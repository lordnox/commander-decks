import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { bears, newGame } from '../testGame'
import { turnStructure } from '../plugins/turnStructure'
import {
  animateUntilEndOfTurn,
  changeController,
  changeStats,
  continuousEffects,
  copyObject,
  untilEndOfTurn,
  whileSourceTappedAndPowerAtMost,
} from './continuousEffects'

import {commanderRules} from '../formats'
import {createServerGame} from '../runtime'
import {ok, resolveStack} from '../testHelpers'
import {activated} from './activated'
import {effectsOf} from './cardRules'







describe('continuous effect durations', () => {
  test('cleanup reverts a land animation while retaining its original type', () => {
    const catalog = createCatalog([turnStructure, continuousEffects])
    const state = newGame({
      battlefield: { p1: [cardTemplate('Dry Land', { types: ['Land'] })] },
      builtinRules: ['turnStructure', 'continuousEffects'],
    })
    const land = Object.values(state.objects)[0]
    animateUntilEndOfTurn(land, 3, 3)
    expect(land).toMatchObject({
      types: ['Land', 'Creature'],
      power: 3,
      toughness: 3,
    })

    const result = rules(
      { ...state, step: 'end' },
      { type: 'advanceStep' },
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[land.id]).toMatchObject({
      types: ['Land'],
      power: null,
      toughness: null,
    })
  })

  test('cleanup reverts a temporary pump', () => {
    const catalog = createCatalog([turnStructure, continuousEffects])
    const state = newGame({
      battlefield: { p1: [bears()] },
      builtinRules: ['turnStructure', 'continuousEffects'],
    })
    const creature = Object.values(state.objects)[0]
    untilEndOfTurn(creature, changeStats(creature, 2, 2))
    expect(creature.power).toBe(4)
    expect(creature.toughness).toBe(4)

    const result = rules(
      { ...state, step: 'end' },
      { type: 'advanceStep' },
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[creature.id].power).toBe(2)
    expect(result.state.objects[creature.id].toughness).toBe(2)
    expect(result.state.objects[creature.id].continuousEffects).toBeUndefined()
  })

  test('an until-end-of-turn effect created later in cleanup waits for the next cleanup', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      battlefield: { p1: [bears()] },
      builtinRules: ['continuousEffects'],
    })
    state.step = 'cleanup'
    const creature = Object.values(state.objects)[0]
    untilEndOfTurn(creature, changeStats(creature, 2, 2))

    const result = rules(state, { type: 'custom', name: 'test.createdInCleanup' }, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[creature.id].power).toBe(4)
    expect(result.state.objects[creature.id].continuousEffects).toHaveLength(1)
  })

  test('a temporary characteristic change ends when the object leaves the battlefield', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      battlefield: { p1: [bears()] },
      builtinRules: ['continuousEffects'],
    })
    const creature = Object.values(state.objects)[0]
    untilEndOfTurn(creature, changeStats(creature, 2, 2))

    const result = rules(
      state,
      { type: 'move', objectId: creature.id, to: 'graveyard' },
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[creature.id]).toMatchObject({
      zone: 'graveyard',
      power: 2,
      toughness: 2,
    })
    expect(result.state.objects[creature.id].continuousEffects).toBeUndefined()
  })

  test('conditional control ends when its source untaps', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      battlefield: {
        p1: [cardTemplate('Old Man', { types: ['Creature'], power: 2, toughness: 3 })],
        p2: [bears()],
      },
      builtinRules: ['continuousEffects'],
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Old Man')!
    const target = Object.values(state.objects).find((object) => object.controller === 'p2')!
    source.tapped = true
    whileSourceTappedAndPowerAtMost(
      state,
      target,
      changeController(target, 'p1'),
      source.id,
    )
    expect(target.controller).toBe('p1')

    const result = rules(state, { type: 'untap', objectId: source.id }, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[target.id].controller).toBe('p2')
    expect(result.state.objects[target.id].continuousEffects).toBeUndefined()
  })

  test('conditional control ends when the target outgrows its source', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      battlefield: {
        p1: [cardTemplate('Old Man', { types: ['Creature'], power: 2, toughness: 3 })],
        p2: [bears()],
      },
      builtinRules: ['continuousEffects'],
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Old Man')!
    const target = Object.values(state.objects).find((object) => object.controller === 'p2')!
    source.tapped = true
    whileSourceTappedAndPowerAtMost(
      state,
      target,
      changeController(target, 'p1'),
      source.id,
    )
    target.power = 3

    const result = rules(state, { type: 'custom', name: 'test.powerChanged' }, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[target.id].controller).toBe('p2')
  })

  test('a for-as-long-as effect does nothing when its duration never starts', () => {
    const state = newGame({
      battlefield: {
        p1: [cardTemplate('Old Man', { types: ['Creature'], power: 2, toughness: 3 })],
        p2: [bears()],
      },
      builtinRules: ['continuousEffects'],
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Old Man')!
    const target = Object.values(state.objects).find((object) => object.controller === 'p2')!

    whileSourceTappedAndPowerAtMost(
      state,
      target,
      changeController(target, 'p1'),
      source.id,
    )

    expect(target.controller).toBe('p2')
    expect(target.continuousEffects).toBeUndefined()
  })

  test('an earlier duration ending does not overwrite a later control effect', () => {
    const catalog = createCatalog([turnStructure, continuousEffects])
    const state = newGame({
      players: ['p1', 'p2', 'p3'],
      battlefield: {
        p1: [cardTemplate('Old Man', { types: ['Creature'], power: 2, toughness: 3 })],
        p2: [bears()],
      },
      builtinRules: ['turnStructure', 'continuousEffects'],
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Old Man')!
    const target = Object.values(state.objects).find((object) => object.controller === 'p2')!
    source.tapped = true
    whileSourceTappedAndPowerAtMost(
      state,
      target,
      changeController(target, 'p1'),
      source.id,
    )
    untilEndOfTurn(target, changeController(target, 'p3'))

    let result = rules(state, { type: 'untap', objectId: source.id }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[target.id].controller).toBe('p3')

    result = rules(
      { ...result.state, step: 'end' },
      { type: 'advanceStep' },
      catalog,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[target.id].controller).toBe('p2')
    expect(result.state.objects[target.id].continuousEffects).toBeUndefined()
  })

  test('an expiring copy replays a later pump that remains active', () => {
    const catalog = createCatalog([continuousEffects])
    const state = newGame({
      battlefield: {
        p1: [cardTemplate('Shapeshifter', { types: ['Creature'], power: 6, toughness: 6 })],
        p2: [bears()],
      },
      builtinRules: ['continuousEffects'],
    })
    const source = Object.values(state.objects).find(
      (object) => object.name === 'Shapeshifter',
    )!
    const target = Object.values(state.objects).find((object) => object.controller === 'p2')!
    source.tapped = true
    whileSourceTappedAndPowerAtMost(
      state,
      target,
      copyObject(target, source),
      source.id,
    )
    untilEndOfTurn(target, changeStats(target, 1, 1))

    const result = rules(state, { type: 'untap', objectId: source.id }, catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[target.id]).toMatchObject({
      name: 'Grizzly Bears',
      power: 3,
      toughness: 3,
    })
    expect(result.state.objects[target.id].continuousEffects).toHaveLength(1)
  })
})

describe('relocated from firdochCore.test.ts → untilEot.test.ts', () => {
  const firdochCore = () => cardTemplate('Firdoch Core', {
    types: ['Artifact'],
    oracleText:
      'Changeling (This card is every creature type.)\n'
      + '{T}: Add one mana of any color.\n'
      + '{4}: This artifact becomes a 4/4 artifact creature until end of turn.',
  })


  test('Firdoch Core animates until cleanup without losing its artifact or changeling traits', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [firdochCore()] } },
      { random: () => 0, cardPlugins: [activated] },
    )
    const objectId = server.state.zoneOrder.p1.battlefield[0]
    expect(server.state.objects[objectId]).toMatchObject({
      types: ['Artifact'],
      power: null,
      toughness: null,
    })

    server.state.players.p1.mana.C = 4
    const activationState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'animate.firdochCore',
      seat: 'p1',
      objectId,
    }))
    const animated = resolveStack(server.rules, activationState)
    expect(animated.objects[objectId]).toMatchObject({
      types: ['Artifact', 'Creature'],
      power: 4,
      toughness: 4,
    })
    expect(effectsOf(animated.objects[objectId])).toContainEqual({
      op: 'static',
      allCreatureTypes: true,
    })

    const combat = structuredClone(animated)
    combat.step = 'declareAttackers'
    const attack = server.rules(combat, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId, defender: 'p2' }],
    })
    expect(attack.ok).toBe(true)

    const cleanup = ok(server.rules(
      { ...animated, step: 'end' },
      { type: 'advanceStep' },
    ))
    expect(cleanup.objects[objectId]).toMatchObject({
      types: ['Artifact'],
      power: null,
      toughness: null,
    })

    const tappedForMana = ok(server.rules(cleanup, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'U',
    }))
    expect(tappedForMana.players.p1.mana.U).toBe(1)
  })

  test('an artifact that entered this turn remains summoning sick when animated', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [firdochCore()] } },
      { random: () => 0, cardPlugins: [activated] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId,
      to: 'battlefield',
    }))
    expect(entered.objects[objectId].summoningSickness).toBe(true)

    entered.players.p1.mana.C = 4
    const activationState = ok(server.rules(entered, {
      type: 'activateAbility',
      abilityId: 'animate.firdochCore',
      seat: 'p1',
      objectId,
    }))
    const animated = resolveStack(server.rules, activationState)
    animated.step = 'declareAttackers'

    const attack = server.rules(animated, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId, defender: 'p2' }],
    })
    expect(attack.ok).toBe(false)
    if (attack.ok) return
    expect(attack.error).toContain('summoning sickness')
  })

})

