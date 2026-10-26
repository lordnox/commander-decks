import type { PluginCatalog } from '../catalog'
import type Draft from '../draft'
import { freezeDraft, makeDraft } from '../draft'
import { startCanonicalResolution } from '../driver'
import { generatedAbilitySnapshot } from '../cardPlugins/dsl/generatedPrograms'
import { captureObject } from '../objectIdentity'
import { pendingSelectionFor, PENDING_SELECTION } from '../rules/selectCards'
import { PENDING_OPTION_SELECTION, openOptionSelection, pendingOptionSelection } from '../rules/selectOptions'
import { REPLACEMENT_DECLINE_OPTION } from './plugin'
import type { Instruction, ReplacementProgramInstruction, ReplacementTransform } from '../cardPlugins/dsl/schema/v2'
import {
  advanceApplicationProgram,
  initApplicationProgram,
  rememberApplicationChoice,
  type ApplicationProgramStep,
} from './applicationProgram'
import type {
  EventProcessingFrame,
  GameEvent,
  GameState,
  OccurrenceSnapshot,
  PreventionFollowUpProgram,
  ReplacementLineage,
} from '../types'
import {
  candidatesInCategory,
  discoverReplacementCandidates,
  lowestCategory,
  type ReplacementCandidate,
} from './discovery'
import { advanceReplacementProgram, initReplacementProgram } from './instructionProgram'
import { applyCanonicalTransform } from './program'
import {
  applyPreventionToDamage,
  eventsFromPreventionAdditional,
  isImmediatePreventionAdditional,
  preventionAdditionalEffects,
  preventionFollowUpOccurrence,
  syncStaticPreventionInstances,
} from './prevention'
import {
  beginLineage,
  descendantLineage,
  lineageFromEvent,
  markInstanceUsed,
  markOptionalDeclined,
  withLineage,
} from './lineage'

export type ReplacementSettlement =
  | { kind: 'settled'; event: GameEvent; pluginId?: string; state?: GameState; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] }
  | { kind: 'prevented'; pluginId?: string; state?: GameState; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] }
  | { kind: 'fork'; events: GameEvent[]; pluginId?: string; state?: GameState; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] }
  | { kind: 'waiting'; state: GameState }

export const REPLACEMENT_DISCARD_RESUME = 'replacement.discardResume'

const MAX_REPLACEMENT_STEPS = 64

const isLegacyPrevent = (candidate: ReplacementCandidate) =>
  candidate.kind === 'legacy' && candidate.preview === null

const allMandatoryPrevent = (candidates: readonly ReplacementCandidate[]) =>
  candidates.length > 0
  && candidates.every((candidate) => !candidate.optional && isLegacyPrevent(candidate))

const announcementOptions = (transactionId?: string) =>
  transactionId ? { announcementTransactionId: transactionId } : {}

const processingFrames = (state: Pick<GameState, 'eventProcessing' | 'deferredEventProcessing'>) =>
  [state.eventProcessing, ...(state.deferredEventProcessing ?? [])].filter(
    (frame): frame is EventProcessingFrame => frame !== undefined,
  )

const processingStore = (frames: readonly EventProcessingFrame[]) => ({
  eventProcessing: frames[0],
  deferredEventProcessing: frames.length > 1 ? frames.slice(1) : undefined,
})

const adoptSettlementWorld = (draft: Draft, source: GameState) => {
  draft.objects = structuredClone(source.objects)
  draft.zoneOrder = structuredClone(source.zoneOrder)
  draft.log = [...source.log]
  draft.rules = structuredClone(source.rules)
  draft.stack = structuredClone(source.stack)
  draft.players = structuredClone(source.players)
  draft.nextId = source.nextId
  draft.nextTimestamp = source.nextTimestamp
  draft.turn = source.turn
  draft.step = source.step
  draft.active = source.active
  if (source.preventionInstances) draft.preventionInstances = source.preventionInstances
}

const applyProcessingStore = (draft: Draft, source: GameState) => {
  const active = source.eventProcessing
  const choice = active?.chooser ? pendingOptionSelection(source, active.chooser) : undefined
  const cards = active?.chooser ? pendingSelectionFor(source, active.chooser) : undefined
  if (active?.chooser) {
    const ownOption = choice && 'frameId' in choice.action && choice.action.frameId === active.id
    const ownCards = cards?.canonicalChoice?.replacementFrameId === active.id
    if (ownOption) draft.players[active.chooser]!.data[PENDING_OPTION_SELECTION] = structuredClone(choice)
    if (ownCards) draft.players[active.chooser]!.data[PENDING_SELECTION] = structuredClone(cards)
    if (ownOption || ownCards) {
      draft.nextId = Math.max(draft.nextId, source.nextId)
      draft.priority = active.chooser
    }
  }
  if (source.eventProcessing) draft.eventProcessing = source.eventProcessing
  else delete draft.eventProcessing
  if (source.deferredEventProcessing?.length) {
    draft.deferredEventProcessing = source.deferredEventProcessing
  } else {
    delete draft.deferredEventProcessing
  }
}

