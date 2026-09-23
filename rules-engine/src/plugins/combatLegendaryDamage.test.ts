import { describe, expect, test } from 'bun:test'
import { ability, draw, opponentDealtCombatDamageByLegendaryThisTurn } from '../cardPlugins/effectBuilders'
import { serializableEffects } from '../cardPlugins/effects'
import { conditionHolds } from '../cardPlugins/effectRuntime'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { bears, forest, newGame } from '../testGame'
import { activated } from '../cardPlugins/activated'
import { abilities } from './activateAbility'
import { combat } from './combat'
import { damage } from './damage'
import { fog } from './fog'
import { life } from './life'
import { priority } from './priority'
import { turnStructure } from './turnStructure'
import {
  legendaryCombatDamageFrom,
  LEGENDARY_COMBAT_DAMAGE_FROM,
  noteLegendaryCombatDamageToPlayer,
} from './combatLegendaryDamage'

const catalog = createCatalog([
  combat,
  damage,
  life,
  fog,
  turnStructure,
  priority,
  abilities,
  activated,
])

const builtinRules = [
  'combat',
  'damage',
  'life',
  'turnStructure',
  'priority',
  'abilities',
  'activated',
]

const legendaryBears = () => ({
  ...bears(),
  supertypes: ['Legendary'],
  name: 'Fixture Legend Bear',
})

const attackPlayer = (
  attacker: ReturnType<typeof bears>,
  defender: 'p2' | 'p3' = 'p2',
  players: 2 | 4 = 2,
) => {
  const state = newGame({
    players,
    battlefield: { p1: [attacker] },
    builtinRules,
  })
  const attackerId = Object.values(state.objects)[0].id
  state.objects[attackerId].summoningSickness = false
  state.step = 'declareAttackers'
  const declared = rules(
    state,
    {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attackerId, defender }],
    },
    catalog,
  )
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'combatDamage'
  const damaged = rules(declared.state, { type: 'assignCombatDamage' }, catalog)
  if (!damaged.ok) throw new Error(damaged.error)
  return damaged.state
}

const goalSphere = () => cardTemplate('Fixture Goal Sphere', {
  types: ['Artifact'],
  effects: serializableEffects([
    ability(
      { id: 'goal.draw' },
      { tap: true, if: opponentDealtCombatDamageByLegendaryThisTurn() },
      draw(2),
    ),
  ]),
})

