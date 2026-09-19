import {
  eventsForAvailableAction,
  legalActsFor,
  pendingPlayerSelection,
} from '../../rules-engine/src/index'
import { pendingPlayerTargets } from '../../rules-engine/src/cardPlugins/playerTargets'
import { pendingExtortFor } from '../../rules-engine/src/cardPlugins/extort'
import { pendingCumulativeUpkeep } from '../../rules-engine/src/cardPlugins/cumulativeUpkeep'
import type { SeatId } from './protocol'
import type { ChoiceContext } from './kernelChoice'
import { closeKernelChoice } from './kernelSettle'

export const applyCumulativeUpkeep = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const pending = pendingCumulativeUpkeep(state, seat)
  if (!pending || pending.id !== decision.kernel.selectionId) {
    throw new Error('That cumulative upkeep choice is no longer open.')
  }
  const sacrificing = message.choices.length === 0
    || message.choices.every(({ destination }) => destination === 'sacrifice')
  const recipients = sacrificing
    ? []
    : message.choices.map(({ card, destination }) => {
        if (destination !== 'target' || !pending.opponents.includes(card)) {
          throw new Error('Choose a living opponent for every age counter.')
        }
        return card
      })
  const result = kernel.dispatch({
    type: 'payCumulativeUpkeep',
    seat,
    choiceId: pending.id,
    objectId: pending.objectId,
    pay: !sacrificing,
    ...(sacrificing ? {} : { recipients }),
  })
  if (!result.ok) throw new Error(result.error)
  return closeKernelChoice(kernel, lobby, seat, {
    judge: sacrificing
      ? `${pending.source} was sacrificed to cumulative upkeep.`
      : `${pending.source}'s cumulative upkeep was paid.`,
  })
}

export const applyExtortPayment = (
  { kernel, lobby, seat, message, state }: ChoiceContext,
) => {
  const pending = pendingExtortFor(state, seat)
  if (!pending) throw new Error('That extort payment is no longer open.')
  const selected = message.choices.find(({ destination }) => destination === 'target')
  const mana = selected?.card.match(/^Pay \{([WB])\}$/)?.[1] as 'W' | 'B' | undefined
  const action = legalActsFor(state, seat).find((candidate) =>
    candidate.kind === 'payExtort'
    && candidate.triggerId === pending.triggerId
    && candidate.mana === mana)
  if (!action) throw new Error('That extort payment is not available.')
  const events = eventsForAvailableAction(state, seat, action)
  if (!events) throw new Error('That extort payment cannot be completed.')
  for (const event of events) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }
  return closeKernelChoice(kernel, lobby, seat, {
    judge: mana
      ? `${pending.source}: ${lobby.occupants[seat]?.name ?? seat} paid {${mana}}.`
      : `${pending.source}: ${lobby.occupants[seat]?.name ?? seat} declined extort.`,
  })
}

export const applySelectPlayers = (
  { kernel, lobby, seat, message, decision, state }: ChoiceContext,
) => {
  const pending = pendingPlayerSelection(state, seat)
  if (!pending || pending.id !== decision.kernel.selectionId) {
    throw new Error('That player choice is no longer open.')
  }
  const players = message.choices
    .filter(({ destination }) => destination === 'target')
    .map(({ card }) => card)
  const result = kernel.dispatch({
    type: 'selectPlayers',
    seat,
    selectionId: pending.id,
    players,
  })
  if (!result.ok) throw new Error(result.error)
  return closeKernelChoice(kernel, lobby, seat, {
    judge: players.length > 0
      ? `${pending.source} targets ${players.join(', ')}.`
      : `${pending.source} chose no opponent.`,
  })
}

export const applyPlayerTargets = (
  { kernel, lobby, seat, message, state }: ChoiceContext,
) => {
  const pending = pendingPlayerTargets(state)
  if (!pending || pending.controller !== seat) {
    throw new Error('That target choice is no longer open.')
  }
  const targets = message.choices
    .filter(({ destination }) => destination === 'target')
    .map(({ card }) => card)
  const result = kernel.dispatch({
    type: 'custom',
    name: pending.chosenEvent,
    seat,
    payload: { targets },
  })
  if (!result.ok) throw new Error(result.error)
  return closeKernelChoice(kernel, lobby, seat, {
    privateJudge: {
      [seat]: targets.length > 0
        ? `${pending.source} targeted ${targets.join(', ')}.`
        : `${pending.source} chose no targets.`,
    },
    judge: targets.length > 0
      ? `${pending.source} targets ${targets.map(
        (target) => lobby.occupants[target as SeatId]?.name ?? target,
      ).join(', ')}.`
      : `${pending.source} has no targets.`,
  })
}