const deferWaiting = (current: GameState, incoming: GameState) => {
  const incomingFrame = incoming.eventProcessing
  if (!incomingFrame) return incoming
  const chooser = incomingFrame.chooser
  const existingChoice = chooser ? pendingOptionSelection(current, chooser) : undefined
  const existingCards = chooser ? pendingSelectionFor(current, chooser) : undefined
  const keepExistingChoice = (existingChoice && 'frameId' in existingChoice.action && existingChoice.action.frameId !== incomingFrame.id)
    || (existingCards?.canonicalChoice?.replacementFrameId && existingCards.canonicalChoice.replacementFrameId !== incomingFrame.id)
  const players = { ...incoming.players }
  if (keepExistingChoice && chooser) {
    const data = { ...incoming.players[chooser]!.data }
    for (const key of [PENDING_OPTION_SELECTION, PENDING_SELECTION]) {
      const value = current.players[chooser]!.data[key]
      if (value !== undefined) data[key] = structuredClone(value)
      else delete data[key]
    }
    players[chooser] = { ...incoming.players[chooser]!, data }
  }
  return {
    ...incoming,
    players,
    ...processingStore([...processingFrames(current), incomingFrame]),
  }
}

const reattachProcessing = (
  settlement: ReplacementSettlement,
  original: GameState,
  completedId: string,
  fallback: GameState,
  catalog: PluginCatalog,
): ReplacementSettlement => {
  const completedWasPrimary = original.eventProcessing?.id === completedId
  const remaining = processingFrames(original).filter((frame) => frame.id !== completedId)
  if (settlement.kind === 'waiting') {
    const continuation = settlement.state.eventProcessing
    const frames = continuation
      ? (completedWasPrimary ? [continuation, ...remaining] : [...remaining, continuation])
      : remaining
    return { ...settlement, state: { ...settlement.state, ...processingStore(frames) } }
  }
  const base = settlement.state ?? fallback
  const next = makeDraft({ ...base, ...processingStore(remaining) })
  const active = next.eventProcessing
  const openChoice = Boolean(
    active?.chooser
    && (pendingOptionSelection(next, active.chooser) || pendingSelectionFor(next, active.chooser)),
  )
  if (active?.applicationProgram && !openChoice) {
    const instruction = active.applicationProgram.instructions[active.applicationProgram.index]
    const shouldResume = Boolean(
      active.applicationProgram.pendingEmit
      || instruction?.kind === 'chooseCards'
      || instruction?.kind === 'choose'
      || instruction?.kind === 'emit',
    )
    if (shouldResume) {
      const reopen = instruction?.kind === 'chooseCards' || instruction?.kind === 'choose'
      const reopened = advanceApplicationProgram(freezeDraft(next), active, reopen, catalog)
      if (reopened.kind === 'waiting') return { ...settlement, state: reopened.state }
      return settleApplicationStep(
        reopened,
        active.pendingEvent,
        active.lineage,
        active.applicationProgram.sourceId,
        active.applicationProgram.controller,
        active.chooser,
        catalog,
        announcementOptions(active.announcementTransactionId),
        [...(active.followUp ?? [])],
        [...(active.followUpPrograms ?? [])],
      )
    }
  }
  if (active?.chooser && active.awaitingCandidateIds.length > 0 && !pendingOptionSelection(next, active.chooser)) {
    const candidates = discoverReplacementCandidates(
      freezeDraft(next), active.pendingEvent, catalog,
      active.lineage.usedInstanceIds, active.lineage.settledOptionalDeclines ?? [],
    ).filter(candidate => active.awaitingCandidateIds.includes(candidate.instanceId))
    if (candidates.length > 0) openModifierChoice(next, active, candidates, active.chooser)
  }
  return { ...settlement, state: freezeDraft(next) }
}

const lineageForProposal = (state: GameState, event: GameEvent) =>
  lineageFromEvent(event) ?? beginLineage(state)

const candidateLabel = (candidate: ReplacementCandidate) => {
  if (candidate.kind === 'legacy') return candidate.pluginId
  if (candidate.kind === 'canonical') return candidate.sourceName
  return candidate.label
}

