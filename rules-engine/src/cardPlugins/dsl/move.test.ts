import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { loseLife, move, objects, ref, select, target } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const names = (state: GameState, zone: 'battlefield' | 'graveyard') =>
  state.zoneOrder.p1[zone].map((id) => state.objects[id].name)
const setup = () => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })] },
    instructions: [move({ targets: target(0), to: 'exile' }), loseLife({ amount: 3, targets: ref('controller') })],
  })] },
  battlefield: { p2: [cardTemplate('Legacy Bear', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Forest', { types: ['Land'] })] },
}, { random: () => 0 })

const cast = (server: ReturnType<typeof setup>, state = server.state, targetName = 'Legacy Bear') => ok(server.rules(state, {
  type: 'castSpell', seat: 'p1', objectId: named(state, 'Instruction fixture').id,
  targets: [{ kind: 'object', objectId: named(state, targetName).id }],
}))

test('move to exile continues with controller life loss exactly once', () => {
  const server = setup()
  const resolved = resolveStack(server.rules, cast(server))
  expect(named(resolved, 'Legacy Bear').zone).toBe('exile')
  expect(named(resolved, 'Instruction fixture').zone).toBe('graveyard')
  expect(resolved.players.p1.life).toBe(37)
  expect(resolved.players.p2.life).toBe(40)
})

test('move target filter rejects lands; illegal targets skip subsequent life loss', () => {
  const server = setup()
  expect(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(server.state, 'Forest').id }],
  }).ok).toBe(false)
  const pending = cast(server)
  const gone = ok(server.rules(pending, { type: 'move', objectId: named(pending, 'Legacy Bear').id, to: 'hand' }))
  const resolved = resolveStack(server.rules, gone)
  expect(resolved.players.p1.life).toBe(40)
  expect(named(resolved, 'Legacy Bear').zone).toBe('hand')
})

test('move with attacking object filter bounces only attacking permanents', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      instructions: [move({ targets: objects({ zone: 'battlefield', attacking: true }), to: 'hand' })],
    })] },
    battlefield: {
      p2: [
        cardTemplate('Attacker', { types: ['Creature'], power: 2, toughness: 2, attacking: 'p2' }),
        cardTemplate('Idle', { types: ['Creature'], power: 1, toughness: 1 }),
      ],
    },
  }, { random: () => 0 })
  const casted = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [],
  }))
  const resolved = resolveStack(server.rules, casted)
  expect(named(resolved, 'Attacker').zone).toBe('hand')
  expect(named(resolved, 'Idle').zone).toBe('battlefield')
})

test('move and life-loss program restores before resolution', () => {
  const server = setup()
  const pending = cast(server)
  const restored = restoreJournal(createJournal(pending), server.rules)
  expect(resolveStack(server.rules, restored.current())).toEqual(resolveStack(server.rules, pending))
})

test('move onto the battlefield with tapped enters tapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      instructions: [move({
        targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
        to: 'battlefield',
        tapped: true,
      })],
    })] },
    libraries: {
      p1: [
        cardTemplate('Milled Forest', { types: ['Land'], zone: 'graveyard' }),
        cardTemplate('Milled Mountain', { types: ['Land'], zone: 'graveyard' }),
        cardTemplate('Milled Spell', { types: ['Instant'], zone: 'graveyard' }),
      ],
    },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [],
  })))
  expect(names(resolved, 'battlefield').sort()).toEqual(['Milled Forest', 'Milled Mountain'])
  expect(names(resolved, 'graveyard')).toContain('Milled Spell')
  expect(resolved.zoneOrder.p1.battlefield.every((id) => resolved.objects[id].tapped)).toBe(true)
})

test('move onto the battlefield without tapped leaves a land untapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      instructions: [move({
        targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
        to: 'battlefield',
      })],
    })] },
    libraries: { p1: [cardTemplate('Milled Island', { types: ['Land'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [],
  })))
  expect(named(resolved, 'Milled Island').tapped).toBe(false)
})

test('kernel move events honor tapped on battlefield enter', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    libraries: { p1: [cardTemplate('Direct Forest', { types: ['Land'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const landId = server.state.zoneOrder.p1.graveyard[0]
  const moved = ok(server.rules(server.state, {
    type: 'move',
    objectId: landId,
    to: 'battlefield',
    tapped: true,
  }))
  expect(moved.objects[landId].tapped).toBe(true)
})
