import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { instructionSpell } from '../cardPlugins/dsl/instructionTestSupport'
import { copyEffect, createEffect, objects, select, target, untilCleanup } from '../cardPlugins/dsl/v1'
import { WORLD_SUPERTYPE } from './worldSupertype'

const world = (name: string) => cardTemplate(name, { types: ['Enchantment'], supertypes: [WORLD_SUPERTYPE] })
const artifact = (name: string) => cardTemplate(name, { types: ['Artifact'] })

// Every artifact becomes a copy of the targeted World permanent until cleanup.
const copyWorldOntoArtifacts = () => instructionSpell({
  decisions: { targets: [select({ filter: objects({ zone: 'battlefield', supertypes: [WORLD_SUPERTYPE] }), count: 1 })] },
  instructions: [createEffect({
    targets: objects({ zone: 'battlefield', type: 'Artifact' }),
    effect: copyEffect({ of: target(0) }),
    duration: untilCleanup(),
  })],
})

const named = (state: GameState, name: string) => Object.values(state.objects).find(object =>
  (object.printedName ?? object.name) === name)!

const zoneOf = (state: GameState, name: string) => named(state, name).zone

const setup = (battlefield: string[], hand: { worlds?: string[]; copies?: number } = {}) =>
  createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: battlefield.map(name => name.startsWith('World') ? world(name) : artifact(name)) },
    hands: { p1: [
      ...(hand.worlds ?? []).map(world),
      ...Array.from({ length: hand.copies ?? 0 }, copyWorldOntoArtifacts),
    ] },
  }, { random: () => 0 })

type Server = ReturnType<typeof setup>

const enter = (server: Server, state: GameState, name: string) =>
  ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'battlefield' }))

const castCopy = (server: Server, state: GameState, worldName: string) => {
  const spell = state.zoneOrder.p1.hand.find(id => state.objects[id].name === 'Instruction fixture')!
  return resolveStack(server.rules, ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: spell,
    targets: [{ kind: 'object', objectId: named(state, worldName).id }],
  })))
}

test('the world rule keeps only the most recently entered world and loses every tied one', () => {
  const server = setup(['World older'], { worlds: ['World newer'] })
  const entered = enter(server, server.state, 'World newer')
  expect(zoneOf(entered, 'World older')).toBe('graveyard')
  expect(zoneOf(entered, 'World newer')).toBe('battlefield')

  const tied = setup(['World setup A', 'World setup B'])
  const checked = ok(tied.rules(tied.state, { type: 'addMana', seat: 'p1', mana: {} }))
  expect(zoneOf(checked, 'World setup A')).toBe('graveyard')
  expect(zoneOf(checked, 'World setup B')).toBe('graveyard')
})

test('an older permanent that becomes a world copy has had the supertype for the shortest time', () => {
  const server = setup(['Old artifact'], { worlds: ['World original'], copies: 1 })
  const entered = enter(server, server.state, 'World original')
  // JSON restore keeps the acquisition timestamps that decide the world rule.
  const restored = JSON.parse(JSON.stringify(entered)) as GameState
  expect(named(restored, 'World original').worldTimestamp).toBe(named(entered, 'World original').worldTimestamp)

  const copied = castCopy(server, restored, 'World original')
  expect(named(copied, 'Old artifact')).toMatchObject({ zone: 'battlefield', supertypes: [WORLD_SUPERTYPE] })
  expect(zoneOf(copied, 'World original')).toBe('graveyard')
})

test('permanents acquiring the world supertype simultaneously tie and all leave', () => {
  const server = setup(['Artifact A', 'Artifact B'], { worlds: ['World original'], copies: 1 })
  const copied = castCopy(server, enter(server, server.state, 'World original'), 'World original')
  expect(named(copied, 'Artifact A').worldTimestamp).toBeUndefined()
  for (const name of ['Artifact A', 'Artifact B', 'World original']) expect(zoneOf(copied, name)).toBe('graveyard')
})

test('losing the world supertype resets its duration when it is acquired again', () => {
  const server = setup(['Old artifact'], { worlds: ['World first', 'World second'], copies: 2 })
  const copied = castCopy(server, enter(server, server.state, 'World first'), 'World first')
  const first = named(copied, 'Old artifact').worldTimestamp!
  expect(zoneOf(copied, 'World first')).toBe('graveyard')

  const cleanup = ok(server.rules({ ...copied, step: 'end', priority: 'p1' }, { type: 'advanceStep' }))
  expect(named(cleanup, 'Old artifact').supertypes).toEqual([])
  expect(named(cleanup, 'Old artifact').worldTimestamp).toBeUndefined()

  const second = enter(server, cleanup, 'World second')
  const recopied = castCopy(server, { ...second, priority: second.active }, 'World second')
  expect(named(recopied, 'Old artifact').worldTimestamp).toBeGreaterThan(first)
  expect(zoneOf(recopied, 'Old artifact')).toBe('battlefield')
  expect(zoneOf(recopied, 'World second')).toBe('graveyard')
})

test('phasing does not reset how long a permanent has had the world supertype', () => {
  const server = setup([], { worlds: ['World phased', 'World present'] })
  const first = enter(server, server.state, 'World phased')
  const phased = ok(server.rules(first, { type: 'phaseOut', objectId: named(first, 'World phased').id }))
  const both = enter(server, phased, 'World present')
  expect(zoneOf(both, 'World phased')).toBe('battlefield')

  const returned = ok(server.rules(both, { type: 'phaseIn', objectId: named(both, 'World phased').id }))
  expect(zoneOf(returned, 'World phased')).toBe('graveyard')
  expect(zoneOf(returned, 'World present')).toBe('battlefield')
})
