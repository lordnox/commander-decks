import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { pluginIdsFromEffects } from './effectRuntime'
import { staticBoardPump as pumpEffect } from './effects'
import { staticBoardPump } from './staticBoardPump'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const lord = () => cardTemplate('Land-Creature Lord', {
  types: ['Creature'],
  power: 3,
  toughness: 3,
  effects: [pumpEffect(1, 1, ['Creature', 'Land'])],
})

const forestDryad = () => cardTemplate('Forest Dryad', {
  types: ['Creature', 'Land'],
  subtypes: ['Forest', 'Dryad'],
  power: 1,
  toughness: 1,
})

const bear = () => cardTemplate('Plain Bear', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

describe('static board pump for land creatures', () => {
  test('stamped effects grant the staticBoardPump plugin', () => {
    expect(pluginIdsFromEffects([pumpEffect(1, 1, ['Creature', 'Land'])]))
      .toEqual(['staticBoardPump'])
    expect(staticBoardPump.id).toBe('staticBoardPump')
  })

  test('a Forest Dryad gets +1/+1 and a non-land creature does not', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [lord(), forestDryad(), bear()] } },
      { random: () => 0.5 },
    )
    const dryadId = Object.values(server.state.objects)
      .find((object) => object.name === 'Forest Dryad')!.id
    const bearId = Object.values(server.state.objects)
      .find((object) => object.name === 'Plain Bear')!.id
    const state = ok(server.rules(server.state, {
      type: 'custom',
      name: 'staticBoardPump.sync',
    }))
    expect([state.objects[dryadId].power, state.objects[dryadId].toughness]).toEqual([2, 2])
    expect([state.objects[bearId].power, state.objects[bearId].toughness]).toEqual([2, 2])
  })

  test("an opponent's land creature is unchanged", () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: {
          p1: [lord()],
          p2: [forestDryad()],
        },
      },
      { random: () => 0.5 },
    )
    const dryadId = Object.values(server.state.objects)
      .find((object) => object.name === 'Forest Dryad')!.id
    const state = ok(server.rules(server.state, {
      type: 'custom',
      name: 'staticBoardPump.sync',
    }))
    expect([state.objects[dryadId].power, state.objects[dryadId].toughness]).toEqual([1, 1])
  })

  test('structuredClone keeps the staticBoardPump static effect', () => {
    const stamped = [pumpEffect(1, 1, ['Creature', 'Land'])]
    expect(structuredClone(stamped)).toEqual(stamped)
  })
})
