import type Draft from '../draft'
import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import { activePrintedStaticModifiers } from './dsl/staticModifierCore'
import { effectsOf } from './cardRules'

export const EXTRA_LAND_PLAYS = 'additionalLandPlay.extra'
export const GRANT_EXTRA_LAND_PLAY = 'additionalLandPlay.grant'

const legacyStaticExtraLandPlays = (object: GameObject) =>
  effectsOf(object).reduce((sum, effect) =>
    sum + (effect.op === 'static' ? effect.extraLandPlays ?? 0 : 0), 0)

const dslStaticExtraLandPlays = (state: GameState | Draft, object: GameObject) =>
  activePrintedStaticModifiers(state as GameState, object).reduce((sum, entry) =>
    sum + ('effect' in entry && entry.effect.kind === 'extraLandPlays' ? entry.effect.count : 0), 0)

const staticCount = (state: GameState | Draft, seat: PlayerId) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield' && object.controller === seat).reduce(
    (total, object) =>
      total + legacyStaticExtraLandPlays(object) + dslStaticExtraLandPlays(state, object),
    0,
  )

const extraFor = (data: Record<string, unknown>) => {
  const value = data[EXTRA_LAND_PLAYS]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

const recompute = (draft: Draft) => {
  for (const seat of draft.playerOrder) {
    const player = draft.players[seat]
    player.landPlaysAllowed = 1 + staticCount(draft, seat) + extraFor(player.data)
  }
}

const isStepAdvance = (event: { type: string; name?: string }) =>
  event.type === 'advanceStep' || (event.type === 'custom' && event.name === 'advanceStep')

export const additionalLandPlay: Plugin = {
  id: 'additionalLandPlay',
  apply: ({ event, draft }) => {
    if (event.type === 'grantLandPlays' || (event.type === 'custom' && event.name === GRANT_EXTRA_LAND_PLAY && event.seat)) {
      const count = event.type === 'grantLandPlays' ? event.count : Number(event.payload?.count ?? 1)
      if (!Number.isSafeInteger(count) || count < 1) return
      const seat = event.seat
      if (!seat) return
      const player = draft.players[seat]
      if (!player) return
      player.data[EXTRA_LAND_PLAYS] = extraFor(player.data) + count
      recompute(draft)
      draft.note(`${event.seat} may play ${count} additional land(s) this turn`)
      return
    }

    if (isStepAdvance(event) && (draft.step === 'untap' || draft.step === 'cleanup')) {
      for (const seat of draft.playerOrder) delete draft.players[seat].data[EXTRA_LAND_PLAYS]
    }

    recompute(draft)
  },
}
