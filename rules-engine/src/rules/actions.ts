import { effectsOf } from '../cardPlugins/cardRules'
import {
  activateEffect,
  conditionHolds,
  runInstructions,
  type CardCondition,
  type CardInstruction,
} from '../cardPlugins/effects'
import { gameObjectFieldDefaults } from '../definitions'
import type Draft from '../draft'
import type { GameObject, GameState, StackItem } from '../types'
import { validTargetRef } from '../cardPlugins/targetedResolve'
import type { TargetFilter } from '../cardPlugins/effects'
import { emitCyclingResolved } from '../cardPlugins/cycling'
import { resolveDiscardAction } from './discard'
import { resolveDrawAction } from './draw'

/**
 * Resolve an activated or triggered ability after it is popped from the stack.
 * CR 602.2 — costs are paid at activation; effects run on resolution.
 * CR 608.2 — perform the ability's instructions when it resolves.
 */
const stackSourceFallback = (item: StackItem): GameObject => ({
  ...gameObjectFieldDefaults(),
  id: item.objectId,
  name: item.name,
  owner: item.controller,
  controller: item.controller,
  zone: 'graveyard',
})

export const resolveAbility = (draft: Draft, item: StackItem) => {
  const payloadInstructions = item.payload?.instructions
  let instructions: CardInstruction[] | undefined

  if (Array.isArray(payloadInstructions)) {
    instructions = payloadInstructions as CardInstruction[]
  } else if (item.abilityId) {
    const live = draft.object(item.objectId)
    if (!live) return
    instructions = activateEffect(effectsOf(live), item.abilityId)?.do
  }

  if (!instructions) return

  const source = draft.object(item.objectId) ?? stackSourceFallback(item)
  const interveningIf = item.payload?.interveningIf as CardCondition | undefined
  if (interveningIf && !conditionHolds(interveningIf, draft, source)) return
  const targetFilter = item.payload?.targetFilter as TargetFilter | undefined
  if (
    targetFilter
    && !validTargetRef(draft, item.targets[0], targetFilter, item.controller)
  ) return
  emitCyclingResolved(draft, item)
  runInstructions(draft, source, instructions, item)
}

/**
 * Resolve a builtin action stack item during `resolveTop`.
 * CR 608.2 — perform the action's instructions; waiting actions stay on the stack.
 */
export const resolveAction = (draft: Draft, item: StackItem, _state: GameState) => {
  if (item.kind !== 'action') return
  if (item.actionId === 'discard') resolveDiscardAction(draft, item)
  if (item.actionId === 'draw') resolveDrawAction(draft, item)
}
