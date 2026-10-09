import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import { effectsFor, handlerIdsForNames } from './cardRules'

/**
 * Activated abilities with a filtered target re-check it on resolution (CR 608.2b), so the filter
 * has to say where the target must be. A target that moved to another zone in response (exile,
 * graveyard) is then no longer legal and the ability fizzles instead of acting on the card.
 */

const KNOWN = [
  'Voyager Staff',
  'Endless Sands',
  'Otawara, Soaring City',
  'Boseiju, Who Endures',
  'Cephalid Coliseum',
]

const plugins = async (): Promise<Plugin[]> =>
  Promise.all(handlerIdsForNames(KNOWN).map(async (id) => {
    const module = await import(`./${id}`) as Record<string, unknown>
    const plugin = Object.values(module).find((value): value is Plugin =>
      typeof value === 'object' && value !== null && (value as Plugin).id === id)
    if (!plugin) throw new Error(`no plugin ${id}`)
    return plugin
  }))

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const creature = (name: string) =>
  card(name, ['Creature'], { power: 2, toughness: 2, manaCost: '{2}', manaValue: 2 })

const ready = (state: GameState) => {
  const next = structuredClone(state)
  next.active = 'p1'
  next.priority = 'p1'
  next.step = 'precombatMain'
  next.players.p1.mana = { W: 0, U: 4, B: 0, R: 0, G: 4, C: 6 }
  return next
}

const activate = (state: GameState, abilityId: string, source: string, target?: string) => ({
  type: 'activateAbility' as const,
  abilityId,
  seat: 'p1',
  objectId: named(state, source).id,
  ...(target ? { targets: [{ kind: 'object' as const, objectId: named(state, target).id }] } : {}),
})

/** What the opponent does in response: the target leaves the battlefield. */
const moveAway = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
  to: 'exile' | 'graveyard',
) => ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to }))

const advanceToEndStep = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  for (let guard = 0; guard < 24 && current.step !== 'end'; guard += 1) {
    current = resolveStack(server.rules, ok(server.rules(current, { type: 'advanceStep' })))
  }
  return current
}

const everyFilteredTargetNamesItsZone = ['Voyager Staff', 'Endless Sands', 'Otawara, Soaring City', 'Boseiju, Who Endures']

describe('filtered activated-ability targets name the zone they must be in', () => {
  test('every object-targeting filtered activated ability on these cards requires the battlefield', () => {
    for (const name of everyFilteredTargetNamesItsZone) {
      const targeted = effectsFor(name).filter((effect) =>
        effect.op === 'activate' && effect.targets && typeof effect.targets !== 'string')
      expect(targeted.length).toBeGreaterThan(0)
      for (const effect of targeted) {
        if (effect.op !== 'activate' || !effect.targets || typeof effect.targets === 'string') continue
        const filter = 'filter' in effect.targets ? effect.targets.filter : effect.targets
        expect({ name, zone: filter.zone }).toEqual({ name, zone: 'battlefield' })
      }
    }
    // Cephalid Coliseum targets a player, which has no zone.
    const [, threshold] = effectsFor('Cephalid Coliseum')
    expect(threshold).toMatchObject({ targets: { filter: { players: 'any' } } })
  })
})

describe('Voyager Staff', () => {
  const setup = async () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [card('Voyager Staff', ['Artifact']), creature('Own Bear'), card('Own Relic', ['Artifact']),
          card('Own Plains', ['Land'], { subtypes: ['Plains'] })],
        p2: [creature('Foe Bear')],
      },
    }, { random: () => 0.5, cardPlugins: await plugins() })
    return { server, state: ready(server.state) }
  }
  const BLINK = 'voyagerStaff.blink'

  test('is registered from its exact Oracle text: {2}, sacrifice, target creature', () => {
    expect(effectsFor('Voyager Staff')).toEqual([{
      op: 'activate',
      id: BLINK,
      costs: { mana: '{2}', sacrifice: 'self' },
      targets: { filter: { zone: 'battlefield', type: 'Creature' } },
      do: [{ kind: 'blink', when: 'nextEndStep', returnController: 'owner' }],
    }])
  })

  test('exiles any creature, yours or an opponent\'s, and returns it under its owner at the next end step', async () => {
    const { server, state } = await setup()
    for (const target of ['Own Bear', 'Foe Bear']) {
      const stacked = ok(server.rules(state, activate(state, BLINK, 'Voyager Staff', target)))
      expect(stacked.players.p1.mana.C).toBe(4)
      expect(named(stacked, 'Voyager Staff').zone).toBe('graveyard')
      const exiled = resolveStack(server.rules, stacked)
      expect(named(exiled, target).zone).toBe('exile')
      const back = advanceToEndStep(server, exiled)
      expect(named(back, target)).toMatchObject({ zone: 'battlefield', controller: named(state, target).owner })
    }
  })

  test('cannot target a noncreature permanent', async () => {
    const { server, state } = await setup()
    for (const target of ['Own Relic', 'Own Plains', 'Voyager Staff']) {
      expect(server.rules(state, activate(state, BLINK, 'Voyager Staff', target)).ok).toBe(false)
    }
  })

  test('a target exiled in response fizzles: it is not blinked back and nothing else happens', async () => {
    const { server, state } = await setup()
    const stacked = ok(server.rules(state, activate(state, BLINK, 'Voyager Staff', 'Foe Bear')))
    const gone = moveAway(server, stacked, 'Foe Bear', 'exile')
    const resolved = resolveStack(server.rules, gone)
    expect(resolved.stack).toHaveLength(0)
    expect(named(resolved, 'Foe Bear').zone).toBe('exile')
    const later = advanceToEndStep(server, resolved)
    expect(named(later, 'Foe Bear').zone).toBe('exile')
    expect(named(later, 'Voyager Staff').zone).toBe('graveyard')
  })
})

