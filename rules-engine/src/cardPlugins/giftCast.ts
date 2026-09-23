import type Draft from '../draft'
import type { GameEvent, GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'

type PendingGiftCast = Omit<Extract<GameEvent, { type: 'castSpell' }>, 'type' | 'giftRecipient'>
import { effectsOf } from './cardRules'
import type { GiftSpec } from './effectDefinitions'
import { createToken } from './effectRuntime'
import {
  openPlayerSelection,
  pendingPlayerSelectionFor,
} from '../rules/selectPlayers'

export const giftSpecOf = (object: GameObject): GiftSpec | undefined =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.gift ? [effect.gift] : [])[0]

const livingOpponents = (state: GameState | Draft, seat: PlayerId) =>
  state.playerOrder.filter((id) => id !== seat && !state.players[id].lost)

export const deliverGift = (
  draft: Draft,
  spec: GiftSpec,
  recipient: PlayerId,
  sourceName: string,
) => {
  if (spec.draw) {
    draft.enqueue({ type: 'draw', seat: recipient, count: spec.draw })
  }
  if (spec.token) {
    const { token } = spec
    createToken(draft, recipient, {
      name: token.name,
      types: token.types,
      subtypes: token.subtypes ?? [],
      power: token.power ?? null,
      toughness: token.toughness ?? null,
      oracleText: token.oracleText,
      ...(token.tapped ? { tapped: true } : {}),
    })
  }
  if (spec.extraTurn) {
    if (!draft.extraTurns) draft.extraTurns = []
    draft.extraTurns.push(recipient)
    draft.note(`${recipient} will take an extra turn after this turn (${sourceName})`)
  }
}

export const giftCast: Plugin = {
  id: 'giftCast',
  replace: ({ state, event }) => {
    if (event.type !== 'castSpell' || !event.giftPromised || event.giftRecipient) return
    const object = state.objects[event.objectId]
    if (!object || !giftSpecOf(object)) return
    if (livingOpponents(state, event.seat).length === 0) return
    const {
      type: _type,
      giftRecipient: _recipient,
      ...cast
    } = event
    return [{
      type: 'custom' as const,
      name: 'giftCast.openSelection',
      seat: event.seat,
      payload: { cast },
    }]
  },
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    const gift = object ? giftSpecOf(object) : undefined
    if (event.giftPromised && !gift) return 'this spell has no gift cost'
    if (event.giftRecipient && !event.giftPromised) return 'gift was not promised'
    if (event.giftPromised) {
      const opponents = livingOpponents(state, event.seat)
      if (opponents.length === 0) return 'no opponents to receive the gift'
      if (event.giftRecipient) {
        if (event.giftRecipient === event.seat) return 'cannot gift yourself'
        if (!opponents.includes(event.giftRecipient)) return 'illegal gift recipient'
      }
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === 'giftCast.openSelection') {
      const cast = event.payload?.cast as PendingGiftCast | undefined
      const object = cast ? state.objects[cast.objectId] : undefined
      if (!cast || !object) return
      const candidates = livingOpponents(draft, event.seat)
      if (candidates.length === 0) return
      openPlayerSelection(draft, {
        seat: event.seat,
        sourceId: cast.objectId,
        source: object.name,
        prompt: 'Choose an opponent to receive the gift.',
        min: 1,
        max: 1,
        candidates,
        action: { kind: 'finishGiftCast', cast },
      })
      return
    }
    if (event.type === 'selectPlayers') {
      const selection = pendingPlayerSelectionFor(state, event.seat)
      if (selection?.action.kind !== 'finishGiftCast') return
      const recipient = event.players[0]
      if (!recipient) return
      draft.enqueue({
        type: 'castSpell',
        ...selection.action.cast,
        giftRecipient: recipient,
      })
      return
    }

    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item || item.kind !== 'spell' || !item.giftPromised || !item.giftRecipient) return
    const object = state.objects[item.objectId]
    const spec = object ? giftSpecOf(object) : undefined
    if (!spec) return
    deliverGift(draft, spec, item.giftRecipient, object?.name ?? item.name)
  },
}

export const giftPromisedOnStack = (item?: StackItem) => item?.giftPromised === true
