import {
  waitingCastTransformed,
  waitingDiscard,
  waitingSelectCards,
} from '../../rules-engine/src/index'
import {
  pendingSearch,
  searchSpecForPending,
  type SearchMove,
  validateSplitSearchSelection,
} from '../../rules-engine/src/cardPlugins/librarySearch'
import {
  discardOffer,
  objectIdsForChoices,
  searchOffer,
  selectCardsOffer,
  type ChoiceContext,
} from './kernelChoice'
import type { LobbyState } from './lobby'
import type { SeatId } from './protocol'
import { finishLibrarySearch } from './kernelChoicePrepareCards'
import { closeKernelChoice } from './kernelSettle'
import { pendingOptionSelection } from '../../rules-engine/src/rules/selectOptions'
import { pendingVote } from '../../rules-engine/src/cardPlugins/vote'

export const applySelectCards = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const waiting = waitingSelectCards(state, seat)
  const selectionId = decision.kernel.selectionId
  const cardKind = decision.kernel.cardKind
  if (!waiting || !selectionId || !cardKind || waiting.selection.id !== selectionId) {
    throw new Error('That card choice is no longer open.')
  }
  if (
    cardKind === 'choose'
    || cardKind === 'discard'
    || cardKind === 'sacrifice'
    || cardKind === 'reveal'
    || cardKind === 'choosePile'
  ) {
    if (cardKind === 'choosePile') {
      const piles = waiting.selection.piles ?? { 'face-up': [], 'face-down': [] }
      const taken = message.choices.find(({ destination }) => destination === 'hand')
      if (!taken) throw new Error('Choose exactly one pile for your hand.')
      const faceUpLabel = decision.cards[0]
      const objectIds = taken.card === faceUpLabel ? piles['face-up'] : piles['face-down']
      const continued = kernel.dispatch({
        type: 'selectCards',
        seat,
        kind: 'choosePile',
        count: waiting.selection.count,
        objectIds,
      })
      if (!continued.ok) throw new Error(continued.error)
      return closeKernelChoice(kernel, lobby, seat, {
        privateJudge: {
          [seat]: waiting.selection.source
            ? `${waiting.selection.source}: you took ${taken.card}.`
            : `You took ${taken.card}.`,
        },
        judge: waiting.selection.source
          ? `${lobby.occupants[seat]?.name ?? seat} chose a pile for ${waiting.selection.source}.`
          : `${lobby.occupants[seat]?.name ?? seat} chose a pile.`,
      })
    }
    const chosenDestination = cardKind === 'sacrifice'
      ? 'sacrifice'
      : cardKind === 'reveal'
        ? 'reveal'
        : cardKind === 'choose'
          ? (
              waiting.selection.moveSelectedTo
              && waiting.selection.destinations?.some(
                (destination) => destination === waiting.selection.moveSelectedTo,
              )
                ? waiting.selection.moveSelectedTo
                : 'target'
            )
        : 'graveyard'
    const objectIds = objectIdsForChoices(
      state,
      selectCardsOffer(waiting).ids,
      message.choices.filter(({ destination }) => destination === chosenDestination),
    )
    const minimum = cardKind === 'discard'
      ? waiting.count
      : waiting.selection.min ?? waiting.count
    if (objectIds.length < minimum || objectIds.length > waiting.count) {
      throw new Error(
        minimum === waiting.count
          ? `Choose exactly ${waiting.count} card(s).`
          : `Choose between ${minimum} and ${waiting.count} card(s).`,
      )
    }
    const continued = kernel.dispatch({
      type: 'selectCards',
      seat,
      kind: cardKind,
      count: waiting.selection.count,
      objectIds,
    })
    if (!continued.ok) throw new Error(continued.error)
    const name = state.objects[objectIds[0]]?.name ?? 'no card'
    const verb = cardKind === 'sacrifice'
      ? 'sacrificed'
      : cardKind === 'reveal'
        ? 'revealed'
        : 'chose'
    return closeKernelChoice(kernel, lobby, seat, {
      privateJudge: {
        [seat]: cardKind === 'sacrifice'
          ? `${waiting.selection.source}: you chose ${name}.`
          : `You chose ${name}.`,
      },
      judge: waiting.selection.source
        ? `${lobby.occupants[seat]?.name ?? seat} ${verb} ${name} for ${waiting.selection.source}.`
        : `${lobby.occupants[seat]?.name ?? seat} ${verb} ${name}.`,
    })
  }
  const pickedIds = objectIdsForChoices(state, selectCardsOffer(waiting).ids, message.choices)
  const choices = message.choices.map((choice, index) => ({
    objectId: pickedIds[index],
    destination: choice.destination as 'top' | 'bottom' | 'hand' | 'graveyard' | 'face-up' | 'face-down',
  }))
  if (choices.length !== waiting.count) {
    throw new Error(`Assign exactly ${waiting.count} card(s).`)
  }
  const continued = kernel.dispatch({
    type: 'selectCards',
    seat,
    kind: cardKind,
    count: waiting.selection.count,
    choices,
  })
  if (!continued.ok) throw new Error(continued.error)
  const summary = message.choices
    .map(({ card, destination }) => `${card} → ${destination}`)
    .join(', ')
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: { [seat]: `${cardKind}: ${summary}.` },
    judge: waiting.selection.source
      ? `${lobby.occupants[seat]?.name ?? seat} finished ${cardKind} for ${waiting.selection.source}.`
      : `${lobby.occupants[seat]?.name ?? seat} finished ${cardKind}.`,
  })
}

type OpenVote = NonNullable<ReturnType<typeof pendingVote>>

