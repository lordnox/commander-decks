import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import type { ColorSet } from '../../../shared/cardColors'
import { card as definition, compileCardRuleDefinition, activated, convoke, destroy, objects, select, target } from './dsl/v1'
import { instructionSpell } from './dsl/instructionTestSupport'

const card = (name: string, types: string[], colors: ColorSet = '') =>
  cardTemplate(name, { types, colors })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = () => createServerGame(
  commanderRules,
  {
    hands: {
      p1: [instructionSpell({ costs: [convoke()], decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] }, instructions: [destroy({ targets: target(0) })] }, '{3}{B}'), cardTemplate('Ordinary Spell', {
        types: ['Instant'],
        manaCost: '{3}{B}',
      })],
    },
    battlefield: {
      p1: [
        { ...card('Black Creature', ['Creature'], 'B'), tapProduces: { C: 1 } },
        card('Green Creature', ['Creature'], 'G'),
        card('Colorless Creature', ['Creature']),
        card('Mana Rock', ['Artifact'], 'B'),
        { ...card('Tapped Creature', ['Creature'], 'B'), tapped: true },
        { ...card('Phased Creature', ['Creature'], 'B'), phasedOut: true },
      ],
      p2: [
        card('Opponent Creature', ['Creature'], 'B'),
        card('Target Bear', ['Creature'], 'G'),
      ],
    },

  },
  { random: () => 0.5 },
)

describe('convoke', () => {
  test('matching colors pay colored symbols and other creatures pay generic mana', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2
    const spell = named(ready, 'Instruction fixture')
    const black = named(ready, 'Black Creature')
    black.summoningSickness = true
    const green = named(ready, 'Green Creature')
    const target = named(ready, 'Target Bear')

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      convoke: [black.id, green.id],
      targets: [{ kind: 'object', objectId: target.id }],
    }))

    expect(cast.players.p1.mana.C).toBe(0)
    expect(cast.stack[0].manaSpent).toEqual({ C: 2 })
    expect(cast.objects[black.id].tapped).toBe(true)
    expect(cast.objects[green.id].tapped).toBe(true)
  })

  test('rejects a creature whose color cannot cover the remaining colored symbol', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3

    const result = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Instruction fixture').id,
      convoke: [named(ready, 'Green Creature').id],
      targets: [{ kind: 'object', objectId: named(ready, 'Target Bear').id }],
    })

    expect(result).toMatchObject({ ok: false, error: 'not enough mana' })
  })

  test('rejects tapped, opposing, noncreature, and duplicate convoke objects', () => {
    const server = game()
    const cases = [
      ['Tapped Creature'],
      ['Phased Creature'],
      ['Opponent Creature'],
      ['Mana Rock'],
      ['Black Creature', 'Black Creature'],
    ]

    for (const names of cases) {
      const ready = structuredClone(server.state)
      ready.players.p1.mana.C = 3
      const result = server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(ready, 'Instruction fixture').id,
        convoke: names.map((name) => named(ready, name).id),
        targets: [{ kind: 'object', objectId: named(ready, 'Target Bear').id }],
      })
      expect(result.ok).toBe(false)
    }
  })

  test('rejects convoke objects on a spell without the keyword', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const result = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Ordinary Spell').id,
      convoke: [named(ready, 'Black Creature').id],
    })

    expect(result).toMatchObject({ ok: false, error: 'Ordinary Spell does not have convoke' })
  })

  test('legal acts and dispatch fund a canonical spell without double-tapping its contribution', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const spell = named(ready, 'Instruction fixture')
    const black = named(ready, 'Black Creature')
    const target = named(ready, 'Target Bear')
    const action = legalActsFor(ready, 'p1').find(candidate => candidate.kind === 'castSpell' && candidate.objectId === spell.id)!
    expect(action).toMatchObject({ kind: 'castSpell', convoke: [black.id] })
    if (action.kind !== 'castSpell') throw new Error('expected a casting action')
    const events = eventsForAvailableAction(ready, 'p1', { ...action, targetObjectIds: [target.id] })!
    expect(events.at(-1)).toMatchObject({ type: 'castSpell', convoke: [black.id] })
    let state = ready
    for (const event of events) state = ok(server.rules(state, event))
    expect(state.objects[black.id].tapped).toBe(true)
    expect(state.players.p1.mana.C).toBe(0)
    const underfunded = structuredClone(ready)
    underfunded.players.p1.mana.C = 2
    expect(eventsForAvailableAction(underfunded, 'p1', { ...action, targetObjectIds: [target.id] })).toBeNull()
  })
})


test('convoke is accepted as a spell payment method and rejected as an activated cost', () => {
  expect(() => compileCardRuleDefinition(definition([activated({ costs: [convoke()], instructions: [] })]))).toThrow('convoke is a spell payment method')
})
