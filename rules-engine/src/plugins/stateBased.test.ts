import { expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, newGame } from '../testGame'
import type { Plugin } from '../types'
import { stateBased } from './stateBased'

const manaStub: Plugin = { id: 'mana' }

test('state-based actions move a lethally damaged creature to the graveyard', () => {
  const catalog = createCatalog([manaStub, stateBased])
  const state = newGame({
    battlefield: { p1: [bears()] },
    builtinRules: ['mana', 'stateBased'],
  })
  const bearId = Object.values(state.objects)[0].id
  state.objects[bearId].damageMarked = 2

  const result = rules(state, { type: 'addMana', seat: 'p1', mana: {} }, catalog)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.objects[bearId].zone).toBe('graveyard')
})
