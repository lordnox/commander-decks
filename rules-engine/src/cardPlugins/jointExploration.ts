import type { GameState, PlayerId, Plugin } from '../types'
import {
  clearPendingDialog,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import { openCardSelection, pendingSelectionFor } from '../rules/selectCards'

export const JOINT_SCRY_BEGIN = 'jointExploration.scryBegin'
export const JOINT_LAND_CHOSEN = 'jointExploration.landChosen'
export const JOINT_SCRY_DONE = 'jointExploration.scryDone'

const NAME = 'Joint Exploration'

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
    if (
      item?.kind === 'spell'
      && item.name === NAME
      && state.players[item.controller]?.data[JOINT_SCRY_DONE]
    ) {
      return `${item.controller} is resolving ${NAME}`
    }
  },
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.kind !== 'spell' || item.name !== NAME) return
    if (pendingSelectionFor(state, item.controller)?.kind === 'scry') return null
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
      const candidates = draft.zoneOrder[event.seat].library.slice(0, 2)
      if (candidates.length > 0) {
        openCardSelection(draft, {
          seat: event.seat,
          kind: 'scry',
          count: 2,
          candidates,
          sourceId,
          source: NAME,
          prompt: 'Scry 2, then this spell resolves.',
          destinations: ['top', 'bottom'],
          after: ['resolveTop'],
        })
      }
      draft.players[event.seat].data.jointKicked = event.payload?.kicked === true
      draft.note(`${event.seat} scries 2 for ${NAME}`)
      return
    }
    if (event.type === 'selectCards' && event.kind === 'scry' && event.seat) {
      const item = state.stack[0]
      if (item?.kind === 'spell' && item.name === NAME) {
        draft.players[event.seat].data[JOINT_SCRY_DONE] = true
      }
      return
    }
    if (event.type === 'custom' && event.name === JOINT_LAND_CHOSEN && event.seat) {
      clearPendingDialog(draft, event.seat)
      return
    }
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (
      item?.kind !== 'spell'
      || item.name !== NAME
      || !state.players[item.controller]?.data[JOINT_SCRY_DONE]
    ) {
      return
    }
    delete draft.players[item.controller].data[JOINT_SCRY_DONE]
    const kicked = draft.players[item.controller].data.jointKicked === true
    delete draft.players[item.controller].data.jointKicked
    if (kicked) setPendingDialog(draft, landDialog(item.objectId, item.controller))
  },
}

export const pendingJointExploration = (state: GameState, seat: PlayerId) => {
  const selection = pendingSelectionFor(state, seat)
  if (selection?.kind === 'scry') {
    return { sourceId: selection.sourceId ?? '', stage: 'scry' as const }
  }
  const dialog = pendingDialogFor(state, seat)
  if (dialog?.kind === 'put-land') return { sourceId: dialog.sourceId, stage: 'putLand' as const }
  if (state.players[seat]?.data[JOINT_SCRY_DONE]) {
    return { sourceId: '', stage: 'scryDone' as const }
  }
}
