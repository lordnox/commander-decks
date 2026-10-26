import type { Instruction, PlayerReference } from '../../schema/v2'
import { chooseInstructions, ref } from '../../builders'

/** A resolution-time option; declining skips only the wrapped program (CR 603.5). */
export const may = (instruction: Instruction, chooser: PlayerReference = ref('controller')) =>
  chooseInstructions({
    optional: true,
    chooser,
    prompt: 'You may perform this action.',
    options: [
      { label: 'Accept', instructions: [instruction] },
      { label: 'Decline', instructions: [] },
    ],
  })
