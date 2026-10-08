import type { AmountInput, Instruction, PlayerRecipient } from '../../../schema/v1'
import { draw, variable } from '../../../builders'

export type DrawCounts = {
  readonly one: Instruction
  readonly X: Instruction
  count: (count: AmountInput) => Instruction
}

export const drawCounts = (targets: PlayerRecipient): DrawCounts => Object.freeze({
  get one() { return draw({ count: 1, targets }) },
  get X() { return draw({ count: variable('X'), targets }) },
  count(count: AmountInput) { return draw({ count, targets }) },
})
