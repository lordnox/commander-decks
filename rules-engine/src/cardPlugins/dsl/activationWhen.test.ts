import { describe, expect, test } from 'bun:test'
import {
  activated,
  activePlayer,
  allConditions,
  card,
  compareAmount,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  currentStep,
  manaCost,
  move,
  notCondition,
  objects,
  ref,
  tapCost,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'

const snapshot = (...abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const land = (name: string, abilities: Parameters<typeof snapshot>) =>
  cardTemplate(name, { types: ['Land'], ruleDefinition: snapshot(...abilities) })

describe('activation when', () => {
  test('a not-your-turn activation bounces only while another player is active', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [land('Ghost Patch', [activated({
        when: notCondition(activePlayer(ref('controller'))),
        instructions: [move({ targets: ref('source'), to: 'hand' })],
      })])] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Ghost Patch')!
    expect(server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }).ok).toBe(false)

    const otherTurn = { ...server.state, active: 'p2', priority: 'p1' }
    const stacked = ok(server.rules(otherTurn, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }))
    expect(ok(server.rules(stacked, { type: 'resolveTop' })).objects[source.id].zone).toBe('hand')
  })

  test('an upkeep activation is refused on the main phase and accepted on the controller upkeep', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [land('Upkeep Stone', [activated({
        when: allConditions(currentStep('upkeep'), activePlayer(ref('controller'))),
        costs: [tapCost()],
        instructions: [move({ targets: ref('source'), to: 'hand' })],
      })])] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Upkeep Stone')!
    expect(server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }).ok).toBe(false)

    const upkeep = { ...server.state, step: 'upkeep' as const }
    const stacked = ok(server.rules(upkeep, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }))
    expect(ok(server.rules(stacked, { type: 'resolveTop' })).objects[source.id].zone).toBe('hand')
  })

  test('a land-count mana ability needs five controlled lands', () => {
    const ability = activated({
      when: compareAmount(count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })), 'gte', 5),
      costs: [tapCost()],
      instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: { kind: 'constant', value: 2 } } }],
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          land('False Temple', [ability]),
          ...['One', 'Two', 'Three'].map((name) => cardTemplate(name, { types: ['Land'] })),
        ],
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'False Temple')!
    expect(server.rules(server.state, {
      type: 'tapForMana', seat: 'p1', objectId: source.id,
    }).ok).toBe(false)

    const five = structuredClone(server.state)
    const extraId = 'extra-land'
    five.objects[extraId] = {
      ...cardTemplate('Four', { types: ['Land'] }),
      id: extraId,
      owner: 'p1',
      controller: 'p1',
      zone: 'battlefield',
    }
    five.zoneOrder.p1.battlefield.push(extraId)
    five.zoneCounts.p1.battlefield += 1
    const tapped = ok(server.rules(five, { type: 'tapForMana', seat: 'p1', objectId: source.id }))
    expect(tapped.players.p1.mana.C).toBe(2)
  })

  test('a graveyard-threshold activation needs seven cards', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [land('Threshold Pool', [activated({
        when: compareAmount(count(objects({ zone: 'graveyard', owner: 'you' })), 'gte', 7),
        costs: [manaCost('{U}'), tapCost()],
        instructions: [move({ targets: ref('source'), to: 'hand' })],
      })])] },
      libraries: { p1: Array.from({ length: 6 }, (_, index) => cardTemplate(`Milled ${index}`, { zone: 'graveyard' })) },
    }, { random: () => 0 })
    server.state.players.p1.mana.U = 1
    const source = Object.values(server.state.objects).find((object) => object.name === 'Threshold Pool')!
    expect(server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }).ok).toBe(false)

    const ready = structuredClone(server.state)
    const extraId = 'seventh'
    ready.objects[extraId] = {
      ...cardTemplate('Seventh'),
      id: extraId,
      owner: 'p1',
      controller: 'p1',
      zone: 'graveyard',
    }
    ready.zoneOrder.p1.graveyard.push(extraId)
    ready.zoneCounts.p1.graveyard += 1
    const stacked = ok(server.rules(ready, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }))
    expect(ok(server.rules(stacked, { type: 'resolveTop' })).objects[source.id].zone).toBe('hand')
  })
})
