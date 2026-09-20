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
    | 'exile-graveyards'
    | 'sacrifice-lands'
    | 'sacrifice-creature'
    | 'discard-card'
    | 'choose-modes'
    | 'choose-creature-type'
    | 'may'
    | 'may-draw'
    | 'may-pay-mana'
    | 'may-pay-life'
    | 'secret-vote'
    | 'fight-target'
    | 'fight-own'
    | 'may-search'
    | 'counter-unless'
    | 'counter-spell'
    | 'destroy-permanent'
    | 'bounce-permanent'
    | 'look-top-land'
  prompt: string
  waiting: string
  judge: string
  chosenEvent: string
  destinations: Array<
    'top' | 'bottom' | 'hand' | 'battlefield' | 'graveyard' | 'exile'
    | 'sacrifice' | 'skip' | 'target'
  >
  count?: number
  cost?: string
  /** Literal choices for a modal ability, used instead of cards on a board. */
  options?: string[]
  types?: string[]
  permanent?: boolean
  optional?: boolean
  /** Lower numbers are answered first when several seats owe a choice. */
  sequence?: number
  after?: Array<'resolveTop'>
  requirements?: Partial<Record<
    'battlefield' | 'hand' | 'target' | 'graveyard' | 'exile' | 'sacrifice',
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

/**
 * A seat can owe several choices at once: lands fetched by a resolving spell
 * bring their own enters-triggers while that spell still waits. They queue in
 * the order they were asked, and the seat answers the oldest first.
 */
export const pendingDialogsFor = (
  state: GameState | Draft,
  seat: PlayerId,
): PendingDialog[] => {
  const value = state.players[seat]?.data[PENDING_DIALOG]
  if (Array.isArray(value)) return value.filter(isDialog)
  return isDialog(value) ? [value] : []
}

export const pendingDialogFor = (state: GameState | Draft, seat: PlayerId) =>
  pendingDialogsFor(state, seat)[0]

export const hasPendingDialog = (
  state: GameState | Draft,
  seat: PlayerId,
  kind: PendingDialog['kind'],
) => pendingDialogsFor(state, seat).some((dialog) => dialog.kind === kind)

export const pendingDialog = (state: GameState) => {
  const open = state.playerOrder.flatMap((seat) => pendingDialogsFor(state, seat))
  const sequenced = open.filter((dialog) => typeof dialog.sequence === 'number')
  if (sequenced.length > 0) {
    return [...sequenced].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))[0]
  }
  for (const seat of state.playerOrder) {
    const dialog = pendingDialogFor(state, seat)
    if (dialog) return dialog
  }
}

export const setPendingDialog = (draft: Draft, dialog: PendingDialog) => {
  draft.players[dialog.seat].data[PENDING_DIALOG] = [
    ...pendingDialogsFor(draft, dialog.seat),
    dialog,
  ]
}

export const openSourceDialog = (
  draft: Draft,
  source: { id: string; name: string },
  dialog: Omit<PendingDialog, 'sourceId' | 'source' | 'chosenEvent'> & {
    chosenEvent?: string
  },
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    chosenEvent: DIALOG_CHOSEN,
    ...dialog,
  })
}