type ApplyResult =
  | { kind: 'prevented'; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] }
  | { kind: 'continue'; event: GameEvent; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] }
  | { kind: 'fork'; events: GameEvent[]; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] }
  | {
    kind: 'program'
    instructions: readonly Instruction[]
    sourceId: string
    controller: string
    occurrencePlayer: string
    followUp?: GameEvent[]
    followUpPrograms?: PreventionFollowUpProgram[]
  }
  | {
    kind: 'applicationProgram'
    instructions: readonly ReplacementProgramInstruction[]
    transform: ReplacementTransform
    sourceId: string
    controller: string
    chooser: string
    followUp?: GameEvent[]
    followUpPrograms?: PreventionFollowUpProgram[]
  }

type FollowUpExtras = {
  followUp?: GameEvent[]
  followUpPrograms?: PreventionFollowUpProgram[]
}

const sideEffectsForPrevention = (
  state: GameState,
  candidate: Extract<ReplacementCandidate, { kind: 'prevention' }>,
  occurrence: OccurrenceSnapshot,
): FollowUpExtras => {
  const instance = (state.preventionInstances ?? []).find((entry) => entry.id === candidate.preventionId)
  const host = state.objects[instance?.hostSourceId ?? '']
  const extra = preventionAdditionalEffects(state, candidate.preventionId)
  if (!extra?.length || !host) return {}
  if (extra.length === 1 && extra.every(isImmediatePreventionAdditional)) {
    const followUp = eventsFromPreventionAdditional(state, host.id, host.controller, extra, occurrence)
    return followUp.length > 0 ? { followUp } : {}
  }
  return {
    followUpPrograms: [{
      hostSourceId: host.id,
      controller: host.controller,
      instructions: structuredClone(extra),
      occurrence: structuredClone(occurrence),
    }],
  }
}

const mergeFollowUpLists = (
  events: GameEvent[],
  programs: PreventionFollowUpProgram[],
  extras?: FollowUpExtras,
) => {
  if (extras?.followUp) events.push(...extras.followUp)
  if (extras?.followUpPrograms) programs.push(...extras.followUpPrograms)
}

const followUpFields = (events: GameEvent[], programs: PreventionFollowUpProgram[]): FollowUpExtras => ({
  ...(events.length > 0 ? { followUp: events } : {}),
  ...(programs.length > 0 ? { followUpPrograms: programs } : {}),
})

const attachFollowUps = (
  settlement: ReplacementSettlement,
  events: GameEvent[],
  programs: PreventionFollowUpProgram[],
): ReplacementSettlement => {
  if (events.length === 0 && programs.length === 0) return settlement
  if (settlement.kind === 'waiting') {
    const frame = settlement.state.eventProcessing
    if (!frame) return settlement
    return {
      ...settlement,
      state: {
        ...settlement.state,
        eventProcessing: {
          ...frame,
          ...followUpFields(
            [...(frame.followUp ?? []), ...events],
            [...(frame.followUpPrograms ?? []), ...programs],
          ),
        },
      },
    }
  }
  if (settlement.kind === 'settled' || settlement.kind === 'prevented' || settlement.kind === 'fork') {
    return {
      ...settlement,
      ...followUpFields(
        [...events, ...(settlement.followUp ?? [])],
        [...programs, ...(settlement.followUpPrograms ?? [])],
      ),
    }
  }
  return settlement
}

export const startPreventionAdditionalPrograms = (
  draft: Draft,
  programs: readonly PreventionFollowUpProgram[],
) => {
  for (const program of programs) {
    const host = draft.object(program.hostSourceId)
    if (!host) continue
    const generated = {
      kind: 'triggered' as const,
      on: { kind: 'draw' as const, filter: {} },
      instructions: structuredClone(program.instructions),
    }
    const definitionSnapshot = generatedAbilitySnapshot(generated)
    startCanonicalResolution(draft, {
      id: draft.allocId('inline'),
      kind: 'ability',
      objectId: host.id,
      controller: program.controller,
      name: host.name,
      targets: [],
      payload: { instructions: structuredClone(program.instructions) },
      execution: {
        controller: program.controller,
        source: captureObject(host),
        definitionSnapshot,
        abilityIndex: 0,
        ...(program.occurrence ? { occurrence: structuredClone(program.occurrence) } : {}),
      },
    }, { inline: true })
  }
}

