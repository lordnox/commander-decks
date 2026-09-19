import {
  currentVoter,
  pendingVote,
  votingSeat,
  voteCandidates,
} from '../../rules-engine/src/cardPlugins/vote'
import {
  KEEP_STACK_TARGETS,
  stackCopyPending,
  stackCopyTargetCandidates,
} from '../../rules-engine/src/cardPlugins/stackCopy'
import type { LobbyState } from './lobby'
import { isSeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import { openTopdeck } from './kernelChoice'

export const prepareVoteChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const pending = pendingVote(state)
  const voter = pending ? currentVoter(pending) : undefined
  const seat = pending ? votingSeat(state, pending) : undefined
  if (!pending || !voter || !seat || !isSeatId(seat)) return false
  const cards = voteCandidates(state, pending, voter).map((object) => object.name)
  return openTopdeck(
    lobby,
    {
      seat,
      kind: 'vote',
      cards,
      destinations: ['skip', 'target'],
      requirements: { target: { min: 1, max: 1 } },
      kernel: {
        sourceId: pending.sourceId,
        stage: 'vote',
      },
    },
    {
      waiting: `${lobby.occupants[seat]?.name ?? seat} is voting.`,
      prompt: pending.effect.prompt,
      judge: `Waiting for ${pending.source}'s public vote.`,
    },
  )
}

export const prepareStackCopyChoice = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const pending = stackCopyPending(state)
  if (!pending || !isSeatId(pending.seat)) return false
  const item = state.stack.find((candidate) => candidate.id === pending.stackId)
  if (!item) return false
  const candidates = stackCopyTargetCandidates(state, pending)
  const playerCandidates = item.targets.length === 1 && item.targets[0]?.kind === 'player'
    ? state.playerOrder.filter((seat) => !state.players[seat].lost)
    : []
  const cards = item.targets.length === 0
    ? [`Copy ${item.name}`]
    : [
        KEEP_STACK_TARGETS,
        ...(playerCandidates.length > 0
          ? playerCandidates
          : candidates.map((object) => object.name)),
      ]
  return openTopdeck(
    lobby,
    {
      seat: pending.seat,
      kind: 'stack-copy',
      cards,
      destinations: ['skip', 'target'],
      requirements: {
        target: {
          ...(!pending.optional ? { min: 1 } : {}),
          max: 1,
        },
      },
      kernel: {
        sourceId: pending.sourceId,
        stage: 'stack-copy',
        stackId: pending.stackId,
      },
    },
    {
      waiting: `${lobby.occupants[pending.seat]?.name ?? pending.seat} is deciding whether to copy an ability.`,
      prompt: `Pay ${pending.cost} to copy ${item.name}? You may choose a new target.`,
      judge: `Waiting for ${pending.source}'s copy choice.`,
    },
  )
}
