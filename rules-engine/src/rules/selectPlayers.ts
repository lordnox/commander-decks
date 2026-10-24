import { REPLACEMENT_APPLICATION_PLAYER_CHOICE } from '../replacement/constants'
import { freezeDraft } from '../draft'
import { resumeReplacementProgramChoice, enqueueReplacementSettlement } from '../replacement/processor'
import { PLAYER_PROGRAM_CHOICE_ACTION } from '../cardPlugins/dsl/playerProgramConstants'
import { CONTROL_CHOICE_ACTION } from '../cardPlugins/dsl/controlConstants'
import { continueControlAssignment } from '../cardPlugins/dsl/controlAssignment'
import type { ControlAssignment } from '../cardPlugins/dsl/controlAssignment'
import type Draft from '../draft'
import type { CardCondition, CardInstruction } from '../cardPlugins/effects'
import type { GameEvent, GameState, PlayerId, Plugin, StackExecutionContext } from '../types'
import { stampLoseAbilitiesBecomeOnOpponentCreatures } from '../cardPlugins/loseAbilitiesStamp'
import { openOpponentPilePartition } from './selectCards'
import { advanceCopySlot } from './selectOptions'
import { canonicalChoiceAnnouncement, continueCanonicalTargetSelection } from './canonicalAnnouncement'
import type { CanonicalChoicePayload } from './canonicalAnnouncement'
import { canonicalCopySource, copyTargetsWithReplacement, validateCanonicalCopyTarget } from '../cardPlugins/dsl/copies'

export const PENDING_PLAYER_SELECTION = 'kernel.pendingPlayerSelection'

export type PendingPlayerSelection = {
  id: string
  seat: PlayerId
  sourceId: string
  source: string
  prompt: string
  min: number
  max: number
  candidates: PlayerId[]
  action:
    | { kind: typeof REPLACEMENT_APPLICATION_PLAYER_CHOICE; frameId: string; binding: string }
    | { kind: typeof PLAYER_PROGRAM_CHOICE_ACTION.choose; stackId: string; binding: string }
    | ControlAssignment
    | { kind: 'canonicalProliferatePlayers'; stackId: string }
    | { kind: 'canonicalCopyTargets'; stackId: string; copyStackId: string; controller: PlayerId; slotIndex?: number }
    | { kind: 'exchangeLifeTotals'; drawLifeLost?: boolean }
    | { kind: 'drawHandDifference' }
    | { kind: 'copyStackItem'; stackId: string }
    | { kind: 'designateBattleProtector' }
    | { kind: 'assignDonatedPermanent'; donationId: string; objectId: string }
    | {
        kind: 'finishGiftCast'
        cast: Omit<Extract<GameEvent, { type: 'castSpell' }>, 'type' | 'giftRecipient'>
      }
    | {
        kind: 'putTriggeredAbility'
        instructions: CardInstruction[]
        triggeringPlayer: PlayerId
        abilityId?: string
        triggerEffectKey?: string
        interveningIf?: CardCondition
        x?: number
        /** Extra stack payload, such as a Saga's `sagaChapter` and re-checked `targetFilter`. */
        payload?: Record<string, unknown>
        execution?: StackExecutionContext
      }
    | ({ kind: 'putCanonicalTriggeredAbility' } & CanonicalChoicePayload)
    | {
        kind: 'loseAbilitiesBecomeOpponent'
        extraSubtype: string
        power: number
        toughness: number
      }
    | {
        kind: 'opponentPiles'
        count: number
        reveal: 'public' | 'look'
        piles: 'public' | 'facedown-faceup'
      }
}

const isSelection = (value: unknown): value is PendingPlayerSelection =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingPlayerSelection).id === 'string'
  && typeof (value as PendingPlayerSelection).seat === 'string'
  && Array.isArray((value as PendingPlayerSelection).candidates)

export const pendingPlayerSelectionsFor = (
  state: GameState | Draft,
  seat: PlayerId,
) => {
  const value = state.players[seat]?.data[PENDING_PLAYER_SELECTION]
  return Array.isArray(value) ? value.filter(isSelection) : []
}

export const pendingPlayerSelectionFor = (state: GameState | Draft, seat: PlayerId) =>
  pendingPlayerSelectionsFor(state, seat)[0]

export const pendingPlayerSelection = (state: GameState | Draft, seat?: PlayerId) => {
  if (seat) return pendingPlayerSelectionFor(state, seat)
  for (const candidate of state.playerOrder) {
    const pending = pendingPlayerSelectionFor(state, candidate)
    if (pending) return pending
  }
}

