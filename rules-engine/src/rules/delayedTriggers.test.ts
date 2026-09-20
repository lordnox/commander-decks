import { describe, expect, test } from 'bun:test'
import type { CardInstruction } from '../cardPlugins/effects'
import { freezeDraft, makeDraft } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { DelayedTriggerCondition, GameState } from '../types'
import { registerDelayedTrigger } from './delayedTriggers'

const setup = () => createServerGame(commanderRules, {
  players: 2,
  battlefield: {
    p1: [cardTemplate('Delayed Source', { types: ['Enchantment'] })],
  },
})

const register = (
  state: GameState,
  condition: DelayedTriggerCondition,
  instructions: CardInstruction[],
) => {
  const draft = makeDraft(state)
  const source = draft.zoneOf('battlefield', 'p1')[0]
  registerDelayedTrigger(draft, source, condition, instructions)
  return freezeDraft(draft)
}

describe('delayed triggers', () => {
  test('registration snapshots source, controller, condition, and instructions', () => {
    const server = setup()
    const source = server.state.zoneOrder.p1.battlefield[0]
    const state = register(
      server.state,
      { kind: 'step', step: 'end', active: 'p1' },
      [{ kind: 'gainLife', count: 2 }],
    )

    expect(state.delayedTriggers).toEqual([{
      id: expect.stringMatching(/^delayed/),
      sourceId: source,
      sourceName: 'Delayed Source',
      controller: 'p1',
      condition: { kind: 'step', step: 'end', active: 'p1' },
      instructions: [{ kind: 'gainLife', count: 2 }],
      timestamp: expect.any(Number),
    }])
  })

  test('fires once on the matching event, stacks, and cleans up before resolution', () => {
    const server = setup()
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    let state = register(
      server.state,
      { kind: 'event', type: 'gainLife' },
      [{ kind: 'gainLife', count: 3 }],
    )
    state = ok(server.rules(state, { type: 'move', objectId: sourceId, to: 'graveyard' }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p1', amount: 1 }))

    expect(state.delayedTriggers).toHaveLength(1)
    expect(state.stack).toHaveLength(0)

    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 1 }))

    expect(state.players.p1.life).toBe(40)
    expect(state.delayedTriggers).toHaveLength(0)
    expect(state.stack[0]).toMatchObject({
      kind: 'ability',
      objectId: sourceId,
      controller: 'p1',
      name: 'Delayed Source',
    })

    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 1 }))
    expect(state.stack).toHaveLength(1)

    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(44)
    expect(state.stack).toHaveLength(0)
  })

  test('a step trigger without an active seat fires at the next such step', () => {
    const server = setup()
    let state = register(
      { ...server.state, step: 'untap' },
      { kind: 'step', step: 'upkeep' },
      [{ kind: 'gainLife', count: 2 }],
    )

    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.step).toBe('upkeep')
    expect(state.stack[0]).toMatchObject({ kind: 'ability', controller: 'p1' })
    expect(state.delayedTriggers).toHaveLength(0)
  })

  test('a step trigger for a named active seat waits for that player\'s step', () => {
    const server = setup()
    let state = register(
      { ...server.state, step: 'untap' },
      { kind: 'step', step: 'upkeep', active: 'p2' },
      [{ kind: 'gainLife', count: 2 }],
    )

    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.step).toBe('upkeep')
    expect(state.stack).toHaveLength(0)
    expect(state.delayedTriggers).toHaveLength(1)

    state = { ...state, active: 'p2', priority: 'p2', step: 'untap' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.stack[0]).toMatchObject({ kind: 'ability', controller: 'p1' })
    expect(state.delayedTriggers).toHaveLength(0)
    expect(state.players.p1.life).toBe(40)
  })

  test('removes delayed triggers controlled by a player who leaves the game', () => {
    const server = setup()
    const state = register(
      server.state,
      { kind: 'event', type: 'draw' },
      [{ kind: 'gainLife', count: 1 }],
    )
    const conceded = ok(server.rules(state, { type: 'concede', seat: 'p1' }))

    expect(conceded.delayedTriggers).toHaveLength(0)
  })
})
