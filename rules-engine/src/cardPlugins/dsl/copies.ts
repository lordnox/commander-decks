import { loadDefinitionSnapshot } from './compiler'
import { canonicalTargetError } from './compiler/targeting'
import { ceaseToExist, putSpellCopyOnStack } from '../../rules/spellCopies'
import type { Draft } from '../../draft'
import type { GameObject, StackItem, TargetRef, PlayerId } from '../../types'
export const copyTargets = (
  original: StackItem,
  retargeted?: readonly TargetRef[],
) => structuredClone(retargeted ?? original.targets)

/**
 * Validate only explicitly supplied replacement targets. Keeping targets is a
 * separate legal choice and deliberately does not re-run target selection.
 */
export const validateCanonicalCopyTargets = (
  state: Parameters<typeof canonicalTargetError>[0],
  original: StackItem,
  source: GameObject,
  targets: readonly TargetRef[],
  controller = original.controller,
) => {
  const snapshot = original.execution?.definitionSnapshot
  if (!snapshot) return 'the copied spell has no pinned canonical definition'
  const definition = loadDefinitionSnapshot(snapshot).definition
  const abilityIndex = original.execution?.abilityIndex
    ?? definition.abilities.findIndex((ability) => ability.kind === 'spell')
  if (abilityIndex < 0) return 'the copied spell has no pinned canonical definition'
  const ability = definition.abilities[abilityIndex]
  const clausesOverride = original.execution?.targetBindings?.map((binding) =>
    ability && 'decisions' in ability
      ? (binding.modeIndex !== undefined && 'modes' in ability
        ? ability.modes?.[binding.modeIndex]?.decisions.targets[binding.clauseIndex]
        : ability.decisions.targets[binding.clauseIndex])
      : undefined,
  ).filter((clause): clause is NonNullable<typeof clause> => Boolean(clause))
  const error = canonicalTargetError(
    state,
    source,
    definition,
    abilityIndex,
    targets,
    original,
    undefined,
    controller,
    original.x,
    new Set(original.targets
      .filter((target, index) => JSON.stringify(target) === JSON.stringify(targets[index]))
      .map((target) => {
        switch (target.kind) {
          case 'player': return `player:${target.player}`
          case 'stackItem': return `stack:${target.stackId}`
          case 'object': return `object:${target.objectId}:${target.incarnation ?? ''}:${target.zone ?? ''}`
        }
      })),
    clausesOverride,
  )
  return error
}

export type CanonicalCopyTargetAnswer =
  | { kind: 'keep' }
  | { kind: 'chooseNewTargets'; targets: readonly TargetRef[] }

export const resolveCanonicalCopyTargets = (
  state: Parameters<typeof canonicalTargetError>[0],
  original: StackItem,
  source: GameObject,
  answer: CanonicalCopyTargetAnswer,
  controller = original.controller,
) => {
  if (answer.kind === 'keep') return { ok: true as const, targets: copyTargets(original) }
  const error = validateCanonicalCopyTargets(state, original, source, answer.targets, controller)
  return error
    ? { ok: false as const, error }
    : { ok: true as const, targets: copyTargets(original, answer.targets) }
}

/** Put a canonical spell copy on the stack, retaining its complete execution context. */
export const putCanonicalSpellCopyOnStack = (
  draft: Draft,
  original: StackItem,
  source: GameObject,
  controller: PlayerId,
  targets?: readonly TargetRef[],
) => {
  const copy = putSpellCopyOnStack(draft, source, controller, [...copyTargets(original, targets)])
  const created = draft.stack.find((item) => item.id === copy.id)
  if (!created) throw new Error('spell copy was not placed on the stack')
  created.execution = original.execution ? structuredClone(original.execution) : undefined
  if (created.execution?.targetBindings && targets) {
    let targetIndex = 0
    created.execution.targetBindings = created.execution.targetBindings.map((binding) => ({
      ...binding,
      recipients: binding.recipients.map((recipient) => {
        const replacement = targets[targetIndex++]
        if (!replacement) return recipient
        const unchanged = recipient.kind === replacement.kind && (
          recipient.kind === 'player' && replacement.kind === 'player'
            ? recipient.player === replacement.player
            : recipient.kind === 'stackItem' && replacement.kind === 'stackItem'
              ? recipient.stackId === replacement.stackId
              : recipient.kind === 'object' && replacement.kind === 'object'
              ? recipient.objectId === replacement.objectId
                && recipient.incarnation === replacement.incarnation
                && recipient.zone === replacement.zone
                : false
        )
        if (unchanged) return recipient
        return structuredClone(replacement)
      }),
    }))
  }
  created.x = original.x
  created.abilityId = original.abilityId
  created.uncounterable = original.uncounterable
  return created
}

