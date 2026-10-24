import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import {
  captureCopy,
  capturePlayer,
  controllerOf,
  copy,
  move,
  objects,
  players,
  resultPlayer,
  select,
  target,
} from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

const copiesOf = (state: GameState, name: string) =>
  Object.values(state.objects).filter(object => object.name === name && object.token && object.zone === 'battlefield')

test('captured copy snapshots survive exile and iterate every other player', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })] },
      instructions: [
        captureCopy({ targets: target(0), bindResult: 'copied' }),
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'copiedController' }),
        move({ targets: target(0), to: 'exile' }),
        copy({ snapshot: 'copied', controller: players({ not: { relation: resultPlayer('copiedController') } }) }),
      ],
    })] },
    battlefield: { p2: [cardTemplate('Borrowed Titan', { types: ['Creature'], power: 6, toughness: 6 })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  const targetId = named(ready, 'Borrowed Titan').id
  const resolved = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: targetId }],
  })))
  expect(resolved.objects[targetId].zone).toBe('exile')
  expect(copiesOf(resolved, 'Borrowed Titan').map(copy => copy.controller).sort()).toEqual(['p1', 'p3', 'p4'])
})

test('a captured token snapshot still copies after the token ceases', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] },
      instructions: [
        captureCopy({ targets: target(0), bindResult: 'copied' }),
        capturePlayer({ player: controllerOf(target(0)), bindResult: 'copiedController' }),
        move({ targets: target(0), to: 'exile' }),
        copy({ snapshot: 'copied', controller: players({ not: { relation: resultPlayer('copiedController') } }) }),
      ],
    })] },
    battlefield: { p2: [cardTemplate('Spirit', { types: ['Creature'], power: 1, toughness: 1, token: true })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(server.state, 'Spirit').id }],
  })))
  expect(Object.values(resolved.objects).some(object => object.name === 'Spirit' && !object.token)).toBe(false)
  const copies = copiesOf(resolved, 'Spirit')
  expect(copies).toHaveLength(1)
  expect(copies[0]?.controller).toBe('p1')
})