export const openPlayerSelection = (
  draft: Draft,
  selection: Omit<PendingPlayerSelection, 'id'>,
) => {
  const pending = { id: draft.allocId('player-selection'), ...selection }
  draft.players[selection.seat].data[PENDING_PLAYER_SELECTION] = [
    ...pendingPlayerSelectionsFor(draft, selection.seat),
    pending,
  ]
  draft.priority = pendingPlayerSelection(draft)?.seat ?? selection.seat
  return pending
}

const clearSelection = (draft: Draft, seat: PlayerId) => {
  const remaining = pendingPlayerSelectionsFor(draft, seat).slice(1)
  if (remaining.length > 0) {
    draft.players[seat].data[PENDING_PLAYER_SELECTION] = remaining
  } else {
    delete draft.players[seat].data[PENDING_PLAYER_SELECTION]
  }
}

export const selectPlayers: Plugin = {
  id: 'selectPlayers',
  legal: ({ state, event }) => {
    const pending = pendingPlayerSelection(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} is choosing players for ${pending.source}`
    }
    if (event.type !== 'selectPlayers') return
    const selection = pendingPlayerSelectionFor(state, event.seat)
    if (!selection) return `${event.seat} has no open player selection`
    if (selection.id !== event.selectionId) return 'that player selection is no longer open'
    if (new Set(event.players).size !== event.players.length) {
      return 'players must not contain duplicates'
    }
    if (event.players.length < selection.min || event.players.length > selection.max) {
      return `choose between ${selection.min} and ${selection.max} player(s)`
    }
    if (event.players.some((seat) =>
      !selection.candidates.includes(seat) || state.players[seat]?.lost)) {
      return 'illegal player choice'
    }
    if (selection.action.kind === 'canonicalCopyTargets') {
      const action = selection.action
      const frame = state.resolution?.kind === 'canonicalSpell' && state.resolution.stackId === action.stackId
        ? state.resolution
        : undefined
      const original = state.stack.find((item) => item.id === action.copyStackId)
      const source = original ? canonicalCopySource(state, original) : undefined
      const job = frame?.pendingCopyTargets?.[0]
      if (frame && job && original && source) {
        const error = validateCanonicalCopyTarget(state, original, source, action.slotIndex ?? 0, { kind: 'player', player: event.players[0]! }, job.answers, action.controller)
        if (error) return error
      }
    }
  },
  apply: ({ event, draft, catalog }) => {
    if (event.type !== 'selectPlayers') return
    const selection = pendingPlayerSelectionFor(draft, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    clearSelection(draft, event.seat)
    const target = event.players[0]
    if (selection.action.kind === REPLACEMENT_APPLICATION_PLAYER_CHOICE) {
      const settled = resumeReplacementProgramChoice(freezeDraft(draft), selection.action.frameId, selection.action.binding, event.players, catalog)
      if (settled.kind !== 'invalid') enqueueReplacementSettlement(draft, settled)
      return
    }
    if (selection.action.kind === PLAYER_PROGRAM_CHOICE_ACTION.choose) {
      const frame = draft.resolution
      if (frame?.kind === 'canonicalSpell' && frame.stackId === selection.action.stackId) {
        frame.choices = { ...frame.choices, [selection.action.binding]: event.players.map(playerId => ({ kind: 'player' as const, playerId })) }
      }
      return
    }
    if (selection.action.kind === CONTROL_CHOICE_ACTION.assign && target) {
      continueControlAssignment(draft, selection.action, target)
      return
    }
    if (selection.action.kind === 'canonicalProliferatePlayers') {
      const events: GameEvent[] = []
      const pending = draft.resolution?.kind === 'canonicalSpell' ? draft.resolution.pendingProliferate : undefined
      for (const objectId of pending?.objectIds ?? []) {
        const object = draft.object(objectId)
        if (object) for (const counter of Object.keys(object.counters)) events.push({ type: 'proliferateCounter', recipient: { kind: 'object', objectId, counter } })
      }
      for (const seat of event.players) {
        const player = draft.players[seat]
        if (player.poison > 0) events.push({ type: 'proliferateCounter', recipient: { kind: 'player', seat, counter: 'poison' } })
        if ((player.energy ?? 0) > 0) events.push({ type: 'proliferateCounter', recipient: { kind: 'player', seat, counter: 'energy' } })
      }
      if (draft.resolution?.kind === 'canonicalSpell') {
        draft.resolution.pendingEvents = events.length > 1 ? [{ type: 'actionGroup', events }] : events
        delete draft.resolution.pendingProliferate
      }
    }
    if (selection.action.kind === 'canonicalCopyTargets' && target) {
      if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.pendingCopyTargets?.length) {
        advanceCopySlot(draft, draft.resolution, { kind: 'player', player: target })
        return
      }
      const action = selection.action
      const original = draft.stack.find((item) => item.id === action.copyStackId)
      if (original) {
        const targets = copyTargetsWithReplacement(original, action.slotIndex ?? 0, { kind: 'player', player: target })
        if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId) {
          draft.resolution.afterChoiceEvents = [{ type: 'copySpell', stackId: original.id, controller: action.controller, targets, retarget: true, sourceId: draft.resolution.source.ref.objectId }]
        }
      }
    }
    if (selection.action.kind === 'exchangeLifeTotals' && target) {
      const lifeLost = Math.max(
        0,
        draft.players[event.seat].life - draft.players[target].life,
      )
      draft.enqueue({
        type: 'exchangeLifeTotals',
        first: event.seat,
        second: target,
        source: selection.sourceId,
      })
      if (selection.action.drawLifeLost && lifeLost > 0) {
        draft.enqueue({ type: 'draw', seat: event.seat, count: lifeLost })
      }
    }
    if (selection.action.kind === 'drawHandDifference' && target) {
      const yourHand = draft.zoneOrder[event.seat].hand.length
      const theirHand = draft.zoneOrder[target].hand.length
      const count = Math.max(0, theirHand - yourHand)
      if (count > 0) {
        draft.enqueue({ type: 'draw', seat: event.seat, count })
      }
    }
    if (selection.action.kind === 'putTriggeredAbility' && target) {
      const source = selection.action.execution?.source.snapshot ?? draft.object(selection.sourceId)
      if (source) {
        draft.addTriggeredAbility(source, selection.action.instructions, {
          ...(selection.action.abilityId ? { abilityId: selection.action.abilityId } : {}),
          ...(selection.action.x !== undefined ? { x: selection.action.x } : {}),
          targets: [{ kind: 'player', player: target }],
          ...(selection.action.execution ? { execution: selection.action.execution } : {}),
          payload: {
            instructions: selection.action.instructions,
            triggeringPlayer: selection.action.triggeringPlayer,
            ...(selection.action.triggerEffectKey
              ? { triggerEffectKey: selection.action.triggerEffectKey }
              : {}),
            ...(selection.action.interveningIf
              ? { interveningIf: selection.action.interveningIf }
              : {}),
            ...selection.action.payload,
          },
        })
      }
    }
    if (selection.action.kind === 'putCanonicalTriggeredAbility') {
      const selectedTargets = [
        ...(selection.action.selectedTargets ?? []),
        ...event.players.map((player) => ({ kind: 'player' as const, player })),
      ]
      const targetIndex = selection.action.targetIndex ?? 0
      const targetClauses = selection.action.targetClauses ?? [{ min: event.players.length, max: event.players.length }]
      const announcement = canonicalChoiceAnnouncement(selection.action, {
        source: selection.action.execution.source.snapshot,
        sourceId: selection.action.sourceId,
        targetClauses: selection.action.targetClauseDefinitions ?? [],
        targets: selectedTargets,
        clauseBounds: targetClauses,
        clauseIndex: targetIndex + 1,
      })
      continueCanonicalTargetSelection(draft, announcement)
      return
    }
    if (selection.action.kind === 'designateBattleProtector' && target) {
      const battle = draft.object(selection.sourceId)
      if (battle?.zone === 'battlefield' && battle.types.includes('Battle')) {
        battle.protector = target
      }
    }
    if (selection.action.kind === 'loseAbilitiesBecomeOpponent' && target) {
      stampLoseAbilitiesBecomeOnOpponentCreatures(draft, target, selection.action)
    }
    if (selection.action.kind === 'opponentPiles' && target) {
      openOpponentPilePartition(draft, {
        opponent: target,
        controller: event.seat,
        sourceId: selection.sourceId,
        source: selection.source,
        count: selection.action.count,
        reveal: selection.action.reveal,
        piles: selection.action.piles,
      })
    }
    const next = draft.playerOrder
      .map((seat) => pendingPlayerSelectionFor(draft, seat))
      .find(Boolean)
    draft.priority = next?.seat ?? draft.active
  },
}
