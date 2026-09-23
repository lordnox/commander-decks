import type Draft from '../draft'
import type { CardCondition, CardInstruction } from '../cardPlugins/effects'
import type { GameEvent, GameState, PlayerId, Plugin } from '../types'
import { stampLoseAbilitiesBecomeOnOpponentCreatures } from '../cardPlugins/loseAbilitiesStamp'
import type { GameState, PlayerId, Plugin } from '../types'

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
      }
    | {
        kind: 'loseAbilitiesBecomeOpponent'
        extraSubtype: string
        power: number
        toughness: number
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
  for (const seat of state.playerOrder) {
    const pending = pendingPlayerSelectionFor(state, seat)
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
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'selectPlayers') return
    const selection = pendingPlayerSelectionFor(draft, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    clearSelection(draft, event.seat)
    const target = event.players[0]
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
      const source = draft.object(selection.sourceId)
      if (source) {
        draft.addTriggeredAbility(source, selection.action.instructions, {
          ...(selection.action.abilityId ? { abilityId: selection.action.abilityId } : {}),
          targets: [{ kind: 'player', player: target }],
          payload: {
            instructions: selection.action.instructions,
            triggeringPlayer: selection.action.triggeringPlayer,
            ...(selection.action.triggerEffectKey
              ? { triggerEffectKey: selection.action.triggerEffectKey }
              : {}),
            ...(selection.action.interveningIf
              ? { interveningIf: selection.action.interveningIf }
              : {}),
          },
        })
      }
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
    const next = draft.playerOrder
      .map((seat) => pendingPlayerSelectionFor(draft, seat))
      .find(Boolean)
    draft.priority = next?.seat ?? draft.active
  },
}
