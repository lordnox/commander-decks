import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { counter, select, stackItems, target } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

const originCounter = (filter: Parameters<typeof stackItems>[0]) =>
  instructionSpell({
    decisions: { targets: [select({ filter: stackItems(filter), count: 1 })] },
    instructions: [counter({ targets: target(0) })],
  })

test('stack filters distinguish command-zone casts from hand casts', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    command: { p1: [cardTemplate('Commander fixture', { types: ['Creature'], manaCost: '{0}', power: 2, toughness: 2, tags: ['commander'] })] },
    hands: {
      p1: [originCounter({ kind: 'spell', castFrom: 'command', other: true })],
      p2: [cardTemplate('Hand spell', { types: ['Instant'], manaCost: '{0}' })],
    },
  }, { random: () => 0 })
  const commander = named(server.state, 'Commander fixture')
  let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: commander.id })
  expect(state.stack[0].castFrom).toBe('command')
  const fromCommand = named(state, 'Instruction fixture')
  const commandTarget = { kind: 'stackItem' as const, stackId: state.stack.find(item => item.objectId === commander.id)!.id }
  expect(server.rules(state, {
    type: 'castSpell', seat: 'p1', objectId: fromCommand.id, targets: [commandTarget],
  }).ok).toBe(true)
  state.priority = 'p2'
  const handSpell = named(state, 'Hand spell')
  const fromHand = reduce(server, state, { type: 'castSpell', seat: 'p2', objectId: handSpell.id })
  expect(fromHand.stack[0].castFrom).toBe('hand')
  expect(server.rules(fromHand, {
    type: 'castSpell', seat: 'p1', objectId: fromCommand.id,
    targets: [{ kind: 'stackItem', stackId: fromHand.stack.find(item => item.objectId === handSpell.id)!.id }],
  }).ok).toBe(false)
})

test('stack filters can require the owner of the stacked card', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [
        originCounter({ kind: 'spell', owner: 'opponent', other: true }),
        cardTemplate('Own instant', { types: ['Instant'], manaCost: '{0}' }),
      ],
      p2: [cardTemplate('Opp instant', { types: ['Instant'], manaCost: '{0}' })],
    },
  }, { random: () => 0 })
  const own = named(server.state, 'Own instant')
  const opp = named(server.state, 'Opp instant')
  const counterspell = named(server.state, 'Instruction fixture')
  let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: own.id })
  expect(server.rules(state, {
    type: 'castSpell', seat: 'p1', objectId: counterspell.id,
    targets: [{ kind: 'stackItem', stackId: state.stack[0].id }],
  }).ok).toBe(false)
  state = structuredClone(server.state)
  state.priority = 'p2'
  state = reduce(server, state, { type: 'castSpell', seat: 'p2', objectId: opp.id })
  state.priority = 'p1'
  const cast = reduce(server, state, {
    type: 'castSpell', seat: 'p1', objectId: counterspell.id,
    targets: [{ kind: 'stackItem', stackId: state.stack[0].id }],
  })
  const resolved = reduce(server, cast, { type: 'resolveTop' })
  expect(resolved.objects[opp.id].zone).toBe('graveyard')
})
