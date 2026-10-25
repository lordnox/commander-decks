import type { GameState } from '../types'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { planeswalker } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingOptionSelection } from '../rules/selectOptions'
import { planeswalker as planeswalkerPlugin } from './planeswalker'
import { projectForViewer } from '../runtime'

const jace = (loyalty = 4) => planeswalker('Jace, Multiverse Architect', loyalty, {
  subtypes: ['Jace'],
  counters: { loyalty },
})

const game = (setup: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [jace()] },
    ...setup,
  }, { random: () => 0, cardPlugins: [planeswalkerPlugin] })

const atOpponentBeginCombat = (
  runtime: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
) => {
  let current: GameState = { ...state, active: 'p2' as const, step: 'precombatMain' as const }
  current = ok(runtime.rules(current, { type: 'advanceStep' }))
  expect(current.step).toBe('beginCombat')
  return current
}

describe('Jace, Multiverse Architect', () => {
  test('pending optional pay survives projection for the payer only', () => {
    const runtime = game()
    let state = atOpponentBeginCombat(runtime, runtime.state)
    state = resolveStack(runtime.rules, state)
    const projected = projectForViewer(state, 'p2')
    expect(pendingOptionSelection(projected, 'p2')).toBeDefined()
    expect(pendingOptionSelection(projectForViewer(state, 'p1'), 'p2')).toBeUndefined()
  })
})
