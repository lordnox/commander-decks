import type { DelayedPattern, ObjectRecipient } from '../../schema/v1'
import { choice, createDelayed, move, sequence } from '../../builders'

/** A delayed owner-controlled return, composed from ordinary movement and delayed programs. */
export const blinkUntil = (input: { targets: ObjectRecipient; condition: DelayedPattern; bindChoice: string }) => sequence(
  move({ targets: input.targets, to: 'exile', bindChoice: input.bindChoice }),
  createDelayed({ inheritTargets: false, condition: input.condition, instructions: [move({ targets: choice(input.bindChoice), to: 'battlefield' })] }),
)
