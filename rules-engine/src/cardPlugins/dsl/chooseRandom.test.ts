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
  card,
  choice,
  chooseCards,
  chooseRandom,
  compareAmount,
  copy,
  count,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createToken,
  draw,
  move,
  objects,
  putCounters,
  ref,
  repeatWhile,
  resultAmount,
  self,
  whenever,
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

const repeatExileCopy = [
  ...exileCopy,
  repeatWhile({
    condition: compareAmount(resultAmount('wasLand'), 'gte', 1),
    instructions: exileCopy,
  }),
]

const randomCopyTrigger = createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(self.enters, { instructions: repeatExileCopy }),
  whenever(self.attacks, { instructions: repeatExileCopy }),
])))

const randomCopyWatcher = (extra = {}) => cardTemplate('Random copy watcher', {
  types: ['Creature'],
  power: 3,
  toughness: 3,
  ruleDefinition: randomCopyTrigger,
  ...extra,
})

test('triggered random copies repeat over lands, stop at a nonland, and enter tapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      randomCopyWatcher(),
      cardTemplate('First Land', { types: ['Land'], zone: 'graveyard' }),
      cardTemplate('Second Land', { types: ['Land'], zone: 'graveyard' }),
      cardTemplate('Relic', { types: ['Artifact'], zone: 'graveyard' }),
    ] },
  }, { random: () => 0 })
  const source = named(server.state, 'Random copy watcher')
  const entered = ok(server.rules(server.state, { type: 'move', objectId: source.id, to: 'battlefield' }))
  expect(entered.stack[0]?.kind).toBe('ability')
  const state = resolveStack(server.rules, entered)
  expect(state.zoneOrder.p1.exile.map(id => state.objects[id].name)).toEqual(['First Land', 'Second Land', 'Relic'])
  expect(state.zoneOrder.p1.battlefield.map(id => state.objects[id].name)).toEqual([
    'Random copy watcher', 'First Land', 'Second Land', 'Relic',
  ])
  expect(Object.values(state.objects).filter(object => object.token).every(object => object.tapped)).toBe(true)
})

test('the first random nonland ends the triggered repetition', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      randomCopyWatcher(),
      cardTemplate('Relic', { types: ['Artifact'], zone: 'graveyard' }),
      cardTemplate('Later Land', { types: ['Land'], zone: 'graveyard' }),
    ] },
  }, { random: () => 0 })
  const source = named(server.state, 'Random copy watcher')
  const entered = ok(server.rules(server.state, { type: 'move', objectId: source.id, to: 'battlefield' }))
  const state = resolveStack(server.rules, entered)
  expect(state.zoneOrder.p1.exile.map(id => state.objects[id].name)).toEqual(['Relic'])
  expect(state.zoneOrder.p1.graveyard.map(id => state.objects[id].name)).toEqual(['Later Land'])
  expect(state.zoneOrder.p1.battlefield.map(id => state.objects[id].name)).toEqual(['Random copy watcher', 'Relic'])
})

test('an attack trigger uses the same random-copy program', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [randomCopyWatcher({ summoningSickness: false })] },
    hands: { p1: [cardTemplate('Relic', { types: ['Artifact'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const source = named(server.state, 'Random copy watcher')
  const ready = { ...structuredClone(server.state), active: 'p1' as const, priority: 'p1' as const, step: 'declareAttackers' as const }
  const attacking = ok(server.rules(ready, {
    type: 'declareAttackers', seat: 'p1',
    attackers: [{ objectId: source.id, defender: 'p2' }],
  }))
  expect(attacking.stack[0]?.kind).toBe('ability')
  const state = resolveStack(server.rules, attacking)
  expect(state.zoneOrder.p1.exile.map(id => state.objects[id].name)).toEqual(['Relic'])
  expect(state.zoneOrder.p1.battlefield.map(id => state.objects[id].name)).toEqual(['Random copy watcher', 'Relic'])
})

test('the entry trigger resolves harmlessly when no owned permanent qualifies', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [randomCopyWatcher()] },
  }, { random: () => 0 })
  const source = named(server.state, 'Random copy watcher')
  const entered = ok(server.rules(server.state, { type: 'move', objectId: source.id, to: 'battlefield' }))
  expect(entered.stack[0]?.kind).toBe('ability')
  const state = resolveStack(server.rules, entered)
  expect(state.zoneOrder.p1.battlefield.map(id => state.objects[id].name)).toEqual(['Random copy watcher'])
  expect(state.zoneOrder.p1.exile).toEqual([])
})

test('casting the source puts its enter trigger on the stack after it resolves', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [randomCopyWatcher({ manaCost: '{1}', manaValue: 1 }), cardTemplate('Relic', { types: ['Artifact'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.step = 'precombatMain'
  ready.players.p1.mana.C = 1
  const source = named(ready, 'Random copy watcher')
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: source.id }))
  const entered = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(entered.objects[source.id]?.zone).toBe('battlefield')
  expect(entered.stack[0]?.kind).toBe('ability')
  const state = resolveStack(server.rules, entered)
  expect(state.zoneOrder.p1.exile.map(id => state.objects[id].name)).toEqual(['Relic'])
})

test('a copied permanent keeps and executes its stamped canonical ability', () => {
  const drawOnEntry = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(self.enters, { instructions: [draw({ count: 1, targets: ref('controller') })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [randomCopyWatcher(), cardTemplate('Value Relic', { types: ['Artifact'], ruleDefinition: drawOnEntry, zone: 'graveyard' })] },
    libraries: { p1: [cardTemplate('Fresh Card', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const source = named(server.state, 'Random copy watcher')
  const entered = ok(server.rules(server.state, { type: 'move', objectId: source.id, to: 'battlefield' }))
  const state = resolveStack(server.rules, entered)
  const copy = Object.values(state.objects).find(object => object.token && object.name === 'Value Relic')!
  expect(copy.ruleDefinition).toEqual(drawOnEntry)
  expect(state.zoneOrder.p1.hand.map(id => state.objects[id].name)).toEqual(['Fresh Card'])
})

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
  { types: ['Artifact', 'Creature'], copied: 1 },
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
