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
