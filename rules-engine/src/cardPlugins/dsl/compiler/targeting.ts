import { hasKeyword } from '../../../keywords'
import { hasProtectionFromEverything } from '../../../plugins/protectionFromEverything'
import { effectsOf } from '../../cardRules'
import type { CardRuleDefinitionV1, TargetClause } from '../schema/v1'
import type { CanonicalTargetBinding, GameObject, GameState, PlayerId, StackItem, TargetRef } from '../../../types'
import { captureObject, objectIdentity, pinTarget, targetObject } from '../../../objectIdentity'
import type { BoundRecipient, RuleDslRuntimeContext } from './runtime'
import { amountEvaluationContext, evaluateCondition, evaluateObjectSelector, evaluatePlayerSelector, evaluateStackItemSelector } from './runtime'
import { evaluateTargetBounds } from './evaluate'
import { RuleDslEvaluationError } from './errors'

export const canonicalScopeId = (abilityIndex: number) => `$.abilities[${abilityIndex}]`

export const canonicalModeScopeId = (
  abilityIndex: number,
  modeIndex: number,
  occurrence: number,
) => `${canonicalScopeId(abilityIndex)}.modes[${modeIndex}]#${occurrence}`

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
  ...(item?.execution?.occurrence ? { occurrence: item.execution.occurrence } : {}),
  variables: (item?.x ?? x) === undefined ? undefined : { X: item?.x ?? x },
})

const targetCounts = (
  clauses: readonly TargetClause[],
  context: RuleDslRuntimeContext,
) => clauses.map((clause) => evaluateTargetBounds(clause, amountEvaluationContext(context)))

const bindingContext = (
  context: RuleDslRuntimeContext,
  slots: readonly (readonly TargetRef[])[],
  legality?: Readonly<Record<number, readonly boolean[]>>,
) => ({
  ...context,
  targets: (() => {
    const targetBindings: Record<number, BoundRecipient[]> = Object.fromEntries(slots.map((targets, clauseIndex) => {
      const recipients: BoundRecipient[] = []
      for (const target of targets) {
        switch (target.kind) {
          case 'player': recipients.push({ kind: 'player', playerId: target.player }); break
          case 'stackItem': recipients.push({ kind: 'stackItem', stackId: target.stackId }); break
          case 'object':
            if (target.incarnation !== undefined && target.zone !== undefined) {
              recipients.push({ kind: 'object', objectId: target.objectId, incarnation: target.incarnation, zone: target.zone })
            }
            break
        }
      }
      return [clauseIndex, recipients] as const
    }))
    return targetBindings
  })(),
  ...(legality ? { targetLegality: legality } : {}),
})

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
  // Recursive clause partitioning needs an explicit void return to document its traversal contract.
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
        if (keys.has(key) || !canonicalCandidate(state, target, clause, bindingContext(context, slots.slice(0, clauseIndex)), sourceId)) return false
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
      if (keys.has(key) || !canonicalCandidate(state, target, clauses[index], bindingContext(context, supplied.slice(0, index)), sourceId)) return false
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
  clausesOverride?: readonly TargetClause[],
  scopeIdsOverride?: readonly string[],
  modeIndicesOverride?: readonly (number | undefined)[],
) => {
  const ability = definition.abilities[abilityIndex]
  if (!ability || (ability.kind !== 'spell' && ability.kind !== 'activated' && ability.kind !== 'triggered')) {
    throw new RuleDslEvaluationError(`ability ${abilityIndex} does not declare target clauses`)
  }
  const context = contextFor(state, controller ?? item?.controller ?? source.controller, source, item, x)
  const clauses = clausesOverride ?? ability.decisions.targets
  const sourceId = ability.kind === 'spell' ? source.id : undefined
  const normalizedSupplied = supplied.map((target) => pinTarget(state, target))
  const normalizedGrouped = grouped?.map((clause) => clause.map((target) => pinTarget(state, target)))
  if (normalizedGrouped && normalizedSupplied.length > 0) {
    const groupedFlat = normalizedGrouped.flat()
    if (groupedFlat.length !== normalizedSupplied.length
      || groupedFlat.some((target, index) => identityKey(target) !== identityKey(normalizedSupplied[index]))) {
      throw new RuleDslEvaluationError('targets and targetClauses disagree')
    }
  }
  const slots = grouped
    ? groupedTargets(state, sourceId, clauses, normalizedGrouped!, context)
    : partitionTargets(state, sourceId ?? '', clauses, normalizedSupplied, context)
  if (!slots) {
    throw new RuleDslEvaluationError('supplied canonical targets do not satisfy the declared clauses')
  }
  const scopeSlots = new Map<string, TargetRef[][]>()
  const scopeModes = new Map<string, number | undefined>()
  const scopeIndices = new Map<string, number>()
  slots.forEach((recipients, clauseIndex) => {
    const scopeId = scopeIdsOverride?.[clauseIndex] ?? canonicalScopeId(abilityIndex)
    const localIndex = scopeIndices.get(scopeId) ?? 0
    scopeIndices.set(scopeId, localIndex + 1)
    const scopeRecipients = scopeSlots.get(scopeId) ?? []
    scopeRecipients[localIndex] = recipients
    scopeSlots.set(scopeId, scopeRecipients)
    scopeModes.set(scopeId, modeIndicesOverride?.[clauseIndex])
  })
  for (const [scopeId, scopeRecipients] of scopeSlots) {
    const modeIndex = scopeModes.get(scopeId)
    const constraints = modeIndex === undefined
      ? ability.decisions.constraints
      : ('modes' in ability ? ability.modes?.[modeIndex]?.decisions.constraints : undefined)
    if (!satisfiesConstraints(constraints, scopeRecipients)) {
      throw new RuleDslEvaluationError('supplied canonical targets do not satisfy the declared constraints')
    }
  }
  const localClauseIndices = new Map<string, number>()
  return slots.map((recipients, clauseIndex) => {
    const scopeId = scopeIdsOverride?.[clauseIndex] ?? canonicalScopeId(abilityIndex)
    const localClauseIndex = localClauseIndices.get(scopeId) ?? 0
    localClauseIndices.set(scopeId, localClauseIndex + 1)
    return {
    scopeId,
    clauseIndex: localClauseIndex,
    recipients,
    ...(modeIndicesOverride?.[clauseIndex] !== undefined
      ? { modeIndex: modeIndicesOverride[clauseIndex] }
      : {}),
    }
  })
}

