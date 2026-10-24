import { pendingSelectionFor } from '../rules/selectCards'
import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { activate, createTreasures, effectsFromTokenSpec } from './effects'

import {createServerGame as createRuntimeGame} from '../runtime'

import { choiceEffects } from './choiceEffects'
import {entersTapped} from './entersTapped'
import {librarySearch} from './librarySearch'
import {onResolve} from './onResolve'
import {targetedResolve} from './targetedResolve'
const TREASURE_TEXT = '{T}, Sacrifice this token: Add one mana of any color.'

const treasure = (): CardTemplate => cardTemplate('Treasure', {
  types: ['Artifact'],
  subtypes: ['Treasure'],
  token: true,
  oracleText: TREASURE_TEXT,
})

const game = (battlefield: CardTemplate[], hand: CardTemplate[] = []) =>
  createServerGame(
    commanderRules,
    { battlefield: { p1: battlefield }, hands: { p1: hand } },
    { random: () => 0.5, cardPlugins: [activated] },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

const spell = (manaCost: string) => cardTemplate('Planner Spell', {
  types: ['Creature'],
  manaCost,
})

const spawn = () => cardTemplate('Eldrazi Spawn', {
  types: ['Creature'],
  token: true,
  oracleText: 'Sacrifice this token: Add {C}.',
  effects: effectsFromTokenSpec({ name: 'Eldrazi Spawn', types: ['Creature'], sacrificeForMana: { C: 1 } }),
})

const basic = (name: 'Forest' | 'Mountain'): CardTemplate => cardTemplate(name, {
  types: ['Land'],
  subtypes: [name],
  supertypes: ['Basic'],
  tapProduces: { [name === 'Forest' ? 'G' : 'R']: 1 },
  oracleText: `{T}: Add {${name === 'Forest' ? 'G' : 'R'}}.`,
})

/** Names of the sources the planner uses to cast Planner Spell, in plan order. */
const plannedSources = (server: ReturnType<typeof game>) => {
  const objectId = named(server.state, 'Planner Spell')[0].id
  const action = availableActions(server.state, 'p1').find((candidate) =>
    candidate.kind === 'castSpell' && candidate.objectId === objectId)!
  return eventsForAvailableAction(server.state, 'p1', action)!.flatMap((event) =>
    event.type === 'tapForMana' || event.type === 'activateAbility'
      ? [server.state.objects[event.objectId].name]
      : [])
}

describe('planning prefers lands over sacrifice sources', () => {
  test.each([
    ['land first', [basic('Forest'), treasure()]],
    ['treasure first', [treasure(), basic('Forest')]],
  ])('a {G} spell taps the Forest, not the Treasure (%s)', (_, battlefield) => {
    expect(plannedSources(game(battlefield, [spell('{G}')]))).toEqual(['Forest'])
  })

  test.each([
    ['land first', [basic('Forest'), treasure()]],
    ['treasure first', [treasure(), basic('Forest')]],
  ])('the Treasure is spent when it is genuinely needed (%s)', (_, battlefield) => {
    expect(plannedSources(game(battlefield, [spell('{G}{R}')])).sort())
      .toEqual(['Forest', 'Treasure'])
  })

  test('an Eldrazi Spawn is kept when a land pays, in either order', () => {
    expect(plannedSources(game([spawn(), basic('Mountain')], [spell('{1}')])))
      .toEqual(['Mountain'])
    expect(plannedSources(game([basic('Mountain'), spawn()], [spell('{1}')])))
      .toEqual(['Mountain'])
  })
})

describe('sacrifice-this mana abilities', () => {
  test('tapping a Treasure adds the chosen color and sacrifices it', () => {
    const server = game([treasure()])
    const [token] = named(server.state, 'Treasure')
    const next = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: token.id,
      mana: 'R',
    }))
    expect(next.players.p1.mana).toMatchObject({ R: 1, G: 0 })
    expect(next.objects[token.id]?.zone === 'battlefield').toBe(false)
  })

  test('a Treasure needs a color and cannot make colorless mana', () => {
    const server = game([treasure()])
    const objectId = named(server.state, 'Treasure')[0].id
    const bare = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId })
    expect(bare.ok).toBe(false)
    expect(bare.ok === false && bare.error).toContain('needs a mana color')
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'C',
    }).ok).toBe(false)
  })

  test('a Treasure made by createTreasures can be spent the same way', () => {
    const server = game([cardTemplate('Maker', {
      types: ['Creature'],
      effects: [activate({ id: 'maker.treasures', costs: {}, do: [createTreasures(2, 'you')] })],
    })])
    const maker = named(server.state, 'Maker')[0]
    const stacked = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: maker.id,
      abilityId: 'maker.treasures',
    }))
    const made = resolveStack(server.rules, stacked)
    const tokens = named(made, 'Treasure')
    expect(tokens).toHaveLength(2)
    const spent = ok(server.rules(made, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: tokens[0].id,
      mana: 'U',
    }))
    expect(spent.players.p1.mana.U).toBe(1)
    expect(named(spent, 'Treasure').filter((object) => object.zone === 'battlefield'))
      .toHaveLength(1)
  })

  test('the planner spends one Treasure per colored mana to fund a spell', () => {
    const server = game([treasure(), treasure()], [spell('{U}{R}')])
    const objectId = named(server.state, 'Planner Spell')[0].id
    const action = availableActions(server.state, 'p1').find((candidate) =>
      candidate.kind === 'castSpell' && candidate.objectId === objectId)!
    const events = eventsForAvailableAction(server.state, 'p1', action)!
    expect(events.map((event) => event.type)).toEqual(['tapForMana', 'tapForMana', 'castSpell'])
    const next = events.reduce(
      (current: GameState, event) => ok(server.rules(current, event)),
      server.state,
    )
    expect(next.objects[objectId].zone).toBe('stack')
    expect(named(next, 'Treasure').filter((object) => object.zone === 'battlefield'))
      .toHaveLength(0)
  })

  test('a creature with a no-{T} sacrifice ability works while summoning sick', () => {
    const thrull = cardTemplate('Test Thrull', {
      types: ['Creature'],
      summoningSickness: true,
      oracleText: 'Sacrifice this creature: Add {B}{B}.',
    })
    const server = game([thrull], [spell('{B}{B}')])
    const objectId = named(server.state, 'Planner Spell')[0].id
    const action = availableActions(server.state, 'p1').find((candidate) =>
      candidate.kind === 'castSpell' && candidate.objectId === objectId)!
    const events = eventsForAvailableAction(server.state, 'p1', action)!
    const next = events.reduce(
      (current: GameState, event) => ok(server.rules(current, event)),
      server.state,
    )
    expect(next.objects[objectId].zone).toBe('stack')
    expect(named(next, 'Test Thrull').filter((object) => object.zone === 'battlefield'))
      .toHaveLength(0)
  })

  test('an altar that sacrifices another creature is not a free tap', () => {
    const server = game([cardTemplate('Test Altar', {
      types: ['Artifact'],
      oracleText: 'Sacrifice a creature: Add {C}{C}.',
    })])
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: named(server.state, 'Test Altar')[0].id,
    }).ok).toBe(false)
  })

  test('Dryad Arbor taps for {G} through its Forest type', () => {
    const arbor = cardTemplate('Dryad Arbor', {
      types: ['Land', 'Creature'],
      subtypes: ['Forest', 'Dryad'],
      oracleText: '(Dryad Arbor is green.)',
    })
    const server = game([arbor])
    const objectId = named(server.state, 'Dryad Arbor')[0].id
    server.state.objects[objectId].summoningSickness = false
    const next = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId }))
    expect(next.players.p1.mana.G).toBe(1)
  })

  test('an Eldrazi Spawn funds a spell through its explicit ability while summoning sick', () => {
    const sickSpawn = cardTemplate('Eldrazi Spawn', {
      types: ['Creature'],
      subtypes: ['Eldrazi', 'Spawn'],
      summoningSickness: true,
      token: true,
      oracleText: 'Sacrifice this token: Add {C}.',
      effects: effectsFromTokenSpec({ name: 'Eldrazi Spawn', types: ['Creature'], sacrificeForMana: { C: 1 } }),
    })
    const server = game([sickSpawn], [spell('{1}')])
    const objectId = named(server.state, 'Planner Spell')[0].id
    const action = availableActions(server.state, 'p1').find((candidate) =>
      candidate.kind === 'castSpell' && candidate.objectId === objectId)!
    const events = eventsForAvailableAction(server.state, 'p1', action)!
    expect(events.map((event) => event.type)).toEqual(['activateAbility', 'castSpell'])
    const next = events.reduce(
      (current: GameState, event) => ok(server.rules(current, event)),
      server.state,
    )
    expect(next.objects[objectId].zone).toBe('stack')
    expect(named(next, 'Eldrazi Spawn').filter((object) => object.zone === 'battlefield'))
      .toHaveLength(0)
  })
})