/** Answers the oldest open choice. */
export const clearPendingDialog = (draft: Draft, seat: PlayerId) => {
  const remaining = pendingDialogsFor(draft, seat).slice(1)
  if (remaining.length === 0) delete draft.players[seat].data[PENDING_DIALOG]
  else draft.players[seat].data[PENDING_DIALOG] = remaining
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
  if (
    dialog.kind === 'bounce-land'
    || dialog.kind === 'copy-creature'
    || dialog.kind === 'sacrifice-lands'
    || dialog.kind === 'sacrifice-creature'
  ) {
    return Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === dialog.seat
        && (dialog.kind !== 'copy-creature' || object.id !== dialog.sourceId)
        && (dialog.kind !== 'sacrifice-lands' || object.types.includes('Land'))
        && (dialog.kind !== 'sacrifice-creature' || object.types.includes('Creature'))
        && (!dialog.types || dialog.types.every((type) => object.types.includes(type))))
  }
  if (dialog.kind === 'fight-target') {
    return Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.types.includes('Creature')
        && object.controller !== dialog.seat)
  }
  if (dialog.kind === 'fight-own') {
    return Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === dialog.seat
        && object.types.includes('Creature')
        && object.id !== dialog.sourceId)
  }
  if (dialog.kind === 'counter-unless') {
    return state.stack
      .map((item) => state.objects[item.objectId])
      .filter((object): object is NonNullable<typeof object> =>
        Boolean(object)
        && object.zone === 'stack'
        && !object.types.includes('Creature'))
  }
  if (dialog.kind === 'counter-spell') {
    return state.stack
      .map((item) => state.objects[item.objectId])
      .filter((object): object is NonNullable<typeof object> =>
        Boolean(object) && object.zone === 'stack')
  }
  if (dialog.kind === 'destroy-permanent' || dialog.kind === 'bounce-permanent') {
    return Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && (!dialog.types || dialog.types.some((type) => object.types.includes(type))))
  }
  if (dialog.kind === 'look-top-land') {
    return (state.zoneOrder[dialog.seat].library ?? [])
      .slice(0, dialog.count ?? 1)
      .map((id) => state.objects[id])
      .filter((object): object is NonNullable<typeof object> => Boolean(object))
  }
  if (dialog.kind === 'return-land') {
    return (state.zoneOrder[dialog.seat].graveyard ?? [])
      .map((id) => state.objects[id])
      .filter((object): object is NonNullable<typeof object> =>
        Boolean(object)
        && (!dialog.types || dialog.types.every((type) => object.types.includes(type))))
  }
  if (dialog.kind === 'exile-graveyards') {
    return state.playerOrder.flatMap((seat) =>
      (state.zoneOrder[seat].graveyard ?? [])
        .map((id) => state.objects[id])
        .filter((object): object is NonNullable<typeof object> => Boolean(object)))
  }
  return (state.zoneOrder[dialog.seat].hand ?? [])
    .map((id) => state.objects[id])
    .filter((object): object is NonNullable<typeof object> =>
      Boolean(object)
      && (!dialog.types || dialog.types.every((type) => object.types.includes(type)))
      && (!dialog.permanent || isPermanentType(object.types)))
}

/**
 * A choice posted while a spell resolves is moot once that spell has left the
 * stack. Without this the lock would hold priority on a dialog whose answer
 * the kernel would apply to a spell that is already in the graveyard.
 */
const stranded = (state: GameState, dialog: PendingDialog) =>
  dialog.kind === 'sacrifice-lands' && state.objects[dialog.sourceId]?.zone !== 'stack'

const liveDialog = (state: GameState) => {
  const open = state.playerOrder.flatMap((seat) =>
    pendingDialogsFor(state, seat).filter((dialog) => !stranded(state, dialog)))
  const sequenced = open.filter((dialog) => typeof dialog.sequence === 'number')
  if (sequenced.length > 0) {
    return [...sequenced].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))[0]
  }
  return open[0]
}

/** Blocks priority while any card has posted an open host dialog. */
export const pendingDialogLock: Plugin = {
  id: 'pendingDialog',
  legal: ({ state, event }) => {
    if (event.type !== 'passPriority') return
    const dialog = liveDialog(state)
    if (dialog) return `${dialog.seat} is resolving ${dialog.source}`
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      clearPendingDialog(draft, event.seat)
      return
    }
    for (const seat of state.playerOrder) {
      const live = pendingDialogsFor(state, seat).filter((dialog) => !stranded(state, dialog))
      if (live.length === pendingDialogsFor(state, seat).length) continue
      if (live.length === 0) delete draft.players[seat].data[PENDING_DIALOG]
      else draft.players[seat].data[PENDING_DIALOG] = live
    }
  },
}
