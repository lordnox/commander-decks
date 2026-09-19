import type { GameEvent, Plugin } from '../types'

export const combatDialogue: Plugin = {
  id: 'combatDialogue',
  replace: ({ state, event, rule }) => {
    if (
      event.type !== 'combatDamage'
      || event.target.kind !== 'player'
      || event.sourceId !== rule.params.creatureId
    ) {
      return
    }
    const source = state.objects[event.sourceId]
    const count = Math.floor(event.amount / 2)
    if (!source || count <= 0) return []
    const draws: GameEvent[] = [
      { type: 'draw', seat: source.controller, count },
      { type: 'draw', seat: event.target.player, count },
    ]
    return draws
  },
}
