import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { activate, draw } from './effectBuilders'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { bears, newGame } from '../testGame'
import { ok } from '../testHelpers'
import { turnStructure } from '../plugins/turnStructure'
import {
  continuousEffects,
  loseAbilitiesBecome,
  permanent,
} from './continuousEffects'
import {
  entersTargetingOpponent,
  loseAbilitiesBecome as loseAbilitiesBecomeInstruction,
  onResolve,
} from './effectBuilders'
import { onResolve as onResolvePlugin } from './onResolve'

const shrinkingColossus = () => cardTemplate('Fixture Shrinking Colossus', {
  types: ['Creature'],
  power: 4,
  toughness: 4,
  effects: [
    entersTargetingOpponent(
      loseAbilitiesBecomeInstruction('Coward', 1, 1),
    ),
  ],
})

const cowardMaker = () => cardTemplate('Fixture Coward Maker', {
  types: ['Sorcery'],
  effects: [onResolve(loseAbilitiesBecomeInstruction('Coward', 1, 1))],
})

const abilityBear = () => cardTemplate('Fixture Ability Bear', {
  types: ['Creature'],
  power: 3,
  toughness: 3,
  subtypes: ['Bear'],
  oracleText: '{T}: Draw a card.',
  effects: [
    activate({
      id: 'draw',
      costs: { tap: true },
      do: [draw(1)],
    }),
  ],
})

describe('loseAbilitiesBecome', () => {
  test('stamps each creature the chosen opponent controls and survives cleanup', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        battlefield: {
          p1: [shrinkingColossus()],
          p2: [abilityBear(), bears()],
          p3: [bears()],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = structuredClone(server.state)
    state.active = 'p1'
    state.priority = 'p1'
    const source = Object.values(state.objects).find(
      (object) => object.name === 'Fixture Shrinking Colossus',
    )!
    state = ok(server.rules(state, { type: 'move', objectId: source.id, to: 'battlefield' }))
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice.candidates).toEqual(['p2', 'p3', 'p4'])
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))

    const p2Creatures = Object.values(state.objects).filter(
      (object) =>
        object.zone === 'battlefield'
        && object.controller === 'p2'
        && object.types.includes('Creature'),
    )
    expect(p2Creatures).toHaveLength(2)
    for (const creature of p2Creatures) {
      expect(creature.power).toBe(1)
      expect(creature.toughness).toBe(1)
      expect(creature.oracleText).toBe('')
      expect(creature.effects).toEqual([])
      expect(creature.subtypes).toContain('Coward')
      expect(creature.continuousEffects?.[0]?.duration).toEqual({ kind: 'permanent' })
    }

    const untouched = Object.values(state.objects).find(
      (object) => object.controller === 'p3' && object.types.includes('Creature'),
    )!
    expect(untouched.power).toBe(2)

    state = ok(server.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))
    expect(p2Creatures.map((creature) => state.objects[creature.id].power)).toEqual([1, 1])
  })

  test('on-resolve spells open opponent selection when no target is stamped yet', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: { p1: [cowardMaker()] },
        battlefield: { p2: [abilityBear()] },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = structuredClone(server.state)
    state.active = 'p1'
    state.priority = 'p1'
    state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 10 }
    const spell = state.zoneOrder.p1.hand[0]
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    const restarted = structuredClone(state)
    expect(pendingPlayerSelectionFor(restarted, 'p1')?.id).toBe(choice.id)
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    const bear = Object.values(state.objects).find(
      (object) => object.name === 'Fixture Ability Bear',
    )!
    expect(bear.power).toBe(1)
    expect(bear.effects).toEqual([])
    expect(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'draw',
      seat: 'p2',
      objectId: bear.id,
    }).ok).toBe(false)
  })

  test('does not restamp creatures that enter later under that opponent', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      players: ['p1', 'p2'],
      battlefield: { p2: [bears()] },
      builtinRules: ['continuousEffects'],
    })
    const existing = Object.values(state.objects).find((object) => object.controller === 'p2')!
    permanent(existing, loseAbilitiesBecome(existing, {
      extraSubtype: 'Coward',
      power: 1,
      toughness: 1,
    }))

    const later = bears()
    later.id = 'later-bear'
    later.controller = 'p2'
    later.owner = 'p2'
    state.objects[later.id] = later
    state.zoneOrder.p2.battlefield.push(later.id)

    expect(state.objects[later.id].power).toBe(2)
    expect(state.objects[existing.id].power).toBe(1)
  })

  test('reverts when the creature leaves the battlefield', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      battlefield: { p2: [abilityBear()] },
      builtinRules: ['continuousEffects'],
    })
    const bear = Object.values(state.objects)[0]
    permanent(bear, loseAbilitiesBecome(bear, {
      extraSubtype: 'Coward',
      power: 1,
      toughness: 1,
    }))

    const result = rules(
      state,
      { type: 'move', objectId: bear.id, to: 'graveyard' },
      catalog,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[bear.id]).toMatchObject({
      zone: 'graveyard',
      power: 3,
      toughness: 3,
    })
    expect(result.state.objects[bear.id].effects?.length).toBe(1)
  })

  test('structuredClone keeps pending opponent selection and continuous effects', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [cowardMaker()] } },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana.C = 10
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: state.zoneOrder.p1.hand[0],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const clone = structuredClone(state)
    expect(pendingPlayerSelectionFor(clone, 'p1')).toEqual(
      pendingPlayerSelectionFor(state, 'p1'),
    )
  })

  test('permanent duration survives turn cleanup unlike until-end-of-turn pumps', () => {
    const catalog = createCatalog([turnStructure, continuousEffects])
    const state = newGame({
      battlefield: { p2: [bears()] },
      builtinRules: ['turnStructure', 'continuousEffects'],
    })
    const creature = Object.values(state.objects)[0]
    permanent(creature, loseAbilitiesBecome(creature, {
      extraSubtype: 'Coward',
      power: 1,
      toughness: 1,
    }))

    const result = rules({ ...state, step: 'end' }, { type: 'advanceStep' }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[creature.id].power).toBe(1)
    expect(result.state.objects[creature.id].continuousEffects).toHaveLength(1)
  })
})
