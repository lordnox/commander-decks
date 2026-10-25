import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import {
  captureAmount,
  choice,
  chooseCards,
  chooseRandom,
  compareAmount,
  copy,
  count,
  createToken,
  move,
  objects,
  putCounters,
  ref,
  repeatWhile,
  resultAmount,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const permanents = {
  any: [{ type: 'Artifact' }, { type: 'Battle' }, { type: 'Creature' }, { type: 'Enchantment' }, { type: 'Land' }, { type: 'Planeswalker' }],
}

const exileCopy = [
  chooseRandom({
    filter: objects({ zone: 'graveyard', owner: 'you', any: permanents.any }),
    bindChoice: 'picked',
  }),
  copy({ targets: choice('picked'), tapped: true, bindChoice: 'copied' }),
  captureAmount({
    amount: count(objects({ among: choice('picked'), type: 'Land' })),
    bindResult: 'wasLand',
  }),
  move({ targets: choice('picked'), to: 'exile' }),
]

test('chooseRandom binds an empty set and continues when nothing qualifies', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: exileCopy })] },
    battlefield: { p1: [cardTemplate('Forest', { types: ['Land'] })] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  expect(Object.values(state.objects).filter(object => object.token)).toEqual([])
  expect(state.resolution).toBeUndefined()
})

test('chooseRandom persists the journaled pick across restore', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      chooseRandom({
        filter: objects({ zone: 'graveyard', owner: 'you', any: permanents.any }),
        bindChoice: 'exiled',
      }),
      chooseCards({
        chooser: ref('controller'),
        bindChoice: 'ignored',
        filter: objects({ zone: 'hand', owner: 'you' }),
        min: 0,
        max: 1,
      }),
      move({ targets: choice('exiled'), to: 'exile' }),
    ] }),
    cardTemplate('Spare', { types: ['Instant'] }),
    cardTemplate('First', { types: ['Creature'], zone: 'graveyard' }),
    cardTemplate('Second', { types: ['Land'], zone: 'graveyard' }),
    ] },
  }, { random: () => 0 })
  const paused = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  const pick = pendingSelectionFor(paused, 'p1')!
  const spare = named(paused, 'Spare').id
  const event = { type: 'selectCards' as const, seat: 'p1' as const, selectionId: pick.id, kind: 'choose' as const, count: pick.count, objectIds: pick.count === 0 ? [] : [spare] }
  const direct = ok(server.rules(paused, event))
  const restored = ok(server.rules(JSON.parse(JSON.stringify(paused)), event))
  expect(restored).toEqual(direct)
  expect(named(direct, 'First').zone).toBe('exile')
  expect(named(direct, 'Second').zone).toBe('graveyard')
})

test.each([
  { types: ['Land', 'Land', 'Creature', 'Artifact'], copied: 3 },
  { types: ['Land', 'Land'], copied: 2 },
])('repeatWhile stops at a nonland or exhausted pool: $types', ({ types, copied }) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      ...exileCopy,
      repeatWhile({
        condition: compareAmount(resultAmount('wasLand'), 'gte', 1),
        instructions: exileCopy,
      }),
    ] }),
    ...types.map((type, index) => cardTemplate(`Buried ${index}`, {
      types: [type], zone: 'graveyard',
    })),
    cardTemplate('Excluded instant', { types: ['Instant'], zone: 'graveyard' }),
    ], p2: [cardTemplate('Other owner', { types: ['Land'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  const copies = Object.values(state.objects).filter(object => object.token)
  const exiled = Object.values(state.objects).filter(object => !object.token && object.zone === 'exile')
  expect(copies).toHaveLength(copied)
  expect(copies.map(object => object.name).toSorted()).toEqual(exiled.map(object => object.name).toSorted())
  expect(copies.filter(object => !object.types.includes('Land'))).toHaveLength(types.every(type => type === 'Land') ? 0 : 1)
  expect(copies.every(object => object.tapped && object.controller === 'p1')).toBe(true)
  expect(types.map((_, index) => named(state, `Buried ${index}`)).filter(object => object.zone === 'graveyard')).toHaveLength(types.length - copied)
  expect(named(state, 'Excluded instant').zone).toBe('graveyard')
  expect(named(state, 'Other owner').zone).toBe('graveyard')
  expect(state.resolution).toBeUndefined()
})

test('a tapped copy is already tapped when entry observers see it', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        cardTemplate('Amulet of Vigor'),
        cardTemplate('Source Forest', { types: ['Land'] }),
      ],
    },
    hands: { p1: [instructionSpell({ instructions: [copy({ targets: objects({ zone: 'battlefield', name: 'Source Forest' }), tapped: true })] })] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  const token = Object.values(state.objects).find(object => object.token && object.name === 'Source Forest')!
  expect(token.tapped).toBe(false)
})

test('createToken bindChoice names the new token rather than every similar permanent', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Saproling', { types: ['Creature'], token: true, power: 1, toughness: 1 })] },
    hands: { p1: [instructionSpell({ instructions: [
      createToken({
        count: 1,
        targets: ref('controller'),
        token: { name: 'Saproling', types: ['Creature'], power: 1, toughness: 1 },
        bindChoice: 'made',
      }),
      putCounters({ targets: choice('made'), counter: '+1/+1', count: 1 }),
    ] })] },
  }, { random: () => 0 })
  const existing = named(server.state, 'Saproling').id
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  const tokens = Object.values(state.objects).filter(object => object.name === 'Saproling' && object.zone === 'battlefield')
  expect(tokens).toHaveLength(2)
  expect(state.objects[existing].counters['+1/+1'] ?? 0).toBe(0)
  const created = tokens.find(object => object.id !== existing)!
  expect(created.counters['+1/+1']).toBe(1)
})
