import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import {
  draw,
  enters,
  grantControlledSubtypeTrigger as grantBuilder,
} from './effects'
import { grantControlledSubtypeTrigger } from './grantControlledSubtypeTrigger'

const sliver = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    subtypes: ['Fixture Sliver'],
    ...extra,
  })

const lord = (...instructions: ReturnType<typeof draw>[]) =>
  sliver('Fixture Sliver Lord', {
    effects: [
      grantBuilder('Fixture Sliver', 'enters', ...instructions),
    ],
    grantedRules: ['grantControlledSubtypeTrigger'],
  })

describe('grantControlledSubtypeTrigger', () => {
  test('grants an enters draw to matching creatures while the lord is on the battlefield', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [lord(draw(1))] },
        hands: { p1: [sliver('Fixture Sliver Scout')] },
        libraries: { p1: [cardTemplate('Fixture Drawn Card', { types: ['Instant'] })] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantControlledSubtypeTrigger] },
    )
    const scoutId = server.state.zoneOrder.p1.hand[0]

    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: scoutId,
      to: 'battlefield',
    }))
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0]).toMatchObject({
      kind: 'ability',
      objectId: scoutId,
      name: 'Fixture Sliver Scout',
    })

    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('the lord grants the trigger to itself when it matches the subtype', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [lord(draw(1)), sliver('Fixture Sliver Recruit')] },
        libraries: { p1: [cardTemplate('Fixture Top Card', { types: ['Instant'] })] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantControlledSubtypeTrigger] },
    )
    const [lordId, recruitId] = server.state.zoneOrder.p1.hand

    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: lordId,
      to: 'battlefield',
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)

    state = ok(server.rules(state, {
      type: 'move',
      objectId: recruitId,
      to: 'battlefield',
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('leaving the lord removes the grant before another sliver enters', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [lord(draw(1))] },
        libraries: { p1: [sliver('Fixture Sliver Latecomer')] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantControlledSubtypeTrigger] },
    )
    const lordId = server.state.zoneOrder.p1.battlefield[0]
    const scoutId = server.state.zoneOrder.p1.library[0]

    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: lordId,
      to: 'graveyard',
    }))
    state = ok(server.rules(state, {
      type: 'move',
      objectId: scoutId,
      to: 'battlefield',
    }))
    expect(state.stack).toHaveLength(0)
  })

  test('stamped granted triggers clone without matchers', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [lord(draw(1))] },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [grantControlledSubtypeTrigger] },
    )
    const lordId = server.state.zoneOrder.p1.hand[0]
    const state = ok(server.rules(server.state, {
      type: 'move',
      objectId: lordId,
      to: 'battlefield',
    }))
    const stamped = state.objects[lordId].effects?.filter((effect) => effect.op === 'trigger')
    expect(stamped).toEqual([enters(draw(1))])
    expect(() => structuredClone(state)).not.toThrow()
  })
})