const applyCandidate = (
  proposal: GameEvent,
  candidate: ReplacementCandidate,
  lineage: ReplacementLineage,
  state: GameState,
): { result: ApplyResult; state: GameState } => {
  if (candidate.kind === 'prevention') {
    markInstanceUsed(lineage, candidate.instanceId)
    if (proposal.type !== 'dealDamage') {
      return { result: { kind: 'continue', event: proposal }, state }
    }
    const applied = applyPreventionToDamage(state, proposal, candidate.preventionId)
    const extras = applied.preventedAmount > 0
      ? sideEffectsForPrevention(
        applied.state,
        candidate,
        preventionFollowUpOccurrence(proposal, applied.preventedAmount, applied.state),
      )
      : {}
    if (applied.event.amount <= 0) {
      return { result: { kind: 'prevented', ...extras }, state: applied.state }
    }
    return {
      result: {
        kind: 'continue',
        event: withLineage(applied.event, descendantLineage(lineage)),
        ...extras,
      },
      state: applied.state,
    }
  }
  if (candidate.kind === 'legacy') {
    markInstanceUsed(lineage, candidate.instanceId, candidate.pluginId)
    if (candidate.preview === null) return { result: { kind: 'prevented' }, state }
    if (Array.isArray(candidate.preview)) {
      return {
        result: {
          kind: 'fork',
          events: candidate.preview.map((entry) => withLineage(entry, descendantLineage(lineage))),
        },
        state,
      }
    }
    return {
      result: { kind: 'continue', event: withLineage(candidate.preview, descendantLineage(lineage)) },
      state,
    }
  }
  markInstanceUsed(lineage, candidate.instanceId)
  if (candidate.effect.program?.length) {
    const source = state.objects[candidate.sourceId]
    const selfEntry = candidate.category === 'self' || candidate.category === 'copyAsEntry'
    const sourceController = selfEntry && proposal.type === 'move'
      ? (proposal.controller ?? source?.controller ?? candidate.chooser)
      : (source?.controller ?? candidate.chooser)
    return {
      result: {
        kind: 'applicationProgram',
        instructions: candidate.effect.program,
        transform: candidate.effect.transform,
        sourceId: candidate.sourceId,
        controller: sourceController,
        chooser: selfEntry ? sourceController : candidate.chooser,
      },
      state,
    }
  }
  const transformed = applyCanonicalTransform(proposal, candidate, lineage, state)
  if (transformed.kind === 'prevented') return { result: { kind: 'prevented' }, state }
  if (transformed.kind === 'program') {
    const source = state.objects[candidate.sourceId]
    return {
      result: {
        kind: 'program',
        instructions: transformed.instructions,
        sourceId: candidate.sourceId,
        controller: source?.controller ?? candidate.chooser,
        occurrencePlayer: proposal.type === 'draw' ? proposal.seat : candidate.chooser,
      },
      state,
    }
  }
  if (transformed.kind === 'fork') return { result: transformed, state }
  if (proposal.type === 'dealDamage' && transformed.event.type === 'dealDamage' && transformed.event.amount <= 0) {
    return { result: { kind: 'prevented' }, state }
  }
  return { result: transformed, state }
}

const mergeState = (base: GameState, update: GameState) => ({
  ...base,
  preventionInstances: update.preventionInstances,
  nextId: update.nextId,
})

const openModifierChoice = (
  draft: Draft,
  frame: EventProcessingFrame,
  candidates: readonly ReplacementCandidate[],
  chooser: string,
) => {
  const allOptional = candidates.every((candidate) => candidate.optional)
  openOptionSelection(draft, {
    seat: chooser,
    source: 'Replacement',
    prompt: 'Choose which replacement effect to apply.',
    options: [
      ...candidates.map((candidate) => ({
        id: candidate.instanceId,
        label: candidate.label,
      })),
      ...(allOptional ? [{ id: REPLACEMENT_DECLINE_OPTION, label: 'Decline' }] : []),
    ],
    action: {
      kind: 'replacementModifier',
      frameId: frame.id,
      candidateIds: candidates.map((candidate) => candidate.instanceId),
    },
  })
}

export const drawRemainderFollowUp = (event: GameEvent): GameEvent[] => {
  if (event.type !== 'draw' || !event.remainingAfter || event.remainingAfter < 1) return []
  return [{
    type: 'draw',
    seat: event.seat,
    count: event.remainingAfter,
  }]
}

