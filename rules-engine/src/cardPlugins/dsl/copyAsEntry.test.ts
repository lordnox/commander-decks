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
  keyword,
  legendRuleOff,
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

const walkerCopyingCreature = () => cardTemplate('Walker copy fixture', {
  types: ['Planeswalker'],
  printedLoyalty: 3,
  ruleDefinition: snapshot([staticAbility(copyAsEntry({
    filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you', other: true }),
  }))]),
})

const copyWalkerAsCreature = (enterCounters?: Readonly<Record<string, number>>) => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [walkerCopyingCreature()] },
    battlefield: { p1: [cardTemplate('Creature original', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  const paused = ok(server.rules(server.state, {
    type: 'move', objectId: id, to: 'battlefield', ...(enterCounters ? { enterCounters } : {}),
  }))
  const original = named(paused, 'Creature original')
  return ok(server.rules(paused, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: pendingSelectionFor(paused, 'p1')!.id,
    kind: 'choose',
    count: 1,
    objectIds: [original.id],
  })).objects[id]
}

describe('copy as entry', () => {
  test('a planeswalker copied into a creature does not keep printed loyalty counters', () => {
    const copied = copyWalkerAsCreature()

    expect(copied.types).toEqual(['Creature'])
    expect(copied.counters).not.toHaveProperty('loyalty')
  })

  test('explicit entry loyalty counters survive a copy that becomes a creature', () => {
    const copied = copyWalkerAsCreature({ loyalty: 2 })

    expect(copied.types).toEqual(['Creature'])
    expect(copied.counters.loyalty).toBe(2)
  })

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

  test('kept abilities exclude the clone-as-entry replacement', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Keep-abilities clone', {
        types: ['Creature'],
        power: 0,
        toughness: 0,
        ruleDefinition: snapshot([
          staticAbility(copyAsEntry({
            filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'you', other: true }),
            except: { keepAbilities: true },
          })),
          staticAbility(legendRuleOff()),
          keyword.partner,
        ]),
      })] },
      battlefield: { p1: [cardTemplate('Original', {
        types: ['Creature'],
        subtypes: ['Human'],
        power: 2,
        toughness: 2,
      })] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
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
      printedName: 'Keep-abilities clone',
      subtypes: ['Human'],
    })
    expect(picked.objects[id].ruleDefinition?.definition.abilities).toMatchObject([
      { kind: 'static', effects: [{ kind: 'legendRuleOff' }] },
      { kind: 'keyword', keyword: 'partner' },
    ])
  })

  test('Spark Double copying a planeswalker enters with an extra loyalty counter', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Spark Double')] },
      battlefield: { p1: [cardTemplate('Walker', {
        types: ['Planeswalker'],
        subtypes: ['Ugin'],
        printedLoyalty: 3,
        counters: { loyalty: 3 },
      })] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const walker = named(paused, 'Walker')
    const picked = ok(server.rules(paused, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pendingSelectionFor(paused, 'p1')!.id,
      kind: 'choose',
      count: 1,
      objectIds: [walker.id],
    }))
    expect(picked.objects[id]).toMatchObject({
      zone: 'battlefield',
      name: 'Walker',
      types: ['Planeswalker'],
      subtypes: ['Ugin'],
      printedLoyalty: 3,
      counters: { loyalty: 4 },
    })
  })
})