/** A public vote names its choice; a secret vote is revealed only once it is finished. */
const voteJudge = (
  lobby: LobbyState,
  vote: OpenVote,
  voter: string,
  option: { id: string; label: string },
  finished: boolean,
) => {
  const name = lobby.occupants[voter as SeatId]?.name ?? voter
  if (!finished) {
    return vote.secret
      ? `${name} voted in secret for ${vote.source}.`
      : `${name} voted for ${option.label}.`
  }
  const revealed = Object.entries({ ...vote.votes, [voter]: option.id })
    .map(([seat, id]) =>
      `${lobby.occupants[seat as SeatId]?.name ?? seat} for ${
        vote.options.find((candidate) => candidate.id === id)?.label ?? id
      }`)
    .join(', ')
  return `${vote.source} votes: ${revealed}.`
}

export const applyOptionSelection = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const pending = pendingOptionSelection(state, seat)
  if (!pending || pending.id !== decision.kernel.selectionId) {
    throw new Error('That option choice is no longer open.')
  }
  const chosen = message.choices.filter(({ destination }) => destination === 'target')
  if (chosen.length !== 1) throw new Error('Choose exactly one option.')
  // Two options can share a label (a vote between same-named permanents), so the slot picks.
  const option = chosen[0].slot === undefined ? undefined : pending.options[chosen[0].slot]
  if (option?.label !== chosen[0].card) throw new Error('That option was not offered.')
  const open = pending.action.kind === 'vote' ? pendingVote(state) : undefined
  const result = kernel.dispatch({
    type: 'selectOption',
    seat,
    selectionId: pending.id,
    optionId: option.id,
  })
  if (!result.ok) throw new Error(result.error)
  const name = lobby.occupants[seat]?.name ?? seat
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: { [seat]: `You chose ${option.label}.` },
    judge: open && pending.action.kind === 'vote'
      ? voteJudge(lobby, open, pending.action.voter, option, !pendingVote(kernel.history.current()))
      : `${name} made a private choice${pending.source ? ` for ${pending.source}` : ''}.`,
  })
}

export const applyWaitingDiscard = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const waiting = waitingDiscard(state)
  const stackId = decision.kernel.stackId
  if (!waiting || waiting.item.id !== stackId) {
    throw new Error('That discard is no longer open.')
  }
  const objectIds = objectIdsForChoices(
    state,
    discardOffer(state, waiting).ids,
    message.choices.filter(({ destination }) => destination === 'graveyard'),
  )
  if (objectIds.length !== waiting.count) {
    throw new Error(`Choose exactly ${waiting.count} card(s) to discard.`)
  }
  const continued = kernel.dispatch({
    type: 'continueAction',
    stackId,
    seat,
    payload: { objectIds },
  })
  if (!continued.ok) throw new Error(continued.error)
  const name = state.objects[objectIds[0]]?.name ?? 'a card'
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: { [seat]: `You discarded ${name}.` },
    judge: `${lobby.occupants[seat]?.name ?? seat} discarded ${name}.`,
  })
}

export const applyCastTransformed = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const waiting = waitingCastTransformed(state, seat)
  if (!waiting || waiting.item.id !== decision.kernel.stackId) {
    throw new Error('That Siege casting choice is no longer open.')
  }
  const cast = message.choices.some(({ destination }) => destination === 'target')
  const continued = kernel.dispatch({
    type: 'continueAction',
    stackId: waiting.item.id,
    seat,
    payload: { cast },
  })
  if (!continued.ok) throw new Error(continued.error)
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: {
      [seat]: cast ? 'You cast the Siege transformed.' : 'You declined to cast the Siege.',
    },
    judge: cast
      ? `${lobby.occupants[seat]?.name ?? seat} cast the defeated Siege transformed.`
      : `${lobby.occupants[seat]?.name ?? seat} declined to cast the defeated Siege.`,
  })
}

export const applyLibrarySearch = (
  { kernel, lobby, seat, message, state }: ChoiceContext,
) => {
  const pending = pendingSearch(state, seat)
  const spec = pending ? searchSpecForPending(state, pending) : undefined
  if (!pending || !spec) throw new Error('That library search is no longer open.')
  const picked = message.choices.filter(({ destination }) => destination !== 'library')
  if (spec.split) {
    const splitError = validateSplitSearchSelection(
      spec,
      picked.map(({ destination }) => ({ destination: destination as SearchMove['destination'] })),
    )
    if (splitError) throw new Error(splitError)
  } else {
    const selected = picked
      .filter(({ destination }) => destination === spec.destination)
      .map(({ card }) => card)
    if (selected.length < spec.min || selected.length > spec.max) {
      throw new Error(
        spec.min === spec.max
          ? `Choose ${spec.min} card(s) for ${pending.source}.`
          : `Choose between ${spec.min} and ${spec.max} cards for ${pending.source}.`,
      )
    }
  }
  const ids = objectIdsForChoices(
    state,
    searchOffer(state, seat, spec, pending).ids,
    picked,
  )
  const selectionError = spec.validateSelection?.(
    ids.map((objectId) => state.objects[objectId]),
  )
  if (selectionError) throw new Error(selectionError)
  const moves: SearchMove[] = picked.map(({ destination }, index) => ({
    objectId: ids[index],
    destination: (spec.split
      ? destination
      : spec.destination) as SearchMove['destination'],
  }))
  finishLibrarySearch(kernel, lobby, seat, pending, spec, moves)
  const selected = picked.map(({ card }) => card)
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: {
      [seat]: selected.length > 0
        ? `${pending.source} found ${selected.join(', ')} and you shuffled.`
        : `${pending.source} found nothing and you shuffled.`,
    },
    judge: `${lobby.occupants[seat]?.name ?? seat} finished a private library search.`,
  })
}
