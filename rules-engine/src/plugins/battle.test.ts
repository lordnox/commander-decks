import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { createServerGame } from '../runtime'
import { bears } from '../testGame'
import { ok } from '../testHelpers'
import { BATTLE_DEFEATED_ABILITY, CAST_TRANSFORMED_ACTION } from './battle'

const siege = () => cardTemplate('Test Siege // Test Victor', {
  types: ['Battle'],
  subtypes: ['Siege'],
  manaCost: '{2}{G}',
  printedDefense: 3,
  frontFace: {
    types: ['Battle'],
    subtypes: ['Siege'],
    supertypes: [],
    manaCost: '{2}{G}',
    manaValue: 3,
    colors: ['G'],
    power: null,
    toughness: null,
    printedDefense: 3,
    oracleText: 'Siege reminder text',
  },
  backFace: {
    types: ['Creature'],
    subtypes: ['Warrior'],
    supertypes: [],
    manaCost: '',
    manaValue: 0,
    colors: ['G'],
    power: 4,
    toughness: 4,
    printedDefense: null,
    oracleText: 'Vigilance, haste',
  },
})

const castSiege = (card = siege()) => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [card] },
  })
  const objectId = server.state.zoneOrder.p1.hand[0]
  server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 }
  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId,
  }))
  return { server, objectId, state: ok(server.rules(cast, { type: 'resolveTop' })) }
}

