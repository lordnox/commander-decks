import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import {
  SEARCH_CHOSEN,
  librarySearch,
  pendingSearch,
} from './librarySearch'
import { targetedResolve } from './targetedResolve'
import { targetOnResolve } from './effects'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

describe('targeted spell resolution', () => {
  test('Deathsprout rejects a noncreature target', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Deathsprout', {
            types: ['Instant'],
            manaCost: '{1}{B}{B}{G}',
          })],
        },
        battlefield: { p2: [cardTemplate('Rock', { types: ['Artifact'] })] },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve, librarySearch] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 1, C: 1 }
    const result = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Deathsprout').id,
      targets: [{ kind: 'object', objectId: named(ready, 'Rock').id }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('illegal target')
  })

  test('Deathsprout destroys its target and completes the private basic search', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Deathsprout', {
            types: ['Instant'],
            manaCost: '{1}{B}{B}{G}',
          })],
        },
        battlefield: { p2: [cardTemplate('Bear', { types: ['Creature'] })] },
        libraries: { p1: [forest()] },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve, librarySearch] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 1, C: 1 }
    const spell = named(ready, 'Deathsprout').id
    const bear = named(ready, 'Bear').id
    const opened = run(server, ready, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell,
        targets: [{ kind: 'object', objectId: bear }],
      },
      { type: 'resolveTop' },
    ])
    expect(pendingSearch(opened, 'p1')?.source).toBe('Deathsprout')
    expect(opened.objects[bear].zone).toBe('battlefield')
    const opponentView = server.project(opened, 'p2')
    expect(opponentView.zoneOrder.p1.library).toEqual([])
    expect(Object.values(opponentView.objects).some((object) => object.name === 'Forest')).toBe(false)

    const basic = named(opened, 'Forest').id
    const resolved = run(server, opened, [
      { type: 'move', objectId: basic, to: 'battlefield' },
      { type: 'tap', objectId: basic },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
      { type: 'resolveTop' },
    ])
    expect(resolved.objects[bear].zone).toBe('graveyard')
    expect(resolved.objects[basic].zone).toBe('battlefield')
    expect(resolved.objects[basic].tapped).toBe(true)
    expect(resolved.objects[spell].zone).toBe('graveyard')
  })

  test('Reanimate steals the creature and charges its mana value in life', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Reanimate', { types: ['Sorcery'], manaCost: '{B}' })],
          p2: [cardTemplate('Big Sphinx', {
            types: ['Creature'],
            manaCost: '{4}{U}{U}',
            power: 5,
            toughness: 5,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.B = 1
    const spell = named(ready, 'Reanimate').id
    const sphinx = named(ready, 'Big Sphinx').id
    const life = ready.players.p1.life
    const resolved = run(server, ready, [
      { type: 'move', objectId: sphinx, to: 'graveyard' },
      { type: 'castSpell', seat: 'p1', objectId: spell, targets: [{ kind: 'object', objectId: sphinx }] },
      { type: 'resolveTop' },
    ])

    expect(resolved.objects[sphinx].zone).toBe('battlefield')
    expect(resolved.objects[sphinx].controller).toBe('p1')
    expect(resolved.objects[sphinx].owner).toBe('p2')
    expect(resolved.players.p1.life).toBe(life - 6)
    expect(resolved.objects[spell].zone).toBe('graveyard')
  })

  test('Keep Safe only targets a spell aimed at a controlled permanent', () => {
    const keepSafe = cardTemplate('Keep Safe', { types: ['Instant'], manaCost: '{1}{U}' })
    const removal = cardTemplate('Removal', { types: ['Instant'], manaCost: '{B}' })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [keepSafe], p2: [removal] },
        battlefield: {
          p1: [cardTemplate('Protected Bear', { types: ['Creature'] })],
          p2: [cardTemplate('Other Bear', { types: ['Creature'] })],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const hostileReady = structuredClone(server.state)
    hostileReady.priority = 'p2'
    hostileReady.players.p2.mana.B = 1
    const hostile = ok(server.rules(hostileReady, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(hostileReady, 'Removal').id,
      targets: [{ kind: 'object', objectId: named(hostileReady, 'Other Bear').id }],
    }))
    hostile.priority = 'p1'
    hostile.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 }
    const result = server.rules(hostile, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(hostile, 'Keep Safe').id,
      targets: [{ kind: 'object', objectId: named(hostile, 'Removal').id }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('illegal target')
  })

  test('Keep Safe counters the targeted spell and draws a card', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Keep Safe', { types: ['Instant'], manaCost: '{1}{U}' })],
          p2: [cardTemplate('Removal', { types: ['Instant'], manaCost: '{B}' })],
        },
        battlefield: { p1: [cardTemplate('Protected Bear', { types: ['Creature'] })] },
        libraries: { p1: [cardTemplate('Fresh Card', { types: ['Creature'] })] },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const hostileReady = structuredClone(server.state)
    hostileReady.priority = 'p2'
    hostileReady.players.p2.mana.B = 1
    const removalId = named(hostileReady, 'Removal').id
    const hostile = ok(server.rules(hostileReady, {
      type: 'castSpell',
      seat: 'p2',
      objectId: removalId,
      targets: [{ kind: 'object', objectId: named(hostileReady, 'Protected Bear').id }],
    }))
    hostile.priority = 'p1'
    hostile.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 }
    const keepSafeId = named(hostile, 'Keep Safe').id
    const cast = ok(server.rules(hostile, {
      type: 'castSpell',
      seat: 'p1',
      objectId: keepSafeId,
      targets: [{ kind: 'object', objectId: removalId }],
    }))
    const countered = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(countered.objects[removalId].zone).toBe('graveyard')
    expect(countered.objects[keepSafeId].zone).toBe('graveyard')
    expect(named(countered, 'Fresh Card').zone).toBe('hand')
    expect(countered.stack).toHaveLength(0)
  })

  test('a bounced spell is removed from the stack before it can resolve', () => {
    const bounce = cardTemplate('Stack Bounce', {
      types: ['Instant'],
      manaCost: '{U}',
      effects: [
        targetOnResolve('bounce', { zone: 'stack' }),
      ],
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [bounce], p2: [cardTemplate('Threat', { types: ['Instant'] })] } },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    const threat = named(ready, 'Threat').id
    let state = ok(server.rules(ready, { type: 'castSpell', seat: 'p2', objectId: threat }))
    state.priority = 'p1'
    state.players.p1.mana.U = 1
    const answer = named(state, 'Stack Bounce').id
    state = run(server, state, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: answer,
        targets: [{ kind: 'object', objectId: threat }],
      },
      { type: 'resolveTop' },
    ])

    expect(state.objects[threat].zone).toBe('hand')
    expect(state.objects[answer].zone).toBe('graveyard')
    expect(state.stack).toHaveLength(0)
  })
})
