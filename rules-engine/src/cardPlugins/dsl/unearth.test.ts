import type { CardTemplate } from '../../newGame'
import type { GameState } from '../../types'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, unearth, blink, objects, createEffect } from './v1'

const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([unearth('{1}')])))
const game = (loseAbilities = false) => createServerGame(commanderRules, { hands: { p1: [cardTemplate('Returned fixture', { zone: 'graveyard', types: ['Creature'], power: 3, toughness: 3, ruleDefinition: definition }), instructionSpell({ instructions: [loseAbilities ? createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: { kind: 'removeAbilities' }, duration: { kind: 'permanent' } }) : blink({ targets: objects({ zone: 'battlefield', type: 'Creature' }) })] })] } }, { random: () => 0 })
const activate = (server: ReturnType<typeof game>) => {
  const state = structuredClone(server.state)
  state.players.p1.mana.C = 1
  return ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: state.zoneOrder.p1.graveyard[0]!, abilityId: '$.abilities[0]' }))
}

test.each(['hand', 'graveyard', 'library'] as const)('a resolved graveyard return redirects departure to exile instead of %s', to => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  expect(state.objects[id]!.zone).toBe('battlefield')
  expect(hasKeyword(state.objects[id]!, 'haste')).toBe(true)
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'move', objectId: id, to }))
  expect(state.objects[id]!.zone).toBe('exile')
})

test('ordinary exile and blink create a fresh permanent without the departure replacement', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  const incarnation = state.objects[id]!.incarnation
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0]! })))
  expect(state.objects[id]!.zone).toBe('battlefield')
  expect(state.objects[id]!.incarnation).toBe(incarnation + 2)
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' }))
  expect(state.objects[id]!.zone).toBe('hand')
})

test('a return activation does nothing if its graveyard source left and returned before resolution', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = activate(server)
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  state = resolveStack(server.rules, state)
  expect(state.objects[id]!.zone).toBe('graveyard')
  expect(state.delayedTriggers).toHaveLength(0)
})

test('the delayed end-step exile survives losing the permanent’s abilities and JSON restore', () => {
  const server = game(true), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0]! })))
  expect(hasKeyword(state.objects[id]!, 'haste')).toBe(false)
  expect(ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' })).objects[id]!.zone).toBe('exile')
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(1)
  state = resolveStack(server.rules, state)
  expect(state.objects[id]!.zone).toBe('exile')
})

test('countering the end-step trigger leaves the lasting replacement without another delayed trigger', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  let state = resolveStack(server.rules, activate(server))
  state = ok(server.rules({ ...state, step: 'postcombatMain' }, { type: 'advanceStep' }))
  state = ok(server.rules(state, { type: 'counterStackItem', stackId: state.stack[0]!.id }))
  state = ok(server.rules({ ...state, turn: state.turn + 1, step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(0)
  expect(state.objects[id]!.zone).toBe('battlefield')
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  expect(state.objects[id]!.zone).toBe('exile')
})

test('a graveyard activation requires its cost and the controller’s sorcery timing', () => {
  const server = game(), id = server.state.zoneOrder.p1.graveyard[0]!
  const event = { type: 'activateAbility' as const, seat: 'p1', objectId: id, abilityId: '$.abilities[0]' }
  expect(server.rules(server.state, event).ok).toBe(false)
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 1
  expect(server.rules({ ...ready, active: 'p2' }, event).ok).toBe(false)
  expect(server.rules({ ...ready, step: 'upkeep' }, event).ok).toBe(false)
  const activated = ok(server.rules(ready, event))
  expect(activated.players.p1.mana.C).toBe(0)
  expect(server.rules(activated, event).ok).toBe(false)
})

test('departure replacements reject a destination that does not leave the battlefield', () => {
  expect(() => compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [
    createEffect({ targets: objects({ zone: 'battlefield' }), effect: { kind: 'redirectDeparture', to: 'battlefield' }, duration: { kind: 'permanent' } }),
  ] }]))).toThrow('departure replacement must leave the battlefield')
})

