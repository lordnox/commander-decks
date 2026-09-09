import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { emptyMana } from '../draft'
import { rules } from '../kernel'
import { bolt, newGame } from '../testGame'
import { damage } from './damage'
import { payCost, spells } from './spells'

describe('spells', () => {
  test('generic mana can be paid with colored mana but not as colorless mana', () => {
    expect(payCost({ ...emptyMana(), G: 2 }, '{1}{G}')).toEqual(emptyMana())
    expect(payCost({ ...emptyMana(), G: 2 }, '{C}{G}')).toBeNull()
  })

  test('casts and resolves Lightning Bolt', () => {
    const catalog = createCatalog([spells, damage])
    const state = newGame({
      hands: { p1: [bolt()] },
      builtinRules: ['spells', 'damage'],
    })
    const boltId = Object.values(state.objects)[0].id
    state.players.p1.mana.R = 1

    const cast = rules(
      state,
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: boltId,
        targets: [{ kind: 'player', player: 'p2' }],
      },
      catalog,
    )
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    expect(cast.state.players.p1.mana.R).toBe(0)
    expect(cast.state.objects[boltId].zone).toBe('stack')

    const resolved = rules(cast.state, { type: 'resolveTop' }, catalog)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.players.p2.life).toBe(37)
    expect(resolved.state.objects[boltId].zone).toBe('graveyard')
  })
})
