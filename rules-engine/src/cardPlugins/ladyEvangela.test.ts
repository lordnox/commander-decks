import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, ReduceResult } from '../types'
import { activated } from './activated'
import { missingCardPlugins } from './index'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const passToEmpty = (
  rules: (state: GameState, event: { type: 'passPriority'; seat: string }) => ReduceResult,
  state: GameState,
) => {
  let current = state
  while (current.stack.length > 0 && !current.stack[0].waiting) {
    for (const seat of current.playerOrder) {
      current = ok(rules(current, { type: 'passPriority', seat }))
    }
  }
  return current
}

describe('Lady Evangela foggy blood transfusion coverage', () => {
  test('the Eva cards this pass covers stay registered', () => {
    expect(missingCardPlugins([
      'Absorb',
      'Anguished Unmaking',
      'Batwing Brume',
      'Blanket of Night',
      'Blood Celebrant',
      'Bubbling Muck',
      'Cabal Coffers',
      'Cabal Stronghold',
      'Comeuppance',
      'Crypt Ghast',
      'Dark Confidant',
      'Dark Tutelage',
      'Darkness',
      'Debt to the Deathless',
      'Deserted Temple',
      'Dimir Signet',
      'Drain Life',
      "Dovin's Veto",
      'Energy Arc',
      'Everybody Lives!',
      'Esper Panorama',
      'Expedition Map',
      'Exsanguinate',
      'Inkshield',
      'Kami of False Hope',
      'Lady Evangela',
      'Magus of the Coffers',
      'Marsh Flats',
      'Mirror Universe',
      'Mister Negative',
      'Mulldrifter',
      'Necrologia',
      'Nirkana Revenant',
      'Orzhov Signet',
      "Raffine's Tower",
      'Repay in Kind',
      'Selenia, Dark Angel',
      'Settle the Wreckage',
      'Snuff Out',
      'Swan Song',
      'Swords to Plowshares',
      'Tainted Sigil',
      'Test of Endurance',
      'Urborg, Tomb of Yawgmoth',
      'Wall of Blood',
      'Children of Korlis',
      'Counterspell',
      'Arcanis the Omnipotent',
      'Cryptic Command',
      'Wedding Ring',
      'Breena, the Demagogue',
      'Kuroki, Thief of Talents',
    ])).toEqual([])
  })

  test('Urborg lets a Forest tap for {B}', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            forest(),
            cardTemplate('Urborg, Tomb of Yawgmoth', { types: ['Land'] }),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const forestId = named(server.state, 'Forest').id
    const black = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: forestId,
      mana: 'B',
    }))
    expect(black.players.p1.mana.B).toBe(1)
  })

  test('Crypt Ghast adds {B} when you tap a Swamp', () => {
    const swamp = cardTemplate('Swamp', {
      types: ['Land'],
      subtypes: ['Swamp'],
      supertypes: ['Basic'],
      oracleText: '{T}: Add {B}.',
      tapProduces: { B: 1 },
    })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            swamp,
            cardTemplate('Crypt Ghast', { types: ['Creature'] }),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const swampId = named(server.state, 'Swamp').id
    const tapped = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: swampId,
    }))
    expect(tapped.players.p1.mana.B).toBe(2)
  })

  test('Cabal Coffers adds {B} for each Swamp including Urborg', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            forest(),
            forest(),
            cardTemplate('Urborg, Tomb of Yawgmoth', { types: ['Land'] }),
            cardTemplate('Cabal Coffers', { types: ['Land'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2
    const coffersId = named(ready, 'Cabal Coffers').id
    const activatedMana = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'coffers.cabal',
      seat: 'p1',
      objectId: coffersId,
      manaAbility: true,
    }))
    expect(activatedMana.objects[coffersId].tapped).toBe(true)
    expect(activatedMana.players.p1.mana.B).toBe(4)
    expect(activatedMana.players.p1.mana.C).toBe(0)
  })

  test('Darkness prevents combat damage until cleanup', () => {
    const attacker = cardTemplate('Grizzly Bears', {
      types: ['Creature'],
      power: 2,
      toughness: 2,
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Darkness', { types: ['Instant'], manaCost: '{B}' })] },
        battlefield: { p2: [attacker] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.B = 1
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Darkness').id,
    }))
    const fogged = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(fogged.rules.some((rule) => rule.pluginId === 'fog' && rule.params.untilCleanup)).toBe(true)

    let combat = structuredClone(fogged)
    combat.active = 'p2'
    combat.priority = 'p2'
    combat.step = 'declareAttackers'
    combat.objects[named(combat, 'Grizzly Bears').id].summoningSickness = false
    combat = ok(server.rules(combat, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{ objectId: named(combat, 'Grizzly Bears').id, defender: 'p1' }],
    }))
    combat.step = 'combatDamage'
    combat = ok(server.rules(combat, { type: 'assignCombatDamage' }))
    expect(combat.players.p1.life).toBe(40)

    let cleaned = fogged
    while (cleaned.step !== 'cleanup') {
      cleaned = ok(server.rules(cleaned, { type: 'advanceStep' }))
    }
    expect(cleaned.rules.some((rule) => rule.pluginId === 'fog' && rule.params.untilCleanup))
      .toBe(false)
  })

  test('Lady Evangela fogs only the targeted creature', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Lady Evangela', { types: ['Creature'] })],
          p2: [
            cardTemplate('Angry Bear', { types: ['Creature'], power: 3, toughness: 3 }),
            cardTemplate('Quiet Bear', { types: ['Creature'], power: 2, toughness: 2 }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const eva = named(server.state, 'Lady Evangela').id
    server.state.objects[eva].summoningSickness = false
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 }
    const angry = named(ready, 'Angry Bear').id
    const activatedAbility = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'ladyEvangela.fog',
      seat: 'p1',
      objectId: eva,
      targets: [{ kind: 'object', objectId: angry }],
    }))
    const resolved = passToEmpty(server.rules, activatedAbility)
    expect(resolved.rules.some((rule) =>
      rule.pluginId === 'fog' && rule.params.sourceId === angry)).toBe(true)

    let combat = structuredClone(resolved)
    combat.active = 'p2'
    combat.priority = 'p2'
    combat.step = 'declareAttackers'
    combat.objects[angry].summoningSickness = false
    combat.objects[named(combat, 'Quiet Bear').id].summoningSickness = false
    combat = ok(server.rules(combat, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [
        { objectId: angry, defender: 'p1' },
        { objectId: named(combat, 'Quiet Bear').id, defender: 'p1' },
      ],
    }))
    combat.step = 'combatDamage'
    combat = ok(server.rules(combat, { type: 'assignCombatDamage' }))
    expect(combat.players.p1.life).toBe(38)
  })

  test('Swords to Plowshares exiles and gains life equal to power', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Swords to Plowshares', { types: ['Instant'], manaCost: '{W}' })],
        },
        battlefield: {
          p2: [cardTemplate('Bear', { types: ['Creature'], power: 4, toughness: 4 })],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.W = 1
    const opened = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Swords to Plowshares').id,
      targets: [{ kind: 'object', objectId: named(ready, 'Bear').id }],
    }))
    const resolved = resolveStack(server.rules, opened)
    expect(named(resolved, 'Bear').zone).toBe('exile')
    expect(resolved.players.p1.life).toBe(44)
  })

  test('Dark Confidant reveals, draws, and loses life on your upkeep', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Dark Confidant', { types: ['Creature'] })],
        },
        libraries: {
          p1: [cardTemplate('Ancestral Recall', {
            types: ['Instant'],
            manaCost: '{U}',
            manaValue: 1,
          })],
        },
      },
      { random: () => 0.5 },
    )
    let state = server.state
    state.step = 'untap'
    state.active = 'p1'
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.step).toBe('upkeep')
    state = resolveStack(server.rules, state)
    expect(named(state, 'Ancestral Recall').zone).toBe('hand')
    expect(state.players.p1.life).toBe(39)
  })
})
