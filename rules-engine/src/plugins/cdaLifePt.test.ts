import { describe, expect, test } from 'bun:test'
import { changeController, untilEndOfTurn } from '../cardPlugins/continuousEffects'
import { applyCopy } from '../cardPlugins/effectRuntime'
import { ptEqualsLife } from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const vitalityElemental = (who: 'controller' | 'owner') => cardTemplate('Vitality Elemental', {
  types: ['Creature'],
  subtypes: ['Elemental'],
  power: null,
  toughness: null,
  oracleText: 'Vitality Elemental\'s power and toughness are each equal to your life total.',
  effects: [ptEqualsLife({ who })],
})

describe('cda life power and toughness', () => {
  test('power and toughness match the controller life total on the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [vitalityElemental('controller')] } },
      { random: () => 0.5 },
    )
    const id = server.state.zoneOrder.p1.battlefield[0]
    let state = ok(server.rules(server.state, { type: 'custom', name: 'cdaLifePt.sync' }))
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([40, 40])

    const afterLoss = ok(server.rules(state, {
      type: 'loseLife',
      seat: 'p1',
      amount: 5,
    }))
    expect([afterLoss.objects[id].power, afterLoss.objects[id].toughness]).toEqual([35, 35])

    const afterGain = ok(server.rules(afterLoss, {
      type: 'gainLife',
      seat: 'p1',
      amount: 3,
    }))
    expect([afterGain.objects[id].power, afterGain.objects[id].toughness]).toEqual([38, 38])
  })

  test('uses the new controller life total after control changes when who is controller', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: { p1: [vitalityElemental('controller')] },
      },
      { random: () => 0.5 },
    )
    const id = server.state.zoneOrder.p1.battlefield[0]
    expect(server.state.players.p1.life).toBe(40)
    expect(server.state.players.p2.life).toBe(40)

    let state = server.state
    untilEndOfTurn(state.objects[id], changeController(state.objects[id], 'p2'))
    state = ok(server.rules(state, { type: 'custom', name: 'cdaLifePt.sync' }))

    expect(state.objects[id].controller).toBe('p2')
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([40, 40])

    state = ok(server.rules(state, { type: 'loseLife', seat: 'p2', amount: 10 }))
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([30, 30])
    expect(state.players.p1.life).toBe(40)
  })

  test('owner life applies when who is owner even under another controller', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: { p1: [vitalityElemental('owner')] },
      },
      { random: () => 0.5 },
    )
    const id = server.state.zoneOrder.p1.battlefield[0]
    let state = server.state
    untilEndOfTurn(state.objects[id], changeController(state.objects[id], 'p2'))
    state = ok(server.rules(state, { type: 'custom', name: 'cdaLifePt.sync' }))
    expect(state.objects[id].controller).toBe('p2')
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([40, 40])

    state = ok(server.rules(state, { type: 'loseLife', seat: 'p1', amount: 12 }))
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([28, 28])
    expect(state.players.p2.life).toBe(40)
  })

  test('still tracks life in the graveyard public zone', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [vitalityElemental('controller')] } },
      { random: () => 0.5 },
    )
    const id = server.state.zoneOrder.p1.battlefield[0]
    let state = ok(server.rules(server.state, { type: 'custom', name: 'cdaLifePt.sync' }))
    state = ok(server.rules(state, {
      type: 'move',
      objectId: id,
      to: 'graveyard',
    }))
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([40, 40])
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 4 }))
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([44, 44])
  })

  test('lethal damage destroys the creature after life loss shrinks toughness', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [vitalityElemental('controller')] } },
      { random: () => 0.5 },
    )
    const id = server.state.zoneOrder.p1.battlefield[0]
    let state = ok(server.rules(server.state, { type: 'custom', name: 'cdaLifePt.sync' }))
    state = ok(server.rules(state, { type: 'loseLife', seat: 'p1', amount: 10 }))
    expect([state.objects[id].power, state.objects[id].toughness]).toEqual([30, 30])
    state = ok(server.rules(state, {
      type: 'dealDamage',
      sourceId: id,
      target: { kind: 'object', objectId: id },
      amount: 30,
    }))
    expect(state.objects[id].zone).toBe('graveyard')
  })

  test('clone copies the stamped static effect and keeps life-based stats', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            vitalityElemental('controller'),
            cardTemplate('Mirror Fixture', {
              types: ['Creature'],
              subtypes: ['Shapeshifter'],
              power: 0,
              toughness: 0,
            }),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const [targetId, cloneId] = server.state.zoneOrder.p1.battlefield
    applyCopy(server.state.objects[cloneId], server.state.objects[targetId])
    const synced = ok(server.rules(server.state, { type: 'custom', name: 'cdaLifePt.sync' }))
    expect(ptEqualsLife({ who: 'controller' })).toEqual(
      (synced.objects[cloneId].effects ?? []).find(
        (effect) => effect.op === 'static' && effect.ptEqualsLife,
      ),
    )
    expect([synced.objects[cloneId].power, synced.objects[cloneId].toughness]).toEqual([40, 40])
  })

  test('structuredClone keeps the ptEqualsLife static effect', () => {
    const stamped = [ptEqualsLife({ who: 'controller' })]
    expect(structuredClone(stamped)).toEqual(stamped)
  })
})
