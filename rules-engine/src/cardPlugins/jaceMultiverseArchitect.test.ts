import type { GameState } from '../types'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { legalActsFor } from '../actions'
import { cardTemplate, planeswalker } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingOptionalManaPayFor } from './optionalManaPay'
import { optionalManaPay } from './optionalManaPay'
import { planeswalker as planeswalkerPlugin } from './planeswalker'
import { projectForViewer } from '../runtime'

const jace = (loyalty = 4) => planeswalker('Jace, Multiverse Architect', loyalty, {
  subtypes: ['Jace'],
  counters: { loyalty },
})

const creature = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const game = (setup: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [jace()] },
    ...setup,
  }, { random: () => 0, cardPlugins: [planeswalkerPlugin, optionalManaPay] })

const jaceId = (state: ReturnType<typeof game>['state']) =>
  Object.values(state.objects).find((object) => object.name === 'Jace, Multiverse Architect')!.id

const atOpponentBeginCombat = (
  runtime: ReturnType<typeof game>,
  state: ReturnType<typeof game>['state'],
) => {
  let current: GameState = { ...state, active: 'p2' as const, step: 'precombatMain' as const }
  current = ok(runtime.rules(current, { type: 'advanceStep' }))
  expect(current.step).toBe('beginCombat')
  return current
}

