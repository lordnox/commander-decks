import type Draft from '../draft'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
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
    kind: 'putCanonicalModeTriggeredAbility'
    definitionSnapshot: import('../cardPlugins/dsl/schema/v1').CardRuleDefinitionSnapshotV1
    abilityIndex: number
    execution: import('../types').StackExecutionContext
    sourceId: string
    targets: TargetRef[]
    targetBindings: CanonicalTargetBinding[]
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
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'selectOption') return
    const selection = pendingOptionSelection(draft, event.seat)
    if (!selection || selection.id !== event.selectionId) return
    delete draft.players[event.seat].data[PENDING_OPTION_SELECTION]
    if (selection.action.kind === 'putCanonicalModeTriggeredAbility') {
      const modeIndex = Number(event.optionId.replace('mode:', ''))
      const source = draft.object(selection.action.sourceId) ?? selection.action.execution.source.snapshot
      const definition = loadDefinitionSnapshot(selection.action.definitionSnapshot).definition
      const ability = definition.abilities[selection.action.abilityIndex]
      if (!source || !ability || ability.kind !== 'triggered' || !('modes' in ability) || !ability.modes?.[modeIndex]) return
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
          modeIndices: [modeIndex],
          targetBindings: selection.action.targetBindings,
        },
      })
      draft.passedInRow = []
      draft.priority = null
    }
  },
}