describe('Siege battles', () => {
  test('enter with defense counters and use selectPlayers to choose an opponent protector', () => {
    const { server, objectId, state } = castSiege()
    expect(state.objects[objectId]).toMatchObject({
      zone: 'battlefield',
      name: 'Test Siege // Test Victor',
      counters: { defense: 3 },
    })

    const pending = pendingPlayerSelectionFor(state, 'p1')
    expect(pending).toMatchObject({
      sourceId: objectId,
      candidates: ['p2', 'p3'],
      action: { kind: 'designateBattleProtector' },
    })
    if (!pending) throw new Error('missing protector choice')

    const chosen = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending.id,
      players: ['p2'],
    }))
    expect(chosen.objects[objectId].protector).toBe('p2')
  })

  test('the controller can attack its Siege, only its protector can block, and protector cannot attack it', () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      battlefield: {
        p1: [bears(), { ...siege(), protector: 'p2', counters: { defense: 3 } }],
        p2: [bears()],
        p3: [bears()],
      },
    })
    const battle = Object.values(server.state.objects).find((object) =>
      object.types.includes('Battle'))!
    const attackers = Object.values(server.state.objects).filter((object) =>
      object.types.includes('Creature'))
    for (const attacker of attackers) attacker.summoningSickness = false
    server.state.step = 'declareAttackers'

    const controllerAttack = server.rules(server.state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{
        objectId: attackers.find((object) => object.controller === 'p1')!.id,
        defender: { kind: 'object', objectId: battle.id },
      }],
    })
    expect(controllerAttack.ok).toBe(true)

    const protectorTurn = structuredClone(server.state)
    protectorTurn.active = 'p2'
    protectorTurn.priority = 'p2'
    const protectorAttack = server.rules(protectorTurn, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{
        objectId: attackers.find((object) => object.controller === 'p2')!.id,
        defender: { kind: 'object', objectId: battle.id },
      }],
    })
    expect(protectorAttack.ok).toBe(false)
    if (!protectorAttack.ok) expect(protectorAttack.error).toContain('controller')

    if (!controllerAttack.ok) return
    controllerAttack.state.step = 'declareBlockers'
    const wrongBlocker = server.rules(controllerAttack.state, {
      type: 'declareBlockers',
      seat: 'p3',
      blockers: [{
        blockerId: attackers.find((object) => object.controller === 'p3')!.id,
        attackerId: attackers.find((object) => object.controller === 'p1')!.id,
      }],
    })
    expect(wrongBlocker.ok).toBe(false)

    const protectorBlock = server.rules(controllerAttack.state, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: [{
        blockerId: attackers.find((object) => object.controller === 'p2')!.id,
        attackerId: attackers.find((object) => object.controller === 'p1')!.id,
      }],
    })
    expect(protectorBlock.ok).toBe(true)
  })

  test('damage removes defense, defeat waits on the stack, then casts the transformed back face', () => {
    const { server, objectId, state } = castSiege()
    const pending = pendingPlayerSelectionFor(state, 'p1')!
    let current = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending.id,
      players: ['p2'],
    }))

    current = ok(server.rules(current, {
      type: 'dealDamage',
      sourceId: 'test-source',
      target: { kind: 'object', objectId },
      amount: 3,
    }))
    expect(current.objects[objectId]).toMatchObject({
      zone: 'battlefield',
      counters: { defense: 0 },
    })
    expect(current.stack[0]).toMatchObject({
      objectId,
      abilityId: BATTLE_DEFEATED_ABILITY,
    })

    current = ok(server.rules(current, { type: 'resolveTop' }))
    expect(current.objects[objectId]).toMatchObject({
      zone: 'exile',
      name: 'Test Siege // Test Victor',
    })
    expect(current.stack[0]).toMatchObject({
      objectId,
      actionId: CAST_TRANSFORMED_ACTION,
      waiting: 'choice',
    })
    expect(legalActsFor(current, 'p1')).toContainEqual({
      kind: 'continueAction',
      stackId: current.stack[0].id,
      actionId: CAST_TRANSFORMED_ACTION,
      objectIds: [objectId],
      count: 1,
      options: ['cast', 'decline'],
    })
    expect(current.objects[objectId].counters.defense).toBeUndefined()
    expect(current.objects[objectId].protector).toBeUndefined()

    current = ok(server.rules(current, {
      type: 'continueAction',
      stackId: current.stack[0].id,
      seat: 'p1',
      payload: { cast: true },
    }))
    expect(current.objects[objectId]).toMatchObject({
      zone: 'stack',
      name: 'Test Siege // Test Victor',
      types: ['Creature'],
      power: 4,
      toughness: 4,
    })

    current = ok(server.rules(current, { type: 'resolveTop' }))
    expect(current.objects[objectId]).toMatchObject({
      zone: 'battlefield',
      name: 'Test Siege // Test Victor',
      types: ['Creature'],
    })
  })

  test('a defeated Siege goes to the graveyard if its intrinsic trigger leaves the stack', () => {
    const { server, objectId, state } = castSiege()
    const pending = pendingPlayerSelectionFor(state, 'p1')!
    let current = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending.id,
      players: ['p2'],
    }))
    current = ok(server.rules(current, {
      type: 'removeDefenseCounters',
      objectId,
      amount: 3,
    }))
    expect(current.objects[objectId].zone).toBe('battlefield')

    current.stack = []
    current = ok(server.rules(current, {
      type: 'addMana',
      seat: 'p1',
      mana: { C: 1 },
    }))
    expect(current.objects[objectId].zone).toBe('graveyard')
  })

  test('clears a stale protector but waits until combat ends to choose another', () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      battlefield: {
        p1: [bears(), { ...siege(), protector: 'p2', counters: { defense: 3 } }],
      },
    })
    const battle = Object.values(server.state.objects).find((object) =>
      object.types.includes('Battle'))!
    const attacker = Object.values(server.state.objects).find((object) =>
      object.types.includes('Creature'))!
    attacker.summoningSickness = false
    server.state.step = 'declareAttackers'
    let current = ok(server.rules(server.state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{
        objectId: attacker.id,
        defender: { kind: 'object', objectId: battle.id },
      }],
    }))

    current = ok(server.rules(current, { type: 'concede', seat: 'p2' }))
    expect(current.objects[battle.id].protector).toBeUndefined()
    expect(pendingPlayerSelectionFor(current, 'p1')).toBeUndefined()

    current.objects[attacker.id].attacking = null
    current = ok(server.rules(current, {
      type: 'addMana',
      seat: 'p1',
      mana: { C: 1 },
    }))
    expect(current.objects[battle.id].protector).toBe('p3')
  })

  test('a transformed back-face instant or sorcery returns to its front face off the stack', () => {
    const card = siege()
    card.backFace = {
      types: ['Sorcery'],
      subtypes: [],
      supertypes: [],
      manaCost: '',
      manaValue: 0,
      colors: ['G'],
      power: null,
      toughness: null,
      printedDefense: null,
      oracleText: 'Draw two cards.',
    }
    const { server, objectId, state } = castSiege(card)
    const pending = pendingPlayerSelectionFor(state, 'p1')!
    let current = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending.id,
      players: ['p2'],
    }))
    current = ok(server.rules(current, {
      type: 'removeDefenseCounters',
      objectId,
      amount: 3,
    }))
    current = ok(server.rules(current, { type: 'resolveTop' }))
    current = ok(server.rules(current, {
      type: 'continueAction',
      stackId: current.stack[0].id,
      seat: 'p1',
      payload: { cast: true },
    }))
    current = ok(server.rules(current, { type: 'resolveTop' }))

    expect(current.objects[objectId]).toMatchObject({
      zone: 'graveyard',
      name: 'Test Siege // Test Victor',
      types: ['Battle'],
      printedDefense: 3,
    })
  })
})
