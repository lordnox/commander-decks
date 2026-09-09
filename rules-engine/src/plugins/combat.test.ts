import { expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../newGame'
import { combat } from './combat'

test('an unblocked attacker deals combat damage to the defending player', () => {
  const catalog = createCatalog([combat])
  const state = newGame({
    battlefield: { p1: [bears()], p2: [bears()] },
    builtinRules: ['combat'],
  })
  const attackerId = Object.values(state.objects).find((object) => object.controller === 'p1')!.id
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
  expect(declared.ok).toBe(true)
  if (!declared.ok) return
  expect(declared.state.objects[attackerId].tapped).toBe(true)

  declared.state.step = 'combatDamage'
  const damaged = rules(declared.state, { type: 'assignCombatDamage' }, catalog)
  expect(damaged.ok).toBe(true)
  if (!damaged.ok) return
  expect(damaged.state.players.p2.life).toBe(38)
})
