import { effectsOf } from '../cardPlugins/cardRules'
import {
  activateEffect,
  runInstructions,
  type CardInstruction,
} from '../cardPlugins/effects'
import type Draft from '../draft'
import type { StackItem } from '../types'

/**
 * Resolve an activated or triggered ability after it is popped from the stack.
 * CR 602.2 — costs are paid at activation; effects run on resolution.
 * CR 608.2 — perform the ability's instructions when it resolves.
 */
export const resolveAbility = (draft: Draft, item: StackItem) => {
  const source = draft.object(item.objectId)
  const payloadInstructions = item.payload?.instructions
  let instructions: CardInstruction[] | undefined

  if (Array.isArray(payloadInstructions)) {
    instructions = payloadInstructions as CardInstruction[]
  } else if (item.abilityId && source) {
    instructions = activateEffect(effectsOf(source), item.abilityId)?.do
  }

  if (!instructions || !source) return
  runInstructions(draft, source, instructions, item)
}
