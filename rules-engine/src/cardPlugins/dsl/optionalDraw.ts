import type { Instruction } from './schema/v1'

const onlyDraw = (instructions: readonly Instruction[]): boolean =>
  instructions.length > 0 && instructions.every((instruction) => {
    switch (instruction.kind) {
      case 'sequence': return onlyDraw(instruction.instructions)
      case 'draw': return instruction.targets.kind === 'contextRef' && instruction.targets.name === 'controller'
      default: return false
    }
  })

/** Only draw versus do-nothing choices qualify; payments and mixed programs must ask. */
export const optionalDrawSlots = (instruction: Extract<Instruction, { kind: 'chooseInstructions' }>) => {
  if (instruction.options.length !== 2) return
  const acceptSlot = instruction.options.findIndex((option) => onlyDraw(option.instructions))
  const declineSlot = instruction.options.findIndex((option) => option.instructions.length === 0)
  if (acceptSlot < 0 || declineSlot < 0) return
  return { acceptSlot, declineSlot }
}
