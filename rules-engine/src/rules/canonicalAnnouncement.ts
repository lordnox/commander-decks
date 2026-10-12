import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { canonicalModeScopeId, canonicalScopeId, canonicalTargetBindings, canonicalTargetCandidates } from '../cardPlugins/dsl/compiler/targeting'
import { evaluateDistributionBounds, modeOccurrences, selectedDistributionScopeIds, selectedDistributionSpecs, validateScopedDistributions } from '../cardPlugins/dsl/compiler/modes'
import { amountEvaluationContext } from '../cardPlugins/dsl/compiler/runtime'
import { evaluateAmount, evaluateTargetBounds } from '../cardPlugins/dsl/compiler'
import { objectIdentity } from '../objectIdentity'
import type { CardRuleDefinitionSnapshotV1, TargetClause } from '../cardPlugins/dsl/schema/v1'
import type { CanonicalTargetBinding, GameObject, StackExecutionContext, TargetRef } from '../types'
import { allocationOptions } from './canonicalAllocation'
import { openCardSelection, targetDestinations } from './selectCards'
import { openOptionSelection } from './selectOptions'
import { openPlayerSelection } from './selectPlayers'

type ClauseBounds = { min: number; max: number }

export type CanonicalAnnouncement = {
  definitionSnapshot: CardRuleDefinitionSnapshotV1
  abilityIndex: number
  execution: StackExecutionContext
  source: GameObject
  sourceId: string
  targets: TargetRef[]
  targetBindings?: CanonicalTargetBinding[]
  targetClauses: readonly TargetClause[]
  clauseBounds: ClauseBounds[]
  clauseIndex: number
  selectedModes?: number[]
  targetScopeIds?: readonly string[]
  targetModeIndices?: readonly (number | undefined)[]
  modeScopeIds?: readonly string[]
  distributionBounds?: readonly { total: number; minEach: number }[]
}

export type CanonicalChoicePayload = {
  definitionSnapshot: CardRuleDefinitionSnapshotV1
  abilityIndex: number
  execution: StackExecutionContext
  sourceId: string
  targetClauses: ClauseBounds[]
  targetClauseDefinitions: TargetClause[]
  targetIndex: number
  selectedTargets: TargetRef[]
  selectedModes?: number[]
  targetScopeIds?: string[]
  targetModeIndices?: Array<number | undefined>
  modeScopeIds?: string[]
  distributionBounds?: Array<{ total: number; minEach: number }>
}

export const canonicalChoicePayload = (
  announcement: CanonicalAnnouncement,
  sourceId = announcement.sourceId,
) => ({
  definitionSnapshot: announcement.definitionSnapshot,
  abilityIndex: announcement.abilityIndex,
  execution: announcement.execution,
  sourceId,
  targetClauses: [...announcement.clauseBounds],
  targetClauseDefinitions: [...announcement.targetClauses],
  targetIndex: announcement.clauseIndex,
  selectedTargets: [...announcement.targets],
  selectedModes: announcement.selectedModes ? [...announcement.selectedModes] : undefined,
  ...(announcement.targetScopeIds ? { targetScopeIds: [...announcement.targetScopeIds] } : {}),
  ...(announcement.targetModeIndices ? { targetModeIndices: [...announcement.targetModeIndices] } : {}),
  ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
  ...(announcement.distributionBounds ? { distributionBounds: [...announcement.distributionBounds] } : {}),
}) satisfies CanonicalChoicePayload

export const canonicalChoiceAnnouncement = (
  payload: CanonicalChoicePayload,
  continuation: Pick<CanonicalAnnouncement, 'source' | 'sourceId' | 'targets' | 'targetClauses' | 'clauseBounds' | 'clauseIndex'>,
) => ({
  definitionSnapshot: payload.definitionSnapshot,
  abilityIndex: payload.abilityIndex,
  execution: payload.execution,
  source: continuation.source,
  sourceId: continuation.sourceId,
  targetClauses: continuation.targetClauses,
  clauseBounds: continuation.clauseBounds,
  clauseIndex: continuation.clauseIndex,
  targets: continuation.targets,
  selectedModes: payload.selectedModes,
  targetScopeIds: payload.targetScopeIds,
  targetModeIndices: payload.targetModeIndices,
  modeScopeIds: payload.modeScopeIds,
  distributionBounds: payload.distributionBounds,
}) satisfies CanonicalAnnouncement