/**
 * Return the public candidates for one canonical target clause while an ability
 * is being put on the stack.  This intentionally does not choose or bind a
 * target; the placement cursor owns that decision and pins the identities only
 * after the chooser answers.
 */
export const canonicalTargetCandidates = (
  state: GameState,
  source: GameObject,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  controller: PlayerId,
  occurrence?: import('../../../types').OccurrenceSnapshot,
  clausesOverride?: readonly TargetClause[],
) => {
  const context = {
    state,
    controller,
    source: captureObject(source),
    ...(occurrence ? { occurrence } : {}),
  }
  return (clausesOverride ?? ability.decisions.targets).map((clause) => {
    switch (clause.filter.kind) {
      case 'players':
        return state.playerOrder
          .filter((player) => !state.players[player]?.lost && canonicalCandidate(
            state,
            { kind: 'player', player },
            clause,
            context,
            undefined,
          ))
          .map((player) => ({ kind: 'player' as const, player }))
      case 'objects':
        return Object.values(state.objects)
          .filter((object) => object.zone !== 'stack' && canonicalCandidate(
            state,
            { kind: 'object', ...objectIdentity(object) },
            clause,
            context,
            undefined,
          ))
          .map((object) => ({ kind: 'object' as const, ...objectIdentity(object) }))
      case 'stackItems':
        return state.stack
          .filter((item) => canonicalCandidate(
            state,
            { kind: 'stackItem', stackId: item.id },
            clause,
            context,
            undefined,
          ))
          .map((item) => ({ kind: 'stackItem' as const, stackId: item.id }))
    }
  })
}

export const canonicalTargetLegalityForAbility = (
  state: GameState,
  source: GameObject,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  bindings: readonly CanonicalTargetBinding[],
  item?: StackItem,
  controller?: PlayerId,
  x?: number,
) => {
  const legality: Record<number, boolean[]> = {}
  const clauses = 'modes' in ability && item?.execution?.modeIndices
    ? item.execution.modeIndices.flatMap((index) => ability.modes?.[index]?.decisions.targets ?? [])
    : ability.decisions.targets
  for (const binding of bindings) {
    const clause = clauses[binding.clauseIndex]
    if (!clause) {
      legality[binding.clauseIndex] = []
      continue
    }
    const context = bindingContext(
      contextFor(state, controller ?? item?.controller ?? source.controller, source, item, x),
      bindings.map((entry) => entry.recipients),
      legality,
    )
    legality[binding.clauseIndex] = binding.recipients.map((target) => canonicalCandidate(
      state,
      target,
      clause,
      context,
      ability.kind === 'spell' ? source.id : undefined,
    ))
  }
  return legality
}

