import type Draft from '../draft'
import type { GameState, PlayerId, Plugin } from '../types'

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
    kind: 'hidden-piles-reveal'
    piles: [string[], string[]]
    opponents: PlayerId[]
    lifeLoss: number
  } | {
    kind: 'hidden-piles-take'
    piles: [string[], string[]]
    lifeLoss: number
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
  draft.priority = selection.seat
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
  },
}
