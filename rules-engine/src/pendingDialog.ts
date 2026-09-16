import type Draft from './draft'
import { isPermanentType } from './definitions'
import type { GameState, PlayerId, Plugin } from './types'

export const PENDING_DIALOG = 'kernel.pendingDialog'
export const DIALOG_CHOSEN = 'kernel.pendingDialog.chosen'

/** A private table choice the host can present without knowing which card asked. */
export type PendingDialog = {
  sourceId: string
  source: string
  seat: PlayerId
  kind:
    | 'scry'
    | 'look-top'
    | 'put-land'
    | 'put-permanents'
    | 'surveil'
    | 'bounce-land'
    | 'reveal-pick'
    | 'copy-creature'
    | 'return-land'
    | 'may'
    | 'may-pay-life'
  prompt: string
  waiting: string
  judge: string
  chosenEvent: string
  destinations: Array<
    'top' | 'bottom' | 'hand' | 'battlefield' | 'graveyard' | 'skip' | 'target'
  >
  count?: number
  types?: string[]
  permanent?: boolean
  optional?: boolean
  after?: Array<'resolveTop'>
  requirements?: Partial<Record<
    'battlefield' | 'hand' | 'target' | 'graveyard',
    { min?: number; max?: number }
  >>
}

const isDialog = (value: unknown): value is PendingDialog =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingDialog).sourceId === 'string'
  && typeof (value as PendingDialog).seat === 'string'
  && typeof (value as PendingDialog).kind === 'string'
  && typeof (value as PendingDialog).chosenEvent === 'string'

export const pendingDialogFor = (state: GameState | Draft, seat: PlayerId) => {
  const value = state.players[seat]?.data[PENDING_DIALOG]
  return isDialog(value) ? value : undefined
}

export const pendingDialog = (state: GameState) => {
  for (const seat of state.playerOrder) {
    const dialog = pendingDialogFor(state, seat)
    if (dialog) return dialog
  }
}

export const setPendingDialog = (draft: Draft, dialog: PendingDialog) => {
  draft.players[dialog.seat].data[PENDING_DIALOG] = dialog
}

export const clearPendingDialog = (draft: Draft, seat: PlayerId) => {
  delete draft.players[seat].data[PENDING_DIALOG]
}

export const dialogCandidates = (state: GameState, dialog: PendingDialog) => {
  if (
    dialog.kind === 'scry'
    || dialog.kind === 'look-top'
    || dialog.kind === 'surveil'
    || dialog.kind === 'reveal-pick'
  ) {
    return (state.zoneOrder[dialog.seat].library ?? [])
      .slice(0, dialog.count ?? 1)
      .map((id) => state.objects[id])
      .filter((object): object is NonNullable<typeof object> => Boolean(object))
  }
  if (dialog.kind === 'bounce-land' || dialog.kind === 'copy-creature') {
    return (state.zoneOrder[dialog.seat].battlefield ?? [])
      .map((id) => state.objects[id])
      .filter((object): object is NonNullable<typeof object> =>
        Boolean(object)
        && (dialog.kind !== 'copy-creature' || object.id !== dialog.sourceId)
        && (!dialog.types || dialog.types.every((type) => object.types.includes(type))))
  }
  if (dialog.kind === 'return-land') {
    return (state.zoneOrder[dialog.seat].graveyard ?? [])
      .map((id) => state.objects[id])
      .filter((object): object is NonNullable<typeof object> =>
        Boolean(object)
        && (!dialog.types || dialog.types.every((type) => object.types.includes(type))))
  }
  return (state.zoneOrder[dialog.seat].hand ?? [])
    .map((id) => state.objects[id])
    .filter((object): object is NonNullable<typeof object> =>
      Boolean(object)
      && (!dialog.types || dialog.types.every((type) => object.types.includes(type)))
      && (!dialog.permanent || isPermanentType(object.types)))
}

/** Blocks priority while any card has posted an open host dialog. */
export const pendingDialogLock: Plugin = {
  id: 'pendingDialog',
  legal: ({ state, event }) => {
    if (event.type !== 'passPriority') return
    const dialog = pendingDialog(state)
    if (dialog) return `${dialog.seat} is resolving ${dialog.source}`
  },
  apply: ({ event, draft }) => {
    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      clearPendingDialog(draft, event.seat)
    }
  },
}
