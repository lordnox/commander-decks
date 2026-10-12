import { loadDefinitionSnapshot } from './compiler'
import { canonicalTargetError } from './compiler/targeting'
import { putSpellCopyOnStack } from '../../rules/spellCopies'
import type { Draft } from '../../draft'
import { captureObject } from '../../objectIdentity'
import type { CardRuleDefinitionV1, TargetClause } from './schema/v1'
import type { GameObject, StackItem, TargetRef, PlayerId } from '../../types'
export const copyTargets = (
  original: StackItem,
  retargeted?: readonly TargetRef[],
) => structuredClone(retargeted ?? original.targets)

const targetIdentity = (target: TargetRef) => {
  switch (target.kind) {
    case 'player': return `player:${target.player}`
    case 'stackItem': return `stack:${target.stackId}`
    case 'object': return `object:${target.objectId}:${target.incarnation ?? ''}:${target.zone ?? ''}`
  }
}

const sameTarget = (left: TargetRef, right: TargetRef) => targetIdentity(left) === targetIdentity(right)

const copyTargetLayout = (
  original: StackItem,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  targets: readonly TargetRef[],
) => {
  const bindings = original.execution?.targetBindings ?? []
  if (bindings.length === 0) return
  const clauses: TargetClause[] = []
  const grouped: TargetRef[][] = []
  const scopeIds: string[] = []
  const modeIndices: Array<number | undefined> = []
  let targetIndex = 0
  for (const binding of bindings) {
    const clause = binding.modeIndex !== undefined && 'modes' in ability
      ? ability.modes?.[binding.modeIndex]?.decisions.targets[binding.clauseIndex]
      : ability.decisions.targets[binding.clauseIndex]
    if (!clause) return
    const count = binding.recipients.length
    clauses.push({
      ...clause,
      min: { kind: 'constant', value: count },
      max: { kind: 'constant', value: count },
    })
    grouped.push(targets.slice(targetIndex, targetIndex + count))
    scopeIds.push(binding.scopeId)
    modeIndices.push(binding.modeIndex)
    targetIndex += count
  }
  if (targetIndex !== original.targets.length) return
  return { clauses, grouped, scopeIds, modeIndices }
}

/** Replace one target slot while retaining answers already given for earlier slots. */
export const copyTargetsWithReplacement = (
  original: StackItem,
  slotIndex: number,
  replacement: TargetRef,
  answers?: readonly TargetRef[],
) => original.targets.map((target, index) =>
  index < slotIndex ? answers?.[index] ?? target : index === slotIndex ? replacement : target)

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
  if (!ability || !('decisions' in ability)) return 'the copied spell has no target clauses'
  const layout = copyTargetLayout(original, ability, targets)
  const clausesOverride = layout?.clauses
  const grouped = layout?.grouped
  if (original.execution?.targetBindings && !layout) return 'the copied spell has inconsistent target bindings'
  const preservedPins = new Set<number>()
  for (const [index, target] of original.targets.entries()) {
    if (sameTarget(target, targets[index] ?? target)) preservedPins.add(index)
  }
  const error = canonicalTargetError(
    state,
    source,
    definition,
    abilityIndex,
    targets,
    original,
    grouped,
    controller,
    original.x,
    clausesOverride,
    layout?.scopeIds,
    layout?.modeIndices,
    preservedPins,
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
  created.execution = original.execution
    ? {
      ...structuredClone(original.execution),
      controller,
      source: captureObject(draft.object(created.objectId) ?? source),
    }
    : undefined
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

