import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { continueCanonicalModeTargets, continueCanonicalTargetSelection } from './canonicalAnnouncement'
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
    /** A canonical resolution program choice; the frame remains private. */
    kind: 'canonicalInstructionChoice'
    stackId: string
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
  if (!draft.resolution) draft.priority = selection.seat
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
    if (selection.action.kind === 'canonicalInstructionChoice') {
      const option = selection.action.options.find((entry) => entry.id === event.optionId)
      if (!option) return
      delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
      if (draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === selection.action.stackId) {
        draft.resolution.scopes.push({
          path: `.choice.${event.optionId}`,
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
      const modeClausesByMode = selection.action.modeClausesByMode
      const modeClauses = modeClausesByMode
        ? selectedModes.flatMap((index) => modeClausesByMode[index] ?? [])
        : selection.action.modeClauses
      if (modeClauses && modeClauses.length > 0) {
        continueCanonicalModeTargets(draft, {
          definitionSnapshot: selection.action.definitionSnapshot,
          abilityIndex: selection.action.abilityIndex,
          execution: selection.action.execution,
          source: selection.action.execution.source.snapshot,
          sourceId: selection.action.sourceId,
          targets: selection.action.targets,
          selectedModes,
          clauses: modeClauses,
        })
        return
      }
      const source = draft.object(selection.action.sourceId) ?? selection.action.execution.source.snapshot
      const definition = loadDefinitionSnapshot(selection.action.definitionSnapshot).definition
      const ability = definition.abilities[selection.action.abilityIndex]
      if (!source || !ability || ability.kind !== 'triggered' || !('modes' in ability)
        || selectedModes.some((index) => !ability.modes?.[index])) return
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
        clauseBounds: bounds,
        clauseIndex: selection.action.targetIndex + 1,
      })
      return
    }
    delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
  },
}
