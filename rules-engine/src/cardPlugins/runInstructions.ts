import type Draft from '../draft'
import type { GameObject, StackItem } from '../types'
import type { CardInstruction } from './effects'
import {
  dispatchInstruction,
  flushStackActions,
  type BufferedStackAction,
  type InstructionContext,
} from './instructionHandlers'

export const runInstructions = (
  draft: Draft,
  source: GameObject,
  instructions: CardInstruction[],
  item?: StackItem,
  stackBuffer?: BufferedStackAction[],
) => {
  const buffer = stackBuffer ?? (item ? [] : undefined)
  const run = (nested: CardInstruction[], nestedSource = source) => {
    const ctx: InstructionContext = {
      draft,
      source: nestedSource,
      item,
      buffer,
      run,
    }
    for (const instruction of nested) dispatchInstruction(ctx, instruction)
  }

  run(instructions)

  if (buffer && stackBuffer === undefined) flushStackActions(draft, source, buffer, item)
}
