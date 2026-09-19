import type Draft from '../../draft'
import { initiateDiscard } from '../../rules/discard'
import { openCardSelection } from '../../rules/selectCards'
import { apnapSeats } from '../../turnOrder'
import type { GameObject, StackItem } from '../../types'
import type { BufferedStackAction } from './types'

export const discardSeatFor = (
  source: GameObject,
  item?: StackItem,
  who: 'controller' | 'target' = 'controller',
) => {
  if (who === 'target') {
    const target = item?.targets[0]
    if (target?.kind === 'player') return target.player
  }
  return source.controller
}

export const instructionAmount = (
  amount: number | 'triggerAmount',
  item?: StackItem,
) => amount === 'triggerAmount'
  ? typeof item?.payload?.triggerAmount === 'number'
    ? item.payload.triggerAmount
    : 0
  : amount

export const flushStackActions = (
  draft: Draft,
  source: GameObject,
  buffer: BufferedStackAction[],
  item?: StackItem,
) => {
  for (const action of buffer) {
    if (action.kind === 'draw') {
      draft.enqueue({
        type: 'draw',
        seat: source.controller,
        count: action.remaining,
      })
      continue
    }
    const seat = discardSeatFor(source, item, action.who)
    initiateDiscard(draft, {
      seat,
      count: action.count,
      chooser: seat,
      sourceId: source.id,
      name: source.name,
    })
  }
}

export const askPlayerDiscard = (
  draft: Draft,
  source: GameObject,
  seat: string,
  count: number,
  prompt = count === 1
    ? `${source.name} makes you discard a card. Choose one.`
    : `${source.name} makes you discard ${count} cards. Choose ${count}.`,
) => {
  const candidates = draft.zoneOrder[seat].hand
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat,
    kind: 'discard',
    count,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt,
    destinations: ['graveyard'],
    fromSeat: seat,
    sequence: draft.allocTs(),
  })
}

export const askEachPlayerDiscard = (
  draft: Draft,
  source: GameObject,
  count: number,
) => {
  for (const seat of apnapSeats(draft)) {
    askPlayerDiscard(
      draft,
      source,
      seat,
      count,
      count === 1
        ? `${source.name} makes each player discard a card. Choose one.`
        : `${source.name} makes each player discard ${count} cards. Choose ${count}.`,
    )
  }
}

export const askPlayerSacrifice = (
  draft: Draft,
  source: GameObject,
  seat: string,
  type = 'Creature',
  prompt = `${source.name} makes you sacrifice a ${type.toLowerCase()}. Choose one.`,
) => {
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === seat
      && object.types.includes(type))
    .map((object) => object.id)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat,
    kind: 'sacrifice',
    count: 1,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt,
    destinations: ['battlefield', 'sacrifice'],
    fromSeat: seat,
    sequence: draft.allocTs(),
  })
}

export const askEachPlayerSacrifice = (
  draft: Draft,
  source: GameObject,
  type = 'Creature',
) => {
  for (const seat of apnapSeats(draft)) {
    askPlayerSacrifice(
      draft,
      source,
      seat,
      type,
      `${source.name} makes each player sacrifice a ${type.toLowerCase()}. Choose one.`,
    )
  }
}
