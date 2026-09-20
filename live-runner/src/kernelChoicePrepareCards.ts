import {
  waitingCastTransformed,
  waitingDiscard,
  waitingSelectCards,
  type GameEvent,
} from '../../rules-engine/src/index'
import {
  SEARCH_CHOSEN,
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
  type PendingSearch,
  type SearchMove,
  type SearchSpec,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import type { LobbyState, TopdeckDecision } from './lobby'
import { isSeatId, type SeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import { openTopdeck } from './kernelChoice'
import { pendingOptionSelection } from '../../rules-engine/src/rules/selectOptions'

/**
 * Move the found cards, shuffle, close the marker, and let a spell finish
 * resolving. An empty selection is a legal "fail to find" and runs the same
 * path, so the spell never sticks on the stack.
 */
export const finishLibrarySearch = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  pending: PendingSearch,
  spec: SearchSpec,
  moves: SearchMove[],
) => {
  const events: GameEvent[] = []
  const objectIds = moves.map((move) => move.objectId)
  if (spec.reveal && objectIds.length > 0) {
    events.push({ type: 'reveal', seat, objectIds, source: pending.source })
  }
  for (const move of moves) {
    events.push({ type: 'move', objectId: move.objectId, to: move.destination })
    const tapped = move.destination === 'battlefield'
      && (spec.split?.battlefield.tapped ?? spec.tapped)
    if (tapped) {
      events.push({ type: 'tap', objectId: move.objectId })
    }
    if (
      spec.untapWithFourLands
      && move.destination === 'battlefield'
    ) {
      const landsBeforeEntry = Object.values(kernel.history.current().objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && object.controller === seat
          && object.types.includes('Land'))
        .length
      if (landsBeforeEntry >= 3) events.push({ type: 'untap', objectId: move.objectId })
    }
  }
  events.push({ type: 'shuffleLibrary', seat })
  events.push({ type: 'custom', name: SEARCH_CHOSEN, seat })
  if (pending.via === 'spell') events.push({ type: 'resolveTop' })
  for (const event of events) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }
  lobby.topdeck = undefined
}

/**
 * Every "search your library" card shares one dialog. The kernel already
 * recorded whose choice is open, so a host that restarted mid-search rebuilds
 * the same private dialog instead of resuming past it.
 */
export const prepareLibrarySearchChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const seat = searchingSeat(state)
  if (!seat || !isSeatId(seat)) return false
  const pending = pendingSearch(state, seat)
  const spec = pending ? searchSpecForPending(state, pending) : undefined
  if (!pending || !spec) return false
  const cards = searchCandidates(state, seat, spec, pending.kicked).map((object) => object.name)
  const minRequired = spec.split
    ? Math.min(spec.split.battlefield.min, spec.split.hand.min)
    : spec.min
  if (cards.length === 0 || cards.length < minRequired) {
    // Failing to find is a legal choice, and the only one available.
    finishLibrarySearch(kernel, lobby, seat, pending, spec, [])
    return false
  }
  return openTopdeck(
    lobby,
    {
      seat,
      kind: 'search',
      cards,
      // Sorted, because the searcher may read the library but not its order.
      library: (state.zoneOrder[seat]?.library ?? [])
        .map((objectId) => state.objects[objectId]?.name ?? '')
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
      destinations: spec.split
        ? ['library', 'battlefield', 'hand']
        : ['library', spec.destination],
      requirements: spec.split
        ? {
            battlefield: {
              min: spec.split.battlefield.min,
              max: spec.split.battlefield.max,
            },
            hand: { min: spec.split.hand.min, max: spec.split.hand.max },
          }
        : { [spec.destination]: { min: spec.min, max: spec.max } },
      kernel: { sourceId: pending.sourceId, stage: 'library-search' },
    },
    {
      waiting: `${lobby.occupants[seat]?.name ?? seat} is searching privately.`,
      prompt: pending.kicked && spec.kickedPrompt ? spec.kickedPrompt : spec.prompt,
      judge: 'Waiting for a private library search.',
    },
  )
}

