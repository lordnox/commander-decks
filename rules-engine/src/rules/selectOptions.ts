import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { continueCanonicalModeTargets, continueCanonicalTargetSelection, stackCanonical } from './canonicalAnnouncement'
import { canonicalModeScopeId } from '../cardPlugins/dsl/compiler/targeting'
import { validateModeSelection } from '../cardPlugins/dsl/compiler/modes'
import type { CanonicalTargetBinding, GameState, ManaPool, PlayerId, Plugin, TargetRef } from '../types'

export const PENDING_OPTION_SELECTION = 'kernel.pendingOptionSelection'

export type PendingOptionSelection = {
  id: string
  seat: PlayerId
  sourceId?: string
  source?: string
  prompt: string
  options: Array<{ id: string; label: string }>
  action: {
    kind: 'abundance'
    replacedBy: string[]
    remainingAfter?: number
  } | {
    /** Pay this much life or the warded spell or ability is countered. */
    kind: 'ward-life'
    life: number
  } | {
    /** Each remaining seat, in turn order, is asked after this one answers. */
    kind: 'wheel'
    count: number
    remaining: PlayerId[]
  } | {
    kind: 'hidden-piles-reveal'
    piles: [string[], string[]]
    opponents: PlayerId[]
    lifeLoss: number
  } | {
    kind: 'hidden-piles-take'
    piles: [string[], string[]]
    lifeLoss: number
  } | {
    kind: 'vote'
    voteId: string
    /** Whose vote this answers; a vote chooser answers for each voter in turn. */
    voter: PlayerId
  } | {
    /** Pool to add for each offered option id. */
    kind: 'mana-choice'
    pools: Record<string, Partial<ManaPool>>
  } | {
    /** The color a permanent stores as it enters. */
    kind: 'choose-color'
  } | {
    /** Optional proliferate recipients selected during resolution. */
    kind: 'canonicalProliferateChoice'
    stackId: string
    recipients: Array<{ id: string; kind: 'object' | 'player'; objectId?: string; seat?: PlayerId; counter: string }>
  } | {
    /** A canonical resolution program choice; the frame remains private. */
    kind: 'canonicalInstructionChoice'
    stackId: string
    scopeId?: string
    options: readonly { id: string; instructions: readonly import('../cardPlugins/dsl/schema/v1').Instruction[] }[]
  } | {
    kind: 'putCanonicalModeTriggeredAbility'
    definitionSnapshot: import('../cardPlugins/dsl/schema/v1').CardRuleDefinitionSnapshotV1
    abilityIndex: number
    execution: import('../types').StackExecutionContext
    sourceId: string
    targets: TargetRef[]
    targetBindings: CanonicalTargetBinding[]
    modeCount: number
    repeatable: boolean
    selectedModes: number[]
    modeClauses?: import('../cardPlugins/dsl/schema/v1').TargetClause[]
    modeClausesByMode?: import('../cardPlugins/dsl/schema/v1').TargetClause[][]
    baseTargetClauses?: import('../cardPlugins/dsl/schema/v1').TargetClause[]
    baseTargetScopeIds?: string[]
    baseTargetModeIndices?: Array<number | undefined>
    modeScopeIds?: string[]
    distributionBounds?: Array<{ total: number; minEach: number }>
  } | {
    kind: 'putCanonicalStackTarget'
    definitionSnapshot: import('../cardPlugins/dsl/schema/v1').CardRuleDefinitionSnapshotV1
    abilityIndex: number
    execution: import('../types').StackExecutionContext
    sourceId: string
    targetClauses: Array<{ min: number; max: number }>
    targetClauseDefinitions: import('../cardPlugins/dsl/schema/v1').TargetClause[]
    targetIndex: number
    selectedTargets: TargetRef[]
    selectedStackTargets: string[]
    selectedModes?: number[]
    targetScopeIds?: string[]
    targetModeIndices?: Array<number | undefined>
    modeScopeIds?: string[]
    distributionBounds?: Array<{ total: number; minEach: number }>
  } | {
    /** Announcement-time trigger allocation, one original target slot at a time. */
    kind: 'putCanonicalTriggeredAbilityAllocation'
    announcement: import('./canonicalAnnouncement').CanonicalAnnouncement
    specs: import('../cardPlugins/dsl/schema/v1').DistributionSpec[]
    bounds: Array<{ total: number; minEach: number }>
    allocations: import('../cardPlugins/dsl/compiler/modes').DistributionAllocation[]
    recipientCounts: number[]
    specIndex: number
    recipientCount: number
    allocationIndex: number
    amounts: number[]
  }
}

