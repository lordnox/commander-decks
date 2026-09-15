import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { emptyMana } from '../draft'
import { rules } from '../kernel'
import { bolt, forest, newGame, timetwister } from '../testGame'
import { damage } from './damage'
import { createAuthoritativeHiddenInformation } from './hiddenInformation'
import { payCost, spells } from './spells'
import type { Plugin } from '../types'

describe('spells', () => {
  test('generic mana can be paid with colored mana but not as colorless mana', () => {
    expect(payCost({ ...emptyMana(), G: 2 }, '{1}{G}')).toEqual(emptyMana())
    expect(payCost({ ...emptyMana(), G: 2 }, '{C}{G}')).toBeNull()
  })

  test('hybrid mana spends either listed color instead of making the spell free', () => {
    expect(payCost({ ...emptyMana(), B: 2 }, '{U/B}{U/B}')).toEqual(emptyMana())
    expect(payCost({ ...emptyMana(), U: 1, B: 1 }, '{U/B}{U/B}')).toEqual(emptyMana())
    expect(payCost(emptyMana(), '{U/B}{U/B}')).toBeNull()
  })

  test('payCost does not mutate the input pool', () => {
    const pool = { ...emptyMana(), C: 2 }
    expect(payCost(pool, '{1}')).toEqual({ ...emptyMana(), C: 1 })
    expect(pool.C).toBe(2)
  })

  test('casts and resolves Lightning Bolt while it is still on the stack', () => {
    const seen: string[] = []
    const witness: Plugin = {
      id: 'witness',
      apply: ({ event, draft }) => {
        if (event.type === 'dealDamage') {
          seen.push(draft.objects[event.sourceId]?.zone ?? 'missing')
        }
      },
    }
    const catalog = createCatalog([spells, damage, witness])
    const state = newGame({
      hands: { p1: [bolt()] },
      builtinRules: ['spells', 'damage', 'witness'],
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
    expect(seen).toEqual(['stack'])
  })

  test('Timetwister does not shuffle itself: it is still on the stack while its instructions run', () => {
    const hiddenInformation = createAuthoritativeHiddenInformation(() => 0.5)
    const catalog = createCatalog([spells, hiddenInformation])
    const state = newGame({
      players: 2,
      hands: { p1: [timetwister()] },
      libraries: { p1: [forest()] },
      builtinRules: ['spells', 'hiddenInformation'],
    })
    const twisterId = Object.values(state.objects).find((object) => object.name === 'Timetwister')!.id
    const forestId = Object.values(state.objects).find((object) => object.name === 'Forest')!.id
    state.players.p1.mana.U = 1
    state.players.p1.mana.C = 2

    const milled = rules(state, { type: 'move', objectId: forestId, to: 'graveyard' }, catalog)
    expect(milled.ok).toBe(true)
    if (!milled.ok) return

    const cast = rules(
      milled.state,
      { type: 'castSpell', seat: 'p1', objectId: twisterId },
      catalog,
    )
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    expect(cast.state.objects[twisterId].zone).toBe('stack')
    expect(cast.state.objects[forestId].zone).toBe('graveyard')

    const resolved = rules(cast.state, { type: 'resolveTop' }, catalog)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.objects[forestId].zone).toBe('library')
    expect(resolved.state.objects[twisterId].zone).toBe('graveyard')
    expect(resolved.state.zoneOrder.p1.library).toEqual([forestId])
    expect(resolved.state.zoneOrder.p1.graveyard).toEqual([twisterId])
  })
})