export const prepareWaitingDiscardChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingDiscard(state)
  if (!waiting || !isSeatId(waiting.chooser)) return false
  const cards = waiting.handIds
    .map((objectId) => state.objects[objectId]?.name ?? '')
    .filter(Boolean)
  return openTopdeck(
    lobby,
    {
      seat: waiting.chooser,
      kind: 'discard-card',
      cards,
      destinations: waiting.count === 1 ? ['graveyard'] : ['hand', 'graveyard'],
      requirements: { graveyard: { min: waiting.count, max: waiting.count } },
      kernel: {
        sourceId: waiting.item.objectId,
        stage: 'waiting-discard',
        stackId: waiting.item.id,
      },
    },
    {
      waiting: `${lobby.occupants[waiting.chooser]?.name ?? waiting.chooser} is choosing cards to discard.`,
      prompt: `Discard ${waiting.count} card${waiting.count === 1 ? '' : 's'}.`,
      judge: 'Waiting for a discard choice on the stack.',
    },
  )
}

export const prepareCastTransformedChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingCastTransformed(state)
  if (!waiting || !isSeatId(waiting.chooser)) return false
  const source = state.objects[waiting.item.objectId]
  return openTopdeck(
    lobby,
    {
      seat: waiting.chooser,
      kind: 'may',
      cards: ['Yes'],
      destinations: ['target', 'skip'],
      requirements: { target: { min: 0, max: 1 } },
      kernel: {
        sourceId: waiting.item.objectId,
        stage: 'battle-cast-transformed',
        stackId: waiting.item.id,
      },
    },
    {
      waiting: `${lobby.occupants[waiting.chooser]?.name ?? waiting.chooser} may cast a defeated Siege transformed.`,
      prompt: `Cast ${source?.name ?? 'the defeated Siege'} transformed without paying its mana cost?`,
      judge: 'Waiting for the defeated Siege casting choice.',
    },
  )
}

export const prepareSelectCardsChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const waiting = waitingSelectCards(state)
  if (!waiting) return false
  const seat = waiting.selection.seat
  if (!isSeatId(seat)) return false
  const { selection, names, count } = waiting
  const destinations = (selection.destinations
    ?? (selection.kind === 'scry'
      ? ['top', 'bottom']
      : selection.kind === 'surveil'
        ? ['top', 'graveyard']
        : selection.kind === 'reveal'
          ? ['hand', 'reveal']
        : selection.kind === 'choose'
          ? ['target']
        : selection.kind === 'sacrifice'
          ? ['battlefield', 'sacrifice']
          : ['graveyard'])) as TopdeckDecision['destinations']
  const requirements = selection.kind === 'sacrifice'
    ? { sacrifice: { min: selection.min ?? count, max: count } }
    : selection.kind === 'discard'
      ? { graveyard: { min: count, max: count } }
      : selection.kind === 'reveal'
        ? { reveal: { min: selection.min ?? count, max: count } }
      : selection.kind === 'choose'
        ? {
            [selection.moveSelectedTo && selection.destinations?.some(
              (destination) => destination === selection.moveSelectedTo,
            )
              ? selection.moveSelectedTo
              : 'target']: {
              min: selection.min ?? count,
              max: count,
            },
          }
      : undefined
  return openTopdeck(
    lobby,
    {
      seat,
      kind: selection.kind === 'discard' ? 'discard-card' : selection.kind,
      cards: names,
      destinations,
      ...(requirements ? { requirements } : {}),
      kernel: {
        sourceId: selection.sourceId ?? '',
        stage: 'select-cards',
        selectionId: selection.id,
        cardKind: selection.kind,
      },
    },
    {
      waiting: `${lobby.occupants[seat]?.name ?? seat} is choosing cards.`,
      prompt: selection.prompt ?? `Choose ${count} card${count === 1 ? '' : 's'}.`,
      judge: selection.source
        ? `Waiting for a ${selection.kind} choice for ${selection.source}.`
        : `Waiting for a ${selection.kind} choice.`,
    },
  )
}

export const prepareOptionSelectionChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const pending = pendingOptionSelection(kernel.history.current())
  if (!pending || !isSeatId(pending.seat)) return false
  return openTopdeck(
    lobby,
    {
      seat: pending.seat,
      kind: 'choose',
      cards: pending.options.map((option) => option.label),
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
      kernel: {
        sourceId: pending.sourceId ?? '',
        stage: 'option-selection',
        selectionId: pending.id,
      },
    },
    {
      waiting: `${lobby.occupants[pending.seat]?.name ?? pending.seat} is choosing privately.`,
      prompt: pending.prompt,
      judge: pending.source
        ? `Waiting for a choice for ${pending.source}.`
        : 'Waiting for a private choice.',
    },
  )
}