describe('legendary combat damage to opponents this turn', () => {
  test('records which controllers legendary creatures dealt combat damage to a player', () => {
    const state = attackPlayer(legendaryBears())
    expect(legendaryCombatDamageFrom(state.players.p2)).toEqual({ p1: true })
    expect(legendaryCombatDamageFrom(state.players.p1)).toEqual({})
  })

  test('non-legendary combat damage to a player is not recorded', () => {
    const state = attackPlayer(bears())
    expect(legendaryCombatDamageFrom(state.players.p2)).toEqual({})
  })

  test('fog prevents combat damage and leaves the tracker empty', () => {
    const state = newGame({
      players: 2,
      battlefield: { p1: [legendaryBears()] },
      builtinRules: [...builtinRules, 'fog'],
    })
    state.rules.push({
      instanceId: 'fog-rule',
      pluginId: 'fog',
      sourceId: null,
      timestamp: state.rules.length,
      params: {},
    })
    const attackerId = Object.values(state.objects)[0].id
    state.objects[attackerId].summoningSickness = false
    state.step = 'combatDamage'
    const result = rules(state, { type: 'assignCombatDamage' }, catalog)
    if (!result.ok) throw new Error(result.error)
    expect(legendaryCombatDamageFrom(result.state.players.p2)).toEqual({})
  })

  test('non-combat damage to a player does not record legendary combat hits', () => {
    const state = newGame({
      players: 2,
      battlefield: { p1: [legendaryBears()] },
      builtinRules,
    })
    const sourceId = Object.values(state.objects)[0].id
    const result = rules(
      state,
      {
        type: 'dealDamage',
        sourceId,
        target: { kind: 'player', player: 'p2' },
        amount: 3,
      },
      catalog,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(legendaryCombatDamageFrom(result.state.players.p2)).toEqual({})
  })

  test('clears on each player untap step', () => {
    const hit = attackPlayer(legendaryBears())
    expect(legendaryCombatDamageFrom(hit.players.p2)).toEqual({ p1: true })
    const wrapped = rules({ ...hit, step: 'cleanup', active: 'p2' }, { type: 'advanceStep' }, catalog)
    if (!wrapped.ok) throw new Error(wrapped.error)
    expect(wrapped.state.step).toBe('untap')
    expect(legendaryCombatDamageFrom(wrapped.state.players.p2)).toEqual({})
  })

  test('player data clones safely', () => {
    const player = newGame().players.p1
    noteLegendaryCombatDamageToPlayer(player, 'p3')
    const cloned = structuredClone(newGame({ players: 2 }))
    cloned.players.p2.data[LEGENDARY_COMBAT_DAMAGE_FROM] = { p1: true }
    expect(legendaryCombatDamageFrom(cloned.players.p2)).toEqual({ p1: true })
  })
})

describe('opponentDealtCombatDamageByLegendaryThisTurn condition', () => {
  test('controller any accepts any legendary source', () => {
    const hit = attackPlayer(legendaryBears(), 'p3', 4)
    const sphere = goalSphere()
    const state = newGame({
      players: 4,
      battlefield: { p2: [sphere] },
      builtinRules,
    })
    const artifact = Object.values(state.objects).find((o) => o.name === sphere.name)!
    state.players.p3.data = { ...hit.players.p3.data }
    expect(conditionHolds(
      opponentDealtCombatDamageByLegendaryThisTurn(),
      state,
      artifact,
    )).toBe(true)
  })

  test('controller you requires your legendary creature', () => {
    const yours = attackPlayer(legendaryBears(), 'p2')
    const sphere = goalSphere()
    const state = newGame({
      players: 2,
      battlefield: { p1: [sphere] },
      builtinRules,
    })
    const artifact = Object.values(state.objects).find((o) => o.name === sphere.name)!
    state.players.p2.data = { ...yours.players.p2.data }
    expect(conditionHolds(
      opponentDealtCombatDamageByLegendaryThisTurn('you'),
      state,
      artifact,
    )).toBe(true)

    state.players.p2.data = { [LEGENDARY_COMBAT_DAMAGE_FROM]: { p2: true } }
    expect(conditionHolds(
      opponentDealtCombatDamageByLegendaryThisTurn('you'),
      state,
      artifact,
    )).toBe(false)
  })

  test('activation costs with if reject until an opponent was hit', () => {
    const sphere = goalSphere()
    const state = newGame({
      players: 2,
      battlefield: { p1: [sphere] },
      libraries: { p1: [forest(), forest()] },
      builtinRules,
    })
    const artifactId = Object.values(state.objects).find((o) => o.name === sphere.name)!.id
    state.priority = 'p1'

    const blocked = rules(
      state,
      { type: 'activateAbility', seat: 'p1', objectId: artifactId, abilityId: 'goal.draw' },
      catalog,
    )
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('cannot be activated')

    const afterHit = attackPlayer(legendaryBears())
    const ready = newGame({
      players: 2,
      battlefield: { p1: [sphere] },
      libraries: { p1: [forest(), forest()] },
      builtinRules,
    })
    ready.players.p2.data = { ...afterHit.players.p2.data }
    const id = Object.values(ready.objects).find((o) => o.name === sphere.name)!.id
    ready.priority = 'p1'
    const allowed = rules(
      ready,
      { type: 'activateAbility', seat: 'p1', objectId: id, abilityId: 'goal.draw' },
      catalog,
    )
    expect(allowed.ok).toBe(true)
    if (!allowed.ok) return
    expect(allowed.state.stack).toHaveLength(1)
  })
})
