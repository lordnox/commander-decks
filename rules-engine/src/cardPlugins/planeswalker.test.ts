import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction } from '../actions'
import { cardTemplate, planeswalker } from '../newGame'
import { commanderRules } from '../formats'
import { createServerGame } from '../runtime'

const ugin = (loyalty = 7) => planeswalker('Ugin, the Spirit Dragon', 7, {
  manaCost: '{8}',
  manaValue: 8,
  counters: { loyalty },
  oracleText:
    '+2: Ugin deals 3 damage to any target.\n−X: Exile each permanent with mana value X or less that’s one or more colors.\n−10: You gain 7 life, draw seven cards, then put up to seven permanent cards from your hand onto the battlefield.',
})

const gameWithUgin = (loyalty = 7, extras: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    battlefield: { p1: [ugin(loyalty)] },
    ...extras,
  })

const uginId = (state: ReturnType<typeof gameWithUgin>['state']) =>
  Object.values(state.objects).find((object) => object.name === 'Ugin, the Spirit Dragon')!.id

describe('planeswalker loyalty abilities', () => {
  test('+2 pays loyalty and deals 3 to any target from the stack', () => {
    const runtime = gameWithUgin()
    const id = uginId(runtime.state)
    const activated = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'ugin.plus-two',
      seat: 'p1',
      objectId: id,
      targets: [{ kind: 'player', player: 'p2' }],
    })
    if (!activated.ok) throw new Error(activated.error)
    expect(activated.state.objects[id].counters.loyalty).toBe(9)
    expect(activated.state.players.p2.life).toBe(40)
    expect(activated.state.stack[0].kind).toBe('ability')

    const resolved = runtime.rules(activated.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.players.p2.life).toBe(37)
  })

  test('+2 accepts a battlefield object as its any target', () => {
    const target = cardTemplate('Target Creature', {
      types: ['Creature'],
      power: 4,
      toughness: 4,
    })
    const runtime = gameWithUgin(7, {
      battlefield: { p1: [ugin(7)], p2: [target] },
    })
    const id = uginId(runtime.state)
    const targetId = Object.values(runtime.state.objects)
      .find((object) => object.name === 'Target Creature')!.id
    const activated = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'ugin.plus-two',
      seat: 'p1',
      objectId: id,
      targets: [{ kind: 'object', objectId: targetId }],
    })
    if (!activated.ok) throw new Error(activated.error)
    const resolved = runtime.rules(activated.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.objects[targetId].damageMarked).toBe(3)
  })

  test('−X exiles colored permanents at the chosen mana value or less', () => {
    const green = cardTemplate('Green Permanent', {
      types: ['Enchantment'],
      manaValue: 3,
      colors: ['G'],
    })
    const colorless = cardTemplate('Colorless Permanent', {
      types: ['Artifact'],
      manaValue: 2,
      colors: [],
    })
    const expensive = cardTemplate('Expensive Permanent', {
      types: ['Creature'],
      manaValue: 5,
      colors: ['B'],
    })
    const runtime = gameWithUgin(7, {
      battlefield: { p1: [ugin(7)], p2: [green, colorless, expensive] },
    })
    const id = uginId(runtime.state)
    const activated = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'ugin.minus-x',
      seat: 'p1',
      objectId: id,
      x: 3,
    })
    if (!activated.ok) throw new Error(activated.error)
    expect(activated.state.objects[id].counters.loyalty).toBe(4)
    const resolved = runtime.rules(activated.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(Object.values(resolved.state.objects).find((object) => object.name === 'Green Permanent')?.zone)
      .toBe('exile')
    expect(Object.values(resolved.state.objects).find((object) => object.name === 'Colorless Permanent')?.zone)
      .toBe('battlefield')
    expect(Object.values(resolved.state.objects).find((object) => object.name === 'Expensive Permanent')?.zone)
      .toBe('battlefield')
  })

  test('−10 gains and draws seven, then puts only the chosen permanents onto the battlefield', () => {
    const permanents = Array.from({ length: 8 }, (_, index) =>
      cardTemplate(`Permanent ${index + 1}`, { types: ['Artifact'] }))
    const runtime = gameWithUgin(10, {
      libraries: { p1: Array.from({ length: 7 }, (_, index) => cardTemplate(`Draw ${index + 1}`)) },
      hands: { p1: permanents },
    })
    const id = uginId(runtime.state)
    const choices = runtime.state.zoneOrder.p1.hand.slice(0, 7)
    const activated = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'ugin.minus-ten',
      seat: 'p1',
      objectId: id,
      choices,
    })
    if (!activated.ok) throw new Error(activated.error)
    expect(activated.state.objects[id].zone).toBe('graveyard')
    const resolved = runtime.rules(activated.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.players.p1.life).toBe(47)
    expect(resolved.state.zoneOrder.p1.hand).toHaveLength(8)
    expect(choices.every((choice) => resolved.state.objects[choice].zone === 'battlefield')).toBe(true)
  })

  test('a walker activates once per turn and cannot pay unavailable loyalty', () => {
    const runtime = gameWithUgin(7)
    const id = uginId(runtime.state)
    const tooMuch = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'ugin.minus-ten',
      seat: 'p1',
      objectId: id,
    })
    expect(tooMuch.ok).toBe(false)

    const first = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'ugin.minus-x',
      seat: 'p1',
      objectId: id,
      x: 0,
    })
    if (!first.ok) throw new Error(first.error)
    const resolved = runtime.rules(first.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    const second = runtime.rules(resolved.state, {
      type: 'activateAbility',
      abilityId: 'ugin.minus-x',
      seat: 'p1',
      objectId: id,
      x: 0,
    })
    expect(second.ok).toBe(false)
  })

  test('the action runner emits a no-target fixed loyalty activation', () => {
    const runtime = gameWithUgin(10)
    const action = availableActions(runtime.state, 'p1').find(
      (candidate) =>
        candidate.kind === 'activateAbility'
        && candidate.text.startsWith('−10:'),
    )
    expect(action).toBeDefined()
    expect(eventsForAvailableAction(runtime.state, 'p1', action!)).toEqual([{
      type: 'activateAbility',
      abilityId: 'ugin.minus-ten',
      seat: 'p1',
      objectId: uginId(runtime.state),
    }])
  })
})
