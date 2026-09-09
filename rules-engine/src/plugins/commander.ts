import { payCost } from './spells'
import type { Plugin } from '../types'

const taxedCost = (manaCost: string, tax: number) => `${manaCost}${tax > 0 ? `{${tax}}` : ''}`

const numberMap = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, number>)
    : {}

const commanderTax = (data: Record<string, unknown>) => numberMap(data.commanderTax)
const commanderDamage = (data: Record<string, unknown>) => numberMap(data.commanderDamage)
const taxFor = (data: Record<string, unknown>, commanderId: string) =>
  commanderTax(data)[commanderId] ?? 0

export const commander: Plugin = {
  id: 'commander',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const object = state.objects[event.objectId]
    if (!object || object.zone !== 'command') return
    if (!object.tags.includes('commander')) return 'only a commander can be cast from the command zone'
    if (object.owner !== event.seat || object.controller !== event.seat) {
      return 'commander is not owned and controlled by that seat'
    }
    const cost = taxedCost(object.manaCost, taxFor(state.players[event.seat].data, object.id))
    if (!payCost(state.players[event.seat].mana, cost)) return 'not enough mana for commander tax'
  },
  replace: ({ state, event }) => {
    if (event.type === 'castSpell') {
      const object = state.objects[event.objectId]
      if (!object?.tags.includes('commander') || object.zone !== 'command') return
      return {
        ...event,
        additionalGeneric:
          (event.additionalGeneric ?? 0) + taxFor(state.players[event.seat].data, object.id),
      }
    }
    if (event.type !== 'move' || (event.to !== 'graveyard' && event.to !== 'exile')) return
    const object = state.objects[event.objectId]
    if (!object?.tags.includes('commander')) return
    return { type: 'move', objectId: event.objectId, to: 'command' }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const object = state.objects[event.objectId]
      if (!object?.tags.includes('commander') || object.zone !== 'command') return
      const data = draft.players[event.seat].data
      const tax = commanderTax(data)
      data.commanderTax = { ...tax, [object.id]: (tax[object.id] ?? 0) + 2 }
      return
    }
    if (event.type === 'combatDamage') {
      if (event.target.kind !== 'player') return
      const source = draft.objects[event.sourceId]
      const player = draft.players[event.target.player]
      if (!source?.tags.includes('commander') || !player) return
      const tally = commanderDamage(player.data)
      player.data.commanderDamage = {
        ...tally,
        [event.sourceId]: (tally[event.sourceId] ?? 0) + event.amount,
      }
    }
  },
  sba: ({ draft }) => {
    for (const player of Object.values(draft.players)) {
      if (player.lost) continue
      if (Object.values(commanderDamage(player.data)).some((amount) => amount >= 21)) {
        return [{ type: 'concede', seat: player.id }]
      }
    }
    return []
  },
}
