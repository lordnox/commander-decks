import {
  DIALOG_CHOSEN,
  dialogCandidates,
  pendingDialogFor,
} from '../../rules-engine/src/pendingDialog'
import {
  dispatchChoiceObjectIds,
  objectIdsByDestination,
  objectIdsForNames,
  type ChoiceContext,
} from './kernelChoice'
import { preparePendingDialog } from './kernelChoicePrepareDialog'
import { closeKernelChoice } from './kernelSettle'

export const applyPutPermanents = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const selected = message.choices.filter(({ destination }) => destination === 'battlefield')
  const max = decision.requirements?.battlefield?.max
  if (max !== undefined && selected.length > max) {
    throw new Error(`Choose at most ${max} card(s).`)
  }
  const objectIds = objectIdsForNames(
    state,
    state.zoneOrder[seat].hand,
    selected.map(({ card }) => card),
  )
  for (const objectId of objectIds) {
    const moved = kernel.dispatch({ type: 'move', objectId, to: 'battlefield' })
    if (!moved.ok) throw new Error(moved.error)
  }
  const chosenEvent = decision.kernel.chosenEvent
  if (!chosenEvent) throw new Error('That card choice is no longer open.')
  const chosen = kernel.dispatch({
    type: 'custom',
    name: chosenEvent,
    seat,
    payload: { objectIds },
  })
  if (!chosen.ok) throw new Error(chosen.error)
  return closeKernelChoice(kernel, lobby, seat, {
    judge: `${lobby.occupants[seat]?.name ?? seat} finished a private choice.`,
  })
}

export const applyChooseModes = (
  { kernel, lobby, seat, message, state }: ChoiceContext,
) => {
  const dialog = pendingDialogFor(state, seat)
  if (dialog?.kind !== 'choose-modes') throw new Error('That choice is no longer open.')
  const modes = message.choices
    .filter(({ destination }) => destination === 'target')
    .map(({ card }) => card)
  const chosen = kernel.dispatch({
    type: 'custom',
    name: dialog.chosenEvent ?? DIALOG_CHOSEN,
    seat,
    payload: { modes },
  })
  if (!chosen.ok) throw new Error(chosen.error)
  return closeKernelChoice(kernel, lobby, seat, {
    judge: modes.length > 0
      ? `${dialog.source} chose: ${modes.join('; ')}.`
      : `${dialog.source} chose no modes.`,
  })
}

export const applySacrificeLands = (
  { kernel, lobby, seat, message, state }: ChoiceContext,
) => {
  const dialog = pendingDialogFor(state, seat)
  if (dialog?.kind !== 'sacrifice-lands') {
    throw new Error('That sacrifice choice is no longer open.')
  }
  const candidates = dialogCandidates(state, dialog)
  const objectIds = objectIdsByDestination(
    state,
    candidates.map((object) => object.id),
    message.choices,
    'sacrifice',
  )
  const names = objectIds.map((id) => state.objects[id]?.name).filter(Boolean)
  dispatchChoiceObjectIds(
    kernel,
    seat,
    dialog.chosenEvent ?? DIALOG_CHOSEN,
    objectIds,
  )
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: {
      [seat]: `${dialog.source} sacrificed ${
        names.length > 0 ? names.join(', ') : 'no lands'
      }.`,
    },
    judge: `${dialog.source} resolved after ${objectIds.length} land sacrifice(s).`,
  })
}

export const applyExileGraveyards = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const objectIds = objectIdsByDestination(
    state,
    state.playerOrder.flatMap((player) => state.zoneOrder[player].graveyard),
    message.choices,
    'exile',
  )
  const max = decision.requirements?.exile?.max ?? 3
  if (objectIds.length > max) throw new Error(`Choose at most ${max} card(s).`)
  const chosenEvent = decision.kernel.chosenEvent
  if (!chosenEvent) throw new Error('That graveyard choice is no longer open.')
  dispatchChoiceObjectIds(kernel, seat, chosenEvent, objectIds)
  const names = objectIds.map((id) => state.objects[id]?.name).filter(Boolean)
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: {},
    judge: names.length > 0
      ? `Pit of Offerings targets ${names.join(', ')}.`
      : 'Pit of Offerings chose no targets.',
  })
}

