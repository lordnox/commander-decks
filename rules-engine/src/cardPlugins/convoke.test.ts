import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import type { GameState, ReduceResult } from '../types'
import { targetedResolve } from './targetedResolve'

const card = (name: string, types: string[], colors: string[] = []) =>
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
      p1: [cardTemplate('Pile On', {
        types: ['Instant'],
        manaCost: '{3}{B}',
      }), cardTemplate('Ordinary Spell', {
        types: ['Instant'],
        manaCost: '{3}{B}',
      })],
    },
    battlefield: {
      p1: [
        card('Black Creature', ['Creature'], ['B']),
        card('Green Creature', ['Creature'], ['G']),
        card('Colorless Creature', ['Creature']),
        card('Mana Rock', ['Artifact'], ['B']),
        { ...card('Tapped Creature', ['Creature'], ['B']), tapped: true },
      ],
      p2: [
        card('Opponent Creature', ['Creature'], ['B']),
        card('Target Bear', ['Creature'], ['G']),
      ],
    },
    libraries: {
      p1: [
        card('Surveil Top', ['Sorcery']),
        card('Surveil Second', ['Land']),
        card('Library Bottom', ['Instant']),
      ],
    },
  },
  { random: () => 0.5, cardPlugins: [targetedResolve] },
)

describe('convoke', () => {
  test('matching colors pay colored symbols and other creatures pay generic mana', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2
    const spell = named(ready, 'Pile On')
    const black = named(ready, 'Black Creature')
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
      objectId: named(ready, 'Pile On').id,
      convoke: [named(ready, 'Green Creature').id],
      targets: [{ kind: 'object', objectId: named(ready, 'Target Bear').id }],
    })

    expect(result).toMatchObject({ ok: false, error: 'not enough mana' })
  })

  test('rejects tapped, opposing, noncreature, and duplicate convoke objects', () => {
    const server = game()
    const cases = [
      ['Tapped Creature'],
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
        objectId: named(ready, 'Pile On').id,
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

  test('legal acts offer convoke when it is needed to cast the spell', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const spell = named(ready, 'Pile On')
    const black = named(ready, 'Black Creature')
    const target = named(ready, 'Target Bear')
    const action = legalActsFor(ready, 'p1').find((candidate) =>
      candidate.kind === 'castSpell'
      && candidate.objectId === spell.id
      && candidate.targetObjectId === target.id)

    expect(action).toMatchObject({ kind: 'castSpell', convoke: [black.id] })
    expect(action && eventsForAvailableAction(ready, 'p1', action)?.at(-1))
      .toMatchObject({ type: 'castSpell', convoke: [black.id] })
  })

  test('Pile On destroys its target and completes surveil 2 after convoking', () => {
    const server = game()
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 3
    const spell = named(ready, 'Pile On')
    const black = named(ready, 'Black Creature')
    const target = named(ready, 'Target Bear')
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      convoke: [black.id],
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(resolved, 'p1')

    expect(resolved.objects[target.id].zone).toBe('graveyard')
    expect(selection).toMatchObject({ kind: 'surveil', count: 2 })
    const [top, second] = selection!.candidates
    const completed = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'surveil',
      count: 2,
      choices: [
        { objectId: top, destination: 'graveyard' },
        { objectId: second, destination: 'top' },
      ],
    }))
    expect(completed.objects[spell.id].zone).toBe('graveyard')
    expect(completed.objects[target.id].zone).toBe('graveyard')
    expect(completed.objects[top].zone).toBe('graveyard')
    expect(completed.zoneOrder.p1.library[0]).toBe(second)
  })
})
