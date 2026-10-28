import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction } from '../../actions'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import {
  activated,
  addMana,
  CARD_COLORS,
  card,
  chooseInstructions,
  chosenCreatureType,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
  tapCost,
} from './v1'

const snapshot = (restriction: Parameters<typeof addMana>[0]['restriction']) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [tapCost()], instructions: [addMana({ amount: { C: 1 } })] }),
    activated({
      costs: [tapCost()],
      instructions: [chooseInstructions({
        chooser: ref('controller'),
        options: CARD_COLORS.map(color => ({
          label: color,
          instructions: [addMana({ amount: { [color]: 1 }, restriction })],
        })),
      })],
    }),
  ])))

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

describe('restricted mana', () => {
  test('legendary restricted mana stays out of the pool, pays only legends, and those spells cannot be countered', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Restricted producer', { types: ['Artifact'], ruleDefinition: snapshot({ legendary: true, uncounterable: true }) })] },
      hands: {
        p1: [
          cardTemplate('Legend', { types: ['Creature'], supertypes: ['Legendary'], manaCost: '{G}' }),
          cardTemplate('Commoner', { types: ['Creature'], manaCost: '{G}' }),
        ],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Restricted producer')
    const colorless = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source.id, mana: 'C' }))
    expect(colorless.players.p1.mana.C).toBe(1)
    expect(colorless.players.p1.restrictedMana ?? []).toEqual([])

    const tapped = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source.id, mana: 'G' }))
    expect(tapped.players.p1.mana.G).toBe(0)
    expect(tapped.players.p1.restrictedMana).toMatchObject([
      { mana: 'G', sourceId: source.id, legendary: true, uncounterable: true },
    ])
    const restored = JSON.parse(JSON.stringify(tapped))
    expect(server.rules(restored, { type: 'castSpell', seat: 'p1', objectId: named(restored, 'Commoner').id }).ok).toBe(false)
    const cast = ok(server.rules(restored, { type: 'castSpell', seat: 'p1', objectId: named(restored, 'Legend').id }))
    expect(cast.stack[0]).toMatchObject({ name: 'Legend', uncounterable: true })
    expect(cast.players.p1.restrictedMana).toEqual([])
    const countered = ok(server.rules(cast, { type: 'counterStackItem', stackId: cast.stack[0]!.id }))
    expect(countered.stack[0]?.name).toBe('Legend')
  })

  test('chosen-type restricted mana pays only that creature type', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Type producer', {
        types: ['Land'],
        chosenType: 'Wizard',
        ruleDefinition: snapshot({ creatureType: chosenCreatureType(), uncounterable: true }),
      })] },
      hands: {
        p1: [
          cardTemplate('Matching Wizard', { types: ['Creature'], subtypes: ['Wizard'], manaCost: '{U}' }),
          cardTemplate('Wrong Bear', { types: ['Creature'], subtypes: ['Bear'], manaCost: '{U}' }),
        ],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Type producer')
    const tapped = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source.id, mana: 'U' }))
    expect(tapped.players.p1.restrictedMana).toMatchObject([
      { mana: 'U', creatureType: 'Wizard', uncounterable: true },
    ])
    expect(server.rules(tapped, { type: 'castSpell', seat: 'p1', objectId: named(tapped, 'Wrong Bear').id }).ok).toBe(false)
    const cast = ok(server.rules(tapped, { type: 'castSpell', seat: 'p1', objectId: named(tapped, 'Matching Wizard').id }))
    expect(cast.stack[0]).toMatchObject({ name: 'Matching Wizard', uncounterable: true })
  })

  test('catalog Maskwood Nexus lets restricted mana pay for matching-type creature spells', () => {
    const producer = createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [tapCost()],
        instructions: [addMana({ amount: { U: 1 }, restriction: { creatureType: 'Wizard', uncounterable: true } })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [
        cardTemplate('Maskwood Nexus'),
        cardTemplate('Restricted producer', { types: ['Artifact'], ruleDefinition: producer }),
      ] },
      hands: { p1: [cardTemplate('Bear Wizard', { types: ['Creature'], subtypes: ['Bear'], manaCost: '{U}' })] },
    }, { random: () => 0 })
    const source = named(server.state, 'Restricted producer')
    const spell = named(server.state, 'Bear Wizard')
    expect(spell.subtypes).toContain('Wizard')
    const castAction = availableActions(server.state, 'p1').find(action => action.kind === 'castSpell' && action.objectId === spell.id)
    expect(castAction).toBeDefined()
    const planned = eventsForAvailableAction(server.state, 'p1', castAction!)
    expect(planned).toMatchObject([
      { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]', manaAbility: true },
      { type: 'castSpell', seat: 'p1', objectId: spell.id },
    ])
    const tapped = ok(server.rules(server.state, planned![0]!))
    expect(tapped.players.p1.restrictedMana).toMatchObject([{ mana: 'U', creatureType: 'Wizard', uncounterable: true }])
    const cast = ok(server.rules(tapped, planned![1]!))
    expect(cast.stack[0]).toMatchObject({ name: 'Bear Wizard', uncounterable: true })
    expect(cast.players.p1.restrictedMana).toEqual([])
  })
})
