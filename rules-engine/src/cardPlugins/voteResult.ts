import type { PlayerId, StackItem, VoteResult } from '../types'
import type { InstructionCount, VoterGroup } from './effectDefinitions'

/** Count a finished vote: every offered option is listed, ties are explicit. */
export const tallyVotes = (
  votes: Record<PlayerId, string>,
  optionIds: string[],
): VoteResult => {
  const counted = Object.fromEntries(
    Object.entries(votes).filter(([, optionId]) => optionIds.includes(optionId)),
  )
  const tallies = Object.fromEntries(optionIds.map((id) => [id, 0]))
  for (const optionId of Object.values(counted)) tallies[optionId] += 1
  const most = Math.max(0, ...Object.values(tallies))
  const winners = most === 0 ? [] : optionIds.filter((id) => tallies[id] === most)
  return { votes: counted, tallies, winners, tied: winners.length > 1 }
}

/** The vote an instruction list is resolving for, carried on its stack item. */
export const voteResultOf = (item?: StackItem) => {
  const result = item?.payload?.vote as VoteResult | undefined
  return result?.votes && result.tallies ? result : undefined
}

/** Voters in `group`, in voting order, as seen by `controller`. */
export const votersIn = (
  result: VoteResult,
  controller: PlayerId,
  group: VoterGroup,
) => Object.entries(result.votes)
  .filter(([seat, optionId]) => {
    if (group === 'all') return true
    if (typeof group === 'object') return optionId === group.votedFor
    if (seat === controller) return false
    return (optionId === result.votes[controller]) === (group === 'opponentsAgreeing')
  })
  .map(([seat]) => seat)

export const instructionCount = (
  count: InstructionCount,
  controller: PlayerId,
  item?: StackItem,
) => {
  if (typeof count === 'number') return count
  const result = voteResultOf(item)
  return result ? votersIn(result, controller, count.voters).length : 0
}
