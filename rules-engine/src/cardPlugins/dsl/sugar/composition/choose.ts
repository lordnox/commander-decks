import type { Instruction, PlayerReference } from '../../schema/v1'
import { chooseInstructions, ref } from '../../builders'

export const choose = (input: {
  chooser: PlayerReference
  count: 1
  options: readonly { instructions: readonly Instruction[] }[]
}): Instruction => {
  if (input.count !== 1) throw new TypeError('Rule DSL v1 instruction choices select exactly one option')
  return chooseInstructions({ chooser: input.chooser, options: input.options })
}

export const or = (left: Instruction, right: Instruction): Instruction => choose({
  chooser: ref('controller'),
  count: 1,
  options: [{ instructions: [left] }, { instructions: [right] }],
})
