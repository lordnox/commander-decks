import type { GameState, PlayerId, Plugin } from '../types'

export const JOINT_PENDING = 'jointExploration.pending'
export const JOINT_SCRY_BEGIN = 'jointExploration.scryBegin'
export const JOINT_SCRY_CHOSEN = 'jointExploration.scryChosen'
export const JOINT_LAND_CHOSEN = 'jointExploration.landChosen'

export type PendingJointExploration = {
  sourceId: string
  stage: 'scry' | 'scryDone' | 'putLand'
  kicked: boolean
}

export const pendingJointExploration = (
  state: GameState,
  seat: PlayerId,
): PendingJointExploration | undefined => {
  const value = state.players[seat]?.data[JOINT_PENDING]
  if (!value || typeof value !== 'object') return
  const pending = value as PendingJointExploration
  return typeof pending.sourceId === 'string'
    && ['scry', 'scryDone', 'putLand'].includes(pending.stage)
    ? pending
    : undefined
}

export const jointExplorationSeat = (state: GameState) =>
  state.playerOrder.find((seat) => pendingJointExploration(state, seat))

export const jointExploration: Plugin = {
  id: 'jointExploration',
  legal: ({ state, event }) => {
    if (event.type !== 'passPriority') return
    const seat = jointExplorationSeat(state)
    if (seat) return `${seat} is resolving Joint Exploration`
  },
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.name !== 'Joint Exploration') return
    const pending = pendingJointExploration(state, item.controller)
    if (pending?.stage === 'scry') return null
    if (pending?.stage === 'scryDone') return
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
      draft.players[event.seat].data[JOINT_PENDING] = {
        sourceId: String(event.payload?.sourceId ?? ''),
        stage: 'scry',
        kicked: event.payload?.kicked === true,
      } satisfies PendingJointExploration
      draft.note(`${event.seat} scries 2 for Joint Exploration`)
      return
    }
    if (event.type === 'custom' && event.name === JOINT_SCRY_CHOSEN && event.seat) {
      const pending = pendingJointExploration(state, event.seat)
      if (!pending || pending.stage !== 'scry') return
      draft.players[event.seat].data[JOINT_PENDING] = {
        ...pending,
        stage: 'scryDone',
      } satisfies PendingJointExploration
      return
    }
    if (event.type === 'custom' && event.name === JOINT_LAND_CHOSEN && event.seat) {
      const pending = pendingJointExploration(state, event.seat)
      if (pending?.stage === 'putLand') {
        delete draft.players[event.seat].data[JOINT_PENDING]
      }
      return
    }
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const pending = item ? pendingJointExploration(state, item.controller) : undefined
    if (item?.name !== 'Joint Exploration' || pending?.stage !== 'scryDone') return
    if (pending.kicked) {
      draft.players[item.controller].data[JOINT_PENDING] = {
        ...pending,
        stage: 'putLand',
      } satisfies PendingJointExploration
    } else {
      delete draft.players[item.controller].data[JOINT_PENDING]
    }
  },
}
