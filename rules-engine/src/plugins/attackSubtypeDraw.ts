import type { Plugin } from '../types'

/** Until cleanup: when a creature with a listed subtype attacks, its controller's effect source draws. */
export const attackSubtypeDraw: Plugin = {
  id: 'attackSubtypeDraw',
  apply: ({ state, event, draft, rule }) => {
    if (event.type !== 'declareAttackers') return
    const subtypes = rule.params.subtypes
    const drawer = rule.params.controller
    if (!Array.isArray(subtypes) || typeof drawer !== 'string') return
    const listed = subtypes.filter((entry): entry is string => typeof entry === 'string')
    if (listed.length === 0) return
    for (const declaration of event.attackers) {
      const attacker = state.objects[declaration.objectId]
      if (!attacker?.types.includes('Creature')) continue
      if (!listed.some((subtype) => attacker.subtypes.includes(subtype))) continue
      draft.enqueue({ type: 'draw', seat: drawer, count: 1 })
    }
  },
}
