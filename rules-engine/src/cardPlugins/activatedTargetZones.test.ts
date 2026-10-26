import { describe, expect, test } from 'bun:test'
import { canonicalScopeId } from './dsl/compiler/targeting'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { cardRuleDefinitionSnapshotFor } from './dsl/cardRuleCatalog'
import { activated } from './activated'

/**
 * Activated abilities with a filtered target re-check it on resolution (CR 608.2b), so the filter
 * has to say where the target must be. A target that moved to another zone in response (exile,
 * graveyard) is then no longer legal and the ability fizzles instead of acting on the card.
 */

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

describe('filtered activated-ability targets name the zone they must be in', () => {
  test('every object-targeting filtered activated ability on these cards requires the battlefield', () => {
    for (const name of ['Otawara, Soaring City', 'Boseiju, Who Endures', 'Endless Sands']) {
      const abilities = cardRuleDefinitionSnapshotFor(name)!.definition.abilities.filter((ability) =>
        ability.kind === 'activated' && ability.decisions.targets.length > 0)
      expect(abilities.length).toBeGreaterThan(0)
      for (const ability of abilities) {
        if (ability.kind !== 'activated') continue
        for (const clause of ability.decisions.targets) {
          expect(clause.filter.kind).toBe('objects')
          if (clause.filter.kind === 'objects') {
            expect({ name, zone: clause.filter.filter.zone }).toEqual({ name, zone: 'battlefield' })
          }
        }
      }
    }
    const threshold = cardRuleDefinitionSnapshotFor('Cephalid Coliseum')!.definition.abilities[1]
    expect(threshold).toMatchObject({ decisions: { targets: [{ filter: { kind: 'players' } }] } })
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
    }, { random: () => 0.5 })
    return { server, state: ready(server.state) }
  }
  const BLINK = canonicalScopeId(0)

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



describe('Otawara, Soaring City', () => {
  const setup = async () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [card('Otawara, Soaring City', ['Land'], { supertypes: ['Legendary'] })] },
      battlefield: { p2: [creature('Foe Bear')] },
    }, { random: () => 0.5 })
    return { server, state: ready(server.state) }
  }

  test('a target that left the battlefield in response is not returned to hand', async () => {
    const { server, state } = await setup()
    const stacked = ok(server.rules(state, activate(state, '$.abilities[1]', 'Otawara, Soaring City', 'Foe Bear')))
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
    }, { random: () => 0.5 })
    return { server, state: ready(server.state) }
  }

  test('a target that left the battlefield in response is not destroyed again and its controller does not search', async () => {
    const { server, state } = await setup()
    const stacked = ok(server.rules(state, activate(state, '$.abilities[1]', 'Boseiju, Who Endures', 'Utility Land')))
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
    const stacked = ok(server.rules(state, activate(state, '$.abilities[1]', 'Boseiju, Who Endures', target.name)))
    const resolved = resolveStack(server.rules, stacked)
    expect(pendingSelectionFor(resolved, 'p2')).toBeDefined()
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
  })
})

describe('activated target payment and resolution lifecycle', () => {
  test('channel pays the legendary discount, validates targets, and completes Boseiju search', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            card('Legend One', ['Creature'], { supertypes: ['Legendary'] }),
            card('Legend Two', ['Creature'], { supertypes: ['Legendary'] }),
          ],
          p2: [
            card('Basic Forest', ['Land'], {
              supertypes: ['Basic'],
              subtypes: ['Forest'],
            }),
            card('Utility Land', ['Land']),
            card('Bounce Me', ['Creature']),
          ],
        },
        hands: {
          p1: [
            card('Boseiju, Who Endures', ['Land']),
            card('Otawara, Soaring City', ['Land']),
          ],
        },
        libraries: {
          p2: [
            card('Found Island', ['Land'], { supertypes: ['Basic'], subtypes: ['Island'] }),
            card('No Type Land', ['Land']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 1, C: 1 }
    const boseiju = named(state, 'Boseiju, Who Endures')
    const basic = named(state, 'Basic Forest')
    expect(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: boseiju.id,
      targets: [{ kind: 'object', objectId: basic.id }],
    }).ok).toBe(false)

    const utility = named(state, 'Utility Land')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: boseiju.id,
      targets: [{ kind: 'object', objectId: utility.id }],
    }))
    expect(state.players.p1.mana).toEqual({ W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 })
    expect(state.objects[boseiju.id].zone).toBe('graveyard')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[utility.id].zone).toBe('graveyard')
    const search = pendingSelectionFor(state, 'p2')!
    const found = named(state, 'Found Island')
    expect(search).toMatchObject({ kind: 'choose', min: 0, viewLibrary: true, candidates: [found.id] })
    expect(server.project(state, 'p1').players.p2.data['kernel.pendingSelection'])
      .toBeUndefined()
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [found.id],
    }))
    expect(state.objects[found.id].zone).toBe('battlefield')

    const otawara = named(state, 'Otawara, Soaring City')
    const creature = named(state, 'Bounce Me')
    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: '$.abilities[1]',
      seat: 'p1',
      objectId: otawara.id,
      targets: [{ kind: 'object', objectId: creature.id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[creature.id].zone).toBe('hand')
  })
})
