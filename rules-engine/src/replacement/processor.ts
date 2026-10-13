import type { PluginCatalog } from '../catalog'
import type Draft from '../draft'
import { freezeDraft, makeDraft } from '../draft'
import { startCanonicalResolution } from '../driver'
import { generatedAbilitySnapshot } from '../cardPlugins/dsl/generatedPrograms'
import { captureObject } from '../objectIdentity'
import { PENDING_OPTION_SELECTION, openOptionSelection } from '../rules/selectOptions'
import { REPLACEMENT_DECLINE_OPTION } from './plugin'
import type {
  EventProcessingFrame,
  GameEvent,
  GameState,
  PreventionFollowUpProgram,
  ReplacementLineage,
} from '../types'
import {
  candidatesInCategory,
  discoverReplacementCandidates,
  lowestCategory,
  type ReplacementCandidate,
} from './discovery'
import { applyCanonicalTransform } from './program'
import {
  applyPreventionToDamage,
  eventsFromPreventionAdditional,
  isImmediatePreventionAdditional,
  preventionAdditionalEffects,
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

const MAX_REPLACEMENT_STEPS = 64

const announcementOptions = (transactionId?: string) =>
  transactionId ? { announcementTransactionId: transactionId } : {}

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

type FollowUpExtras = {
  followUp?: GameEvent[]
  followUpPrograms?: PreventionFollowUpProgram[]
}

const sideEffectsForPrevention = (
  state: GameState,
  candidate: Extract<ReplacementCandidate, { kind: 'prevention' }>,
): FollowUpExtras => {
  const host = state.objects[(state.preventionInstances ?? []).find((entry) => entry.id === candidate.preventionId)?.hostSourceId ?? '']
  const extra = preventionAdditionalEffects(state, candidate.preventionId)
  if (!extra?.length || !host) return {}
  if (extra.every(isImmediatePreventionAdditional)) {
    const followUp = eventsFromPreventionAdditional(state, host.id, host.controller, extra)
    return followUp.length > 0 ? { followUp } : {}
  }
  return {
    followUpPrograms: [{
      hostSourceId: host.id,
      controller: host.controller,
      instructions: structuredClone(extra),
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
    const extras = sideEffectsForPrevention(state, candidate)
    if (proposal.type !== 'dealDamage') {
      return { result: { kind: 'continue', event: proposal, ...extras }, state }
    }
    const applied = applyPreventionToDamage(state, proposal, candidate.preventionId)
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
  const transformed = applyCanonicalTransform(proposal, candidate, lineage)
  if (transformed.kind === 'prevented') return { result: { kind: 'prevented' }, state }
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
      proposal = applied.result.event
      lineage = lineageFromEvent(proposal)!
      continue
    }

    const mandatory = pool.filter((candidate) => !candidate.optional)
    const optional = pool.filter((candidate) => candidate.optional)
    const choosable = mandatory.length > 1 ? mandatory : optional.length > 0 ? optional : mandatory

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
      proposal = applied.result.event
      lineage = lineageFromEvent(proposal)!
      continue
    }

    if (choosable.length === 0) {
      return { kind: 'settled', event: proposal, pluginId, state: workingState, ...followUpFields(followUp, followUpPrograms) }
    }

    const frame: EventProcessingFrame = {
      version: 1,
      id: `event-${workingState.nextId}`,
      originalEvent: structuredClone(event),
      pendingEvent: structuredClone(proposal),
      lineage: structuredClone(lineage),
      awaitingCandidateIds: choosable.map((candidate) => candidate.instanceId),
      ...(options.announcementTransactionId ? { announcementTransactionId: options.announcementTransactionId } : {}),
      ...followUpFields(structuredClone(followUp), structuredClone(followUpPrograms)),
    }
    const draft = makeDraft(workingState)
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
  const frame = state.eventProcessing
  if (!frame || frame.id !== frameId) return { kind: 'invalid', error: 'replacement frame is not active' }
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
  const resumeState = freezeDraft(makeDraft({ ...state, eventProcessing: frame }))
  if (decline) {
    for (const id of frame.awaitingCandidateIds) markOptionalDeclined(lineage, id)
    return attachFollowUps(
      settleReplaceableEvent({ ...resumeState, eventProcessing: undefined }, withLineage(proposal, lineage), catalog, announcementOptions(frame.announcementTransactionId)),
      pendingEvents,
      pendingPrograms,
    )
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
    return {
      kind: 'prevented',
      pluginId,
      state: applied.state,
      ...followUpFields(pendingEvents, pendingPrograms),
    }
  }
  if (applied.result.kind === 'fork') {
    return {
      kind: 'fork',
      events: applied.result.events,
      pluginId,
      state: applied.state,
      ...followUpFields(pendingEvents, pendingPrograms),
    }
  }
  const cleared = mergeState({ ...resumeState, eventProcessing: undefined }, applied.state)
  const continued = settleReplaceableEvent(cleared, applied.result.event, catalog, announcementOptions(frame.announcementTransactionId))
  return attachFollowUps(continued, pendingEvents, pendingPrograms)
}

export const enqueueReplacementSettlement = (draft: Draft, settlement: ReplacementSettlement) => {
  switch (settlement.kind) {
    case 'prevented':
      if (settlement.state?.preventionInstances !== undefined) {
        draft.preventionInstances = settlement.state.preventionInstances
      }
      settlement.followUp?.forEach((entry) => draft.enqueue(entry))
      startPreventionAdditionalPrograms(draft, settlement.followUpPrograms ?? [])
      return
    case 'fork':
      settlement.followUp?.forEach((entry) => draft.enqueue(entry))
      startPreventionAdditionalPrograms(draft, settlement.followUpPrograms ?? [])
      settlement.events.forEach((entry) => draft.enqueue(entry))
      return
    case 'settled':
      if (settlement.state?.preventionInstances !== undefined) {
        draft.preventionInstances = settlement.state.preventionInstances
      }
      settlement.followUp?.forEach((entry) => draft.enqueue(entry))
      startPreventionAdditionalPrograms(draft, settlement.followUpPrograms ?? [])
      draft.enqueue(settlement.event)
      return
    case 'waiting': {
      const waiting = settlement.state
      draft.eventProcessing = waiting.eventProcessing
      if (waiting.preventionInstances) draft.preventionInstances = waiting.preventionInstances
      draft.nextId = waiting.nextId
      draft.priority = waiting.priority
      for (const seat of waiting.playerOrder) {
        const pending = waiting.players[seat]?.data[PENDING_OPTION_SELECTION]
        if (pending) draft.players[seat].data[PENDING_OPTION_SELECTION] = structuredClone(pending)
        else delete draft.players[seat].data[PENDING_OPTION_SELECTION]
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
  if (state.eventProcessing) {
    return { value: event, pluginId: undefined }
  }
  const settlement = settleReplaceableEvent(state, event, catalog, options)
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
