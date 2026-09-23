import type { CardInstruction } from '../effects'
import { combatCopyHandlers } from './combatCopy'
import { controlHandlers } from './control'
import { attachedCopyOrTokenInstruction } from '../bestow'
import { chooseCreatureTypeInstruction } from '../creatureTypeChoice'
import { monarchExileInstructionHandlers } from '../monarchExile'
import { multiplayerHandlers } from './multiplayer'
import { permanentControlHandlers } from '../permanentControl'
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
  ...permanentControlHandlers,
  ...resourceHandlers,
  ...zoneHandlers,
  ...combatCopyHandlers,
  ...monarchExileInstructionHandlers,
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
