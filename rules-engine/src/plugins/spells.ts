import { parseManaCost, poolTotal, type Draft } from '../draft'
import type { GameObject, ManaId, ManaPool, Plugin } from '../types'

const MANA_ORDER: ManaId[] = ['C', 'W', 'U', 'B', 'R', 'G']
const COLORED_MANA: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

const genericCost = (manaCost: string) =>
  [...manaCost.matchAll(/\{(\d+)\}/g)].reduce((total, match) => total + Number(match[1]), 0)

const spellCost = (object: GameObject, commanderTax: number) =>
  `${object.manaCost}${object.zone === 'command' && object.commander ? `{${commanderTax}}` : ''}`

export const payCost = (pool: ManaPool, manaCost: string) => {
  const parsed = parseManaCost(manaCost)
  const generic = genericCost(manaCost)
  const required = { ...parsed }
  required.C = Math.max(0, (required.C ?? 0) - generic)

  const remaining = { ...pool }
  for (const symbol of COLORED_MANA) {
    const amount = required[symbol] ?? 0
    if (remaining[symbol] < amount) return null
    remaining[symbol] -= amount
  }

  if (poolTotal(remaining) < generic) return null
  let unpaid = generic
  for (const symbol of MANA_ORDER) {
    const amount = Math.min(remaining[symbol], unpaid)
    remaining[symbol] -= amount
    unpaid -= amount
  }
  return remaining
}

const installGrantedRules = (draft: Draft, object: GameObject) => {
  for (const pluginId of object.grantedRules) {
    draft.rules.push({
      instanceId: draft.allocId('rule'),
      pluginId,
      sourceId: object.id,
      timestamp: draft.allocTs(),
      params: {},
    })
  }
}

export const spells: Plugin = {
  id: 'spells',
  legal: ({ state, event }) => {
    if (event.type === 'castSpell') {
      const object = state.objects[event.objectId]
      if (!object) return 'spell object does not exist'
      const castableZone = object.zone === 'hand' || (object.zone === 'command' && object.commander)
      if (!castableZone) return 'spell is not in hand or command zone'
      if (object.owner !== event.seat || object.controller !== event.seat) {
        return 'spell is not owned and controlled by that seat'
      }
      if (state.priority !== event.seat) return 'seat does not have priority'

      if (!object.types.includes('Instant')) {
        if (state.active !== event.seat) return 'non-instant spells require the active player'
        if (state.step !== 'precombatMain' && state.step !== 'postcombatMain') {
          return 'non-instant spells require a main phase'
        }
        if (state.stack.length > 0) return 'non-instant spells require an empty stack'
      }

      const cost = spellCost(object, state.players[event.seat].commanderTax)
      if (!payCost(state.players[event.seat].mana, cost)) return 'not enough mana'
    }

    if (event.type === 'resolveTop' && state.stack.length === 0) return 'stack is empty'
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const object = draft.object(event.objectId)
      if (!object) return
      const cost = spellCost(object, draft.players[event.seat].commanderTax)
      const paid = payCost(draft.players[event.seat].mana, cost)
      if (!paid) return

      draft.players[event.seat].mana = paid
      draft.stack.push({
        id: draft.allocId('s'),
        kind: 'spell',
        objectId: object.id,
        controller: event.seat,
        name: object.name,
        targets: event.targets ?? [],
      })
      draft.move(object.id, 'stack')
      draft.passedInRow = []
      draft.priority = event.seat
      return
    }

    if (event.type === 'resolveTop') {
      const item = draft.stack.shift()
      if (!item) return
      const object = draft.object(item.objectId)
      if (!object) return

      if (object.name === 'Lightning Bolt') {
        const target = item.targets[0]
        if (target && target in draft.players) {
          draft.players[target as keyof typeof draft.players].life -= 3
        } else if (target) {
          const targetObject = draft.object(target)
          if (targetObject) targetObject.damageMarked += 3
        }
      }

      if (object.types.includes('Creature')) {
        draft.move(object.id, 'battlefield')
        object.summoningSickness = true
        installGrantedRules(draft, object)
      } else {
        draft.move(object.id, 'graveyard')
      }
      draft.passedInRow = []
      draft.priority = state.active
      return
    }

  },
}