describe('Endless Sands', () => {
  const setup = async () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [card('Endless Sands', ['Land'], { tapProduces: { C: 1 } }), creature('Own Bear')] },
    }, { random: () => 0.5, cardPlugins: await plugins() })
    return { server, state: ready(server.state) }
  }

  test('a creature exiled by something else in response is not linked to the Sands or returned by them', async () => {
    const { server, state } = await setup()
    const stacked = ok(server.rules(state, activate(state, 'endlessSands.exile', 'Endless Sands', 'Own Bear')))
    const gone = moveAway(server, stacked, 'Own Bear', 'graveyard')
    const resolved = resolveStack(server.rules, gone)
    expect(named(resolved, 'Own Bear')).toMatchObject({ zone: 'graveyard' })
    expect(named(resolved, 'Own Bear').exiledWith).toBeUndefined()
  })

  test('the return ability has no timing restriction, so it works at instant speed', async () => {
    const { server, state } = await setup()
    const exiled = resolveStack(server.rules, ok(server.rules(
      state,
      activate(state, 'endlessSands.exile', 'Endless Sands', 'Own Bear'),
    )))
    expect(named(exiled, 'Own Bear')).toMatchObject({ zone: 'exile', exiledWith: named(exiled, 'Endless Sands').id })

    const opponentsTurn = structuredClone(exiled)
    opponentsTurn.active = 'p2'
    opponentsTurn.step = 'declareAttackers'
    opponentsTurn.priority = 'p1'
    opponentsTurn.players.p1.mana.C = 4
    named(opponentsTurn, 'Endless Sands').tapped = false
    const returned = resolveStack(server.rules, ok(server.rules(
      opponentsTurn,
      activate(opponentsTurn, 'endlessSands.return', 'Endless Sands'),
    )))
    expect(named(returned, 'Own Bear').zone).toBe('battlefield')
    expect(named(returned, 'Endless Sands').zone).toBe('graveyard')
  })
})

describe('Otawara, Soaring City', () => {
  const setup = async () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [card('Otawara, Soaring City', ['Land'], { supertypes: ['Legendary'] })] },
      battlefield: { p2: [creature('Foe Bear')] },
    }, { random: () => 0.5, cardPlugins: await plugins() })
    return { server, state: ready(server.state) }
  }

  test('a target that left the battlefield in response is not returned to hand', async () => {
    const { server, state } = await setup()
    const stacked = ok(server.rules(state, activate(state, 'channel.otawara', 'Otawara, Soaring City', 'Foe Bear')))
    const resolved = resolveStack(server.rules, moveAway(server, stacked, 'Foe Bear', 'graveyard'))
    expect(named(resolved, 'Foe Bear').zone).toBe('graveyard')
    expect(named(resolved, 'Otawara, Soaring City').zone).toBe('graveyard')
  })
})

describe('Boseiju, Who Endures', () => {
  const setup = async () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [card('Boseiju, Who Endures', ['Land'], { supertypes: ['Legendary'] })] },
      battlefield: { p2: [card('Utility Land', ['Land'])] },
      libraries: { p2: [card('Basic Swamp', ['Land'], { supertypes: ['Basic'], subtypes: ['Swamp'] })] },
    }, { random: () => 0.5, cardPlugins: await plugins() })
    return { server, state: ready(server.state) }
  }

  test('a target that left the battlefield in response is not destroyed again and its controller does not search', async () => {
    const { server, state } = await setup()
    const stacked = ok(server.rules(state, activate(state, 'channel.boseiju', 'Boseiju, Who Endures', 'Utility Land')))
    const resolved = resolveStack(server.rules, moveAway(server, stacked, 'Utility Land', 'exile'))
    expect(named(resolved, 'Utility Land').zone).toBe('exile')
    expect(pendingSelectionFor(resolved, 'p2')).toBeUndefined()
    expect(named(resolved, 'Basic Swamp').zone).toBe('library')
  })

  test('a destroyed borrowed permanent makes its controller search', async () => {
    const { server, state: readyState } = await setup()
    const state = structuredClone(readyState)
    const target = named(state, 'Utility Land')
    target.owner = 'p1'
    target.controller = 'p2'
    const stacked = ok(server.rules(state, activate(state, 'channel.boseiju', 'Boseiju, Who Endures', target.name)))
    const resolved = resolveStack(server.rules, stacked)
    expect(pendingSelectionFor(resolved, 'p2')).toBeDefined()
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  })
})