describe('relocated from sinFallGaps.test.ts → untilEot.test.ts', () => {
  const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types, ...extra })

  const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Hall of Storm Giants animates when the graveyard is deep enough', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: { p1: [card('Hall of Storm Giants', ['Land'])] },
          libraries: {
            p1: Array.from({ length: 7 }, (_, index) =>
              card(`Filler ${index}`, ['Instant'], { zone: 'graveyard' as const })),
          },
        },
        { random: () => 0.5, cardPlugins: [activated] },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 6 }
      const hall = named(ready, 'Hall of Storm Giants').id
      const activatedState = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: 'hall.animate',
        seat: 'p1',
        objectId: hall,
      }))
      const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
      expect(resolved.objects[hall]).toMatchObject({
        types: ['Land', 'Creature'],
        power: 7,
        toughness: 7,
      })
    })

  test('Lair of the Hydra pays X and becomes an X/X', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: { p1: [card('Lair of the Hydra', ['Land'])] },
        },
        { random: () => 0.5, cardPlugins: [activated] },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 4 }
      const lair = named(ready, 'Lair of the Hydra').id
      const illegal = server.rules(ready, {
        type: 'activateAbility',
        abilityId: 'lair.animate',
        seat: 'p1',
        objectId: lair,
        x: 0,
      })
      expect(illegal.ok).toBe(false)
      const activatedState = ok(server.rules(ready, {
        type: 'activateAbility',
        abilityId: 'lair.animate',
        seat: 'p1',
        objectId: lair,
        x: 4,
      }))
      const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
      expect(resolved.objects[lair]).toMatchObject({ power: 4, toughness: 4 })
      expect(resolved.players.p1.mana).toMatchObject({ G: 0, C: 0 })
    })

})
