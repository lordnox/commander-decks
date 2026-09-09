import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../testGame'
import { commander } from './commander'
import { spells } from './spells'

describe('commander', () => {
  test('21 damage from one commander causes a player to lose', () => {
    const catalog = createCatalog([commander])
    const state = newGame({ builtinRules: ['commander'] })
    state.players.p2.data.commanderDamage = { o1: 21 }

    const result = rules(state, { type: 'custom', name: 'noop' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.lost).toBe(true)
  })

  test('a commander moving to the graveyard returns to command without changing tax', () => {
    const catalog = createCatalog([commander])
    const state = newGame({
      command: { p1: [{ ...bears(), supertypes: ['Legendary'] }] },
      builtinRules: ['commander'],
    })
    const commanderId = Object.values(state.objects)[0].id
    state.objects[commanderId].zone = 'battlefield'

    const result = rules(
      state,
      { type: 'move', objectId: commanderId, to: 'graveyard' },
      catalog,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[commanderId].zone).toBe('command')
    expect(result.state.players.p1.data.commanderTax).toBe(0)
  })

  test('casting from the command zone pays accumulated commander tax', () => {
    const catalog = createCatalog([commander, spells])
    const state = newGame({
      command: { p1: [{ ...bears(), supertypes: ['Legendary'] }] },
      builtinRules: ['spells', 'commander'],
    })
    const commanderId = Object.values(state.objects)[0].id
    state.players.p1.data.commanderTax = 2
    state.players.p1.mana.G = 1
    state.players.p1.mana.C = 3

    const result = rules(
      state,
      { type: 'castSpell', seat: 'p1', objectId: commanderId },
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[commanderId].zone).toBe('stack')
    expect(result.state.players.p1.mana.G).toBe(0)
    expect(result.state.players.p1.mana.C).toBe(0)
    expect(result.state.players.p1.data.commanderTax).toBe(4)
  })
})
