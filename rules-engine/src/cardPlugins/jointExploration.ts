import type { GameState, PlayerId, Plugin } from '../types'
import {
  clearPendingDialog,
  hasPendingDialog,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'

export const JOINT_SCRY_BEGIN = 'jointExploration.scryBegin'
export const JOINT_SCRY_CHOSEN = 'jointExploration.scryChosen'
export const JOINT_LAND_CHOSEN = 'jointExploration.landChosen'
export const JOINT_SCRY_DONE = 'jointExploration.scryDone'

const NAME = 'Joint Exploration'

const scryDialog = (sourceId: string, seat: PlayerId) => ({
  sourceId,
  source: NAME,
  seat,
  kind: 'scry' as const,
  prompt: 'Scry 2, then this spell resolves.',
  waiting: 'is making a private scry choice.',
  judge: 'Waiting for a private scry 2 choice.',
  chosenEvent: JOINT_SCRY_CHOSEN,
  destinations: ['top', 'bottom'] as Array<'top' | 'bottom'>,
  count: 2,
  after: ['resolveTop' as const],
})

const landDialog = (sourceId: string, seat: PlayerId) => ({
  sourceId,
  source: NAME,
  seat,
  kind: 'put-land' as const,
  prompt: 'You may put one land from your hand onto the battlefield.',
  waiting: 'is choosing a land privately.',
  judge: 'Waiting for an optional land.',
  chosenEvent: JOINT_LAND_CHOSEN,
  destinations: ['hand', 'battlefield'] as Array<'hand' | 'battlefield'>,
  types: ['Land'],
  optional: true,
  requirements: { battlefield: { max: 1 } },
})

export const jointExploration: Plugin = {
  id: 'jointExploration',
  legal: ({ state, event }) => {
    if (event.type !== 'passPriority') return
    const item = state.stack[0]
    if (item?.name === NAME && state.players[item.controller]?.data[JOINT_SCRY_DONE]) {
      return `${item.controller} is resolving ${NAME}`
    }
  },
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.name !== NAME) return
    if (hasPendingDialog(state, item.controller, 'scry')) return null
    if (state.players[item.controller]?.data[JOINT_SCRY_DONE]) return
    return {
      type: 'custom',
      name: JOINT_SCRY_BEGIN,
      seat: item.controller,
      payload: {
        sourceId: item.objectId,
        kicked: item.kicked === true,
      },
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === JOINT_SCRY_BEGIN && event.seat) {
      const sourceId = String(event.payload?.sourceId ?? '')
      setPendingDialog(draft, scryDialog(sourceId, event.seat))
      draft.players[event.seat].data.jointKicked = event.payload?.kicked === true
      draft.note(`${event.seat} scries 2 for ${NAME}`)
      return
    }
    if (event.type === 'custom' && event.name === JOINT_SCRY_CHOSEN && event.seat) {
      if (pendingDialogFor(state, event.seat)?.kind !== 'scry') return
      clearPendingDialog(draft, event.seat)
      draft.players[event.seat].data[JOINT_SCRY_DONE] = true
      return
    }
    if (event.type === 'custom' && event.name === JOINT_LAND_CHOSEN && event.seat) {
      clearPendingDialog(draft, event.seat)
      return
    }
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.name !== NAME || !state.players[item.controller]?.data[JOINT_SCRY_DONE]) return
    delete draft.players[item.controller].data[JOINT_SCRY_DONE]
    const kicked = draft.players[item.controller].data.jointKicked === true
    delete draft.players[item.controller].data.jointKicked
    if (kicked) setPendingDialog(draft, landDialog(item.objectId, item.controller))
  },
}

export const pendingJointExploration = (state: GameState, seat: PlayerId) => {
  const dialog = pendingDialogFor(state, seat)
  if (dialog?.kind === 'scry') return { sourceId: dialog.sourceId, stage: 'scry' as const }
  if (dialog?.kind === 'put-land') return { sourceId: dialog.sourceId, stage: 'putLand' as const }
  if (state.players[seat]?.data[JOINT_SCRY_DONE]) {
    return { sourceId: '', stage: 'scryDone' as const }
  }
}