const sourceFor = (draft: Draft, announcement: CanonicalAnnouncement) => {
  const live = draft.object(announcement.execution.source.ref.objectId)
  return live && live.incarnation === announcement.execution.source.ref.incarnation
    ? live
    : announcement.source
}

const announcementContext = (draft: Draft, announcement: Pick<CanonicalAnnouncement, 'execution'>) => ({
  state: draft,
  controller: announcement.execution.controller,
  source: announcement.execution.source,
  ...(announcement.execution.occurrence ? { occurrence: announcement.execution.occurrence } : {}),
  ...(announcement.execution.capturedOccurrence ? { capturedOccurrence: announcement.execution.capturedOccurrence } : {}),
  ...(announcement.execution.capturedOccurrenceBindings ? { capturedOccurrenceBindings: announcement.execution.capturedOccurrenceBindings } : {}),
  ...(announcement.execution.variables ? { variables: announcement.execution.variables } : {}),
  ...(announcement.execution.choices
    ? {
        choices: {
          ...announcement.execution.choices,
          ...Object.fromEntries(Object.entries(announcement.execution.capturedChoiceAliases ?? {}).flatMap(([original, alias]) => {
            const value = announcement.execution.choices?.[original]
            return value === undefined ? [] : [[alias, value]]
          })),
        },
      }
    : {}),
  ...(announcement.execution.results
    ? {
        results: {
          ...announcement.execution.results,
          ...Object.fromEntries(Object.entries(announcement.execution.capturedResultAliases ?? {}).flatMap(([original, alias]) => {
            const value = announcement.execution.results?.[original]
            return value === undefined ? [] : [[alias, value]]
          })),
        },
      }
    : {}),
  ...(announcement.execution.scopeId ? { scopeId: announcement.execution.scopeId } : {}),
})

