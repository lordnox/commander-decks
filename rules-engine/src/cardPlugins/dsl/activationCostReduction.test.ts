import { describe, expect, test } from 'bun:test'
import {
  activated,
  card,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  manaCost,
  move,
  objects,
  reduceActivationCost,
  ref,
  staticAbility,
  tapCost,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'

const snapshot = (...abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

describe('activation cost reduction', () => {
  test('a printed per-legendary reduction discounts generic mana at announcement', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Legend One', { types: ['Creature'], supertypes: ['Legendary'] }),
          cardTemplate('Legend Two', { types: ['Creature'], supertypes: ['Legendary'] }),
        ],
      },
      hands: {
        p1: [cardTemplate('Channel Rock', {
          types: ['Artifact'],
          ruleDefinition: snapshot(activated({
            availableFrom: ['hand'],
            costs: [manaCost('{3}')],
            costReductions: [{ generic: count(objects({
              zone: 'battlefield',
              type: 'Creature',
              supertypes: ['Legendary'],
              controller: 'you',
            })) }],
            instructions: [move({ targets: ref('source'), to: 'graveyard' })],
          })),
        })],
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Channel Rock')!
    const unpaid = structuredClone(server.state)
    unpaid.players.p1.mana.C = 0
    expect(server.rules(unpaid, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }).ok).toBe(false)

    server.state.players.p1.mana.C = 1
    const stacked = ok(server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]',
    }))
    expect(stacked.players.p1.mana.C).toBe(0)
    expect(ok(server.rules(stacked, { type: 'resolveTop' })).objects[source.id].zone).toBe('graveyard')
  })

  test('a continuous land-activation discount reduces {2} to {1} and ignores artifacts', () => {
    const land = cardTemplate('Charged Clearing', {
      types: ['Land'],
      ruleDefinition: snapshot(activated({
        costs: [manaCost('{2}')],
        instructions: [move({ targets: ref('source'), to: 'graveyard' })],
      })),
    })
    const artifact = cardTemplate('Charged Relic', {
      types: ['Artifact'],
      ruleDefinition: snapshot(activated({
        costs: [manaCost('{2}')],
        instructions: [move({ targets: ref('source'), to: 'graveyard' })],
      })),
    })
    const reducer = cardTemplate('Cost Reducer', {
      types: ['Creature'],
      power: 1,
      toughness: 3,
      ruleDefinition: snapshot(staticAbility(reduceActivationCost({
        targets: objects({ zone: 'battlefield', type: 'Land', controller: 'you' }),
        generic: 1,
      }))),
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [land, artifact, reducer] },
    }, { random: () => 0 })
    const landId = Object.values(server.state.objects).find((object) => object.name === 'Charged Clearing')!.id
    const relicId = Object.values(server.state.objects).find((object) => object.name === 'Charged Relic')!.id

    const paidLand = structuredClone(server.state)
    paidLand.players.p1.mana.C = 1
    expect(ok(server.rules(paidLand, {
      type: 'activateAbility', seat: 'p1', objectId: landId, abilityId: '$.abilities[0]',
    })).players.p1.mana.C).toBe(0)

    const unpaidArtifact = structuredClone(server.state)
    unpaidArtifact.players.p1.mana.C = 1
    expect(server.rules(unpaidArtifact, {
      type: 'activateAbility', seat: 'p1', objectId: relicId, abilityId: '$.abilities[0]',
    }).ok).toBe(false)
  })

  test('a tap mana ability also receives the continuous land discount', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Mana Clearing', {
            types: ['Land'],
            ruleDefinition: snapshot(activated({
              costs: [manaCost('{2}'), tapCost()],
              instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: { kind: 'constant', value: 3 } } }],
            })),
          }),
          cardTemplate('Cost Reducer', {
            types: ['Creature'],
            power: 1,
            toughness: 3,
            ruleDefinition: snapshot(staticAbility(reduceActivationCost({
              targets: objects({ zone: 'battlefield', type: 'Land', controller: 'you' }),
              generic: 1,
            }))),
          }),
        ],
      },
    }, { random: () => 0 })
    server.state.players.p1.mana.C = 1
    const landId = Object.values(server.state.objects).find((object) => object.name === 'Mana Clearing')!.id
    const tapped = ok(server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: landId, abilityId: '$.abilities[0]',
    }))
    expect(tapped.objects[landId].tapped).toBe(true)
    expect(tapped.players.p1.mana.C).toBe(3)
  })
})
