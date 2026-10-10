import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { canonicalTargetBindings, canonicalTargetCandidates } from '../cardPlugins/dsl/compiler/targeting'
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
  clauseBounds: ClauseBounds[]
  clauseIndex: number
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
  const targetBindings = announcement.targetBindings ?? canonicalTargetBindings(
    draft,
    source,
    definition,
    announcement.abilityIndex,
    announcement.targets,
    undefined,
    ability.decisions.targets.length === 0 ? [] : undefined,
    announcement.execution.controller,
  )
  if ('modes' in ability) {
    const modes = ability.modes ?? []
    const modeSpec = ability.decisions.modes
    const count = modeSpec ? Number(modeSpec.count.kind === 'constant' ? modeSpec.count.value : 1) : 1
    openOptionSelection(draft, {
      seat: announcement.execution.controller,
      sourceId: source.id,
      source: source.name,
      prompt: `Choose ${count} mode${count === 1 ? '' : 's'} for ${source.name}.`,
      options: modes.map((_, index) => ({ id: `mode:${index}`, label: `Mode ${index + 1}` })),
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
      targetBindings,
    },
  })
  return true
}

/** Continue one canonical target clause, opening the next typed request or stacking the ability. */
export const continueCanonicalTargetSelection = (
  draft: Draft,
  announcement: CanonicalAnnouncement,
) => {
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
        targetIndex: announcement.clauseIndex,
        selectedTargets: announcement.targets,
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
        targetIndex: announcement.clauseIndex,
        selectedTargets: announcement.targets,
      },
    })
    return true
  }
  return false
}

export const startCanonicalAnnouncement = (
  draft: Draft,
  announcement: Omit<CanonicalAnnouncement, 'clauseIndex' | 'clauseBounds' | 'targets'> & {
    clauses: readonly TargetClause[]
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
    clauseBounds: bounds,
    clauseIndex: 0,
    targets: [],
  })
}
