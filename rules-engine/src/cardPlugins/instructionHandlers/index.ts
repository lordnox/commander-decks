import type { CardInstruction } from '../effects'
import { combatCopyHandlers } from './combatCopy'
import { controlHandlers } from './control'
import { attachedCopyOrTokenInstruction } from '../bestow'
import { chooseCreatureTypeInstruction } from '../creatureTypeChoice'
import { multiplayerHandlers } from './multiplayer'
import { resourceHandlers } from './resources'
import type {
  InstructionContext,
  InstructionHandler,
  InstructionHandlers,
  InstructionKind,
} from './types'
import { zoneHandlers } from './zones'
import { linkedExileInstructionHandlers } from '../linkedExile'
import { blinkHandlers } from '../blink'

const instructionHandlers = {
  ...controlHandlers,
  ...resourceHandlers,
  ...zoneHandlers,
  ...combatCopyHandlers,
  ...multiplayerHandlers,
  ...linkedExileInstructionHandlers,
  ...blinkHandlers,
  attachedCopyOrToken: attachedCopyOrTokenInstruction,
  chooseCreatureType: chooseCreatureTypeInstruction,
} satisfies InstructionHandlers

export const dispatchInstruction = (
  ctx: InstructionContext,
  instruction: CardInstruction,
) => {
  // The kind selects the matching handler, but TypeScript cannot retain that mapped correlation.
  const handler = instructionHandlers[instruction.kind] as InstructionHandler<InstructionKind>
  handler(ctx, instruction)
}

export { flushStackActions } from './helpers'
export type { BufferedStackAction, InstructionContext } from './types'