const settleReplacementProgram = (
  workingState: GameState,
  proposal: GameEvent,
  lineage: ReplacementLineage,
  applied: Extract<ApplyResult, { kind: 'program' }>,
  catalog: PluginCatalog,
  options: { announcementTransactionId?: string },
  followUp: GameEvent[],
  followUpPrograms: PreventionFollowUpProgram[],
): ReplacementSettlement => {
  const program = initReplacementProgram(applied.instructions, {
    sourceId: applied.sourceId,
    controller: applied.controller,
    occurrencePlayer: applied.occurrencePlayer,
  })
  const frame: EventProcessingFrame = {
    version: 1,
    id: `event-${workingState.nextId}`,
    originalEvent: structuredClone(proposal),
    pendingEvent: structuredClone(proposal),
    lineage: structuredClone(lineage),
    awaitingCandidateIds: [],
    program,
    ...(options.announcementTransactionId ? { announcementTransactionId: options.announcementTransactionId } : {}),
    ...followUpFields(structuredClone(followUp), structuredClone(followUpPrograms)),
  }
  const stepped = advanceReplacementProgram({ ...workingState, nextId: workingState.nextId + 1, eventProcessing: frame }, frame, catalog)
  if (stepped.kind === 'waiting') return { kind: 'waiting', state: stepped.state }
  return {
    kind: 'prevented',
    state: stepped.state,
    ...followUpFields([...followUp, ...stepped.followUp, ...drawRemainderFollowUp(proposal)], followUpPrograms),
  }
}

const settleApplicationStep = (
  stepped: ApplicationProgramStep,
  proposal: GameEvent,
  lineage: ReplacementLineage,
  sourceId: string,
  controller: string,
  chooser: string | undefined,
  catalog: PluginCatalog,
  options: { announcementTransactionId?: string },
  followUp: GameEvent[],
  followUpPrograms: PreventionFollowUpProgram[],
): ReplacementSettlement => {
  switch (stepped.kind) {
    case 'waiting':
      return { kind: 'waiting', state: stepped.state }
    case 'prevented':
      return {
        kind: 'prevented',
        state: stepped.state,
        ...followUpFields([...followUp, ...drawRemainderFollowUp(proposal)], followUpPrograms),
      }
    case 'fork':
      return {
        kind: 'fork',
        events: stepped.events,
        state: stepped.state,
        ...followUpFields([...followUp, ...drawRemainderFollowUp(proposal)], followUpPrograms),
      }
    case 'program':
      return settleReplacementProgram(
        { ...stepped.state, eventProcessing: undefined },
        stepped.event,
        lineage,
        {
          kind: 'program',
          instructions: stepped.instructions,
          sourceId,
          controller,
          occurrencePlayer: stepped.event.type === 'draw' ? stepped.event.seat : (chooser ?? controller),
        },
        catalog,
        options,
        followUp,
        followUpPrograms,
      )
    case 'complete':
      return attachFollowUps(
        settleReplaceableEvent(
          { ...stepped.state, eventProcessing: undefined },
          stepped.event,
          catalog,
          options,
        ),
        [...followUp, ...stepped.followUp],
        followUpPrograms,
      )
  }
}

const settleApplicationProgram = (
  workingState: GameState,
  proposal: GameEvent,
  lineage: ReplacementLineage,
  applied: Extract<ApplyResult, { kind: 'applicationProgram' }>,
  catalog: PluginCatalog,
  options: { announcementTransactionId?: string },
  followUp: GameEvent[],
  followUpPrograms: PreventionFollowUpProgram[],
): ReplacementSettlement => {
  const frame: EventProcessingFrame = {
    version: 1,
    id: `event-${workingState.nextId}`,
    originalEvent: structuredClone(proposal),
    pendingEvent: structuredClone(proposal),
    lineage: structuredClone(lineage),
    awaitingCandidateIds: [],
    chooser: applied.chooser,
    applicationProgram: initApplicationProgram(
      applied.instructions,
      applied.transform,
      applied.sourceId,
      applied.controller,
    ),
    ...(options.announcementTransactionId ? { announcementTransactionId: options.announcementTransactionId } : {}),
    ...followUpFields(structuredClone(followUp), structuredClone(followUpPrograms)),
  }
  return settleApplicationStep(
    advanceApplicationProgram(
      { ...workingState, nextId: workingState.nextId + 1, eventProcessing: frame },
      frame,
      false,
      catalog,
    ),
    proposal,
    lineage,
    applied.sourceId,
    applied.controller,
    applied.chooser,
    catalog,
    options,
    followUp,
    followUpPrograms,
  )
}

const suspendForChoice = (
  state: GameState,
  frame: EventProcessingFrame,
  draft: Draft,
  candidates: readonly ReplacementCandidate[],
) => {
  const chooser = candidates[0]?.chooser ?? state.playerOrder[0]
  draft.eventProcessing = frame
  openModifierChoice(draft, frame, candidates, chooser)
  return { kind: 'waiting' as const, state: freezeDraft(draft) }
}

