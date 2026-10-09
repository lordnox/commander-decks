import { hasKeyword } from '../../../keywords'
import { hasProtectionFromEverything } from '../../../plugins/protectionFromEverything'
import { effectsOf } from '../../cardRules'
import type { CardRuleDefinitionV1, TargetClause } from '../schema/v1'
import type { CanonicalTargetBinding, GameObject, GameState, PlayerId, StackItem, TargetRef } from '../../../types'
import { captureObject, pinTarget, targetObject } from '../../../objectIdentity'
import type { RuleDslRuntimeContext } from './runtime'
import { evaluateObjectSelector, evaluatePlayerSelector, evaluateStackItemSelector } from './runtime'
import { evaluateTargetBounds } from './evaluate'
import { RuleDslEvaluationError } from './errors'

export const canonicalScopeId = (abilityIndex: number) => `$.abilities[${abilityIndex}]`

const identityKey = (target: TargetRef) => {
  switch (target.kind) {
    case 'player': return `player:${target.player}`
    case 'stackItem': return `stack:${target.stackId}`
    case 'object': return `object:${target.objectId}:${target.incarnation ?? ''}:${target.zone ?? ''}`
  }
}

const canonicalCandidate = (
  state: GameState,
  target: TargetRef,
  clause: TargetClause,
  context: RuleDslRuntimeContext,
  sourceId?: string,
) => {
  switch (clause.filter.kind) {
    case 'players': {
      if (target.kind !== 'player') return false
      if (!evaluatePlayerSelector(clause.filter, context).includes(target.player)) return false
      return !hasProtectionFromEverything(state, undefined, target.player)
    }
    case 'objects': {
      if (target.kind !== 'object' || (sourceId !== undefined && target.objectId === sourceId)) return false
      const object = targetObject(state, target)
      if (!object || !evaluateObjectSelector(clause.filter, context).some((candidate) => candidate.id === object.id)) return false
      if (hasProtectionFromEverything(state, object)) return false
      if (hasKeyword(object, 'shroud', state)) return false
      if (object.controller !== context.controller && hasKeyword(object, 'hexproof', state)) return false
      if (object.controller !== context.controller && !object.tapped && effectsOf(object).some((effect) =>
        effect.op === 'targetingRequirement' && effect.kind === 'hexproof-while-untapped')) return false
      return true
    }
    case 'stackItems': {
      if (target.kind !== 'stackItem') return false
      return evaluateStackItemSelector(clause.filter, context).some((candidate) => candidate.id === target.stackId)
    }
  }
}

const contextFor = (
  state: GameState,
  controller: PlayerId,
  source: GameObject,
  item?: StackItem,
  x?: number,
) => ({
  state,
  controller,
  source: captureObject(source),
  ...(item ? { stackItemId: item.id } : {}),
  variables: (item?.x ?? x) === undefined ? undefined : { X: item?.x ?? x },
})

const targetCounts = (
  clauses: readonly TargetClause[],
  context: RuleDslRuntimeContext,
) => clauses.map((clause) => evaluateTargetBounds(clause, {
  variables: context.variables,
  count: (selector) => selector.kind === 'players'
    ? evaluatePlayerSelector(selector, context).length
    : selector.kind === 'objects'
      ? evaluateObjectSelector(selector, context).length
      : evaluateStackItemSelector(selector, context).length,
  characteristic: () => { throw new RuleDslEvaluationError('target bounds cannot read a characteristic') },
}))

/**
 * Split the existing flat target command into generated clause slots. Backtracking
 * is deliberate: optional clauses need not consume a target that belongs to a
 * later clause, and an omitted slot must remain represented by its own index.
 */
const partitionTargets = (
  state: GameState,
  sourceId: string,
  clauses: readonly TargetClause[],
  supplied: readonly TargetRef[],
  context: RuleDslRuntimeContext,
) => {
  const bounds = targetCounts(clauses, context)
  const slots: TargetRef[][] = clauses.map(() => [])
  const partitions: TargetRef[][][] = []
  const visit = (clauseIndex: number, offset: number): void => {
    if (partitions.length > 1) return
    if (clauseIndex === clauses.length) {
      if (offset === supplied.length) partitions.push(slots.map((slot) => [...slot]))
      return
    }
    const clause = clauses[clauseIndex]
    const { min, max } = bounds[clauseIndex]
    const remainingMinimum = bounds.slice(clauseIndex + 1).reduce((total, bound) => total + bound.min, 0)
    const available = supplied.length - offset
    const upper = Math.min(max, available - remainingMinimum)
    for (let count = min; count <= upper; count += 1) {
      const chosen = supplied.slice(offset, offset + count)
      const keys = new Set<string>()
      if (chosen.every((target) => {
        const key = identityKey(target)
        if (keys.has(key) || !canonicalCandidate(state, target, clause, context, sourceId)) return false
        keys.add(key)
        return true
      })) {
        slots[clauseIndex] = [...chosen]
        visit(clauseIndex + 1, offset + count)
      }
    }
    slots[clauseIndex] = []
    return
  }
  visit(0, 0)
  return partitions.length === 1 ? partitions[0] : undefined
}

const groupedTargets = (
  state: GameState,
  sourceId: string | undefined,
  clauses: readonly TargetClause[],
  supplied: readonly (readonly TargetRef[])[],
  context: RuleDslRuntimeContext,
) => {
  if (supplied.length !== clauses.length) return undefined
  const bounds = targetCounts(clauses, context)
  const slots = supplied.map((targets, index) => {
    const keys = new Set<string>()
    if (targets.length < bounds[index].min || targets.length > bounds[index].max) return undefined
    if (!targets.every((target) => {
      const key = identityKey(target)
      if (keys.has(key) || !canonicalCandidate(state, target, clauses[index], context, sourceId)) return false
      keys.add(key)
      return true
    })) return undefined
    return [...targets]
  })
  return slots.every((slot): slot is TargetRef[] => slot !== undefined) ? slots : undefined
}

