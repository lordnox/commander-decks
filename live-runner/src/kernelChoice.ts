import type { GameObject, GameState } from '../../rules-engine/src/types'
import {
  dialogCandidates,
  pendingDialogsFor,
} from '../../rules-engine/src/pendingDialog'
import type { WaitingDiscard, WaitingSelectCards } from '../../rules-engine/src/actions'
import {
  searchCandidates,
  type PendingSearch,
  type SearchSpec,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import { distinctCardLabels } from '../../shared/liveTypes'
import type { LobbyState, TopdeckDecision } from './lobby'
import type { InboxMessage, SeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'

type TopdeckChoice = Extract<InboxMessage, { type: 'topdeck' }>['choices'][number]

export type TopdeckMessage = Extract<InboxMessage, { type: 'topdeck' }>

/** One open kernel choice, with the state it was read from. */
export type ChoiceContext = {
  kernel: KernelHandle
  lobby: LobbyState
  seat: SeatId
  message: TopdeckMessage
  decision: TopdeckDecision & { kernel: NonNullable<TopdeckDecision['kernel']> }
  state: GameState
}

/** Dialogs that are a plain yes or no, so the seat picks no cards. */
export const OPTIONAL_DIALOGS = new Set([
  'may',
  'may-draw',
  'may-pay-mana',
  'may-pay-life',
  'may-search',
  'ward-pay',
])

export const sameNames = (left: string[], right: string[]) =>
  [...left].sort().join('\0') === [...right].sort().join('\0')

/**
 * Every offered card is answered once, by its position in the offered list.
 * Names may repeat (two Forests), positions never do, so a choice that cannot
 * be matched slot by slot is stale or from a client that predates slots.
 */
export const assertOfferedSlots = (cards: string[], choices: TopdeckChoice[]) => {
  const seen = new Set<number>()
  const answered = choices.length === cards.length && choices.every(({ card, slot }) => {
    if (slot === undefined || seen.has(slot) || cards[slot] !== card) return false
    seen.add(slot)
    return true
  })
  if (!answered) throw new Error('The cards in this choice changed. Refresh and choose again.')
}

/** The candidates of one choice and their names, in the order slots count them. */
type Offer = { ids: string[]; names: string[] }

/**
 * A chooser may read a searched library or an opponent's hand but not learn its
 * order, so those candidates are offered sorted by name. Namesakes keep their
 * zone order, which tells the chooser nothing. Prepare and apply both build
 * their offer here, so slot N is the same card on each side.
 */
const sortedByName = ({ ids, names }: Offer): Offer => {
  const order = names
    .map((_, index) => index)
    .sort((left, right) => names[left].localeCompare(names[right]) || left - right)
  return { ids: order.map((index) => ids[index]), names: order.map((index) => names[index]) }
}

export const searchOffer = (
  state: GameState,
  seat: SeatId,
  spec: SearchSpec,
  pending: PendingSearch,
): Offer => {
  const candidates = searchCandidates(state, seat, spec, pending.kicked, pending.x)
  return sortedByName({
    ids: candidates.map((object) => object.id),
    names: candidates.map((object) => object.name),
  })
}

export const discardOffer = (state: GameState, waiting: WaitingDiscard): Offer => {
  const offer = {
    ids: waiting.handIds,
    names: waiting.handIds.map((id) => state.objects[id]?.name ?? ''),
  }
  return waiting.chooser === waiting.discardSeat ? offer : sortedByName(offer)
}

export const selectCardsOffer = (waiting: WaitingSelectCards): Offer => {
  const { selection } = waiting
  const zone = selection.fromZone ?? (selection.kind === 'choose' ? undefined : 'hand')
  const unseenOrder = selection.fromSeat !== undefined
    && selection.fromSeat !== selection.seat
    && (zone === 'hand' || zone === 'library')
    && (selection.kind === 'choose' || selection.kind === 'discard' || selection.kind === 'reveal')
  const offer = { ids: waiting.objectIds, names: waiting.names }
  return unseenOrder ? sortedByName(offer) : offer
}

/**
 * The objects the picked slots stand for. `ids` is the candidate list the
 * decision was opened from, in offered order, so slot N is `cards[N]`.
 */
export const objectIdsForChoices = (
  state: GameState,
  ids: string[],
  choices: TopdeckChoice[],
) =>
  choices.map(({ card, slot }) => {
    const id = slot === undefined ? undefined : ids[slot]
    if (!id || state.objects[id]?.name !== card) {
      throw new Error('The cards in this choice changed. Refresh and choose again.')
    }
    return id
  })

/** The candidates a generic pending dialog offered, in the order it listed them. */
export const dialogObjectIds = (
  state: GameState,
  seat: SeatId,
  decision: ChoiceContext['decision'],
) => {
  const dialog = pendingDialogsFor(state, seat).find((candidate) =>
    candidate.kind === decision.kernel.stage
    && candidate.sourceId === decision.kernel.sourceId)
  if (!dialog) throw new Error('That choice is no longer open.')
  return dialogCandidates(state, dialog).map((object) => object.id)
}

export const objectIdsByDestination = (
  state: GameState,
  candidateIds: string[],
  choices: TopdeckChoice[],
  destination: TopdeckChoice['destination'],
) =>
  objectIdsForChoices(
    state,
    candidateIds,
    choices.filter((choice) => choice.destination === destination),
  )

export const dispatchChoiceObjectIds = (
  kernel: KernelHandle,
  seat: SeatId,
  chosenEvent: string,
  objectIds: string[],
) => {
  const chosen = kernel.dispatch({
    type: 'custom',
    name: chosenEvent,
    seat,
    payload: { objectIds },
  })
  if (!chosen.ok) throw new Error(chosen.error)
}

const holder = (object: GameObject) =>
  `${object.zone === 'battlefield' || object.zone === 'stack' ? object.controller : object.owner}'s ${object.zone}`

/**
 * Says which same-named offered card belongs to whom ("Forest #2 (p2's
 * battlefield)"), matching the numbers the dialog shows. Namesakes held by one
 * player in one zone need only the number, so they add nothing here.
 */
const namesakeNote = (cards: string[], offered: Array<GameObject | undefined>) => {
  const groups = new Map<string, Array<{ label: string; holder: string }>>()
  distinctCardLabels(cards).forEach((label, slot) => {
    const object = offered[slot]
    if (label === cards[slot] || !object) return
    groups.set(cards[slot], [
      ...(groups.get(cards[slot]) ?? []),
      { label, holder: holder(object) },
    ])
  })
  const lines = [...groups.values()]
    .filter((group) => new Set(group.map((entry) => entry.holder)).size > 1)
    .flat()
    .map((entry) => `${entry.label} (${entry.holder})`)
  return lines.length > 0 ? `Same-named cards: ${lines.join(', ')}.` : undefined
}

/**
 * Every pending choice is published the same way: one seat, one private prompt.
 * `offered` is the object behind each card, so the prompt can tell namesakes
 * apart; only the chooser, who may see these cards, ever reads it.
 */
export const openTopdeck = (
  lobby: LobbyState,
  decision: TopdeckDecision,
  prompts: { waiting: string; prompt: string | undefined; judge: string },
  offered: Array<GameObject | undefined> = [],
) => {
  lobby.topdeck = decision
  lobby.actions = { [decision.seat]: ['topdeck'] }
  lobby.waiting = prompts.waiting
  lobby.privateWaiting = {
    [decision.seat]: [prompts.prompt, namesakeNote(decision.cards, offered)]
      .filter(Boolean)
      .join(' ') || undefined,
  }
  lobby.judge = prompts.judge
  return true
}
