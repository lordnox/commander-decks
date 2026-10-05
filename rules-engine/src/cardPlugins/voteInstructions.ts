import type { StackItem } from '../types'
import type { InstructionHandler } from './instructionHandlers/types'
import { voteResultOf, votersIn } from './voteResult'

/** The payload keys that "that player" and "that many" instructions read. */
const withPayload = (item: StackItem, payload: Record<string, unknown>): StackItem => ({
  ...item,
  payload: { ...item.payload, ...payload },
})

const ifVoteLeads: InstructionHandler<'ifVoteLeads'> = ({ item, run }, instruction) => {
  const result = voteResultOf(item)
  const leads = result?.winners.length === 1 && result.winners[0] === instruction.option
  run(leads ? instruction.whenTrue : instruction.whenFalse ?? [])
}

const forEachVoter: InstructionHandler<'forEachVoter'> = (
  { item, run, source },
  instruction,
) => {
  const result = voteResultOf(item)
  if (!item || !result) return
  for (const seat of votersIn(result, source.controller, instruction.who)) {
    run(instruction.do, source, withPayload(item, { triggeringPlayer: seat }))
  }
}

const forEachVotedOption: InstructionHandler<'forEachVotedOption'> = (
  { item, run, source },
  instruction,
) => {
  const result = voteResultOf(item)
  if (!item || !result) return
  for (const [optionId, votes] of Object.entries(result.tallies)) {
    if (votes === 0) continue
    run(instruction.do, source, withPayload(item, {
      triggerAmount: votes,
      triggeringObjectId: optionId,
    }))
  }
}

const exileVoteWinners: InstructionHandler<'exileVoteWinners'> = ({ draft, item }) => {
  for (const objectId of voteResultOf(item)?.winners ?? []) {
    if (draft.objects[objectId]?.zone === 'battlefield') {
      draft.enqueue({ type: 'move', objectId, to: 'exile' })
    }
  }
}

export const voteResultHandlers = {
  ifVoteLeads,
  forEachVoter,
  forEachVotedOption,
  exileVoteWinners,
}
