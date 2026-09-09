import { poolTotal, type Draft } from '../draft'
import type { GameObject, ManaId, ManaPool, Plugin } from '../types'

const MANA_ORDER: ManaId[] = ['C', 'W', 'U', 'B', 'R', 'G']
const MANA_SYMBOLS = new Set<ManaId>(MANA_ORDER)

const genericCost = (manaCost: string) =>
  [...manaCost.matchAll(/\{(\d+)\}/g)].reduce((total, match) => total + Number(match[1]), 0)

const spellCost = (object: GameObject, additionalGeneric = 0) =>
  `${object.manaCost}${additionalGeneric > 0 ? `{${additionalGeneric}}` : ''}`

const coloredCosts = (manaCost: string) =>
  [...manaCost.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1].split('/').filter((symbol) => MANA_SYMBOLS.has(symbol as ManaId)))
    .filter((choices) => choices.length > 0) as ManaId[][]

const payColored = (pool: ManaPool, costs: ManaId[][], index = 0): ManaPool | null => {
  if (index === costs.length) return pool
  for (const symbol of costs[index]) {
    if (pool[symbol] < 1) continue
    const next = { ...pool, [symbol]: pool[symbol] - 1 }
    const paid = payColored(next, costs, index + 1)
    if (paid) return paid
  }
  return null
}

export const payCost = (pool: ManaPool, manaCost: string) => {
  const generic = genericCost(manaCost)
  const colored = payColored(pool, coloredCosts(manaCost))
  if (!colored) return null
  const remaining = { ...colored }

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
      if (!state.castableZones.includes(object.zone)) return 'spell is not in a castable zone'
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

      const cost = spellCost(object, event.additionalGeneric)
      if (!payCost(state.players[event.seat].mana, cost)) return 'not enough mana'
    }

    if (event.type === 'resolveTop' && state.stack.length === 0) return 'stack is empty'
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const object = draft.object(event.objectId)
      if (!object) return
      const cost = spellCost(object, event.additionalGeneric)
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

      if (object.name === 'Lightning Bolt' && item.targets[0]) {
        draft.enqueue({
          type: 'dealDamage',
          sourceId: object.id,
          target: item.targets[0],
          amount: 3,
        })
      }

      if (object.name === 'Timetwister') {
        for (const player of draft.playerOrder) {
          const pile = [
            ...draft.zoneOrder[player].graveyard,
            ...draft.zoneOrder[player].hand,
          ]
          for (const objectId of pile) {
            draft.enqueue({ type: 'move', objectId, to: 'library' })
          }
          draft.enqueue({ type: 'shuffleLibrary', seat: player })
        }
      }

      const permanent = object.types.some((type) =>
        ['Creature', 'Artifact', 'Enchantment', 'Land', 'Planeswalker', 'Battle'].includes(type),
      )
      if (permanent) {
        draft.move(object.id, 'battlefield')
        object.summoningSickness = object.types.includes('Creature')
        installGrantedRules(draft, object)
      } else {
        // CR 608.2: instructions run while the spell is still on the stack;
        // the card is put into the graveyard only after those events apply.
        draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
      }
      draft.passedInRow = []
      draft.priority = state.active
      return
    }

  },
}
