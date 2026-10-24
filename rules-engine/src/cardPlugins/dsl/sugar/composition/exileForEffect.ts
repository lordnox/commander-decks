import type { Instruction, ObjectSelector, PlayerReference } from '../../schema/v1'
import { choice, chooseCards, compareAmount, count, ifThen, move, objects, sequence } from '../../builders'

/** Optional one-card resolution cost. CR 118.12 checks payment, not the move's destination. */
export const exileForEffect = (input: {
  chooser: PlayerReference
  filter: ObjectSelector
  bindChoice: string
  then: readonly Instruction[]
}) => sequence(
  chooseCards({ chooser: input.chooser, filter: input.filter, bindChoice: input.bindChoice, min: 0, max: 1 }),
  ifThen(compareAmount(count(objects({ among: choice(input.bindChoice) })), 'gte', 1), {
    then: [move({ targets: choice(input.bindChoice), to: 'exile' }), ...input.then],
  }),
)
