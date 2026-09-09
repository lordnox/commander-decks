import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../newGame'
import { commander } from './commander'

describe('commander', () => {
  test('21 damage from one commander causes a player to lose', () => {
    const catalog = createCatalog([commander])
    const state = newGame({ builtinRules: ['commander'] })
    state.players.p2.commanderDamage.o1 = 21

    const result = rules(state, { type: 'custom', name: 'noop' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.p2.lost).toBe(true)
  })

  test('a commander moving to the graveyard returns to command and adds tax', () => {
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
    expect(result.state.players.p1.commanderTax).toBe(2)
  })
})