export const settleReplaceableEvent = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
  options: { announcementTransactionId?: string } = {},
): ReplacementSettlement => {
  let workingState = event.type === 'dealDamage' || event.type === 'combatDamage'
    ? syncStaticPreventionInstances(state)
    : state
  let proposal = withLineage(event, lineageForProposal(state, event))
  let lineage = lineageFromEvent(proposal)!
  let pluginId: string | undefined
  const followUp: GameEvent[] = []
  const followUpPrograms: PreventionFollowUpProgram[] = []
  let guard = 0
  while (guard < MAX_REPLACEMENT_STEPS) {
    guard += 1
    const candidates = discoverReplacementCandidates(
      workingState,
      proposal,
      catalog,
      lineage.usedInstanceIds,
      lineage.settledOptionalDeclines ?? [],
    )
    if (candidates.length === 0) {
      return { kind: 'settled', event: proposal, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
    }
    const category = lowestCategory(candidates)
    const pool = candidatesInCategory(candidates, category)
    if (pool.length === 0) {
      return { kind: 'settled', event: proposal, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
    }

    const structural = pool.filter((candidate) =>
      candidate.kind === 'legacy'
      && candidate.pluginId === 'draw'
      && proposal.type === 'draw'
      && (proposal.count ?? 1) > 1)
    if (structural.length === 1) {
      const structuralCandidate = structural[0]!
      const applied = applyCandidate(proposal, structuralCandidate, lineage, workingState)
      pluginId = candidateLabel(structuralCandidate)
      workingState = applied.state
      mergeFollowUpLists(followUp, followUpPrograms, applied.result)
      if (applied.result.kind === 'prevented') {
        return { kind: 'prevented', pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
      }
      if (applied.result.kind === 'fork') {
        return { kind: 'fork', events: applied.result.events, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
      }
      if (applied.result.kind === 'program') {
        return settleReplacementProgram(
          workingState,
          proposal,
          lineage,
          applied.result,
          catalog,
          options,
          followUp,
          followUpPrograms,
        )
      }
      if (applied.result.kind === 'applicationProgram') {
        return settleApplicationProgram(
          workingState,
          proposal,
          lineage,
          applied.result,
          catalog,
          options,
          followUp,
          followUpPrograms,
        )
      }
      proposal = applied.result.event
      lineage = lineageFromEvent(proposal)!
      continue
    }

    const mandatory = pool.filter((candidate) => !candidate.optional)
    const optional = pool.filter((candidate) => candidate.optional)
    const choosable = mandatory.length > 1 ? mandatory : optional.length > 0 ? optional : mandatory

    if (allMandatoryPrevent(mandatory) && optional.length === 0) {
      for (const candidate of mandatory) {
        markInstanceUsed(lineage, candidate.instanceId, candidate.kind === 'legacy' ? candidate.pluginId : undefined)
      }
      return {
        kind: 'prevented',
        pluginId: candidateLabel(mandatory[0]!),
        state: workingState,
        ...followUpFields(followUp, followUpPrograms),
      }
    }

    if (choosable.length === 1 && !choosable[0]!.optional) {
      const applied = applyCandidate(proposal, choosable[0]!, lineage, workingState)
      pluginId = candidateLabel(choosable[0]!)
      workingState = applied.state
      mergeFollowUpLists(followUp, followUpPrograms, applied.result)
      if (applied.result.kind === 'prevented') {
        return { kind: 'prevented', pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
      }
      if (applied.result.kind === 'fork') {
        return { kind: 'fork', events: applied.result.events, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
      }
      if (applied.result.kind === 'program') {
        return settleReplacementProgram(
          workingState,
          proposal,
          lineage,
          applied.result,
          catalog,
          options,
          followUp,
          followUpPrograms,
        )
      }
      if (applied.result.kind === 'applicationProgram') {
        return settleApplicationProgram(
          workingState,
          proposal,
          lineage,
          applied.result,
          catalog,
          options,
          followUp,
          followUpPrograms,
        )
      }
      proposal = applied.result.event
      lineage = lineageFromEvent(proposal)!
      continue
    }

    if (choosable.length === 0) {
      return { kind: 'settled', event: proposal, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
    }

    const chooser = choosable[0]?.chooser ?? workingState.playerOrder[0]
    const frame: EventProcessingFrame = {
      version: 1,
      id: `event-${workingState.nextId}`,
      originalEvent: structuredClone(event),
      pendingEvent: structuredClone(proposal),
      lineage: structuredClone(lineage),
      awaitingCandidateIds: choosable.map((candidate) => candidate.instanceId),
      chooser,
      ...(options.announcementTransactionId ? { announcementTransactionId: options.announcementTransactionId } : {}),
      ...followUpFields(structuredClone(followUp), structuredClone(followUpPrograms)),
    }
    const draft = makeDraft({ ...workingState, nextId: workingState.nextId + 1 })
    return suspendForChoice(workingState, frame, draft, choosable)
  }
  return { kind: 'settled', event: proposal, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
}

export const resumeReplacementChoice = (
  state: GameState,
  frameId: string,
  candidateId: string,
  catalog: PluginCatalog,
  decline = false,
): ReplacementSettlement | { kind: 'invalid'; error: string } => {
  const frame = processingFrames(state).find((entry) => entry.id === frameId)
  if (!frame) return { kind: 'invalid', error: 'replacement frame is not active' }
  if (!frame.awaitingCandidateIds.includes(candidateId)) {
    return { kind: 'invalid', error: 'replacement choice is not authorized' }
  }
  const lineage = structuredClone(frame.lineage)
  const pendingEvents = [...(frame.followUp ?? [])]
  const pendingPrograms = [...(frame.followUpPrograms ?? [])]
  if (decline) {
    markOptionalDeclined(lineage, candidateId)
  }
  const proposal = withLineage(structuredClone(frame.pendingEvent), lineage)
  const isolated = processingStore([frame])
  const resumeState = freezeDraft(makeDraft({
    ...state,
    eventProcessing: isolated.eventProcessing,
    deferredEventProcessing: isolated.deferredEventProcessing,
  }))
  const finish = (settlement: ReplacementSettlement) =>
    reattachProcessing(settlement, state, frameId, resumeState, catalog)
  if (decline) {
    for (const id of frame.awaitingCandidateIds) markOptionalDeclined(lineage, id)
    return finish(attachFollowUps(
      settleReplaceableEvent({ ...resumeState, eventProcessing: undefined, deferredEventProcessing: undefined }, withLineage(proposal, lineage), catalog, announcementOptions(frame.announcementTransactionId)),
      pendingEvents,
      pendingPrograms,
    ))
  }
  const candidates = discoverReplacementCandidates(
    resumeState,
    proposal,
    catalog,
    lineage.usedInstanceIds,
    lineage.settledOptionalDeclines ?? [],
  ).filter((candidate) => candidate.instanceId === candidateId)
  const chosen = candidates[0]
  if (!chosen) return { kind: 'invalid', error: 'replacement modifier is no longer applicable' }
  const applied = applyCandidate(proposal, chosen, lineage, resumeState)
  const pluginId = candidateLabel(chosen)
  mergeFollowUpLists(pendingEvents, pendingPrograms, applied.result)
  if (applied.result.kind === 'prevented') {
    return finish({
      kind: 'prevented',
      pluginId,
      state: applied.state,
      ...followUpFields(pendingEvents, pendingPrograms),
    })
  }
  if (applied.result.kind === 'fork') {
    return finish({
      kind: 'fork',
      events: applied.result.events,
      pluginId,
      state: applied.state,
      ...followUpFields(pendingEvents, pendingPrograms),
    })
  }
  if (applied.result.kind === 'program') {
    const cleared = mergeState({
      ...resumeState,
      eventProcessing: undefined,
      deferredEventProcessing: undefined,
    }, applied.state)
    return finish(attachFollowUps(
      settleReplacementProgram(
        cleared,
        proposal,
        lineage,
        applied.result,
        catalog,
        announcementOptions(frame.announcementTransactionId),
        pendingEvents,
        pendingPrograms,
      ),
      pendingEvents,
      pendingPrograms,
    ))
  }
  if (applied.result.kind === 'applicationProgram') {
    const cleared = mergeState({
      ...resumeState,
      eventProcessing: undefined,
      deferredEventProcessing: undefined,
    }, applied.state)
    return finish(attachFollowUps(
      settleApplicationProgram(
        cleared,
        proposal,
        lineage,
        applied.result,
        catalog,
        announcementOptions(frame.announcementTransactionId),
        pendingEvents,
        pendingPrograms,
      ),
      pendingEvents,
      pendingPrograms,
    ))
  }
  const cleared = mergeState({
    ...resumeState,
    eventProcessing: undefined,
    deferredEventProcessing: undefined,
  }, applied.state)
  const continued = settleReplaceableEvent(cleared, applied.result.event, catalog, announcementOptions(frame.announcementTransactionId))
  return finish(attachFollowUps(continued, pendingEvents, pendingPrograms))
}

export const resumeReplacementProgramChoice = (
  state: GameState,
  frameId: string,
  bindChoice: string,
  optionId: string | readonly string[],
  catalog: PluginCatalog,
): ReplacementSettlement | { kind: 'invalid'; error: string } => {
  const frame = processingFrames(state).find((entry) => entry.id === frameId)
  if (!frame?.applicationProgram) return { kind: 'invalid', error: 'replacement program frame is not active' }
  const pendingEvents = [...(frame.followUp ?? [])]
  const pendingPrograms = [...(frame.followUpPrograms ?? [])]
  const isolated = processingStore([frame])
  const resumeState = freezeDraft(makeDraft({
    ...state,
    eventProcessing: isolated.eventProcessing,
    deferredEventProcessing: isolated.deferredEventProcessing,
  }))
  const advanced = rememberApplicationChoice(resumeState, frameId, bindChoice, optionId, catalog)
  const finish = (settlement: ReplacementSettlement) =>
    reattachProcessing(settlement, state, frameId, resumeState, catalog)
  if (advanced.kind === 'invalid') return advanced
  const program = frame.applicationProgram
  return finish(settleApplicationStep(
    advanced,
    frame.pendingEvent,
    frame.lineage,
    program.sourceId,
    program.controller,
    frame.chooser,
    catalog,
    announcementOptions(frame.announcementTransactionId),
    pendingEvents,
    pendingPrograms,
  ))
}

export const enqueueReplacementSettlement = (draft: Draft, settlement: ReplacementSettlement) => {
  switch (settlement.kind) {
    case 'prevented':
      if (settlement.state) {
        adoptSettlementWorld(draft, settlement.state)
        applyProcessingStore(draft, settlement.state)
      }
      if (settlement.state?.preventionInstances !== undefined) {
        draft.preventionInstances = settlement.state.preventionInstances
      }
      settlement.followUp?.forEach((entry) => draft.enqueue(entry))
      startPreventionAdditionalPrograms(draft, settlement.followUpPrograms ?? [])
      return
    case 'fork':
      if (settlement.state) {
        adoptSettlementWorld(draft, settlement.state)
        applyProcessingStore(draft, settlement.state)
      }
      settlement.followUp?.forEach((entry) => draft.enqueue(entry))
      startPreventionAdditionalPrograms(draft, settlement.followUpPrograms ?? [])
      settlement.events.forEach((entry) => draft.enqueue(entry))
      return
    case 'settled':
      if (settlement.state) {
        adoptSettlementWorld(draft, settlement.state)
        applyProcessingStore(draft, settlement.state)
      }
      if (settlement.state?.preventionInstances !== undefined) {
        draft.preventionInstances = settlement.state.preventionInstances
      }
      settlement.followUp?.forEach((entry) => draft.enqueue(entry))
      startPreventionAdditionalPrograms(draft, settlement.followUpPrograms ?? [])
      draft.enqueue(settlement.event)
      return
    case 'waiting': {
      const waiting = settlement.state
      adoptSettlementWorld(draft, waiting)
      applyProcessingStore(draft, waiting)
      if (waiting.preventionInstances) draft.preventionInstances = waiting.preventionInstances
      draft.nextId = waiting.nextId
      draft.priority = waiting.priority
      for (const seat of waiting.playerOrder) {
        const pendingOption = waiting.players[seat]?.data[PENDING_OPTION_SELECTION]
        if (pendingOption) draft.players[seat].data[PENDING_OPTION_SELECTION] = structuredClone(pendingOption)
        else delete draft.players[seat].data[PENDING_OPTION_SELECTION]
        const pendingCards = waiting.players[seat]?.data[PENDING_SELECTION]
        if (pendingCards) draft.players[seat].data[PENDING_SELECTION] = structuredClone(pendingCards)
        else delete draft.players[seat].data[PENDING_SELECTION]
      }
      return
    }
  }
}

export const replaceEvent = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
  options: { announcementTransactionId?: string } = {},
): { value: GameEvent | GameEvent[] | null; pluginId?: string; waiting?: GameState; state?: GameState; followUp?: GameEvent[]; followUpPrograms?: PreventionFollowUpProgram[] } => {
  const settlement = settleReplaceableEvent(state, event, catalog, options)
  if (settlement.kind === 'waiting' && state.eventProcessing) {
    return {
      value: settlement.state.eventProcessing?.pendingEvent ?? event,
      waiting: deferWaiting(state, settlement.state),
    }
  }
  switch (settlement.kind) {
    case 'prevented':
      return {
        value: null,
        pluginId: settlement.pluginId,
        state: settlement.state,
        followUp: settlement.followUp,
        followUpPrograms: settlement.followUpPrograms,
      }
    case 'fork':
      return {
        value: settlement.events,
        pluginId: settlement.pluginId,
        state: settlement.state,
        followUp: settlement.followUp,
        followUpPrograms: settlement.followUpPrograms,
      }
    case 'waiting':
      return { value: settlement.state.eventProcessing?.pendingEvent ?? event, waiting: settlement.state }
    case 'settled':
      return {
        value: settlement.event,
        pluginId: settlement.pluginId,
        state: settlement.state,
        followUp: settlement.followUp,
        followUpPrograms: settlement.followUpPrograms,
      }
  }
}