const isPending = (value: unknown): value is PendingOptionSelection =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingOptionSelection).id === 'string'
  && typeof (value as PendingOptionSelection).seat === 'string'
  && Array.isArray((value as PendingOptionSelection).options)

export const pendingOptionSelection = (
  state: GameState | Draft,
  seat?: PlayerId,
) => {
  if (seat) {
    const value = state.players[seat]?.data[PENDING_OPTION_SELECTION]
    return isPending(value) ? value : undefined
  }
  for (const player of state.playerOrder) {
    const value = state.players[player]?.data[PENDING_OPTION_SELECTION]
    if (isPending(value)) return value
  }
}

export const openOptionSelection = (
  draft: Draft,
  selection: Omit<PendingOptionSelection, 'id'>,
) => {
  draft.players[selection.seat].data[PENDING_OPTION_SELECTION] = {
    id: draft.allocId('option'),
    ...selection,
  }
  if (selection.action.kind === 'putCanonicalTriggeredAbilityAllocation') draft.priority = null
  else if (!draft.resolution) draft.priority = selection.seat
}

export const selectOptions: Plugin = {
  id: 'selectOptions',
  legal: ({ state, event }) => {
    const pending = pendingOptionSelection(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} is choosing${pending.source ? ` for ${pending.source}` : ''}`
    }
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(state, event.seat)
    if (!selection) return `${event.seat} has no open option selection`
    if (event.selectionId !== selection.id) return 'option selection is no longer open'
    if (!selection.options.some((option) => option.id === event.optionId)) {
      if (selection.action.kind === 'putCanonicalTriggeredAbilityAllocation') {
        const amount = Number(event.optionId.replace(`allocation:${selection.action.allocationIndex}:`, ''))
        const bound = selection.action.bounds[selection.action.specIndex]
        const remaining = selection.action.recipientCount - selection.action.allocationIndex - 1
        const chosen = selection.action.amounts.reduce((sum, value) => sum + value, 0)
        const max = bound.total - chosen - bound.minEach * remaining
        if (Number.isSafeInteger(amount) && amount >= bound.minEach && amount <= max) return
      }
      return 'option was not offered for this selection'
    }
    if (selection.action.kind === 'putCanonicalModeTriggeredAbility') {
      const modeIndex = Number(event.optionId.replace('mode:', ''))
      if (!Number.isInteger(modeIndex) || modeIndex < 0) return 'invalid mode choice'
      if (!selection.action.repeatable && selection.action.selectedModes.includes(modeIndex)) {
        return 'that mode cannot be selected again'
      }
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(draft, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    if (selection.action.kind === 'canonicalProliferateChoice') {
      if (event.optionId === 'done') {
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
        draft.priority = null
        return
      }
      const recipient = selection.action.recipients.find((entry) => entry.id === event.optionId)
      if (!recipient) return
      if (recipient.kind === 'object' && recipient.objectId) {
        const object = draft.object(recipient.objectId)
        if (object && object.zone === 'battlefield' && !object.phasedOut) {
          object.counters[recipient.counter] = (object.counters[recipient.counter] ?? 0) + 1
        }
      } else if (recipient.kind === 'player' && recipient.seat) {
        const player = draft.players[recipient.seat]
        if (recipient.counter === 'poison') player.poison += 1
        if (recipient.counter === 'energy') player.energy = (player.energy ?? 0) + 1
      }
      const remaining = selection.action.recipients.filter((entry) => entry.id !== event.optionId)
      draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
        ...selection,
        options: [{ id: 'done', label: 'Done' }, ...remaining.map((entry) => ({ id: entry.id, label: `${entry.kind === 'object' ? 'Permanent' : 'Player'}: ${entry.counter}` }))],
        action: { ...selection.action, recipients: remaining },
      }
      draft.priority = event.seat
      return
    }
    if (selection.action.kind === 'canonicalInstructionChoice') {
      const option = selection.action.options.find((entry) => entry.id === event.optionId)
      if (!option) return
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId) {
        draft.resolution.scopes.push({
          path: `.choice.${event.optionId}`,
          scopeId: selection.action.scopeId,
          instructions: structuredClone(option.instructions),
          cursor: 0,
        })
      }
      draft.priority = null
      return
    }
    if (selection.action.kind === 'putCanonicalModeTriggeredAbility') {
      const modeIndex = Number(event.optionId.replace('mode:', ''))
      const selectedModes = [...selection.action.selectedModes, modeIndex]
      if (selectedModes.length < selection.action.modeCount) {
        draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
          ...selection,
          options: selection.action.repeatable
            ? selection.options
            : selection.options.filter((option) => option.id !== event.optionId),
          action: { ...selection.action, selectedModes },
        }
        draft.priority = event.seat
        return
      }
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      validateModeSelection(
        { count: { kind: 'constant', value: selection.action.modeCount }, repeatable: selection.action.repeatable },
        selection.action.modeClausesByMode?.length ?? selection.options.length,
        selection.action.modeCount,
        selectedModes,
      )
      const modeClausesByMode = selection.action.modeClausesByMode
      const modeClauses = modeClausesByMode
        ? selectedModes.flatMap((index) => modeClausesByMode[index] ?? [])
        : selection.action.modeClauses
      if (modeClauses && modeClauses.length > 0) {
        const abilityIndex = selection.action.abilityIndex
        continueCanonicalModeTargets(draft, {
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          execution: selection.action.execution,
          source: selection.action.execution.source.snapshot,
          sourceId: selection.action.sourceId,
          targets: selection.action.targets,
          selectedModes,
          clauses: [ ...(selection.action.baseTargetClauses ?? []), ...modeClauses ],
          targetScopeIds: [
            ...(selection.action.baseTargetScopeIds ?? []),
            ...selectedModes.flatMap((selectedModeIndex, occurrence) =>
              (modeClausesByMode?.[selectedModeIndex] ?? []).map(() =>
                canonicalModeScopeId(abilityIndex, selectedModeIndex, occurrence))),
          ],
          targetModeIndices: [
            ...(selection.action.baseTargetModeIndices ?? []),
            ...selectedModes.flatMap((selectedModeIndex) => (modeClausesByMode?.[selectedModeIndex] ?? []).map(() => selectedModeIndex)),
          ],
          initialClauseIndex: selection.action.baseTargetClauses?.length ?? 0,
        })
        return
      }
      const source = draft.object(selection.action.sourceId) ?? selection.action.execution.source.snapshot
      const definition = loadDefinitionSnapshot(selection.action.definitionSnapshot).definition
      const ability = definition.abilities[selection.action.abilityIndex]
      if (!source || !ability || ability.kind !== 'triggered' || !('modes' in ability)
        || selectedModes.some((index) => !ability.modes?.[index])) return
      if (ability.modes.some((mode) => mode.decisions.distributions?.length)
        || ability.decisions.distributions?.length) {
        stackCanonical(draft, {
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          execution: selection.action.execution,
          source,
          sourceId: source.id,
          targets: selection.action.targets,
          targetBindings: selection.action.targetBindings,
          targetClauses: selection.action.baseTargetClauses ?? [],
          clauseBounds: (selection.action.baseTargetClauses ?? []).map(() => ({ min: 0, max: 0 })),
          clauseIndex: 0,
          selectedModes,
          targetScopeIds: selection.action.baseTargetScopeIds,
          targetModeIndices: selection.action.baseTargetModeIndices,
          modeScopeIds: selection.action.modeScopeIds,
          distributionBounds: selection.action.distributionBounds,
        })
        draft.priority = null
        return
      }
      draft.addToStack({
        kind: 'ability',
        objectId: source.id,
        controller: selection.action.execution.controller,
        name: source.name,
        targets: selection.action.targets,
        execution: {
          ...selection.action.execution,
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          modeIndices: selectedModes,
          ...(selection.action.modeScopeIds ? { modeScopeIds: [...selection.action.modeScopeIds] } : {}),
          targetBindings: selection.action.targetBindings,
        },
      })
      draft.passedInRow = []
      draft.priority = null
      return
    }
    if (selection.action.kind === 'putCanonicalStackTarget') {
      const selectedStackTargets = [...selection.action.selectedStackTargets]
      if (event.optionId === 'done') {
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      } else {
        const stackId = event.optionId.replace('stack:', '')
        selectedStackTargets.push(stackId)
        if (selectedStackTargets.length < selection.action.targetClauses[selection.action.targetIndex].max) {
          const options = selection.options
            .filter((option) => option.id !== event.optionId && option.id !== 'done')
          if (selectedStackTargets.length >= selection.action.targetClauses[selection.action.targetIndex].min) {
            options.push({ id: 'done', label: 'Done' })
          }
          draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
            ...selection,
            options,
            action: { ...selection.action, selectedStackTargets },
          }
          draft.priority = event.seat
          return
        }
        delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      }
      const targets = [
        ...selection.action.selectedTargets,
        ...selectedStackTargets.map((stackId) => ({ kind: 'stackItem' as const, stackId })),
      ]
      const bounds = selection.action.targetClauses
      continueCanonicalTargetSelection(draft, {
        definitionSnapshot: selection.action.definitionSnapshot,
        abilityIndex: selection.action.abilityIndex,
        execution: selection.action.execution,
        source: selection.action.execution.source.snapshot,
        sourceId: selection.action.sourceId,
        targetClauses: selection.action.targetClauseDefinitions,
        targets,
        selectedModes: selection.action.selectedModes,
        targetScopeIds: selection.action.targetScopeIds,
        targetModeIndices: selection.action.targetModeIndices,
        modeScopeIds: selection.action.modeScopeIds,
        distributionBounds: selection.action.distributionBounds,
        clauseBounds: bounds,
        clauseIndex: selection.action.targetIndex + 1,
      })
      return
    }
    if (selection.action.kind === 'putCanonicalTriggeredAbilityAllocation') {
      const amount = Number(event.optionId.replace(`allocation:${selection.action.allocationIndex}:`, ''))
      if (!Number.isSafeInteger(amount) || amount < 0) return
      const nextAmounts = [...selection.action.amounts, amount]
      const nextIndex = selection.action.allocationIndex + 1
      const currentAllocations = selection.action.allocations.map((entry, index) => index === selection.action.specIndex
        ? { ...entry, amounts: nextAmounts }
        : entry)
      if (nextIndex < selection.action.recipientCount) {
        const bound = selection.action.bounds[selection.action.specIndex]
        const remaining = selection.action.recipientCount - nextIndex - 1
        const chosenTotal = nextAmounts.reduce((sum, value) => sum + value, 0)
        const min = bound.minEach
        const max = bound.total - chosenTotal - min * remaining
        const options = nextIndex === selection.action.recipientCount - 1
          ? [{ id: `allocation:${nextIndex}:${max}`, label: String(max) }]
          : Number.isSafeInteger(max) && max - min <= 256
            ? Array.from({ length: max - min + 1 }, (_value, index) => ({ id: `allocation:${nextIndex}:${min + index}`, label: String(min + index) }))
            : []
        draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
          ...selection,
          id: draft.allocId('option'),
          options,
          action: { ...selection.action, allocations: currentAllocations, allocationIndex: nextIndex, amounts: nextAmounts },
        }
        draft.priority = null
        return
      }
      if (selection.action.specIndex + 1 < selection.action.specs.length) {
        const nextSpecIndex = selection.action.specIndex + 1
        const bound = selection.action.bounds[nextSpecIndex]
        const nextRecipientCount = selection.action.recipientCounts[nextSpecIndex]
        const min = bound.minEach
        const max = bound.total - min * Math.max(0, nextRecipientCount - 1)
        const options = nextRecipientCount === 1
          ? [{ id: 'allocation:0:' + max, label: String(max) }]
          : Number.isSafeInteger(max) && max - min <= 256
            ? Array.from({ length: max - min + 1 }, (_value, index) => ({ id: `allocation:0:${min + index}`, label: String(min + index) }))
            : []
        draft.players[event.seat].data[PENDING_OPTION_SELECTION] = {
          ...selection,
          id: draft.allocId('option'),
          options,
          action: { ...selection.action, allocations: currentAllocations, specIndex: nextSpecIndex, recipientCount: nextRecipientCount, allocationIndex: 0, amounts: [] },
        }
        draft.priority = null
        return
      }
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      const allocation = currentAllocations
      const announcement = {
        ...selection.action.announcement,
        distributionBounds: selection.action.bounds,
        execution: { ...selection.action.announcement.execution, distributionBindings: allocation, distributionBounds: selection.action.bounds },
      }
      stackCanonical(draft, announcement)
      draft.priority = null
      return
    }
    delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
  },
}
