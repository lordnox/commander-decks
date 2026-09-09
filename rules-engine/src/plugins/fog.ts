import type { Plugin } from '../types'

/** Prevents combatDamage. dealDamage / loseLife never happen, so commander damage does not count. */
export const fog: Plugin = {
  id: 'fog',
  replace: ({ event }) => {
    if (event.type === 'combatDamage') return null
  },
}
