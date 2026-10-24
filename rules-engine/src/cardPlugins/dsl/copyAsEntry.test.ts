import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  copyAsEntry,
  createDefinitionSnapshot,
  objects,
  staticAbility,
} from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

const clone = (except?: Parameters<typeof copyAsEntry>[0]['except']) =>
  cardTemplate('Clone fixture', {
    types: ['Creature'],
    power: 0,
    toughness: 0,
    ruleDefinition: snapshot([staticAbility(copyAsEntry({
      filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you', other: true }),
      ...(except ? { except } : {}),
      creatureCounters: 1,
    }))]),
  })

describe('copy as entry', () => {
  test('an optional clone copies another creature you control with extra counters', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [clone({ notLegendary: true })] },
      battlefield: { p1: [cardTemplate('Original', {
        types: ['Creature'],
        supertypes: ['Legendary'],
        subtypes: ['Human'],
        power: 2,
        toughness: 2,
      })] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    expect(paused.objects[id].zone).not.toBe('battlefield')
    const original = named(paused, 'Original')
    const picked = ok(server.rules(paused, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pendingSelectionFor(paused, 'p1')!.id,
      kind: 'choose',
      count: 1,
      objectIds: [original.id],
    }))
    expect(picked.objects[id]).toMatchObject({
      zone: 'battlefield',
      name: 'Original',
      subtypes: ['Human'],
      supertypes: [],
      counters: { '+1/+1': 1 },
      power: 3,
      toughness: 3,
    })
  })

  test('declining a clone leaves the printed creature', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Clone fixture', {
        types: ['Creature'],
        power: 1,
        toughness: 1,
        ruleDefinition: snapshot([staticAbility(copyAsEntry({
          filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you', other: true }),
        }))]),
      })] },
      battlefield: { p1: [cardTemplate('Original', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const pending = pendingSelectionFor(paused, 'p1')!
    const resolved = ok(server.rules(paused, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pending.id,
      kind: 'choose',
      count: pending.count,
      objectIds: [],
    }))
    expect(resolved.objects[id]).toMatchObject({ zone: 'battlefield', name: 'Clone fixture', power: 1, toughness: 1 })
  })
})
