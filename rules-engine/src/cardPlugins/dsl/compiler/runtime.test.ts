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
  type RuleDslRuntimeContext,
} from './runtime'

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

  test('evaluates event amounts, current selector counts, and source LKI', () => {
    const context = contextFor()
    expect(evaluateRuntimeAmount({ kind: 'eventAmount' }, context)).toBe(4)
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
