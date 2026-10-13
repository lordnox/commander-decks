import type Draft from '../draft'
import type { GameState, PlayerId } from '../types'

export const beginDrawStepInstance = (draft: Draft, stepPlayer: PlayerId) => {
  const previous = draft.drawStepTracking?.instanceId ?? 0
  draft.drawStepTracking = {
    instanceId: previous + 1,
    stepPlayer,
    actualDraws: {},
  }
}

export const actualDrawsInCurrentStepInstance = (
  state: Pick<GameState, 'drawStepTracking'>,
  player: PlayerId,
) => state.drawStepTracking?.actualDraws[player] ?? 0

/** First actual draw exemption in the drawing player's own current draw step (CR 121 / Chains). */
export const isProtectedFirstDrawInOwnDrawStep = (
  state: Pick<GameState, 'step' | 'active' | 'drawStepTracking'>,
  drawingPlayer: PlayerId,
) =>
  state.step === 'draw'
  && state.active === drawingPlayer
  && actualDrawsInCurrentStepInstance(state, drawingPlayer) === 0

export const recordActualDrawInStep = (draft: Draft, player: PlayerId) => {
  if (!draft.drawStepTracking) return
  const current = draft.drawStepTracking.actualDraws[player] ?? 0
  draft.drawStepTracking.actualDraws[player] = current + 1
}

/** Extra draw step: new instance, same step player. */
export const enterAdditionalDrawStep = (draft: Draft, stepPlayer: PlayerId) => {
  beginDrawStepInstance(draft, stepPlayer)
  draft.step = 'draw'
  draft.enqueue({ type: 'draw', seat: stepPlayer, count: 1 })
}
