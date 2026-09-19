import type { Plugin } from '../types'

export const reinsOfPower: Plugin = {
  id: 'reinsOfPower',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (object?.name !== 'Reins of Power') return
    const target = event.targets?.[0]
    if (target?.kind !== 'player') return 'Reins of Power requires a player target'
    if (target.player === event.seat) return 'Reins of Power targets an opponent'
    if (!state.players[target.player] || state.players[target.player].lost) {
      return 'Reins of Power target is not in the game'
    }
  },
}
