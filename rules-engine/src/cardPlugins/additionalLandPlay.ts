import type Draft from '../draft'
import type { GameState, PlayerId, Plugin } from '../types'

export const EXTRA_LAND_PLAYS = 'additionalLandPlay.extra'
export const GRANT_EXTRA_LAND_PLAY = 'additionalLandPlay.grant'

/** Permanents that give their controller one more land play while they are out. */
export const STATIC_SOURCES = new Set([
  'Aesi, Tyrant of Gyre Strait',
  'Icetill Explorer',
])

/** Spells whose resolution grants land plays for the rest of the turn. */
export const ONE_SHOT_SOURCES: Record<string, { lands: number; draws?: number }> = {
  Explore: { lands: 1, draws: 1 },
  'Summer Bloom': { lands: 3 },
}

const staticCount = (state: GameState | Draft, seat: PlayerId) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield'
    && object.controller === seat
    && STATIC_SOURCES.has(object.name)).length

const extraFor = (data: Record<string, unknown>) => {
  const value = data[EXTRA_LAND_PLAYS]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

/**
 * `landPlaysAllowed` is a derived total, so it is recomputed rather than
 * incremented: a source that leaves the battlefield mid-turn takes its land
 * play with it, and nothing double-counts when several events touch a seat.
 */
const recompute = (draft: Draft) => {
  for (const seat of draft.playerOrder) {
    const player = draft.players[seat]
    player.landPlaysAllowed = 1 + staticCount(draft, seat) + extraFor(player.data)
  }
}

const isUntapWrap = (event: { type: string; name?: string }) =>
  event.type === 'advanceStep' || (event.type === 'custom' && event.name === 'advanceStep')

export const additionalLandPlay: Plugin = {
  id: 'additionalLandPlay',
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === GRANT_EXTRA_LAND_PLAY && event.seat) {
      const count = Number(event.payload?.count ?? 1)
      if (!Number.isSafeInteger(count) || count < 1) return
      const player = draft.players[event.seat]
      if (!player) return
      player.data[EXTRA_LAND_PLAYS] = extraFor(player.data) + count
      recompute(draft)
      draft.note(`${event.seat} may play ${count} additional land(s) this turn`)
      return
    }

    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      const grant = item ? ONE_SHOT_SOURCES[item.name] : undefined
      if (grant) {
        draft.enqueue({
          type: 'custom',
          name: GRANT_EXTRA_LAND_PLAY,
          seat: item!.controller,
          payload: { count: grant.lands },
        })
        if (grant.draws) {
          draft.enqueue({ type: 'draw', seat: item!.controller, count: grant.draws })
        }
      }
    }

    // A new turn ends every "this turn" grant, including one a seat was given
    // during somebody else's turn.
    if (isUntapWrap(event) && draft.step === 'untap') {
      for (const seat of draft.playerOrder) delete draft.players[seat].data[EXTRA_LAND_PLAYS]
    }

    recompute(draft)
  },
}
