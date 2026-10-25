import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate, forest } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { choice, move, objects, ref, revealUntil, REVEAL_UNTIL_REST } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const card = (name: string, types: string[]) => cardTemplate(name, { types })

describe('revealUntil', () => {
  test('reveals until a land, puts it in hand, and orders the rest on the bottom', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [instructionSpell({
          instructions: [revealUntil({
            targets: ref('controller'),
            match: objects({ zone: 'library', type: 'Land' }),
            foundTo: 'hand',
            rest: 'orderBottom',
          })],
        })],
      },
      libraries: {
        p1: [
          card('First Spell', ['Instant']),
          card('Wanted Land', ['Land']),
          card('Next Spell', ['Sorcery']),
        ],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Instruction fixture').id,
    }))
    const result = server.rules(state, { type: 'resolveTop' })
    state = ok(result)
    expect(result.trace.filter(entry => entry.outcome === 'applied' && entry.event.type === 'reveal').map(entry => entry.event)).toEqual([{
      type: 'reveal', seat: 'p1',
      objectIds: [named(state, 'First Spell').id, named(state, 'Wanted Land').id],
      source: 'Instruction fixture',
    }])
    expect(state.log.filter(line => line.includes('reveals'))).toEqual([
      'p1 reveals First Spell, Wanted Land for Instruction fixture',
    ])
    expect(named(state, 'Wanted Land').zone).toBe('hand')
    const order = pendingSelectionFor(state, 'p1')!
    expect(order.candidates.map((id) => state.objects[id].name)).toEqual(['First Spell'])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'scry',
      count: 1,
      choices: [{ objectId: order.candidates[0], destination: 'bottom' }],
    }))
    state = resolveStack(server.rules, state)
    expect(named(state, 'First Spell').zone).toBe('library')
    expect(named(state, 'Next Spell').zone).toBe('library')
    expect(state.log.filter(line => line.includes('reveals'))).toEqual([
      'p1 reveals First Spell, Wanted Land for Instruction fixture',
    ])
  })
})

test.each([0, 1, 3])('graveyard rest handling reveals through a match or the entire library (match index=%s)', matchIndex => {
  const library = [card('First', ['Instant']), card('Second', ['Sorcery']), card('Third', ['Creature'])]
  if (matchIndex < library.length) library[matchIndex] = card('Match', ['Land'])
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [revealUntil({ targets: ref('controller'), match: objects({ zone: 'library', type: 'Land' }), foundTo: 'hand', rest: REVEAL_UNTIL_REST.graveyard })] })] },
    libraries: { p1: library },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  expect(state.zoneOrder.p1.hand.map(id => state.objects[id].name)).toEqual(matchIndex < library.length ? ['Match'] : [])
  expect(state.zoneOrder.p1.graveyard.map(id => state.objects[id].name).filter(name => name !== 'Instruction fixture')).toEqual(library.slice(0, matchIndex).map(object => object.name))
  expect(state.zoneOrder.p1.library.map(id => state.objects[id].name)).toEqual(library.slice(matchIndex + 1).map(object => object.name))
})


test('revealUntil bindings include the resulting object identities for subsequent instructions', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [
      revealUntil({ targets: ref('controller'), match: objects({ type: 'Creature' }), foundTo: 'hand', rest: REVEAL_UNTIL_REST.graveyard, bindFound: 'found', bindRest: 'rest' }),
      move({ targets: choice('found'), to: 'battlefield' }),
      move({ targets: choice('rest'), to: 'exile' }),
    ] })] },
    libraries: { p1: [card('Nonmatch', ['Instant']), card('Match', ['Creature'])] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  expect(named(state, 'Match').zone).toBe('battlefield')
  expect(named(state, 'Nonmatch').zone).toBe('exile')
})

test('a zero-count reveal binds an empty set without revealing or moving cards', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [revealUntil({ targets: ref('controller'), count: 0, match: objects({ type: 'Creature' }), foundTo: 'library', rest: REVEAL_UNTIL_REST.keep, bindFound: 'found' }), move({ targets: choice('found'), to: 'battlefield' })] })] },
    libraries: { p1: [cardTemplate('Untouched', { types: ['Creature'] })] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  expect(named(state, 'Untouched').zone).toBe('library')
  expect(state.log.some(line => line.includes('reveals'))).toBe(false)
})

test('catalog Hermit Druid reveals through the first basic land, keeping it and milling the rest', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Hermit Druid')] },
    libraries: { p1: [card('Nonbasic', ['Land']), card('Spell', ['Instant']), forest(), card('After', ['Creature'])] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.G = 1
  const activated = ok(server.rules(ready, {
    type: 'activateAbility', abilityId: '$.abilities[0]', seat: 'p1', objectId: ready.zoneOrder.p1.battlefield[0]!,
  }))
  const resolved = ok(server.rules(activated, { type: 'resolveTop' }))
  expect(resolved.zoneOrder.p1.graveyard.map((id) => resolved.objects[id].name)).toEqual(['Nonbasic', 'Spell'])
  expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name)).toEqual(['Forest'])
  expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['After'])
})
