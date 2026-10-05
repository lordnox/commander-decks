import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { persist } from './effects'

const persister = (power = 3, toughness = 3, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate('Fixture Persister', {
    types: ['Creature'],
    power,
    toughness,
    oracleText: 'Persist',
    effects: [persist()],
    ...extra,
  })

const gameWith = (card = persister()) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [card] },
  })
  const id = server.state.zoneOrder.p1.battlefield[0]
  const kill = (state: typeof server.state) =>
    resolveStack(server.rules, ok(server.rules(state, { type: 'sacrifice', objectId: id })))
  return { server, id, kill }
}

describe('persist', () => {
  test('builder is clone-safe', () => {
    const effect = persist()
    expect(structuredClone(effect)).toEqual(effect)
  })

  test('returns with a -1/-1 counter under its owner and then stays dead', () => {
    const { server, id, kill } = gameWith()
    const first = kill(server.state)
    const back = first.objects[id]
    expect(back.zone).toBe('battlefield')
    expect(back.counters).toEqual({ '-1/-1': 1 })
    expect([back.power, back.toughness]).toEqual([2, 2])
    const second = kill(first)
    expect(second.objects[id].zone).toBe('graveyard')
    expect(second.stack).toHaveLength(0)
  })

  test('returns under the owner, not the thief', () => {
    const { server, id, kill } = gameWith()
    server.state.objects[id].controller = 'p2'
    const back = kill(server.state)
    expect(back.objects[id].controller).toBe('p1')
    expect(back.zoneOrder.p1.battlefield).toContain(id)
  })

  test('+1/+1 counters are gone on return, leaving only the -1/-1 counter', () => {
    const { server, id, kill } = gameWith()
    const grown = ok(server.rules(server.state, {
      type: 'putCounters',
      objectId: id,
      counter: '+1/+1',
      count: 2,
    }))
    const back = kill(grown).objects[id]
    expect(back.counters).toEqual({ '-1/-1': 1 })
    expect([back.power, back.toughness]).toEqual([2, 2])
  })

  test('a creature that already has a -1/-1 counter does not trigger', () => {
    const { server, id } = gameWith()
    const shrunk = ok(server.rules(server.state, {
      type: 'putCounters',
      objectId: id,
      counter: '-1/-1',
      count: 1,
    }))
    const sacrificed = ok(server.rules(shrunk, { type: 'sacrifice', objectId: id }))
    expect(sacrificed.stack).toHaveLength(0)
    expect(sacrificed.objects[id].zone).toBe('graveyard')
  })

  test('a 1/1 returns, dies to its own counter, and does not persist again', () => {
    const { server, id, kill } = gameWith(persister(1, 1))
    const back = kill(server.state)
    expect(back.objects[id].zone).toBe('graveyard')
    expect(back.stack).toHaveLength(0)
  })

  test('a persist card exiled before the trigger resolves does not return', () => {
    const { server, id } = gameWith()
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
    expect(sacrificed.stack).toHaveLength(1)
    const exiled = ok(server.rules(sacrificed, { type: 'move', objectId: id, to: 'exile' }))
    const resolved = resolveStack(server.rules, exiled)
    expect(resolved.objects[id].zone).toBe('exile')
  })

  test('a token with persist is gone and does not return', () => {
    const { server, id, kill } = gameWith(persister(3, 3, { token: true }))
    const after = kill(server.state)
    expect(after.objects[id]?.zone).not.toBe('battlefield')
  })

  test('a noncreature that is put into a graveyard does not trigger', () => {
    const { server, id } = gameWith(persister(3, 3, { types: ['Artifact'], power: null, toughness: null }))
    const sacrificed = ok(server.rules(server.state, { type: 'sacrifice', objectId: id }))
    expect(sacrificed.stack).toHaveLength(0)
  })
})
