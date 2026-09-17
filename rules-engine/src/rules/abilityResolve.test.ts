import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { activated } from '../cardPlugins/activated'
import { activate, draw } from '../cardPlugins/effects'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('ability resolution', () => {
  test('CR 602.2 pays tap at activation then CR 608.2 draws on resolve', () => {
    const tapDrawer = cardTemplate('Tap Drawer', {
      types: ['Creature'],
      effects: [activate({
        id: 'tap.draw',
        costs: { tap: true },
        do: [draw(1)],
      })],
    })
    const drawn = cardTemplate('Top card', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [tapDrawer] },
        libraries: { p1: [drawn] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const sourceId = named(server.state, 'Tap Drawer').id
    server.state.objects[sourceId].summoningSickness = false

    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'tap.draw',
      seat: 'p1',
      objectId: sourceId,
    }))
    expect(activatedState.objects[sourceId].tapped).toBe(true)
    expect(activatedState.stack).toHaveLength(1)
    expect(activatedState.stack[0]).toMatchObject({
      kind: 'ability',
      abilityId: 'tap.draw',
      objectId: sourceId,
    })
    expect(named(activatedState, 'Top card').zone).toBe('library')
    expect(activatedState.objects[sourceId].zone).toBe('battlefield')

    let passed = activatedState
    for (let round = 0; round < 2; round += 1) {
      for (const seat of passed.playerOrder) {
        passed = ok(server.rules(passed, { type: 'passPriority', seat }))
      }
    }
    expect(passed.stack).toHaveLength(0)
    expect(named(passed, 'Top card').zone).toBe('hand')
    expect(passed.objects[sourceId].zone).toBe('battlefield')
  })
})
