import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { activated } from './activated'
import { activate, reduceActivationCost } from './effects'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const landCharge = () => cardTemplate('Charged Clearing', {
  types: ['Land'],
  effects: [activate({
    id: 'charge',
    costs: { mana: '{2}' },
    do: [{ kind: 'addMana', mana: { C: 1 } }],
  })],
})

const landManaCharge = () => cardTemplate('Mana Clearing', {
  types: ['Land'],
  effects: [activate({
    id: 'mana.charge',
    manaAbility: true,
    costs: { mana: '{2}', tap: true },
    do: [{ kind: 'addMana', mana: { C: 3 } }],
  })],
})

const artifactCharge = () => cardTemplate('Charged Relic', {
  types: ['Artifact'],
  effects: [activate({
    id: 'charge',
    costs: { mana: '{2}' },
    do: [{ kind: 'addMana', mana: { C: 1 } }],
  })],
})

const costReducer = () => cardTemplate('Cost Reducer', {
  types: ['Creature'],
  power: 1,
  toughness: 3,
  effects: [reduceActivationCost(1)],
})

describe('land activation cost reduction', () => {
  test('a land activation {2} becomes {1}', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [landCharge(), costReducer()] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const landId = Object.values(server.state.objects)
      .find((object) => object.name === 'Charged Clearing')!.id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 1
    const paid = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'charge',
      seat: 'p1',
      objectId: landId,
    }))
    expect(paid.players.p1.mana.C).toBe(0)
    expect(paid.stack[0]).toMatchObject({ abilityId: 'charge', objectId: landId })

    const short = structuredClone(server.state)
    short.players.p1.mana.C = 0
    const unpaid = server.rules(short, {
      type: 'activateAbility',
      abilityId: 'charge',
      seat: 'p1',
      objectId: landId,
    })
    expect(unpaid.ok).toBe(false)
  })

  test('a land mana ability {2} becomes {1}', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [landManaCharge(), costReducer()] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const landId = Object.values(server.state.objects)
      .find((object) => object.name === 'Mana Clearing')!.id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 1
    const paid = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'mana.charge',
      seat: 'p1',
      objectId: landId,
      manaAbility: true,
    }))
    expect(paid.objects[landId].tapped).toBe(true)
    expect(paid.players.p1.mana.C).toBe(3)
  })

  test('non-land activations are unchanged', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [artifactCharge(), costReducer()] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const relicId = Object.values(server.state.objects)
      .find((object) => object.name === 'Charged Relic')!.id
    const withOne = structuredClone(server.state)
    withOne.players.p1.mana.C = 1
    expect(server.rules(withOne, {
      type: 'activateAbility',
      abilityId: 'charge',
      seat: 'p1',
      objectId: relicId,
    }).ok).toBe(false)

    const withTwo = structuredClone(server.state)
    withTwo.players.p1.mana.C = 2
    const paid = ok(server.rules(withTwo, {
      type: 'activateAbility',
      abilityId: 'charge',
      seat: 'p1',
      objectId: relicId,
    }))
    expect(paid.players.p1.mana.C).toBe(0)
  })

  test("an opponent's lands are unchanged", () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: {
          p1: [costReducer()],
          p2: [landCharge()],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const landId = Object.values(server.state.objects)
      .find((object) => object.name === 'Charged Clearing')!.id
    const withOne = structuredClone(server.state)
    withOne.players.p2.mana.C = 1
    withOne.priority = 'p2'
    expect(server.rules(withOne, {
      type: 'activateAbility',
      abilityId: 'charge',
      seat: 'p2',
      objectId: landId,
    }).ok).toBe(false)

    const withTwo = structuredClone(server.state)
    withTwo.players.p2.mana.C = 2
    withTwo.priority = 'p2'
    const paid = ok(server.rules(withTwo, {
      type: 'activateAbility',
      abilityId: 'charge',
      seat: 'p2',
      objectId: landId,
    }))
    expect(paid.players.p2.mana.C).toBe(0)
  })

  test('structuredClone keeps the reduceActivationCost static effect', () => {
    const stamped = [reduceActivationCost(1)]
    expect(structuredClone(stamped)).toEqual(stamped)
  })
})
