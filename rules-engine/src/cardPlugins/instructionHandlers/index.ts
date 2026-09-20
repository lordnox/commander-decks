import type { CardInstruction } from '../effects'
import { exilePayoffsInstructionHandlers } from '../exilePayoffs'
import { combatCopyHandlers } from './combatCopy'
import { becomeCopyOfTargetHandlers } from './becomeCopyOfTarget'
import { controlHandlers } from './control'
import { attachedCopyOrTokenInstruction } from '../bestow'
import { chooseCreatureTypeInstruction } from '../creatureTypeChoice'
import { monarchExileInstructionHandlers } from '../monarchExile'
import { encoreHandlers } from '../encore'
import { hiddenPileNegotiationInstruction } from '../hiddenPiles'
import { multiplayerHandlers } from './multiplayer'
import { permanentControlHandlers } from '../permanentControl'
import { opponentCreatureHandlers } from './opponentCreatures'
import { resourceHandlers } from './resources'
import type {
  InstructionContext,
  InstructionHandler,
  InstructionHandlers,
  InstructionKind,
} from './types'
import { unearthSelfInstruction } from '../unearth'
import { zoneHandlers } from './zones'
import { linkedExileInstructionHandlers } from '../linkedExile'
import { blinkHandlers } from '../blink'
import { statusEffectHandlers } from '../statusEffects'
import { monstrosityInstruction } from '../monstrosity'

const instructionHandlers = {
  ...exilePayoffsInstructionHandlers,
  ...controlHandlers,
  ...permanentControlHandlers,
  ...resourceHandlers,
  ...zoneHandlers,
  unearthSelf: unearthSelfInstruction,
  ...combatCopyHandlers,
  ...monarchExileInstructionHandlers,
  ...becomeCopyOfTargetHandlers,
  ...multiplayerHandlers,
  ...linkedExileInstructionHandlers,
  ...blinkHandlers,
  ...statusEffectHandlers,
  ...encoreHandlers,
  ...opponentCreatureHandlers,
  attachedCopyOrToken: attachedCopyOrTokenInstruction,
  chooseCreatureType: chooseCreatureTypeInstruction,
  monstrosity: monstrosityInstruction,
  hiddenPileNegotiation: hiddenPileNegotiationInstruction,
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
