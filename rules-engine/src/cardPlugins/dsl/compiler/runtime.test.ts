import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../../formats'
import { cardTemplate, newGame } from '../../../newGame'
import { captureObject, snapshotObject } from '../../../objectIdentity'
import {
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  evaluateStackItemSelector,
} from './runtime'
import type { RuleDslRuntimeContext } from './runtime'

const contextFor = (): RuleDslRuntimeContext => {
  const format = {
    ...commanderRules,
    id: 'two-headed-test',
    opponentsOf: (_players: readonly string[], player: string) =>
      player === 'p1' || player === 'p2' ? ['p3', 'p4'] : ['p1', 'p2'],
  }
  const state = newGame(format, {
    players: ['p1', 'p2', 'p3', 'p4'],
    battlefield: {
      p1: [cardTemplate('Named Relic', { types: ['Artifact'], manaValue: 2 })],
      p3: [cardTemplate('Other Relic', { types: ['Artifact'], manaValue: 4 })],
    },
  })
  const source = Object.values(state.objects).find((object) => object.name === 'Named Relic')!
  const other = Object.values(state.objects).find((object) => object.name === 'Other Relic')!
  return {
    state,
    controller: 'p1',
    source: captureObject(source),
    occurrence: {
      kind: 'event',
      eventType: 'dealDamage',
      player: 'p3',
      amount: 4,
      object: { before: snapshotObject(other) },
    },
  }
}

