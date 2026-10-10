import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { canonicalModeScopeId, canonicalScopeId, canonicalTargetBindings, canonicalTargetCandidates } from '../cardPlugins/dsl/compiler/targeting'
import { amountEvaluationContext } from '../cardPlugins/dsl/compiler/runtime'
import { evaluateTargetBounds } from '../cardPlugins/dsl/compiler'
import { objectIdentity } from '../objectIdentity'
import type { CardRuleDefinitionSnapshotV1, TargetClause } from '../cardPlugins/dsl/schema/v1'
import type { CanonicalTargetBinding, GameObject, StackExecutionContext, TargetRef } from '../types'
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
}

const sourceFor = (draft: Draft, announcement: CanonicalAnnouncement) => {
  const live = draft.object(announcement.execution.source.ref.objectId)
  return live && live.incarnation === announcement.execution.source.ref.incarnation
    ? live
    : announcement.source
}

const stackCanonical = (draft: Draft, announcement: CanonicalAnnouncement) => {
  const source = sourceFor(draft, announcement)
  const definition = loadDefinitionSnapshot(announcement.definitionSnapshot).definition
  const ability = definition.abilities[announcement.abilityIndex]
  if (!ability || ability.kind !== 'triggered') return false
  const targetBindings = announcement.selectedModes === undefined
    && announcement.targetBindings && announcement.targetBindings.length > 0
    ? announcement.targetBindings
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
      )
  if ('modes' in ability && announcement.selectedModes === undefined) {
    const modes = ability.modes ?? []
    const modeSpec = ability.decisions.modes
    const count = modeSpec ? Number(modeSpec.count.kind === 'constant' ? modeSpec.count.value : 1) : 1
    const legalModes = modes.map((mode, index) => ({ mode, index })).filter(({ mode }) => {
      const candidates = canonicalTargetCandidates(
        draft,
        source,
        { ...ability, decisions: mode.decisions },
        announcement.execution.controller,
        announcement.execution.occurrence,
      )
      return mode.decisions.targets.every((clause, clauseIndex) => {
        const bounds = evaluateTargetBounds(clause, amountEvaluationContext({
          state: draft,
          controller: announcement.execution.controller,
          source: announcement.execution.source,
          occurrence: announcement.execution.occurrence,
        }))
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
        execution: announcement.execution,
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
      ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
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
      action: {
        kind: 'putCanonicalTriggeredAbility',
        definitionSnapshot: announcement.definitionSnapshot,
        abilityIndex: announcement.abilityIndex,
        execution: announcement.execution,
        sourceId: source.id,
        targetClauses: announcement.clauseBounds,
        targetClauseDefinitions: [...announcement.targetClauses],
        targetIndex: announcement.clauseIndex,
        selectedTargets: announcement.targets,
        selectedModes: announcement.selectedModes,
        ...(announcement.targetScopeIds ? { targetScopeIds: [...announcement.targetScopeIds] } : {}),
        ...(announcement.targetModeIndices ? { targetModeIndices: [...announcement.targetModeIndices] } : {}),
        ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
      },
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
      canonicalTrigger: {
        definitionSnapshot: announcement.definitionSnapshot,
        abilityIndex: announcement.abilityIndex,
        execution: announcement.execution,
        sourceId: source.id,
        targetClauses: announcement.clauseBounds,
        targetClauseDefinitions: [...announcement.targetClauses],
        targetIndex: announcement.clauseIndex,
        selectedTargets: announcement.targets,
        selectedModes: announcement.selectedModes,
        ...(announcement.targetScopeIds ? { targetScopeIds: [...announcement.targetScopeIds] } : {}),
        ...(announcement.targetModeIndices ? { targetModeIndices: [...announcement.targetModeIndices] } : {}),
        ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
      },
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
        definitionSnapshot: announcement.definitionSnapshot,
        abilityIndex: announcement.abilityIndex,
        execution: announcement.execution,
        sourceId: source.id,
        targetClauses: announcement.clauseBounds,
        targetClauseDefinitions: [...announcement.targetClauses],
        targetIndex: announcement.clauseIndex,
        selectedTargets: announcement.targets,
        selectedStackTargets,
        selectedModes: announcement.selectedModes,
        ...(announcement.targetScopeIds ? { targetScopeIds: [...announcement.targetScopeIds] } : {}),
        ...(announcement.targetModeIndices ? { targetModeIndices: [...announcement.targetModeIndices] } : {}),
        ...(announcement.modeScopeIds ? { modeScopeIds: [...announcement.modeScopeIds] } : {}),
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
  const modeScopeIds = modeEntries.map(({ modeIndex, occurrence }) =>
    canonicalModeScopeId(announcement.abilityIndex, modeIndex, occurrence))
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
  const bounds = announcement.clauses.map((clause) => evaluateTargetBounds(clause, amountEvaluationContext({
    state: draft,
    controller: announcement.execution.controller,
    source: announcement.execution.source,
    occurrence: announcement.execution.occurrence,
  })))
  return continueCanonicalTargetSelection(draft, {
    ...announcement,
    targetClauses: announcement.clauses,
    targetScopeIds: announcement.targetScopeIds ?? announcement.clauses.map(() => canonicalScopeId(announcement.abilityIndex)),
    targetModeIndices: announcement.targetModeIndices ?? announcement.clauses.map(() => undefined),
    clauseBounds: bounds,
    clauseIndex: announcement.initialClauseIndex ?? 0,
    targets: announcement.targets ?? [],
  })
}
