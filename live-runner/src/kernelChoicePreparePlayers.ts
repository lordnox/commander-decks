import {
  legalActsFor,
  pendingPlayerSelection,
} from '../../rules-engine/src/index'
import { pendingPlayerTargets } from '../../rules-engine/src/cardPlugins/playerTargets'
import { pendingExtort } from '../../rules-engine/src/cardPlugins/extort'
import { pendingCumulativeUpkeep } from '../../rules-engine/src/cardPlugins/cumulativeUpkeep'
import type { LobbyState } from './lobby'
import { isSeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import { openTopdeck } from './kernelChoice'

export const prepareExtortChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const pending = pendingExtort(state)
  if (!pending || !isSeatId(pending.seat)) return false
  const payments = legalActsFor(state, pending.seat)
    .filter((
      action,
    ): action is Extract<ReturnType<typeof legalActsFor>[number], { kind: 'payExtort' }>
      & { mana: 'W' | 'B' } =>
      action.kind === 'payExtort' && Boolean(action.mana))
    .map((action) => `Pay {${action.mana}}`)
  return openTopdeck(
    lobby,
    {
      seat: pending.seat,
      kind: 'extort-payment',
      cards: ['Decline', ...payments],
      destinations: ['skip', 'target'],
      requirements: { target: { min: 0, max: 1 } },
      kernel: {
        sourceId: pending.sourceId,
        stage: 'extort-payment',
      },
    },
    {
      waiting: `${lobby.occupants[pending.seat]?.name ?? pending.seat} is choosing whether to pay extort.`,
      prompt: `${pending.source}: you may pay {W/B}.`,
      judge: `Waiting for ${pending.source}'s extort payment.`,
    },
  )
}

export const prepareCumulativeUpkeepChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const pending = pendingCumulativeUpkeep(kernel.history.current())
  if (!pending || !isSeatId(pending.seat)) return false
  const opponents = pending.opponents.filter(isSeatId)
  return openTopdeck(
    lobby,
    {
      seat: pending.seat,
      kind: 'cumulative-upkeep',
      cards: opponents,
      count: pending.count,
      destinations: ['target', 'sacrifice'],
      kernel: {
        sourceId: pending.objectId,
        stage: 'cumulative-upkeep',
        selectionId: pending.id,
      },
    },
    {
      waiting: `${lobby.occupants[pending.seat]?.name ?? pending.seat} is resolving cumulative upkeep.`,
      prompt: `Choose an opponent to gain 1 life for each of ${pending.count} age counter(s), or sacrifice ${pending.source}.`,
      judge: `Waiting for ${pending.source}'s cumulative upkeep.`,
    },
  )
}

export const prepareSelectPlayersChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const playerSelection = pendingPlayerSelection(kernel.history.current())
  if (!playerSelection || !isSeatId(playerSelection.seat)) return false
  const seat = playerSelection.seat
  return openTopdeck(
    lobby,
    {
      seat,
      kind: 'target-players',
      cards: playerSelection.candidates,
      destinations: ['skip', 'target'],
      requirements: {
        target: { min: playerSelection.min, max: playerSelection.max },
      },
      kernel: {
        sourceId: playerSelection.sourceId,
        selectionId: playerSelection.id,
        stage: 'select-players',
      },
    },
    {
      waiting: `${lobby.occupants[seat]?.name ?? seat} is choosing an opponent.`,
      prompt: playerSelection.prompt,
      judge: `Waiting for ${playerSelection.source} player choice.`,
    },
  )
}

export const preparePlayerTargetsChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const targetsPending = pendingPlayerTargets(state)
  if (!targetsPending || !isSeatId(targetsPending.controller)) return false
  const seat = targetsPending.controller
  const cards = state.playerOrder.filter((target) => !state.players[target].lost)
  return openTopdeck(
    lobby,
    {
      seat,
      kind: 'target-players',
      cards,
      destinations: ['skip', 'target'],
      kernel: {
        sourceId: targetsPending.sourceId,
        stage: 'player-targets',
      },
    },
    {
      waiting: `${lobby.occupants[seat]?.name ?? seat} is choosing ${targetsPending.source} targets.`,
      prompt: targetsPending.prompt,
      judge: `Waiting for ${targetsPending.source} targets.`,
    },
  )
}
