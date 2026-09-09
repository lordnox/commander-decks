import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../testGame'
import type { Plugin } from '../types'
import { combat } from './combat'
import { commander } from './commander'
import { damage } from './damage'
import { fog } from './fog'

const preventDamage: Plugin = {
  id: 'preventDamage',
  replace: ({ event }) => {
    if (event.type === 'dealDamage') return null
  },
}

const preventLifeLoss: Plugin = {
  id: 'preventLifeLoss',
  replace: ({ event }) => {
    if (event.type === 'loseLife') return null
  },
}

const attack = (power: number, extras: { tags?: string[] } = {}) => {
  const catalog = createCatalog([combat, damage, commander, fog, preventDamage, preventLifeLoss])
  const state = newGame({
    battlefield: {
      p1: [{ ...bears(), power, tags: extras.tags ?? [] }],
    },
    builtinRules: ['combat', 'damage', 'commander'],
  })
  const attackerId = Object.values(state.objects)[0].id
  state.objects[attackerId].summoningSickness = false
  state.step = 'declareAttackers'
  const declared = rules(
    state,
    {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attackerId, defender: 'p2' }],
    },
    catalog,
  )
  if (!declared.ok) throw new Error(declared.error)
  declared.state.step = 'combatDamage'
  return { catalog, attackerId, state: declared.state }
}

describe('damage chain', () => {
  test('combatDamage becomes damage, then life loss', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const result = rules(state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(38)
    expect(result.state.players.p2.data.commanderDamage).toEqual({ [attackerId]: 2 })
  })

  test('fog prevents combatDamage, so life and commander damage stay unchanged', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const fogged = rules(state, { type: 'addRule', pluginId: 'fog' }, catalog)
    if (!fogged.ok) throw new Error(fogged.error)
    const result = rules(fogged.state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(40)
    expect(result.state.players.p2.data.commanderDamage).toEqual({})
    expect(result.state.objects[attackerId].tapped).toBe(true)
  })

  test('preventing damage stops life loss but commander damage already counted', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const shielded = rules(state, { type: 'addRule', pluginId: 'preventDamage' }, catalog)
    if (!shielded.ok) throw new Error(shielded.error)
    const result = rules(shielded.state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(40)
    expect(result.state.players.p2.data.commanderDamage).toEqual({ [attackerId]: 2 })
  })

  test('preventing life loss also leaves commander damage intact', () => {
    const { catalog, state, attackerId } = attack(2, { tags: ['commander'] })
    const angel = rules(state, { type: 'addRule', pluginId: 'preventLifeLoss' }, catalog)
    if (!angel.ok) throw new Error(angel.error)
    const result = rules(angel.state, { type: 'assignCombatDamage' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.life).toBe(40)
    expect(result.state.players.p2.data.commanderDamage).toEqual({ [attackerId]: 2 })
  })
})