/**
 * Re-check each local target clause within its generated scope. Modal programs
 * may select the same mode more than once, so each occurrence retains its own
 * scope even when the mode declaration and local clause index repeat.
 */
export const canonicalTargetLegalityByScope = (
  state: GameState,
  source: GameObject,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  bindings: readonly CanonicalTargetBinding[],
  item?: StackItem,
) => {
  const legality: Record<string, Record<number, boolean[]>> = {}
  for (const binding of bindings) {
    const scope = legality[binding.scopeId] ?? {}
    const clauses = binding.modeIndex === undefined
      ? ability.decisions.targets
      : ('modes' in ability ? ability.modes?.[binding.modeIndex]?.decisions.targets ?? [] : [])
    const clause = clauses[binding.clauseIndex]
    if (!clause) {
      scope[binding.clauseIndex] = []
      legality[binding.scopeId] = scope
      continue
    }
    const context = bindingContext(
      contextFor(state, item?.controller ?? source.controller, source, item),
      bindings
        .filter((entry) => entry.scopeId === binding.scopeId)
        .sort((left, right) => left.clauseIndex - right.clauseIndex)
        .map((entry) => entry.recipients),
      scope,
    )
    scope[binding.clauseIndex] = binding.recipients.map((target) => canonicalCandidate(
      state,
      target,
      clause,
      context,
      ability.kind === 'spell' ? source.id : undefined,
    ))
    legality[binding.scopeId] = scope
  }
  return legality
}

export const canonicalWholeItemGate = (
  state: GameState,
  source: GameObject,
  ability: Extract<CardRuleDefinitionV1['abilities'][number], { decisions: unknown }>,
  bindings: readonly CanonicalTargetBinding[],
  item?: StackItem,
) => {
  const context = contextFor(state, item?.controller ?? source.controller, source, item)
  if ('interveningIf' in ability && ability.interveningIf && !evaluateCondition(ability.interveningIf, context)) {
    return { outcome: 'didNotResolve:interveningIf' as const, targetLegality: {} }
  }
  const targetLegalityByScope = bindings.length > 0
    ? canonicalTargetLegalityByScope(state, source, ability, bindings, item)
    : {}
  const scopeIds = new Set(bindings.map((binding) => binding.scopeId))
  const targetLegality = scopeIds.size <= 1
    ? Object.values(targetLegalityByScope)[0] ?? {}
    : {}
  const targetCount = bindings.reduce((total, binding) => total + binding.recipients.length, 0)
  const legalCount = bindings.reduce((total, binding) =>
    total + (targetLegalityByScope[binding.scopeId]?.[binding.clauseIndex] ?? []).filter(Boolean).length, 0)
  return targetCount > 0 && legalCount === 0
    ? { outcome: 'didNotResolve:allTargetsIllegal' as const, targetLegality, targetLegalityByScope }
    : { outcome: 'resolved' as const, targetLegality, targetLegalityByScope }
}

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
    && effectsOf(object).some((effect) => effect.op === 'targetingRequirement' && effect.kind === 'flagbearer'))
  const opposingFlagbearers = flagbearers.filter((object) => object.controller !== targetingController)
  if (opposingFlagbearers.length === 0) return
  const ability = definition.abilities[abilityIndex]
  if (!ability || !('decisions' in ability)) return
  const bindings = canonicalTargetBindings(state, source, definition, abilityIndex, supplied, undefined, grouped, controller, x)
  if (bindings.some((binding) => binding.recipients.some((target) =>
    target.kind === 'object' && flagbearers.some((candidate) => candidate.id === target.objectId)))) return
  const baseContext = contextFor(state, targetingController, source, undefined, x)
  const able = ability.decisions.targets.some((clause, clauseIndex) => {
    const binding = bindings[clauseIndex]
    if (!binding || binding.recipients.length === 0) return false
    const context = bindingContext(
      baseContext,
      bindings.slice(0, clauseIndex).map((entry) => entry.recipients),
    )
    return flagbearers.some((flagbearer) => {
      const target = { kind: 'object' as const, objectId: flagbearer.id, incarnation: flagbearer.incarnation, zone: flagbearer.zone }
      if (!canonicalCandidate(state, target, clause, context, ability.kind === 'spell' ? source.id : undefined)) return false
      return binding.recipients.some((_, recipientIndex) => {
        const prospective = bindings.map((entry, index) => index === clauseIndex
          ? entry.recipients.map((recipient, indexInClause) => indexInClause === recipientIndex ? target : recipient)
          : entry.recipients)
        return satisfiesConstraints(ability.decisions.constraints, prospective)
      })
    })
  })
  return able ? 'an opponent choosing targets must target a Flagbearer if able' : undefined
}
