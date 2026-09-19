import type { Plugin } from '../types'

const SWAPS = 'reinsOfPower.swaps'

type Swap = { objectId: string; previous: string; oracleText?: string }

const isSwap = (value: unknown): value is Swap =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as Swap).objectId === 'string'
  && typeof (value as Swap).previous === 'string'

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
  apply: ({ state, event, draft }) => {
    if (event.type === 'resolveTop') {
      for (const player of Object.values(draft.players)) {
        if (!Array.isArray(player.data[SWAPS])) continue
        const swaps = player.data[SWAPS]
        player.data[SWAPS] = swaps.map((value) => {
          if (!isSwap(value) || value.oracleText !== undefined) return value
          const previous = state.objects[value.objectId]
          return previous ? { ...value, oracleText: previous.oracleText } : value
        })
      }
    }
    if (event.type === 'custom' && event.name === 'advanceStep' && draft.step === 'cleanup') {
      for (const player of Object.values(draft.players)) {
        const swaps = (Array.isArray(player.data[SWAPS]) ? player.data[SWAPS] : [])
          .filter(isSwap)
        for (const swap of swaps) {
          const object = draft.object(swap.objectId)
          if (object && object.zone === 'battlefield') {
            object.controller = swap.previous
            object.oracleText = swap.oracleText ?? (
              object.oracleText === 'Haste' ? '' : object.oracleText.replace(/\nHaste$/, '')
            )
          }
        }
        delete player.data[SWAPS]
      }
    }
  },
}
