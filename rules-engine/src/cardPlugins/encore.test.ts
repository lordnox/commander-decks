import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { encore } from './effectBuilders'
import { encore as encorePlugin } from './encore'
import { STEPS } from '../plugins/turnStructure'

const plugins = [activated, encorePlugin]

const rallyDrummer = () => cardTemplate('Rally Drummer', {
  types: ['Creature'],
  subtypes: ['Human', 'Bard'],
  manaCost: '{2}{R}',
  power: 3,
  toughness: 2,
  effects: [encore('{2}{R}')],
})

const moveToGraveyard = (state: GameState, objectId: string) => {
  const object = state.objects[objectId]
  const from = object.zone
  state.zoneOrder[object.owner][from] = state.zoneOrder[object.owner][from]
    .filter((id) => id !== objectId)
  state.zoneCounts[object.owner][from] -= 1
  state.zoneOrder[object.owner].graveyard.push(objectId)
  state.zoneCounts[object.owner].graveyard += 1
  object.zone = 'graveyard'
}

const advanceToDeclareAttackers = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => {
  let current = state
  while (current.step !== 'declareAttackers') {
    if (current.priority !== current.active) {
      current = ok(server.rules(current, { type: 'passPriority', seat: current.priority! }))
      continue
    }
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

describe('encore', () => {
  test('encore builder clones safely', () => {
    const stamped = structuredClone(encore('{3}{B}'))
    expect(stamped).toEqual({
      op: 'activate',
      id: 'encore',
      zone: 'graveyard',
      sorcery: true,
      costs: { mana: '{3}{B}', exileSelf: true },
      do: [{ kind: 'encoreTokens' }],
    })
  })

  test('pays mana, exiles from graveyard, and creates one copy per opponent', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: { p1: [rallyDrummer()] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = server.state
    const drummerId = state.zoneOrder.p1.hand[0]
    moveToGraveyard(state, drummerId)
    state = {
      ...state,
      active: 'p1',
      priority: 'p1',
      step: 'precombatMain',
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 2 },
        },
      },
    }

    const encoreAct = legalActsFor(state, 'p1').find((action) =>
      action.kind === 'activateAbility' && action.abilityId === 'encore')
    expect(encoreAct).toBeDefined()

    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: drummerId,
      abilityId: 'encore',
    }))
    expect(state.stack[0]).toMatchObject({ kind: 'ability', abilityId: 'encore' })

    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[drummerId].zone).toBe('exile')

    const tokens = Object.values(state.objects).filter((object) => object.token)
    expect(tokens).toHaveLength(3)
    for (const token of tokens) {
      expect(token).toMatchObject({
        name: 'Rally Drummer',
        power: 3,
        toughness: 2,
        controller: 'p1',
        zone: 'battlefield',
      })
      expect(token.oracleText).toContain('Haste')
      expect(token.continuousEffects?.some(
        ({ effect }) => effect.kind === 'encoreAttack',
      )).toBe(true)
    }

    const defenders = new Set(
      tokens.map((token) =>
        token.continuousEffects?.find(({ effect }) => effect.kind === 'encoreAttack')
          ?.effect.kind === 'encoreAttack'
          ? (token.continuousEffects!.find(({ effect }) => effect.kind === 'encoreAttack')!
            .effect as { defender: string }).defender
          : null),
    )
    expect(defenders).toEqual(new Set(['p2', 'p3', 'p4']))
    expect(state.delayedTriggers).toHaveLength(1)
    expect(state.delayedTriggers[0].condition).toEqual({ kind: 'step', step: 'end' })
  })

  test('rejects encore except as a sorcery', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [rallyDrummer()] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const drummerId = server.state.zoneOrder.p1.hand[0]
    const state = structuredClone(server.state)
    moveToGraveyard(state, drummerId)
    const duringCombat = {
      ...state,
      active: 'p1',
      priority: 'p1',
      step: 'declareAttackers' as const,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 2 },
        },
      },
    }
    const illegal = server.rules(duringCombat, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: drummerId,
      abilityId: 'encore',
    })
    expect(illegal.error).toMatch(/only as a sorcery/i)
  })

  test('encore tokens must attack their designated opponent if able', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [rallyDrummer()] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    const drummerId = state.zoneOrder.p1.hand[0]
    moveToGraveyard(state, drummerId)
    state = {
      ...state,
      active: 'p1',
      priority: 'p1',
      step: 'precombatMain',
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 2 },
        },
      },
    }
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: drummerId,
      abilityId: 'encore',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const tokens = Object.values(state.objects).filter((object) => object.token)
    const encoreAttackers = tokens.map((token) => {
      const defender = (
        token.continuousEffects!.find(({ effect }) => effect.kind === 'encoreAttack')!
          .effect as { defender: string }
      ).defender
      return { objectId: token.id, defender }
    })

    state = advanceToDeclareAttackers(server, state)
    const wrongTarget = server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: encoreAttackers.map((declaration, index) => ({
        objectId: declaration.objectId,
        defender: index === 0
          ? (declaration.defender === 'p2' ? 'p3' : 'p2')
          : declaration.defender,
      })),
    })
    expect(wrongTarget.error).toMatch(/designated opponent/i)

    const legal = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: encoreAttackers,
    }))
    for (const declaration of encoreAttackers) {
      expect(legal.objects[declaration.objectId].attacking).toEqual({
        kind: 'player',
        player: declaration.defender,
      })
    }
  })

  test('sacrifices encore tokens at the next end step', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [rallyDrummer()] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    const drummerId = state.zoneOrder.p1.hand[0]
    moveToGraveyard(state, drummerId)
    state = {
      ...state,
      active: 'p1',
      priority: 'p1',
      step: 'precombatMain',
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 2 },
        },
      },
    }
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: drummerId,
      abilityId: 'encore',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const tokenIds = Object.values(state.objects)
      .filter((object) => object.token)
      .map((object) => object.id)

    const endIndex = STEPS.indexOf('end')
    while (state.step !== 'end') {
      if (state.priority !== state.active) {
        state = ok(server.rules(state, { type: 'passPriority', seat: state.priority! }))
        continue
      }
      state = ok(server.rules(state, { type: 'advanceStep' }))
      if (STEPS.indexOf(state.step) > endIndex) break
    }
    expect(state.stack.some((item) => item.kind === 'ability')).toBe(true)
    while (state.stack.length > 0) {
      state = ok(server.rules(state, { type: 'resolveTop' }))
    }
    for (const tokenId of tokenIds) {
      expect(state.objects[tokenId].zone).toBe('graveyard')
    }
  })
})
