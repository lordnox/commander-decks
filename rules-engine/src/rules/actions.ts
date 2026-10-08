import { effectsOf } from '../cardPlugins/cardRules'
import {
  activateEffect,
  conditionHolds,
  runInstructions,
  type CardCondition,
  type CardInstruction,
} from '../cardPlugins/effects'
import {
  bumpResolveCountThisTurn,
  triggerEffectByKey,
} from '../cardPlugins/triggerFrequency'
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
  const capturedAbility = item.payload?.abilityEffect as
    | ReturnType<typeof activateEffect>
    | undefined
  let instructions: CardInstruction[] | undefined

  if (Array.isArray(payloadInstructions)) {
    instructions = payloadInstructions as CardInstruction[]
  } else if (item.abilityId) {
    const live = draft.object(item.objectId)
    const sourceIdentity = item.execution?.source.ref
    const source = live
      && (!sourceIdentity
        || (
          live.incarnation === sourceIdentity.incarnation
          && live.zone === sourceIdentity.zone
        ))
      ? live
      : item.execution?.source.snapshot
    if (!source) return
    instructions = capturedAbility?.do ?? activateEffect(effectsOf(source), item.abilityId)?.do
  }

  if (!instructions) return

  const currentSource = draft.object(item.objectId)
  const sourceIdentity = item.execution?.source.ref
  const liveSource = currentSource
    && (!sourceIdentity
      || (
        currentSource.incarnation === sourceIdentity.incarnation
        && currentSource.zone === sourceIdentity.zone
      ))
    ? currentSource
    : undefined
  const sourceBase = liveSource ?? item.execution?.source.snapshot ?? stackSourceFallback(item)
  // Keep the real live object when its captured controller is unchanged: many
  // legacy instructions intentionally stamp state on their source. A controlled
  // source is viewed through the ability's independently captured controller.
  const source = sourceBase.controller === item.controller
    ? sourceBase
    : { ...sourceBase, controller: item.controller }
  const triggerEffectKey = item.payload?.triggerEffectKey as string | undefined
  if (triggerEffectKey) {
    const effect = item.payload?.triggerEffect as ReturnType<typeof triggerEffectByKey>
      ?? triggerEffectByKey(effectsOf(source), triggerEffectKey)
    if (effect?.whenResolvedNth) {
      const resolveCount = bumpResolveCountThisTurn(
        liveSource ?? source,
        triggerEffectKey,
        draft.turn,
      )
      instructions = resolveCount === effect.whenResolvedNth.nth
        ? effect.whenResolvedNth.do
        : effect.do
    }
  }
  const interveningIf = item.payload?.interveningIf as CardCondition | undefined
  const triggeringId = item.payload?.triggeringObjectId
  const triggering = typeof triggeringId === 'string' ? draft.object(triggeringId) : undefined
  if (interveningIf && !conditionHolds(interveningIf, draft, source, undefined, triggering)) return
  const targetFilter = item.payload?.targetFilter as TargetFilter | undefined
  let resolving = item
  if (targetFilter) {
    // CR 608.2b: each target is re-checked on its own; the ability fizzles only
    // when none remain legal, and otherwise acts on the targets that still are.
    const legal = item.targets.filter((target) =>
      validTargetRef(draft, target, targetFilter, item.controller, undefined, item.objectId))
    if (legal.length === 0) return
    resolving = { ...item, targets: legal }
  }
  runInstructions(draft, source, instructions, resolving)
  if (!item.abilityId) return
  const effect = capturedAbility ?? activateEffect(effectsOf(source), item.abilityId)
  if (
    effect?.cycling
    && !effect.do.some((instruction) => instruction.kind === 'searchLibrary')
  ) {
    emitCyclingResolved(draft, item)
  }
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
