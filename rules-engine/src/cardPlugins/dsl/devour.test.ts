import { describe, expect, test } from 'bun:test'
import {
  card,
  characteristic,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  devour,
  gainLife,
  redirectEvent,
  ref,
  replacement,
  self,
  staticAbility,
  whenever,
  wouldMove,
} from './v1'
import { resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import type { GameState, Plugin, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

const snapshot = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const devourer = (countersPer: number = 1, types: readonly string[] = ['Creature']) =>
  cardTemplate('Devourer', {
    types: ['Creature'],
    power: 0,
    toughness: 0,
    ruleDefinition: snapshot([
      staticAbility(devour(countersPer, types)),
      whenever(self.enters, {
        instructions: [gainLife({
          targets: ref('controller'),
          amount: characteristic(ref('triggering.object.after'), 'power', { information: 'currentOrLastKnown' }),
        })],
      }),
    ]),
  })

const offering = (name: string, types: readonly string[] = ['Creature']) =>
  cardTemplate(name, { types: [...types], power: 1, toughness: 1 })

const chooseOfferings = (server: ReturnType<typeof createServerGame>, state: GameState, ids: string[]) => {
  const selection = pendingSelectionFor(state, 'p1')!
  const answer = { type: 'selectCards' as const, seat: 'p1' as const, selectionId: selection.id, kind: 'choose' as const, count: selection.count, objectIds: ids }
  const direct = ok(server.rules(state, answer))
  expect(ok(server.rules(JSON.parse(JSON.stringify(state)), answer))).toEqual(direct)
  return direct
}

describe('devour', () => {
  test.each([0, 1, 3])('optional creature devour binds actual sacrifices into entry counters (%s selected)', number => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [devourer(2)] },
      battlefield: { p1: Array.from({ length: 3 }, (_, i) => offering(`Offering ${i}`)) },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    expect(paused.objects[id].zone).not.toBe('battlefield')
    const picked = pendingSelectionFor(paused, 'p1')!.candidates.slice(0, number)
    let state = chooseOfferings(server, paused, picked)
    if (number === 0) {
      expect(state.objects[id].zone).toBe('graveyard')
      expect(state.zoneOrder.p1.battlefield.filter(objectId => state.objects[objectId].name.startsWith('Offering'))).toHaveLength(3)
    } else {
      expect(state.objects[id]).toMatchObject({
        zone: 'battlefield',
        counters: { '+1/+1': number * 2 },
        power: number * 2,
        toughness: number * 2,
      })
      expect(state.zoneOrder.p1.battlefield.filter(objectId => state.objects[objectId].name.startsWith('Offering'))).toHaveLength(3 - number)
      state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
      expect(state.players.p1.life).toBe(40 + number * 2)
    }
  })

  test('land devour ignores creatures and multiplies by N', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [devourer(3, ['Land'])] },
      battlefield: { p1: [offering('Beast'), offering('Forest', ['Land']), offering('Island', ['Land'])] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const pick = pendingSelectionFor(paused, 'p1')!
    expect(pick.candidates.map(objectId => paused.objects[objectId].name).sort()).toEqual(['Forest', 'Island'])
    const state = chooseOfferings(server, paused, pick.candidates)
    expect(state.objects[id]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 6 }, power: 6, toughness: 6 })
    expect(named(state, 'Beast').zone).toBe('battlefield')
    expect(named(state, 'Forest').zone).toBe('graveyard')
    expect(named(state, 'Island').zone).toBe('graveyard')
  })

  test('a resolving spell still counts emitted devour sacrifices into entry counters', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Devourer', {
        types: ['Creature'],
        manaCost: '{0}',
        manaValue: 0,
        power: 0,
        toughness: 0,
        ruleDefinition: snapshot([staticAbility(devour(3, ['Land']))]),
      })] },
      battlefield: { p1: [offering('Forest', ['Land']), offering('Island', ['Land'])] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id })), { type: 'resolveTop' }))
    const state = chooseOfferings(server, paused, pendingSelectionFor(paused, 'p1')!.candidates)
    expect(state.objects[id]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 6 }, power: 6, toughness: 6 })
    expect(named(state, 'Forest').zone).toBe('graveyard')
  })

  test('the entering creature is not a legal devour sacrifice', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [devourer()] },
      battlefield: { p1: [offering('Offering')] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    expect(pendingSelectionFor(paused, 'p1')!.candidates).toEqual([named(paused, 'Offering').id])
  })

  test('tokens and redirected graveyard moves still count toward devour', () => {
    const replacementFor = (name: string) => cardTemplate(name, {
      types: ['Enchantment'],
      ruleDefinition: snapshot([
        staticAbility(replacement(wouldMove({ object: { zone: 'battlefield' }, to: 'graveyard' }), redirectEvent('exile'))),
      ]),
    })
    const server = createServerGame(commanderRules, {
      hands: { p1: [devourer(1)] },
      battlefield: { p1: [
        cardTemplate('Token offering', { types: ['Creature'], token: true, power: 1, toughness: 1 }),
        offering('Indestructible offering'),
        replacementFor('Exile replacement'),
      ] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const pick = pendingSelectionFor(paused, 'p1')!
    expect(pick.candidates).toHaveLength(2)
    const state = chooseOfferings(server, paused, pick.candidates)
    expect(state.objects[id]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 2 }, power: 2, toughness: 2 })
    expect(named(state, 'Indestructible offering').zone).toBe('exile')
  })

  test('a suppressed selected sacrifice does not add devour counters', () => {
    const prevent: Plugin = {
      id: 'fixture.preventSacrifice',
      replace: ({ event, state }) => event.type === 'sacrifice' && state.objects[event.objectId]?.name === 'Prevented' ? null : undefined,
    }
    const server = createServerGame(commanderRules, {
      hands: { p1: [devourer(1)] },
      battlefield: { p1: [offering('Performed'), offering('Prevented')] },
    }, { random: () => 0, cardPlugins: [prevent] })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const state = chooseOfferings(server, paused, pendingSelectionFor(paused, 'p1')!.candidates)
    expect(state.objects[id]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 1 }, power: 1, toughness: 1 })
    expect(named(state, 'Performed').zone).toBe('graveyard')
    expect(named(state, 'Prevented').zone).toBe('battlefield')
  })

  test('entry counters from devour are present before ETB observers', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [devourer(1)] },
      battlefield: { p1: [offering('Offering')] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.hand[0]!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    let state = chooseOfferings(server, paused, pendingSelectionFor(paused, 'p1')!.candidates)
    expect(state.objects[id]).toMatchObject({ zone: 'battlefield', power: 1, toughness: 1 })
    state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
    expect(state.players.p1.life).toBe(41)
  })
})