describe('relocated from homerRest.test.ts → selfSacrificeMana.test.ts', () => {
  const createServerGame: typeof createRuntimeGame = (format, options) =>
    createRuntimeGame(format, options, {
      random: () => 0.5,
      cardPlugins: [
        choiceEffects,
        entersTapped,
        librarySearch,
        onResolve,
        targetedResolve,
        activated,
      ],
    })

  const named = (state: import('../types').GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Malevolent Rumble creates a functional Eldrazi Spawn', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Malevolent Rumble', { types: ['Sorcery'], manaCost: '{0}' })] },
          libraries: {
            p1: [
              cardTemplate('Permanent', { types: ['Artifact'] }),
              cardTemplate('One', { types: ['Instant'] }),
              cardTemplate('Two', { types: ['Instant'] }),
              cardTemplate('Three', { types: ['Instant'] }),
            ],
          },
        },
      )
      const cast = ok(server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(server.state, 'Malevolent Rumble').id,
      }))
      const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(named(choosing, 'Eldrazi Spawn')).toBeUndefined()
      const selection = pendingSelectionFor(choosing, 'p1')!
      const permanent = named(choosing, 'Permanent')
      expect(selection.candidates).toEqual([permanent.id])
      const resolved = ok(server.rules(JSON.parse(JSON.stringify(choosing)), {
        type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count, objectIds: [permanent.id],
      }))
      const spawn = named(resolved, 'Eldrazi Spawn')
      expect(spawn.effects).toEqual([])
      expect(spawn.ruleDefinition).toBeDefined()
      expect(spawn).toMatchObject({
        types: ['Creature'],
        subtypes: ['Eldrazi', 'Spawn'],
        power: 0,
        toughness: 1,
      })
      const sacrificed = ok(server.rules(resolved, {
        type: 'activateAbility',
        abilityId: '$.abilities[0]',
        seat: 'p1',
        objectId: spawn.id,
        manaAbility: true,
      }))
      // CR 704.5d: the sacrificed token ceases to exist, but its mana was already made.
      expect(sacrificed.objects[spawn.id]).toBeUndefined()
      expect(sacrificed.players.p1.mana.C).toBe(1)
    })

})