/** Yes-or-no dialogs plus the ones that carry a single picked permanent. */
export const applyDialogChoice = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const accepted = message.choices.some(({ destination }) => destination === 'target')
  const chosenEvent = decision.kernel.chosenEvent
  if (!chosenEvent) throw new Error('That choice is no longer open.')
  const objectIds = decision.kernel.stage === 'copy-creature'
    ? objectIdsForNames(
      state,
      state.zoneOrder[seat].battlefield,
      message.choices.filter(({ destination }) => destination === 'target').map(({ card }) => card),
    )
    : decision.kernel.stage === 'fight-target'
      ? objectIdsForNames(
        state,
        Object.values(state.objects)
          .filter((object) =>
            object.zone === 'battlefield'
            && object.types.includes('Creature')
            && object.controller !== seat)
          .map((object) => object.id),
        message.choices.filter(({ destination }) => destination === 'target').map(({ card }) => card),
      )
      : []
  const targets = decision.kernel.stage === 'secret-vote'
    ? message.choices.filter(({ destination }) => destination === 'target').map(({ card }) => card)
    : undefined
  const chosen = kernel.dispatch({
    type: 'custom',
    name: chosenEvent,
    seat,
    payload: { accepted, objectIds, ...(targets ? { targets } : {}) },
  })
  if (!chosen.ok) throw new Error(chosen.error)
  return closeKernelChoice(kernel, lobby, seat)
}

/** Dialogs answered by moving the picked cards between known zones. */
export const applyZoneChoice = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const zone = decision.kernel.stage === 'bounce-land'
    ? state.zoneOrder[seat].battlefield
    : decision.kernel.stage === 'return-land'
      ? state.zoneOrder[seat].graveyard
      : state.zoneOrder[seat].library.slice(0, decision.cards.length)
  const ids = objectIdsForNames(state, zone, message.choices.map(({ card }) => card))
  const ordered = message.choices.map((choice, index) => ({
    ...choice,
    objectId: ids[index],
  }))
  const destinationZone = (destination: string) => {
    if (destination === 'hand') return 'hand' as const
    if (destination === 'graveyard') return 'graveyard' as const
    if (destination === 'battlefield') return 'battlefield' as const
    return undefined
  }
  if (decision.kernel.stage === 'surveil') {
    for (const choice of ordered.filter(({ destination }) => destination === 'top').reverse()) {
      if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'top' }).ok) {
        throw new Error(`Could not keep ${choice.card} on top`)
      }
    }
    for (const choice of ordered.filter(({ destination }) => destination === 'graveyard')) {
      if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'graveyard' }).ok) {
        throw new Error(`Could not mill ${choice.card}`)
      }
    }
  } else {
    for (const choice of ordered) {
      const to = destinationZone(choice.destination)
      if (!to) continue
      const moved = kernel.dispatch({ type: 'move', objectId: choice.objectId, to })
      if (!moved.ok) throw new Error(moved.error)
      if (to === 'battlefield' && decision.kernel.stage === 'return-land') {
        kernel.dispatch({ type: 'tap', objectId: choice.objectId })
      }
    }
  }
  const chosenEvent = decision.kernel.chosenEvent
  if (!chosenEvent) throw new Error('That choice is no longer open.')
  const chosen = kernel.dispatch({ type: 'custom', name: chosenEvent, seat })
  if (!chosen.ok) throw new Error(chosen.error)
  return closeKernelChoice(kernel, lobby, seat)
}

export const applyTopOfLibrary = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  for (const [destination, limits] of Object.entries(decision.requirements ?? {})) {
    const count = message.choices.filter((choice) => choice.destination === destination).length
    if (
      (limits.min !== undefined && count < limits.min)
      || (limits.max !== undefined && count > limits.max)
    ) {
      throw new Error(`Choose the required number of cards for ${destination}.`)
    }
  }
  const ids = objectIdsForNames(
    state,
    state.zoneOrder[seat].library.slice(0, decision.cards.length),
    message.choices.map(({ card }) => card),
  )
  const ordered = message.choices.map((choice, index) => ({
    ...choice,
    objectId: ids[index],
  }))
  for (const choice of ordered.filter(({ destination }) => destination === 'top').reverse()) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'top' }).ok) {
      throw new Error(`Could not keep ${choice.card} on top`)
    }
  }
  for (const choice of ordered.filter(({ destination }) => destination === 'hand')) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'hand' }).ok) {
      throw new Error(`Could not put ${choice.card} into hand`)
    }
  }
  for (const choice of ordered.filter(({ destination }) => destination === 'bottom')) {
    if (!kernel.dispatch({ type: 'move', objectId: choice.objectId, to: 'library', position: 'bottom' }).ok) {
      throw new Error(`Could not put ${choice.card} on the bottom`)
    }
  }
  lobby.topdeck = undefined
  const chosenEvent = decision.kernel.chosenEvent
  if (!chosenEvent) throw new Error('That scry choice is no longer open.')
  const chosen = kernel.dispatch({ type: 'custom', name: chosenEvent, seat })
  if (!chosen.ok) throw new Error(chosen.error)
  for (const followUp of decision.kernel.after ?? []) {
    if (followUp === 'resolveTop' && !kernel.dispatch({ type: 'resolveTop' }).ok) {
      throw new Error('Could not finish resolving that spell')
    }
  }
  if (preparePendingDialog(kernel, lobby)) return true
  return closeKernelChoice(kernel, lobby, seat, {
    judge: `${lobby.occupants[seat]?.name ?? seat} finished a private choice.`,
  })
}
