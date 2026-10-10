import { describe, expect, test } from 'bun:test'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot, players, select, whenever } from '../cardPlugins/dsl/v1'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingSelectionFor } from './selectCards'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const canonicalDeathGain = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(
    { kind: 'dies', filter: { type: 'Creature' } },
    {
      instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
    },
  ),
])))

describe('canonical triggered abilities', () => {
  test('captures each actual death and executes the pinned definition after source departure', () => {
    const snapshot = canonicalDeathGain()
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Blood Artist DSL', { types: ['Creature'], power: 1, toughness: 1, ruleDefinition: snapshot }),
          cardTemplate('Victim A', { types: ['Creature'], power: 1, toughness: 1 }),
        ],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Blood Artist DSL')
    const victim = named(server.state, 'Victim A')
    let state = ok(server.rules(server.state, { type: 'move', objectId: victim.id, to: 'graveyard' }))
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].execution?.definitionSnapshot).toEqual(snapshot)
    state = ok(server.rules(state, { type: 'move', objectId: source.id, to: 'graveyard' }))
    state = resolveStack(server.rules, state)
    expect(state.players.p1.life).toBe(42)
  })

  test('puts a canonical target choice on the stack before priority', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'dies', filter: { type: 'Creature' } },
        {
          decisions: { targets: [select({ filter: players(), count: 1 })] },
          instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Targeting Artist', { types: ['Creature'], ruleDefinition: snapshot }), cardTemplate('Victim', { types: ['Creature'] })],
      },
    }, { random: () => 0 })
    const victim = named(server.state, 'Victim')
    const state = ok(server.rules(server.state, { type: 'move', objectId: victim.id, to: 'graveyard' }))
    const pending = state.players.p1.data['kernel.pendingPlayerSelection'] as { candidates: string[] }[]
    expect(pending[0].candidates).toEqual(['p1', 'p2'])
    expect(state.stack).toHaveLength(0)
  })

  test('captures a simultaneous three-creature death as three independent instances', () => {
    const snapshot = canonicalDeathGain()
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Blood Artist Three', { types: ['Creature'], power: 1, toughness: 0, ruleDefinition: snapshot }),
          cardTemplate('Victim One', { types: ['Creature'], power: 1, toughness: 0 }),
          cardTemplate('Victim Two', { types: ['Creature'], power: 1, toughness: 0 }),
        ],
      },
    }, { random: () => 0 })
    const waiting = ok(server.rules(server.state, { type: 'passPriority', seat: 'p1' }))
    expect(waiting.pendingTriggers).toHaveLength(3)
    expect(new Set(waiting.pendingTriggers?.map((trigger) => trigger.id)).size).toBe(3)
    expect(waiting.pendingTriggers?.every((trigger) => trigger.execution.source.snapshot.name === 'Blood Artist Three')).toBe(true)
    const order = pendingSelectionFor(waiting, 'p1')!
    const placed = ok(server.rules(waiting, {
      type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
    }))
    expect(placed.pendingTriggers).toBeUndefined()
    expect(placed.stack).toHaveLength(3)
  })
})
