import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const battlefieldNamed = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name && object.zone === 'battlefield')

const thragtuskCard = () => cardTemplate('Thragtusk', { types: ['Creature'], power: 5, toughness: 3 })

const expectBeast = (state: GameState, controller: 'p1' | 'p2' = 'p1') => {
  const beasts = battlefieldNamed(state, 'Beast')
  expect(beasts).toHaveLength(1)
  expect(beasts[0]?.token).toBe(true)
  expect(beasts[0]?.power).toBe(3)
  expect(beasts[0]?.toughness).toBe(3)
  expect(beasts[0]?.controller).toBe(controller)
}

const leaveThragtusk = (to: 'graveyard' | 'hand' | 'exile') => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [thragtuskCard()] },
  }, { random: () => 0 })
  const left = ok(server.rules(server.state, {
    type: 'move',
    objectId: named(server.state, 'Thragtusk').id,
    to,
  }))
  expect(left.stack).toHaveLength(1)
  return resolveStack(server.rules, left)
}

describe('cardRuleCatalog — damageAndLeaves', () => {
  test('Flame Rift deals four damage to each player once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Flame Rift', { types: ['Sorcery'], manaCost: '{0}' })] },
    }, { random: () => 0 })
    const rift = named(server.state, 'Flame Rift')
    expect(rift.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Flame Rift'))
    expect(rift.effects).toEqual([])
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: rift.id }))
    expect(cast.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.players.p1.life).toBe(36)
    expect(resolved.players.p2.life).toBe(36)
    expect(resolved.objects[rift.id].zone).toBe('graveyard')
  })

  test('Thragtusk catalog watches leaves rather than dies', () => {
    const snapshot = cardRuleDefinitionSnapshotFor('Thragtusk')!
    expect(snapshot.definition.abilities[1]).toMatchObject({
      kind: 'triggered',
      on: { kind: 'leaves' },
      instructions: [{
        kind: 'createToken',
        targets: { kind: 'contextRef', name: 'controller' },
      }],
    })
  })

  test('Thragtusk gains five life on entry and makes one Beast when it goes to the graveyard', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [thragtuskCard()] },
    }, { random: () => 0 })
    const thragtusk = named(server.state, 'Thragtusk')
    expect(thragtusk.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Thragtusk'))
    expect(thragtusk.effects).toEqual([])
    const entered = ok(server.rules(server.state, { type: 'move', objectId: thragtusk.id, to: 'battlefield' }))
    expect(entered.stack).toHaveLength(1)
    const afterEntry = resolveStack(server.rules, entered)
    expect(afterEntry.players.p1.life).toBe(45)
    expect(battlefieldNamed(afterEntry, 'Beast')).toHaveLength(0)

    const left = ok(server.rules(afterEntry, {
      type: 'move',
      objectId: named(afterEntry, 'Thragtusk').id,
      to: 'graveyard',
    }))
    expect(left.stack).toHaveLength(1)
    const afterLeave = resolveStack(server.rules, left)
    expect(afterLeave.players.p1.life).toBe(45)
    expectBeast(afterLeave)
    expect(named(afterLeave, 'Thragtusk').zone).toBe('graveyard')
  })

  test('Thragtusk makes one Beast when it is bounced to hand', () => {
    const afterBounce = leaveThragtusk('hand')
    expectBeast(afterBounce)
    expect(named(afterBounce, 'Thragtusk').zone).toBe('hand')
  })

  test('Thragtusk makes one Beast when it is exiled', () => {
    const afterExile = leaveThragtusk('exile')
    expectBeast(afterExile)
    expect(named(afterExile, 'Thragtusk').zone).toBe('exile')
  })

  test('journal restore of a pending Thragtusk leave still makes a Beast for the captured controller', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [thragtuskCard()],
      },
    }, { random: () => 0 })
    const thragtusk = named(server.state, 'Thragtusk')
    const left = ok(server.rules(server.state, { type: 'move', objectId: thragtusk.id, to: 'exile' }))
    expect(left.stack).toHaveLength(1)
    expect(battlefieldNamed(left, 'Beast')).toHaveLength(0)
    const restored = restoreJournal(createJournal(left), server.rules).current()
    expect(restored.stack).toHaveLength(1)
    expect(battlefieldNamed(restored, 'Beast')).toHaveLength(0)
    const finished = resolveStack(server.rules, restored)
    expectBeast(finished)
    expect(named(finished, 'Thragtusk').zone).toBe('exile')
  })

  test('Fate Unraveler deals one damage to the opponent who draws and ignores the controller drawing', () => {
    const snapshot = cardRuleDefinitionSnapshotFor('Fate Unraveler')!
    const triggered = snapshot.definition.abilities[0]
    expect(triggered).toMatchObject({
      kind: 'triggered',
      instructions: [{
        kind: 'damage',
        source: { kind: 'contextRef', name: 'source' },
        targets: { kind: 'contextRef', name: 'triggering.player' },
      }],
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Fate Unraveler', { types: ['Creature'], power: 3, toughness: 4 })],
      },
      libraries: {
        p1: [cardTemplate('Controller Draw')],
        p2: [cardTemplate('Opponent Draw')],
      },
    }, { random: () => 0 })
    const unraveler = named(server.state, 'Fate Unraveler')
    expect(unraveler.ruleDefinition).toEqual(snapshot)
    expect(unraveler.effects).toEqual([])

    const controllerDraw = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    expect(controllerDraw.stack).toHaveLength(0)
    expect(controllerDraw.players.p1.life).toBe(40)
    expect(controllerDraw.players.p2.life).toBe(40)

    const opponentDraw = ok(server.rules(controllerDraw, { type: 'draw', seat: 'p2', count: 1 }))
    expect(opponentDraw.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, opponentDraw)
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.players.p2.life).toBe(39)
    expect(named(resolved, 'Opponent Draw').zone).toBe('hand')
  })

})
