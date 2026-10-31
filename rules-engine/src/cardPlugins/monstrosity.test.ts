import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { card as dslCard, becomesMonstrous, compileCardRuleDefinition, createDefinitionSnapshot, draw as dslDraw, ref, whenever } from './dsl/v1'
import { activated } from './activated'
import {
  monstrosity as monstrosityEffect,
} from './effects'
import { MONSTROSITY_ABILITY as PLUGIN_ABILITY, monstrosity as monstrosityPlugin } from './monstrosity'

const monstrousDraw = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
  whenever(becomesMonstrous(ref('self')), { instructions: [dslDraw(1)] }),
])))

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const rampagingMireling = () => cardTemplate('Rampaging Mireling', {
  types: ['Creature'],
  power: 1,
  toughness: 1,
  effects: [monstrosityEffect('{2}{G}', 2)],
  ruleDefinition: monstrousDraw,
})

const mana = (state: GameState, seat = 'p1') => {
  state.players[seat].mana = { W: 0, U: 0, B: 0, R: 0, G: 10, C: 10 }
  return state
}

describe('monstrosity', () => {
  test('activates once, puts counters, marks monstrous, and triggers becomesMonstrous', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [rampagingMireling()] },
        libraries: { p1: [cardTemplate('Top card', { types: ['Instant'] })] },
      },
      { random: () => 0.5, cardPlugins: [activated, monstrosityPlugin] },
    )
    let state = mana(structuredClone(server.state))
    const creature = named(state, 'Rampaging Mireling')
    expect(creature.monstrous).toBeUndefined()

    const offer = legalActsFor(state, 'p1').find((action) =>
      action.kind === 'activateAbility' && action.abilityId === PLUGIN_ABILITY)
    expect(offer).toMatchObject({
      kind: 'activateAbility',
      objectId: creature.id,
      abilityId: PLUGIN_ABILITY,
    })

    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: creature.id,
      abilityId: PLUGIN_ABILITY,
    }))
    state = resolveStack(server.rules, state)
    state = resolveStack(server.rules, state)
    const live = named(state, 'Rampaging Mireling')
    expect(live.monstrous).toBe(true)
    expect(live.counters['+1/+1']).toBe(2)
    expect(live.power).toBe(3)
    expect(live.toughness).toBe(3)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('rejects a second activation while monstrous', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [rampagingMireling()] } },
      { random: () => 0.5, cardPlugins: [activated, monstrosityPlugin] },
    )
    let state = mana(structuredClone(server.state))
    const creature = named(state, 'Rampaging Mireling')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: creature.id,
      abilityId: PLUGIN_ABILITY,
    }))
    state = resolveStack(server.rules, state)

    const repeat = legalActsFor(state, 'p1').find((action) =>
      action.kind === 'activateAbility' && action.abilityId === PLUGIN_ABILITY)
    expect(repeat).toBeUndefined()

    const illegal = server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: creature.id,
      abilityId: PLUGIN_ABILITY,
    })
    expect(illegal.ok).toBe(false)
  })

  test('clears monstrous when the creature changes zones', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Rampaging Mireling', {
            types: ['Creature'],
            power: 1,
            toughness: 1,
            effects: [monstrosityEffect('{2}{G}', 2)],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [activated, monstrosityPlugin] },
    )
    let state = mana(structuredClone(server.state))
    const creature = named(state, 'Rampaging Mireling')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: creature.id,
      abilityId: PLUGIN_ABILITY,
    }))
    state = resolveStack(server.rules, state)
    expect(named(state, 'Rampaging Mireling').monstrous).toBe(true)

    state = ok(server.rules(state, {
      type: 'move',
      objectId: creature.id,
      to: 'exile',
    }))
    expect(state.objects[creature.id]?.monstrous).toBe(false)

    state = ok(server.rules(state, {
      type: 'move',
      objectId: creature.id,
      to: 'battlefield',
    }))
    const returned = state.objects[creature.id]!
    expect(returned.monstrous).toBe(false)
    state = mana(state)
    const again = server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: creature.id,
      abilityId: PLUGIN_ABILITY,
    })
    expect(again.ok).toBe(true)
  })
})
