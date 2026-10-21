import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { captureObject } from '../../objectIdentity'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  chooseX,
  compileCardRuleDefinition,
  compareCharacteristic,
  evaluateObjectSelector,
  gainLife,
  greatest,
  objects,
  ref,
  select,
  spell,
  variable,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const creature = (name: string, extras: { power?: number; manaValue?: number } = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    power: extras.power ?? 2,
    toughness: extras.power ?? 2,
    ...(extras.manaValue !== undefined ? { manaValue: extras.manaValue } : {}),
  })

test('characteristic filters reject player life and require a declared X', () => {
  expect(() => compileCardRuleDefinition(card([spell({
    decisions: { targets: [select({
      filter: objects({ compareCharacteristic: { characteristic: 'life' as 'power', operator: 'lte', than: variable('X') } }),
      count: 1,
    })] },
    instructions: [],
  })]))).toThrow('numeric characteristic')
  expect(() => compileCardRuleDefinition(card([spell({
    decisions: { targets: [select({
      filter: objects({ compareCharacteristic: compareCharacteristic('manaValue', 'lte', variable('X')) }),
      count: 1,
    })] },
    instructions: [],
  })]))).toThrow('X is not declared')
})

test('mana-value filters compare against X at announcement', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({
      decisions: {
        variables: [chooseX()],
        targets: [select({
          filter: objects({
            zone: 'battlefield',
            type: 'Creature',
            compareCharacteristic: compareCharacteristic('manaValue', 'lte', variable('X')),
          }),
          count: 1,
        })],
      },
      instructions: [gainLife({ amount: 1, targets: ref('controller') })],
    }, '{X}')] },
    battlefield: {
      p2: [creature('Cheap', { manaValue: 2 }), creature('Dear', { manaValue: 3 })],
    },
  }, { random: () => 0 })
  server.state.players.p1.mana.C = 2
  const spellId = named(server.state, 'Instruction fixture').id
  expect(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: spellId, x: 2,
    targets: [{ kind: 'object', objectId: named(server.state, 'Dear').id }],
  }).ok).toBe(false)
  const cast = ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: spellId, x: 2,
    targets: [{ kind: 'object', objectId: named(server.state, 'Cheap').id }],
  }))
  expect(resolveStack(server.rules, cast).players.p1.life).toBe(41)
})

test('power filters include every creature tied for the greatest controlled power', () => {
  const server = createServerGame(commanderRules, {
    battlefield: {
      p1: [creature('Small', { power: 3 }), creature('Tied A', { power: 5 }), creature('Tied B', { power: 5 })],
      p2: [creature('Ignored', { power: 9 })],
    },
  }, { random: () => 0 })
  const source = server.state.objects[server.state.zoneOrder.p1.battlefield[0]!]!
  const context = { state: structuredClone(server.state), controller: 'p1' as const, source: captureObject(source) }
  const controlled = objects({ zone: 'battlefield', type: 'Creature', controller: 'you' })
  expect(evaluateObjectSelector(objects({
    ...controlled.filter,
    compareCharacteristic: compareCharacteristic('power', 'eq', greatest({
      of: controlled, characteristic: 'power', information: 'current',
    })),
  }), context).map(object => object.name).toSorted()).toEqual(['Tied A', 'Tied B'])
})

test("Black Sun's Twilight pumps an optional target and returns a graveyard creature of mana value X or less at five", () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate("Black Sun's Twilight")] },
    battlefield: {
      p1: [creature('Cheap corpse', { manaValue: 4 }), creature('Dear corpse', { manaValue: 6 })],
      p2: [creature('Victim', { power: 6 })],
    },
  }, { random: () => 0 })
  let ready = structuredClone(server.state)
  ready = ok(server.rules(ready, { type: 'move', objectId: named(ready, 'Cheap corpse').id, to: 'graveyard' }))
  ready = ok(server.rules(ready, { type: 'move', objectId: named(ready, 'Dear corpse').id, to: 'graveyard' }))
  ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 5 }

  const four = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell', seat: 'p1', objectId: named(ready, "Black Sun's Twilight").id, x: 4,
    targets: [{ kind: 'object', objectId: named(ready, 'Victim').id }],
  })))
  expect(named(four, 'Victim')).toMatchObject({ power: 2, toughness: 2 })
  expect(pendingSelectionFor(four, 'p1')).toBeUndefined()
  expect(named(four, 'Cheap corpse').zone).toBe('graveyard')

  const choosing = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell', seat: 'p1', objectId: named(ready, "Black Sun's Twilight").id, x: 5,
    targets: [{ kind: 'object', objectId: named(ready, 'Victim').id }],
  })))
  const pending = pendingSelectionFor(choosing, 'p1')!
  expect(named(choosing, 'Victim')).toMatchObject({ power: 1, toughness: 1 })
  expect(pending.candidates).toEqual([named(choosing, 'Cheap corpse').id])
  const returned = ok(server.rules(choosing, {
    type: 'selectCards', seat: 'p1', kind: 'choose', count: pending.count, objectIds: pending.candidates,
  }))
  expect(named(returned, 'Cheap corpse')).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(named(returned, 'Dear corpse').zone).toBe('graveyard')
})