describe('catalog entry mass return combined with graveyard activation', () => {
  const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
  const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })
  const island = (name: string) => cardTemplate(name, { types: ['Land'] })
  const mainPhase = (state: GameState) => {
    const ready = structuredClone(state)
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.step = 'precombatMain'
    return ready
  }
  const pool = (state: GameState, mana: Partial<GameState['players'][string]['mana']>) => {
    Object.assign(state.players.p1.mana, mana)
    return state
  }
  const advanceTo = (server: ReturnType<typeof createServerGame>, state: GameState, step: GameState['step']) => {
    let current = state
    for (let guard = 0; guard < 24 && current.step !== step; guard += 1) {
      current = resolveStack(server.rules, ok(server.rules(current, { type: 'advanceStep' })))
    }
    expect(current.step).toBe(step)
    return current
  }

  const board = () => ({
    battlefield: {
      p1: [
        island('Own Island'),
        creature('Own Bear'),
        cardTemplate('Own Relic', { types: ['Artifact'] }),
      ],
      p2: [
        cardTemplate('Their Forest', { types: ['Land'], subtypes: ['Forest'] }),
        creature('Their Bear'),
        cardTemplate('Their Banner', { types: ['Enchantment'] }),
      ],
    },
  })

  const setup = (extra: Parameters<typeof createServerGame>[1] = {}) => {
    const server = createServerGame(commanderRules, {
      players: 2,
      ...board(),
      ...extra,
    }, { random: () => 0.5 })
    return { server, state: server.state }
  }


  test('unearth returns it with haste, bounces again, and exiles it at the next end step', () => {
    const { server } = setup({ libraries: { p1: [cardTemplate('Kederekt Leviathan')] } })
    let state: GameState = mainPhase(server.state)
    const leviathan = named(state, 'Kederekt Leviathan')
    state = ok(server.rules(state, { type: 'move', objectId: leviathan.id, to: 'graveyard' }))
    state = pool(state, { U: 1, C: 6 })

    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: leviathan.id,
      abilityId: '$.abilities[1]',
    }))
    expect(state.stack[0]).toMatchObject({ kind: 'ability', abilityId: '$.abilities[1]' })
    expect(state.players.p1.mana).toMatchObject({ U: 0, C: 0 })
    state = resolveStack(server.rules, state)

    expect(state.objects[leviathan.id]).toMatchObject({ zone: 'battlefield', summoningSickness: true })
    expect(hasKeyword(state.objects[leviathan.id], 'haste')).toBe(true)
    for (const name of ['Own Bear', 'Own Relic', 'Their Bear', 'Their Banner']) {
      expect(named(state, name).zone).toBe('hand')
    }
    expect(named(state, 'Their Forest').zone).toBe('battlefield')

    const ending = advanceTo(server, state, 'end')
    expect(ending.objects[leviathan.id].zone).toBe('exile')
    expect(ending.delayedTriggers).toHaveLength(0)
  })

  test('unearth is sorcery speed, needs {6}{U}, and leaving replaces to exile', () => {
    const { server } = setup({ libraries: { p1: [cardTemplate('Kederekt Leviathan')] } })
    let state: GameState = mainPhase(server.state)
    const leviathan = named(state, 'Kederekt Leviathan')
    state = ok(server.rules(state, { type: 'move', objectId: leviathan.id, to: 'graveyard' }))
    const activate = (current: GameState) => server.rules(current, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: leviathan.id,
      abilityId: '$.abilities[1]',
    })

    expect(activate(pool(structuredClone(state), { U: 0, C: 7 })).ok).toBe(false)
    expect(activate(pool(structuredClone(state), { U: 1, C: 5 })).ok).toBe(false)
    const theirTurn = pool(structuredClone(state), { U: 1, C: 6 })
    theirTurn.active = 'p2'
    expect(activate(theirTurn).ok).toBe(false)

    const unearthed = resolveStack(server.rules, ok(activate(pool(structuredClone(state), { U: 1, C: 6 }))))
    expect(unearthed.objects[leviathan.id].zone).toBe('battlefield')
    for (const to of ['hand', 'graveyard', 'library'] as const) {
      const gone = ok(server.rules(unearthed, { type: 'move', objectId: leviathan.id, to }))
      expect(gone.objects[leviathan.id].zone).toBe('exile')
    }
  })
})
