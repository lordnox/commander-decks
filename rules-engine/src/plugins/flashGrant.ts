import type { GameState, PlayerId, Plugin } from '../types'

/**
 * Until cleanup: "You may cast spells this turn as though they had flash."
 * Added with `addUntilCleanupRule('flashGrant')`; the grant belongs to the
 * rule's `controller`, and the spell timing checks consult `mayCastAsThoughFlash`.
 */
export const flashGrant: Plugin = { id: 'flashGrant' }

export const mayCastAsThoughFlash = (state: GameState, seat: PlayerId) =>
  state.rules.some((rule) =>
    rule.pluginId === flashGrant.id && rule.params.controller === seat)