export const stackCanonical = (draft: Draft, announcement: CanonicalAnnouncement): boolean => {
  const source = sourceFor(draft, announcement)
  const definition = loadDefinitionSnapshot(announcement.definitionSnapshot).definition
  const ability = definition.abilities[announcement.abilityIndex]
  if (!ability || ability.kind !== 'triggered') return false
  const selectedTargetBindings = announcement.selectedModes === undefined
    && announcement.targetBindings && announcement.targetBindings.length > 0
    ? announcement.targetBindings
    : announcement.targetClauses.length === 0
      && announcement.targets.length === 0
      && announcement.execution.targetBindings
      ? announcement.execution.targetBindings
      : canonicalTargetBindings(
        draft,
        source,
        definition,
        announcement.abilityIndex,
        announcement.targets,
        undefined,
        undefined,
        announcement.execution.controller,
        undefined,
        announcement.targetClauses,
        announcement.targetScopeIds,
        announcement.targetModeIndices,
        undefined,
        undefined,
        announcement.execution,
      )
  const targetBindings = selectedTargetBindings
  const distributionSpecs = selectedDistributionSpecs(ability, announcement.selectedModes)
  if (distributionSpecs.length > 0 && !announcement.execution.distributionBindings) {
    const context = amountEvaluationContext(announcementContext(draft, announcement))
    const bounds = announcement.distributionBounds ?? distributionSpecs.map((spec) => evaluateDistributionBounds(spec, context))
    const scopeIds = selectedDistributionScopeIds(announcement.abilityIndex, ability, announcement.selectedModes)
    const first = distributionSpecs[0]
    const binding = targetBindings?.find((entry) => entry.scopeId === scopeIds[0] && entry.clauseIndex === first.targetClauseIndex)
    const recipientCount = binding?.recipients.length ?? 0
    const recipientCounts = distributionSpecs.map((spec, index) => targetBindings?.find((entry) => entry.scopeId === scopeIds[index] && entry.clauseIndex === spec.targetClauseIndex)?.recipients.length ?? 0)
    if (recipientCount === 0 && (bounds[0]?.total ?? 0) !== 0) return false
    if (recipientCount === 0) {
      const allocation = distributionSpecs.map((spec, index) => ({ scopeId: scopeIds[index], clauseIndex: spec.targetClauseIndex, amounts: [] }))
      return stackCanonical(draft, {
        ...announcement,
        distributionBounds: bounds,
        execution: { ...announcement.execution, distributionBindings: allocation, distributionBounds: bounds },
      })
    }
    openOptionSelection(draft, {
      seat: announcement.execution.controller,
      sourceId: source.id,
      source: source.name,
      prompt: `Allocate ${bounds[0]?.total ?? 0} for ${source.name}.`,
      options: allocationOptions(0, recipientCount, bounds[0] ?? { total: 0, minEach: 0 }),
      action: {
        kind: 'putCanonicalTriggeredAbilityAllocation',
        announcement,
        specs: distributionSpecs.map((spec) => structuredClone(spec)),
        bounds: bounds.map((bound) => ({ ...bound })),
        allocations: distributionSpecs.map((spec, index) => ({ scopeId: scopeIds[index], clauseIndex: spec.targetClauseIndex, amounts: [] })),
        recipientCounts,
        specIndex: 0,
        recipientCount,
        allocationIndex: 0,
        amounts: [],
      },
    })
    return true
  }
  if (distributionSpecs.length > 0) {
    try {
      validateScopedDistributions(
        distributionSpecs,
        announcement.execution.distributionBindings ?? [],
        (scopeId, clauseIndex) => targetBindings?.find((binding) => binding.scopeId === scopeId && binding.clauseIndex === clauseIndex)?.recipients ?? [],
        amountEvaluationContext(announcementContext(draft, announcement)),
        selectedDistributionScopeIds(announcement.abilityIndex, ability, announcement.selectedModes),
        announcement.distributionBounds,
      )
    } catch {
      return false
    }
  }
  if ('modes' in ability && announcement.selectedModes === undefined) {
    const modes = ability.modes ?? []
    const modeSpec = ability.decisions.modes
    const count = modeSpec
      ? evaluateAmount(modeSpec.count, amountEvaluationContext(announcementContext(draft, announcement)))
      : 1
    const legalModes = modes.map((mode, index) => ({ mode, index })).filter(({ mode }) => {
      const candidates = canonicalTargetCandidates(
        draft,
        source,
        { ...ability, decisions: mode.decisions },
        announcement.execution.controller,
        announcement.execution.occurrence,
        undefined,
        undefined,
        announcement.execution.capturedOccurrence,
        announcement.execution.capturedOccurrenceBindings,
      )
      return mode.decisions.targets.every((clause, clauseIndex) => {
        const bounds = evaluateTargetBounds(clause, amountEvaluationContext(announcementContext(draft, announcement)))
        return (candidates[clauseIndex]?.length ?? 0) >= bounds.min
      })
    })
    if (legalModes.length === 0 || (!modeSpec?.repeatable && legalModes.length < count)) return false
    openOptionSelection(draft, {
      seat: announcement.execution.controller,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose ${count} mode${count === 1 ? '' : 's'} for ${source.name}.`,
      options: legalModes.map(({ index }) => ({ id: `mode:${index}`, label: `Mode ${index + 1}` })),
      action: {
        kind: 'putCanonicalModeTriggeredAbility',
        definitionSnapshot: announcement.definitionSnapshot,
        abilityIndex: announcement.abilityIndex,
        execution: { ...announcement.execution, modeCount: count },
        sourceId: source.id,
        targets: announcement.targets,
        targetBindings,
        modeCount: count,
        repeatable: modeSpec?.repeatable ?? false,
        selectedModes: [],
        modeClauses: legalModes.flatMap(({ mode }) => mode.decisions.targets),
        modeClausesByMode: modes.map((mode) => [...mode.decisions.targets]),
        baseTargetClauses: [...announcement.targetClauses],
        baseTargetScopeIds: announcement.targetScopeIds ? [...announcement.targetScopeIds] : undefined,
        baseTargetModeIndices: announcement.targetModeIndices ? [...announcement.targetModeIndices] : undefined,
        ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
        ...(announcement.distributionBounds ? { distributionBounds: [...announcement.distributionBounds] } : {}),
      },
    })
    return true
  }
  draft.addToStack({
    kind: 'ability',
    objectId: source.id,
    controller: announcement.execution.controller,
    name: source.name,
    targets: announcement.targets,
    execution: {
      ...announcement.execution,
      definitionSnapshot: announcement.definitionSnapshot,
      abilityIndex: announcement.abilityIndex,
      ...(announcement.selectedModes ? { modeIndices: announcement.selectedModes } : {}),
      ...(announcement.execution.variables ? { variables: structuredClone(announcement.execution.variables) } : {}),
      ...(announcement.execution.results ? { results: structuredClone(announcement.execution.results) } : {}),
      ...(announcement.execution.scopeId ? { scopeId: announcement.execution.scopeId } : {}),
      ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
      ...(announcement.distributionBounds ? { distributionBounds: [...announcement.distributionBounds] } : {}),
      targetBindings,
    },
  })
  return true
}

/** Continue one canonical target clause, opening the next typed request or stacking the ability. */
export const continueCanonicalTargetSelection = (
  draft: Draft,
  announcement: CanonicalAnnouncement,
): boolean => {
  const definition = loadDefinitionSnapshot(announcement.definitionSnapshot).definition
  const ability = definition.abilities[announcement.abilityIndex]
  if (!ability || ability.kind !== 'triggered') return false
  if (announcement.clauseIndex >= announcement.clauseBounds.length) {
    return stackCanonical(draft, announcement)
  }
  const source = sourceFor(draft, announcement)
  const candidates = canonicalTargetCandidates(
    draft,
    source,
    ability,
    announcement.execution.controller,
    announcement.execution.occurrence,
    announcement.targetClauses,
    undefined,
    announcement.execution.capturedOccurrence,
    announcement.execution.capturedOccurrenceBindings,
  )[announcement.clauseIndex] ?? []
  const bounds = announcement.clauseBounds[announcement.clauseIndex]
  if (candidates.length < bounds.min) return false
  if (candidates.length === 0 || bounds.max === 0) {
    return continueCanonicalTargetSelection(draft, {
      ...announcement,
      clauseIndex: announcement.clauseIndex + 1,
    })
  }
  if (candidates.every((candidate) => candidate.kind === 'player')) {
    openPlayerSelection(draft, {
      seat: announcement.execution.controller,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose target${bounds.max === 1 ? '' : 's'} for ${source.name}.`,
      min: bounds.min,
      max: Math.min(bounds.max, candidates.length),
      candidates: candidates.map((candidate) => candidate.player),
      action: { kind: 'putCanonicalTriggeredAbility', ...canonicalChoicePayload(announcement, source.id) },
    })
    return true
  }
  if (candidates.every((candidate) => candidate.kind === 'object')) {
    const objects = candidates.map((candidate) => candidate.objectId)
    openCardSelection(draft, {
      seat: announcement.execution.controller,
      kind: 'choose',
      count: Math.min(bounds.max, objects.length),
      min: bounds.min,
      candidates: objects,
      targetIdentities: Object.fromEntries(objects.map((id) => [id, objectIdentity(draft.objects[id])])),
      sourceId: source.id,
      source: source.name,
      prompt: `Choose target${bounds.max === 1 ? '' : 's'} for ${source.name}.`,
      destinations: targetDestinations(objects.length, bounds.min),
      canonicalTrigger: canonicalChoicePayload(announcement, source.id),
    })
    return true
  }
  if (candidates.every((candidate) => candidate.kind === 'stackItem')) {
    const stackItems = candidates.map((candidate) => candidate.stackId)
    const selectedStackTargets: string[] = []
    const options = stackItems.map((stackId) => ({
      id: `stack:${stackId}`,
      label: draft.stack.find((item) => item.id === stackId)?.name ?? stackId,
    }))
    if (bounds.min === 0) options.push({ id: 'done', label: 'Done' })
    openOptionSelection(draft, {
      seat: announcement.execution.controller,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose target for ${source.name}.`,
      options,
      action: {
        kind: 'putCanonicalStackTarget',
        ...canonicalChoicePayload(announcement, source.id),
        selectedStackTargets,
      },
    })
    return true
  }
  return false
}

export const continueCanonicalModeTargets = (
  draft: Draft,
  announcement: Omit<CanonicalAnnouncement, 'clauseBounds' | 'clauseIndex' | 'targetClauses'> & {
    clauses: readonly TargetClause[]
    selectedModes: readonly number[]
    initialClauseIndex?: number
  },
) => {
  const definition = loadDefinitionSnapshot(announcement.definitionSnapshot).definition
  const ability = definition.abilities[announcement.abilityIndex]
  const modeEntries = ability && 'modes' in ability ? announcement.selectedModes.map((modeIndex, occurrence) => ({
    modeIndex,
    occurrence,
    clauses: ability.modes?.[modeIndex]?.decisions.targets ?? [],
  })) : []
  const modeTargetScopeIds = modeEntries.flatMap(({ modeIndex, occurrence, clauses }) =>
    clauses.map(() => canonicalModeScopeId(announcement.abilityIndex, modeIndex, occurrence)))
  const modeTargetModeIndices = modeEntries.flatMap(({ modeIndex, clauses }) =>
    clauses.map(() => modeIndex))
  const modeScopeIds = modeOccurrences(announcement.abilityIndex, announcement.selectedModes)
    .map(({ scopeId }) => scopeId)
  return startCanonicalAnnouncement(draft, {
    ...announcement,
    targetScopeIds: announcement.targetScopeIds ?? modeTargetScopeIds,
    targetModeIndices: announcement.targetModeIndices ?? modeTargetModeIndices,
    modeScopeIds,
  })
}

export const startCanonicalAnnouncement = (
  draft: Draft,
  announcement: Omit<CanonicalAnnouncement, 'clauseIndex' | 'clauseBounds' | 'targets' | 'targetClauses'> & {
    clauses: readonly TargetClause[]
    targets?: TargetRef[]
    initialClauseIndex?: number
  },
) => {
  const bounds = announcement.clauses.map((clause) => evaluateTargetBounds(clause, amountEvaluationContext(announcementContext(draft, announcement))))
  const definition = loadDefinitionSnapshot(announcement.definitionSnapshot).definition
  const ability = definition.abilities[announcement.abilityIndex]
  const distributionBounds = announcement.distributionBounds ?? (ability && ability.kind === 'triggered'
    ? selectedDistributionSpecs(ability, announcement.selectedModes).map((spec) => evaluateDistributionBounds(spec, amountEvaluationContext(announcementContext(draft, announcement))))
    : [])
  return continueCanonicalTargetSelection(draft, {
    ...announcement,
    targetClauses: announcement.clauses,
    targetScopeIds: announcement.targetScopeIds ?? announcement.clauses.map(() => canonicalScopeId(announcement.abilityIndex)),
    targetModeIndices: announcement.targetModeIndices ?? announcement.clauses.map(() => undefined),
    clauseBounds: bounds,
    clauseIndex: announcement.initialClauseIndex ?? 0,
    targets: announcement.targets ?? [],
    distributionBounds,
  })
}
