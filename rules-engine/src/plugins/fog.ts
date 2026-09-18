import type { Plugin } from '../types'

/**
 * Prevents combatDamage. Empty params fog everything this turn.
 * `params.sourceId` limits prevention to that attacker.
 * `params.defender` limits prevention to combat damage that player would take.
 */
export const fog: Plugin = {
  id: 'fog',
  replace: ({ event, rule }) => {
    if (event.type !== 'combatDamage') return
    const sourceId = rule.params.sourceId
    if (typeof sourceId === 'string' && event.sourceId !== sourceId) return
    const defender = rule.params.defender
    if (typeof defender === 'string') {
      if (event.target.kind !== 'player' || event.target.player !== defender) return
    }
    return null
  },
}
