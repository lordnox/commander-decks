import type { PluginCatalog } from '../catalog'
import type Draft from '../draft'
import { freezeDraft, makeDraft } from '../draft'
import { openOptionSelection } from '../rules/selectOptions'
import { REPLACEMENT_DECLINE_OPTION } from './plugin'
import type { EventProcessingFrame, GameEvent, GameState, ReplacementLineage } from '../types'
import {
  candidatesInCategory,
  discoverReplacementCandidates,
  lowestCategory,
  type ReplacementCandidate,
} from './discovery'
import { applyCanonicalTransform } from './program'
import {
  beginLineage,
  descendantLineage,
  lineageFromEvent,
  markInstanceUsed,
  markOptionalDeclined,
  withLineage,
} from './lineage'

export type ReplacementSettlement =
  | { kind: 'settled'; event: GameEvent; pluginId?: string }
  | { kind: 'prevented'; pluginId?: string }
  | { kind: 'fork'; events: GameEvent[]; pluginId?: string }
  | { kind: 'waiting'; state: GameState }

const MAX_REPLACEMENT_STEPS = 64

const announcementOptions = (transactionId?: string) =>
  transactionId ? { announcementTransactionId: transactionId } : {}

const lineageForProposal = (state: GameState, event: GameEvent) =>
  lineageFromEvent(event) ?? beginLineage(state)

const applyCandidate = (
  proposal: GameEvent,
  candidate: ReplacementCandidate,
  lineage: ReplacementLineage,
): { kind: 'prevented' } | { kind: 'continue'; event: GameEvent } | { kind: 'fork'; events: GameEvent[] } => {
  if (candidate.kind === 'legacy') {
    markInstanceUsed(lineage, candidate.instanceId, candidate.pluginId)
    if (candidate.preview === null) return { kind: 'prevented' }
    if (Array.isArray(candidate.preview)) {
      return { kind: 'fork', events: candidate.preview.map((entry) => withLineage(entry, descendantLineage(lineage))) }
    }
    return { kind: 'continue', event: withLineage(candidate.preview, descendantLineage(lineage)) }
  }
  markInstanceUsed(lineage, candidate.instanceId)
  return applyCanonicalTransform(proposal, candidate, lineage)
}

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
  let proposal = withLineage(event, lineageForProposal(state, event))
  let lineage = lineageFromEvent(proposal)!
  let pluginId: string | undefined
  let guard = 0
  while (guard < MAX_REPLACEMENT_STEPS) {
    guard += 1
    const candidates = discoverReplacementCandidates(
      state,
      proposal,
      catalog,
      lineage.usedInstanceIds,
      lineage.settledOptionalDeclines ?? [],
    )
    if (candidates.length === 0) {
      return { kind: 'settled', event: proposal, pluginId }
    }
    const category = lowestCategory(candidates)
    const pool = candidatesInCategory(candidates, category)
    if (pool.length === 0) return { kind: 'settled', event: proposal, pluginId }

    const structural = pool.filter((candidate) =>
      candidate.kind === 'legacy'
      && candidate.pluginId === 'draw'
      && proposal.type === 'draw'
      && (proposal.count ?? 1) > 1)
    if (structural.length === 1) {
      const applied = applyCandidate(proposal, structural[0]!, lineage)
      pluginId = structural[0]!.pluginId
      if (applied.kind === 'prevented') return { kind: 'prevented', pluginId }
      if (applied.kind === 'fork') return { kind: 'fork', events: applied.events, pluginId }
      proposal = applied.event
      lineage = lineageFromEvent(proposal)!
      continue
    }

    const mandatory = pool.filter((candidate) => !candidate.optional)
    const optional = pool.filter((candidate) => candidate.optional)
    const choosable = mandatory.length > 1 ? mandatory : optional.length > 0 ? optional : mandatory

    if (choosable.length === 1 && !choosable[0]!.optional) {
      const applied = applyCandidate(proposal, choosable[0]!, lineage)
      pluginId = choosable[0]!.kind === 'legacy' ? choosable[0]!.pluginId : choosable[0]!.sourceName
      if (applied.kind === 'prevented') return { kind: 'prevented', pluginId }
      if (applied.kind === 'fork') return { kind: 'fork', events: applied.events, pluginId }
      proposal = applied.event
      lineage = lineageFromEvent(proposal)!
      continue
    }

    if (choosable.length === 0) return { kind: 'settled', event: proposal, pluginId }

    const frame: EventProcessingFrame = {
      version: 1,
      id: `event-${state.nextId}`,
      originalEvent: structuredClone(event),
      pendingEvent: structuredClone(proposal),
      lineage: structuredClone(lineage),
      awaitingCandidateIds: choosable.map((candidate) => candidate.instanceId),
      ...(options.announcementTransactionId ? { announcementTransactionId: options.announcementTransactionId } : {}),
    }
    const draft = makeDraft(state)
    return suspendForChoice(state, frame, draft, choosable)
  }
  return { kind: 'settled', event: proposal, pluginId }
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
  if (decline) {
    markOptionalDeclined(lineage, candidateId)
  }
  const proposal = withLineage(structuredClone(frame.pendingEvent), lineage)
  const resumeState = freezeDraft(makeDraft({ ...state, eventProcessing: frame }))
  if (decline) {
    for (const id of frame.awaitingCandidateIds) markOptionalDeclined(lineage, id)
    return settleReplaceableEvent({ ...resumeState, eventProcessing: undefined }, withLineage(proposal, lineage), catalog, announcementOptions(frame.announcementTransactionId))
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
  const applied = applyCandidate(proposal, chosen, lineage)
  const pluginId = chosen.kind === 'legacy' ? chosen.pluginId : chosen.sourceName
  if (applied.kind === 'prevented') return { kind: 'prevented', pluginId }
  if (applied.kind === 'fork') return { kind: 'fork', events: applied.events, pluginId }
  const cleared = { ...resumeState, eventProcessing: undefined }
  return settleReplaceableEvent(cleared, applied.event, catalog, announcementOptions(frame.announcementTransactionId))
}

export const enqueueReplacementSettlement = (draft: Draft, settlement: ReplacementSettlement) => {
  switch (settlement.kind) {
    case 'prevented':
      return
    case 'fork':
      settlement.events.forEach((entry) => draft.enqueue(entry))
      return
    case 'settled':
      draft.enqueue(settlement.event)
      return
    case 'waiting':
      draft.eventProcessing = settlement.state.eventProcessing
      return
  }
}

export const replaceEvent = (
  state: GameState,
  event: GameEvent,
  catalog: PluginCatalog,
  options: { announcementTransactionId?: string } = {},
): { value: GameEvent | GameEvent[] | null; pluginId?: string; waiting?: GameState } => {
  if (state.eventProcessing) {
    return { value: event, pluginId: undefined }
  }
  const settlement = settleReplaceableEvent(state, event, catalog, options)
  switch (settlement.kind) {
    case 'prevented':
      return { value: null, pluginId: settlement.pluginId }
    case 'fork':
      return { value: settlement.events, pluginId: settlement.pluginId }
    case 'waiting':
      return { value: settlement.state.eventProcessing?.pendingEvent ?? event, waiting: settlement.state }
    case 'settled':
      return { value: settlement.event, pluginId: settlement.pluginId }
  }
}
