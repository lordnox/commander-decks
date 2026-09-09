import { describe, expect, test } from 'bun:test'
import { createEngine } from './index'
import { forest, newGame, yarokFixture } from './newGame'
import { SEAT_IDS } from './types'

const engine = createEngine()
const ok = (result: ReturnType<typeof engine.rules>) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('createEngine', () => {
  test('Yarok entering installs manaBurn and leaving removes it', () => {
    const { rules } = engine
    let state = newGame({
      hands: { p1: [yarokFixture(), forest()] },
    })
    const yarok = Object.values(state.objects).find((object) => object.name.startsWith('Yarok'))!
    const land = Object.values(state.objects).find((object) => object.name === 'Forest')!

    state = ok(rules(state, { type: 'playLand', seat: 'p1', objectId: land.id }))
    expect(state.objects[land.id].zone).toBe('battlefield')

    state = ok(rules(state, { type: 'move', objectId: yarok.id, to: 'battlefield' }))
    expect(state.rules.some((rule) => rule.pluginId === 'manaBurn' && rule.sourceId === yarok.id)).toBe(
      true,
    )

    state = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 3 } }))
    state = ok(rules(state, { type: 'emptyManaPools' }))
    expect(state.players.p1.life).toBe(37)

    state = ok(rules(state, { type: 'move', objectId: yarok.id, to: 'graveyard' }))
    expect(state.rules.some((rule) => rule.pluginId === 'manaBurn')).toBe(false)

    state = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 3 } }))
    state = ok(rules(state, { type: 'emptyManaPools' }))
    expect(state.players.p1.life).toBe(37)
    expect(state.players.p1.mana.R).toBe(0)
  })

  test('addRule and removeRule toggle manaBurn without a permanent', () => {
    const { rules } = engine
    let state = newGame()
    state = ok(rules(state, { type: 'addRule', pluginId: 'manaBurn' }))
    state = ok(rules(state, { type: 'addMana', seat: 'p2', mana: { U: 1 } }))
    state = ok(rules(state, { type: 'emptyManaPools' }))
    expect(state.players.p2.life).toBe(39)
    state = ok(rules(state, { type: 'removeRule', pluginId: 'manaBurn' }))
    state = ok(rules(state, { type: 'addMana', seat: 'p2', mana: { U: 1 } }))
    state = ok(rules(state, { type: 'emptyManaPools' }))
    expect(state.players.p2.life).toBe(39)
  })

  test('four priority passes on an empty stack advance the step', () => {
    const { rules } = engine
    let state = newGame()
    expect(state.step).toBe('precombatMain')
    for (const seat of SEAT_IDS) {
      state = ok(rules(state, { type: 'passPriority', seat }))
    }
    expect(state.step).toBe('beginCombat')
    expect(state.active).toBe('p1')
  })

  test('an illegal land play leaves the state unchanged', () => {
    const { rules } = engine
    const state = newGame({ hands: { p1: [forest()] } })
    const land = Object.values(state.objects)[0]
    const first = ok(rules(state, { type: 'playLand', seat: 'p1', objectId: land.id }))
    const second = rules(first, { type: 'playLand', seat: 'p1', objectId: land.id })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.state.players.p1.landsPlayed).toBe(1)
  })
})