describe('Rule DSL runtime evaluation', () => {
  test('stack color filters compose against current characteristics rather than captured colors', () => {
    const context = contextFor()
    const source = context.state.objects[context.source.ref.objectId]
    source.zone = 'stack'
    source.types = ['Instant']
    source.colors = 'UR'
    context.state.stack = [{ id: 'spell1', kind: 'spell', objectId: source.id, controller: 'p1', name: source.name, targets: [] }]
    const selector = { kind: 'stackItems' as const, filter: {
      all: [{ kind: 'spell' as const }, { type: 'Instant' }],
      any: [{ color: 'U' as const }, { color: 'R' as const }],
      not: { color: 'B' as const },
    } }
    expect(evaluateStackItemSelector(selector, context).map(item => item.id)).toEqual(['spell1'])
    source.colors = 'B'
    expect(evaluateStackItemSelector(selector, context)).toEqual([])
    delete context.state.objects[source.id]
    expect(evaluateStackItemSelector(selector, context)).toEqual([])
  })

  test('uses format-owned opponent relations and excludes lost seats', () => {
    const context = contextFor()
    context.state.players.p4.lost = true
    expect(evaluatePlayerSelector(
      { kind: 'players', filter: { relation: 'opponent' } },
      context,
    )).toEqual(['p3'])
  })

  test('queries current groups but keeps captured occurrence participants', () => {
    const context = contextFor()
    const named = evaluateObjectSelector({
      kind: 'objects',
      filter: { zone: 'battlefield', type: 'Artifact', name: 'Named Relic' },
    }, context)
    expect(named.map((object) => object.name)).toEqual(['Named Relic'])

    const other = Object.values(context.state.objects).find((object) => object.name === 'Other Relic')!
    other.zone = 'graveyard'
    expect(evaluateObjectSelector({
      kind: 'objects',
      filter: { zone: 'battlefield', type: 'Artifact' },
    }, context).map((object) => object.name)).toEqual(['Named Relic'])
    expect(evaluateObjectReference(
      { kind: 'contextRef', name: 'triggering.object.before' },
      context,
    ).map((object) => object.name)).toEqual(['Other Relic'])
  })

  test('object selectors match attacking battlefield permanents', () => {
    const format = {
      ...commanderRules,
      id: 'attacking-filter-test',
      opponentsOf: (_players: readonly string[], player: string) =>
        player === 'p1' ? ['p2'] : ['p1'],
    }
    const state = newGame(format, {
      players: ['p1', 'p2'],
      battlefield: {
        p2: [
          cardTemplate('Attacker', { types: ['Creature'], attacking: 'p1' }),
          cardTemplate('Idle', { types: ['Creature'] }),
          cardTemplate('Weird Attacker', { types: ['Artifact'], attacking: 'p1' }),
        ],
      },
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Attacker')!
    const context: RuleDslRuntimeContext = {
      state,
      controller: 'p1',
      source: captureObject(source),
    }
    const attacking = { kind: 'objects' as const, filter: { zone: 'battlefield' as const, attacking: true } }
    expect(evaluateObjectSelector(attacking, context).map((object) => object.name).sort())
      .toEqual(['Attacker', 'Weird Attacker'])
    expect(evaluateObjectSelector({
      kind: 'objects',
      filter: { zone: 'battlefield', attacking: false },
    }, context).map((object) => object.name)).toEqual(['Idle'])
  })

  test('object selectors match each requested current supertype', () => {
    const context = contextFor()
    const named = Object.values(context.state.objects).find((object) => object.name === 'Named Relic')!
    named.types = ['Land']
    named.supertypes = ['Basic', 'Snow']
    const other = Object.values(context.state.objects).find((object) => object.name === 'Other Relic')!
    other.types = ['Land']
    other.supertypes = ['Legendary']

    expect(evaluateObjectSelector({
      kind: 'objects', filter: { zone: 'battlefield', type: 'Land', supertypes: ['Basic'] },
    }, context).map((object) => object.name)).toEqual(['Named Relic'])
    expect(evaluateObjectSelector({
      kind: 'objects', filter: { zone: 'battlefield', type: 'Land', supertypes: ['Basic', 'Snow'] },
    }, context).map((object) => object.name)).toEqual(['Named Relic'])
  })

  test('evaluates event amounts, current selector counts, and source LKI', () => {
    const context = contextFor()
    expect(evaluateRuntimeAmount({ kind: 'eventAmount' }, context)).toBe(4)
    context.stackItemId = 'spell1'
    context.state.stack = [{
      id: 'spell1',
      kind: 'spell',
      objectId: context.source.ref.objectId,
      controller: 'p1',
      name: 'Named Relic',
      targets: [],
      manaSpent: { W: 2, U: 0, B: 1, R: 0, G: 0, C: 0 },
    }]
    expect(evaluateRuntimeAmount({ kind: 'manaSpent', color: 'W' }, context)).toBe(2)
    expect(evaluateRuntimeAmount({ kind: 'manaSpent', color: 'B' }, context)).toBe(1)
    expect(evaluateRuntimeAmount({ kind: 'manaSpent', color: 'U' }, context)).toBe(0)
    expect(evaluateRuntimeAmount({
      kind: 'count',
      of: { kind: 'objects', filter: { zone: 'battlefield', type: 'Artifact' } },
    }, context)).toBe(2)

    const source = context.source.snapshot
    source.power = 6
    context.source.information = 'lastKnown'
    context.state.objects[source.id].incarnation = 2
    expect(evaluateRuntimeAmount({
      kind: 'characteristic',
      of: { kind: 'contextRef', name: 'source' },
      characteristic: 'power',
      information: 'currentOrLastKnown',
    }, context)).toBe(6)
  })

  test('rejects absent and cross-domain bindings and hides internal action items', () => {
    const context = contextFor()
    expect(() => evaluateObjectReference({ kind: 'targetRef', clauseIndex: 0 }, context))
      .toThrow('target clause 0 is not bound')
    context.targets = { 0: [{ kind: 'player', playerId: 'p3' }] }
    expect(() => evaluateObjectReference({ kind: 'targetRef', clauseIndex: 0 }, context))
      .toThrow('is not bound to object recipients')
    context.state.stack.push({
      id: 'action1',
      kind: 'action',
      objectId: context.source.ref.objectId,
      controller: 'p1',
      name: 'internal draw',
      targets: [],
    })
    expect(evaluateStackItemSelector({ kind: 'stackItems', filter: {} }, context)).toEqual([])
  })
})