const satisfiesConstraints = (
  constraints: readonly import('../schema/v1').TargetConstraint[] | undefined,
  slots: readonly (readonly TargetRef[])[],
) => (constraints ?? []).every((constraint) => {
  const seen = new Set<string>()
  return constraint.kind !== 'different' || constraint.clauseIndices.every((index) => {
    for (const target of slots[index] ?? []) {
      const key = identityKey(target)
      if (seen.has(key)) return false
      seen.add(key)
    }
    return true
  })
})

export const canonicalTargetBindings = (
  state: GameState,
  source: GameObject,
  definition: CardRuleDefinitionV1,
  abilityIndex: number,
  supplied: readonly TargetRef[],
  item?: StackItem,
  grouped?: readonly (readonly TargetRef[])[],
  controller?: PlayerId,
  x?: number,
) => {
  const ability = definition.abilities[abilityIndex]
  if (!ability || (ability.kind !== 'spell' && ability.kind !== 'activated' && ability.kind !== 'triggered')) {
    throw new RuleDslEvaluationError(`ability ${abilityIndex} does not declare target clauses`)
  }
  const context = contextFor(state, controller ?? item?.controller ?? source.controller, source, item, x)
  const sourceId = ability.kind === 'spell' ? source.id : undefined
  const slots = grouped
    ? groupedTargets(state, sourceId, ability.decisions.targets, grouped, context)
    : partitionTargets(state, sourceId ?? '', ability.decisions.targets, supplied, context)
  if (!slots || !satisfiesConstraints(ability.decisions.constraints, slots)) {
    throw new RuleDslEvaluationError('supplied canonical targets do not satisfy the declared clauses')
  }
  return slots.map((recipients, clauseIndex) => ({
    scopeId: canonicalScopeId(abilityIndex),
    clauseIndex,
    recipients: recipients.map((target) => pinTarget(state, target)),
  }))
}

export const canonicalTargetLegality = (
  state: GameState,
  source: GameObject,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  binding: CanonicalTargetBinding,
  item?: StackItem,
  controller?: PlayerId,
  x?: number,
) => {
  const clause = ability.decisions.targets[binding.clauseIndex]
  if (!clause) return []
  const context = contextFor(state, controller ?? item?.controller ?? source.controller, source, item, x)
  return binding.recipients.map((target) => canonicalCandidate(state, target, clause, context, ability.kind === 'spell' ? source.id : undefined))
}

export const canonicalTargetLegalityForAbility = (
  state: GameState,
  source: GameObject,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  bindings: readonly CanonicalTargetBinding[],
  item?: StackItem,
  controller?: PlayerId,
  x?: number,
) => Object.fromEntries(bindings.map((binding) => [
  binding.clauseIndex,
  canonicalTargetLegality(state, source, ability, binding, item, controller, x),
])) as Record<number, boolean[]>

export const canonicalTargetError = (
  state: GameState,
  source: GameObject,
  definition: CardRuleDefinitionV1,
  abilityIndex: number,
  supplied: readonly TargetRef[],
  item?: StackItem,
  grouped?: readonly (readonly TargetRef[])[],
  controller?: PlayerId,
  x?: number,
) => {
  try {
    const bindings = canonicalTargetBindings(state, source, definition, abilityIndex, supplied, item, grouped, controller, x)
    const ability = definition.abilities[abilityIndex]
    if (!ability || !('decisions' in ability)) return
    const bounds = targetCounts(ability.decisions.targets, contextFor(state, controller ?? item?.controller ?? source.controller, source, item, x))
    for (const [index, bound] of bounds.entries()) {
      const count = bindings[index]?.recipients.length ?? 0
      if (count < bound.min || count > bound.max) return `canonical target clause ${index} requires ${bound.min} to ${bound.max} recipients`
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export const canonicalFlagbearerError = (
  state: GameState,
  source: GameObject,
  definition: CardRuleDefinitionV1,
  abilityIndex: number,
  supplied: readonly TargetRef[],
  grouped?: readonly (readonly TargetRef[])[],
  controller?: PlayerId,
  x?: number,
) => {
  const targetingController = controller ?? source.controller
  const flagbearers = Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller !== targetingController
    && effectsOf(object).some((effect) => effect.op === 'targetingRequirement' && effect.kind === 'flagbearer'))
  if (flagbearers.length === 0) return
  const ability = definition.abilities[abilityIndex]
  if (!ability || !('decisions' in ability)) return
  const bindings = canonicalTargetBindings(state, source, definition, abilityIndex, supplied, undefined, grouped, controller, x)
  if (bindings.some((binding) => binding.recipients.some((target) =>
    target.kind === 'object' && flagbearers.some((candidate) => candidate.id === target.objectId)))) return
  const context = contextFor(state, targetingController, source, undefined, x)
  const able = ability.decisions.targets.some((clause) => {
    if ((evaluateTargetBounds(clause, {
      variables: context.variables,
      count: (selector) => selector.kind === 'players' ? evaluatePlayerSelector(selector, context).length : selector.kind === 'objects' ? evaluateObjectSelector(selector, context).length : evaluateStackItemSelector(selector, context).length,
      characteristic: () => 0,
    }).min) === 0) return false
    return flagbearers.some((flagbearer) => canonicalCandidate(state, { kind: 'object', objectId: flagbearer.id, incarnation: flagbearer.incarnation, zone: flagbearer.zone }, clause, context, ability.kind === 'spell' ? source.id : undefined))
  })
  return able ? 'an opponent choosing targets must target a Flagbearer if able' : undefined
}