describe('Jace, Multiverse Architect', () => {
  test('registry exposes the begin-combat optional pay handler', () => {
    const runtime = game()
    expect(runtime.state.objects[jaceId(runtime.state)].name).toBe('Jace, Multiverse Architect')
  })

  test('opponent paying {2} lets creatures attack your Jace planeswalkers', () => {
    const runtime = game({
      battlefield: {
        p1: [jace()],
        p2: [creature('Attacker')],
      },
    })
    const attackerId = Object.values(runtime.state.objects)
      .find((object) => object.name === 'Attacker')!.id
    const targetJace = jaceId(runtime.state)
    let state = atOpponentBeginCombat(runtime, runtime.state)
    state = resolveStack(runtime.rules, state)
    expect(pendingOptionalManaPayFor(state, 'p2')).toBeDefined()
    state.players.p2.mana.C = 2
    state = ok(runtime.rules(state, {
      type: 'payOptionalMana',
      seat: 'p2',
      pendingId: pendingOptionalManaPayFor(state, 'p2')!.id,
      cost: '{2}',
    }))
    state = { ...state, step: 'declareAttackers', priority: 'p2', active: 'p2' }
    const declared = runtime.rules(state, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{ objectId: attackerId, defender: { kind: 'object', objectId: targetJace } }],
    })
    expect(declared.ok).toBe(true)
  })

  test('declining the {2} tax blocks attacks on your Jaces but not on you', () => {
    const runtime = game({ battlefield: { p1: [jace()], p2: [creature('Attacker')] } })
    const attackerId = Object.values(runtime.state.objects)
      .find((object) => object.name === 'Attacker')!.id
    const targetJace = jaceId(runtime.state)
    let state = atOpponentBeginCombat(runtime, runtime.state)
    state = resolveStack(runtime.rules, state)
    state = ok(runtime.rules(state, {
      type: 'payOptionalMana',
      seat: 'p2',
      pendingId: pendingOptionalManaPayFor(state, 'p2')!.id,
    }))
    state = { ...state, step: 'declareAttackers', priority: 'p2', active: 'p2' }
    const blocked = runtime.rules(state, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{ objectId: attackerId, defender: { kind: 'object', objectId: targetJace } }],
    })
    expect(blocked.ok).toBe(false)
    const atPlayer = runtime.rules(state, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{ objectId: attackerId, defender: 'p1' }],
    })
    expect(atPlayer.ok).toBe(true)
  })

  test('attack restriction clears after the turn', () => {
    const runtime = game({ battlefield: { p1: [jace()], p2: [creature('Attacker')] } })
    const attackerId = Object.values(runtime.state.objects)
      .find((object) => object.name === 'Attacker')!.id
    const targetJace = jaceId(runtime.state)
    let state = atOpponentBeginCombat(runtime, runtime.state)
    state = resolveStack(runtime.rules, state)
    state = ok(runtime.rules(state, {
      type: 'payOptionalMana',
      seat: 'p2',
      pendingId: pendingOptionalManaPayFor(state, 'p2')!.id,
    }))
    state = { ...state, step: 'cleanup', active: 'p2' }
    state = ok(runtime.rules(state, { type: 'advanceStep' }))
    state = { ...state, step: 'declareAttackers', priority: 'p2', active: 'p2' }
    const declared = runtime.rules(state, {
      type: 'declareAttackers',
      seat: 'p2',
      attackers: [{ objectId: attackerId, defender: { kind: 'object', objectId: targetJace } }],
    })
    expect(declared.ok).toBe(true)
  })

  test('+1 draws two then prompts to put a hand card on the bottom', () => {
    const runtime = game({
      libraries: { p1: ['A', 'B', 'C'].map((name) => cardTemplate(name)) },
    })
    const id = jaceId(runtime.state)
    let state: GameState = { ...runtime.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
    state = ok(runtime.rules(state, {
      type: 'activateAbility',
      abilityId: 'jace.plus-one',
      seat: 'p1',
      objectId: id,
    }))
    state = resolveStack(runtime.rules, state)
    expect(state.zoneOrder.p1.hand.length).toBeGreaterThanOrEqual(2)
    const actions = legalActsFor(state, 'p1').filter((action) => action.kind === 'selectCards')
    expect(actions.length).toBeGreaterThan(0)
    const handCard = state.zoneOrder.p1.hand[0]
    state = ok(runtime.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [handCard],
    }))
    expect(state.zoneOrder.p1.library.at(-1)).toBe(handCard)
  })

  test('−3 exiles another target you control then reveals onto the battlefield', () => {
    const sacrifice = cardTemplate('Sacrifice Me', { types: ['Creature'], power: 1, toughness: 1 })
    const revealed = cardTemplate('Revealed Walker', {
      types: ['Planeswalker'],
      subtypes: ['Jace'],
      printedLoyalty: 3,
    })
    const runtime = game({
      battlefield: { p1: [jace(), sacrifice] },
      libraries: { p1: [cardTemplate('Noise'), revealed] },
    })
    const id = jaceId(runtime.state)
    const sacrificeId = Object.values(runtime.state.objects)
      .find((object) => object.name === 'Sacrifice Me')!.id
    let state: GameState = { ...runtime.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
    state = ok(runtime.rules(state, {
      type: 'activateAbility',
      abilityId: 'jace.minus-three',
      seat: 'p1',
      objectId: id,
      targets: [{ kind: 'object', objectId: sacrificeId }],
    }))
    state = resolveStack(runtime.rules, state)
    expect(state.objects[sacrificeId].zone).toBe('exile')
    expect(state.zoneOrder.p1.battlefield).toContain(
      Object.values(state.objects).find((object) => object.name === 'Revealed Walker')!.id,
    )
  })

  test('cannot target Jace himself with −3', () => {
    const runtime = game()
    const id = jaceId(runtime.state)
    const state: GameState = { ...runtime.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
    const activated = runtime.rules(state, {
      type: 'activateAbility',
      abilityId: 'jace.minus-three',
      seat: 'p1',
      objectId: id,
      targets: [{ kind: 'object', objectId: id }],
    })
    expect(activated.ok).toBe(false)
  })

  test('pending optional pay survives projection for the payer only', () => {
    const runtime = game()
    let state = atOpponentBeginCombat(runtime, runtime.state)
    state = resolveStack(runtime.rules, state)
    const projected = projectForViewer(state, 'p2')
    expect(pendingOptionalManaPayFor(projected, 'p2')).toBeDefined()
    const leaked = projectForViewer(state, 'p1')
    expect(pendingOptionalManaPayFor(leaked, 'p2')).toBeDefined()
    expect(leaked.players.p2.data).toEqual(projected.players.p2.data)
  })
})
