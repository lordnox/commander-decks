import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { cardTemplate } from '../newGame'
import { bears, newGame } from '../testGame'
import { turnStructure } from '../plugins/turnStructure'
import {
  changeController,
  changeStats,
  continuousEffects,
  untilEndOfTurn,
  whileSourceTappedAndPowerAtMost,
} from './continuousEffects'

describe('continuous effect durations', () => {
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
    untilEndOfTurn(target, changeController(target, 'p1'))

    let result = rules(state, { type: 'untap', objectId: source.id }, catalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.objects[target.id].controller).toBe('p1')

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
})
