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
import { objectIdsForNames, type ChoiceContext } from './kernelChoice'
import { finishLibrarySearch } from './kernelChoicePrepareCards'
import { closeKernelChoice } from './kernelSettle'
import { pendingOptionSelection } from '../../rules-engine/src/rules/selectOptions'

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
  ) {
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
    const objectIds = objectIdsForNames(
      state,
      waiting.objectIds,
      message.choices
        .filter(({ destination }) => destination === chosenDestination)
        .map(({ card }) => card),
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
  const choices = message.choices.map((choice) => ({
    objectId: objectIdsForNames(state, waiting.objectIds, [choice.card])[0],
    destination: choice.destination as 'top' | 'bottom' | 'graveyard',
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

export const applyOptionSelection = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const pending = pendingOptionSelection(state, seat)
  if (!pending || pending.id !== decision.kernel.selectionId) {
    throw new Error('That option choice is no longer open.')
  }
  const chosen = message.choices.filter(({ destination }) => destination === 'target')
  if (chosen.length !== 1) throw new Error('Choose exactly one option.')
  const option = pending.options.find((candidate) => candidate.label === chosen[0].card)
  if (!option) throw new Error('That option was not offered.')
  const result = kernel.dispatch({
    type: 'selectOption',
    seat,
    selectionId: pending.id,
    optionId: option.id,
  })
  if (!result.ok) throw new Error(result.error)
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: { [seat]: `You chose ${option.label}.` },
    judge: `${lobby.occupants[seat]?.name ?? seat} made a private choice${
      pending.source ? ` for ${pending.source}` : ''
    }.`,
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
  const objectIds = objectIdsForNames(
    state,
    waiting.handIds,
    message.choices
      .filter(({ destination }) => destination === 'graveyard')
      .map(({ card }) => card),
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
  const ids = objectIdsForNames(
    state,
    state.zoneOrder[seat].library,
    picked.map(({ card }) => card),
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
