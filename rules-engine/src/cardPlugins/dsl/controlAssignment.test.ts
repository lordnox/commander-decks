import { CONTROL_EVENT } from './controlConstants'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { isGoaded } from '../../plugins/goad'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, distributeControl, draw, objects, permanentEffect, players, ref, self, spell, whenever } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const copy = (state: GameState): GameState => JSON.parse(JSON.stringify(state))
const assign = (server: ReturnType<typeof createServerGame>, state: GameState, player: string) => {
  const selection = pendingPlayerSelectionFor(state, 'p1')!
  return ok(server.rules(state, { type: 'selectPlayers', selectionId: selection.id, seat: 'p1', players: [player] }))
}

const setup = (distinct = true, number = 3) => {
  const server = createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [instructionSpell({ instructions: [
      createEffect({ targets: objects({ zone: 'battlefield', type: 'Creature' }), effect: { kind: 'goad' }, duration: permanentEffect() }),
      distributeControl({ targets: objects({ zone: 'battlefield', type: 'Creature' }), chooser: ref('controller'), recipients: players({ relation: 'opponent' }), distinct }),
    ] })] },
    battlefield: { p1: Array.from({ length: number }, (_, index) => cardTemplate(`Guest ${index}`, { types: ['Creature'], power: 2, toughness: 2 })) },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] })))
  return { server, state }
}

describe('control distribution and lasting goad', () => {
  test('distinct recipients exclude earlier choices; all control changes wait for the last assignment and survive restore', () => {
    const { server, state } = setup()
    let direct = assign(server, state, 'p2')
    expect(named(direct, 'Guest 0').controller).toBe('p1')
    expect(pendingPlayerSelectionFor(direct, 'p1')!.candidates).toEqual(['p3', 'p4'])
    const selection = pendingPlayerSelectionFor(direct, 'p1')!
    expect(server.rules(direct, { type: 'selectPlayers', selectionId: selection.id, seat: 'p1', players: ['p2'] }).ok).toBe(false)
    let restored = copy(direct)
    for (const player of ['p4', 'p3']) {
      direct = assign(server, direct, player)
      restored = assign(server, restored, player)
      expect(restored).toEqual(direct)
    }
    direct = resolveStack(server.rules, direct)
    expect(['Guest 0', 'Guest 1', 'Guest 2'].map(name => named(direct, name).controller)).toEqual(['p2', 'p4', 'p3'])
    for (const name of ['Guest 0', 'Guest 1', 'Guest 2']) {
      expect(isGoaded(named(direct, name))).toBe(true)
      expect(named(direct, name).continuousEffects?.find(entry => entry.effect.kind === 'goad')?.duration).toEqual({ kind: 'permanent' })
    }
  })

  test('distinct remains mandatory when fewer permanents than recipients are available', () => {
    const { server, state } = setup(true, 2)
    const next = assign(server, state, 'p3')
    expect(pendingPlayerSelectionFor(next, 'p1')!.candidates).toEqual(['p2', 'p4'])
    const finished = resolveStack(server.rules, assign(server, next, 'p2'))
    expect(named(finished, 'Guest 0').controller).toBe('p3')
    expect(named(finished, 'Guest 1').controller).toBe('p2')
  })

  test('non-distinct programs allow the same recipient repeatedly', () => {
    const { server, state } = setup(false, 2)
    const next = assign(server, state, 'p2')
    expect(pendingPlayerSelectionFor(next, 'p1')!.candidates).toContain('p2')
    const finished = resolveStack(server.rules, assign(server, next, 'p2'))
    expect(named(finished, 'Guest 0').controller).toBe('p2')
    expect(named(finished, 'Guest 1').controller).toBe('p2')
  })

  test('control-changing events do not follow an object through a zone change', () => {
    const { server, state } = setup(true, 1)
    let changed = resolveStack(server.rules, assign(server, state, 'p2'))
    const object = named(changed, 'Guest 0')
    const staleRef = { objectId: object.id, incarnation: object.incarnation, zone: object.zone }
    changed = ok(server.rules(changed, { type: 'move', objectId: object.id, to: 'exile' }))
    changed = ok(server.rules(changed, { type: 'move', objectId: object.id, to: 'battlefield' }))
    const finished = ok(server.rules(changed, { type: CONTROL_EVENT.change, objectRef: staleRef, controller: 'p3' }))
    expect(named(finished, 'Guest 0').controller).toBe('p1')
    expect(isGoaded(named(finished, 'Guest 0'))).toBe(false)
  })

  test('lasting goad survives the resolving source leaving and a later controller change', () => {
    const { server, state } = setup(true, 1)
    let finished = resolveStack(server.rules, assign(server, state, 'p2'))
    const object = named(finished, 'Guest 0')
    expect(named(finished, 'Instruction fixture').zone).toBe('graveyard')
    finished = ok(server.rules(finished, { type: CONTROL_EVENT.change, objectRef: { objectId: object.id, incarnation: object.incarnation, zone: object.zone }, controller: 'p3' }))
    expect(isGoaded(named(finished, 'Guest 0'))).toBe(true)
    expect(named(finished, 'Guest 0').continuousEffects?.find(entry => entry.effect.kind === 'goad')?.effect).toEqual({ kind: 'goad', sourceController: 'p1' })
  })
})

// Real catalog composition, with an exchangeable ETB fixture: its trigger belongs
// to the entering controller even though control changes before trigger placement.
test.each([2, 4])('catalog reveal-to-battlefield program resolves in a %s-player pod', number => {
  const trigger = createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(self.enters, { instructions: [draw({ targets: ref('controller'), count: 1 })] })])))
  const guests = Array.from({ length: number - 1 }, (_, index) => cardTemplate(`Found ${index}`, { types: ['Creature'], power: 2, toughness: 2, ...(index === 0 ? { ruleDefinition: trigger } : {}) }))
  const server = createServerGame(commanderRules, {
    players: number,
    hands: { p1: [cardTemplate('Dack Fayden, Helping Hand')] },
    libraries: { p1: [cardTemplate('Noise', { types: ['Instant'] }), ...guests, cardTemplate('Remainder', { types: ['Instant'] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: server.state.zoneOrder.p1.hand[0], to: 'battlefield' })))
  for (let index = 0; index < number - 1; index++) {
    expect(named(state, `Found ${index}`).controller).toBe('p1')
    expect(isGoaded(named(state, `Found ${index}`))).toBe(true)
  }
  for (let index = 0; index < number - 1; index++) state = assign(server, copy(state), `p${index + 2}`)
  state = resolveStack(server.rules, state)
  expect(state.zoneOrder.p1.hand).toHaveLength(1)
  for (let index = 0; index < number - 1; index++) expect(named(state, `Found ${index}`).controller).toBe(`p${index + 2}`)
  expect(state.log.filter(line => line === 'p1 shuffles')).toHaveLength(1)
})

test.each([0, 1])('reveal/bind/move programs handle a library with %s matching creatures', number => {
  const server = createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [cardTemplate('Dack Fayden, Helping Hand')] },
    libraries: { p1: [cardTemplate('Noise', { types: ['Instant'] }), ...Array.from({ length: number }, () => cardTemplate('Found', { types: ['Creature'], power: 2, toughness: 2 }))] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: server.state.zoneOrder.p1.hand[0], to: 'battlefield' })))
  if (number) state = resolveStack(server.rules, assign(server, state, 'p3'))
  expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
  expect(state.zoneOrder.p1.library.map(id => state.objects[id].name)).toEqual(['Noise'])
  if (number) expect(named(state, 'Found').controller).toBe('p3')
})

test('control assignment validation rejects wrong domains and invalid distinct flags', () => {
  for (const instruction of [
    { kind: 'distributeControl', targets: players({ relation: 'any' }), chooser: ref('controller'), recipients: players({ relation: 'opponent' }), distinct: true },
    { kind: 'distributeControl', targets: objects({}), chooser: ref('source'), recipients: players({ relation: 'opponent' }), distinct: true },
    { kind: 'distributeControl', targets: objects({}), chooser: ref('controller'), recipients: objects({}), distinct: true },
    { kind: 'distributeControl', targets: objects({}), chooser: ref('controller'), recipients: players({ relation: 'opponent' }), distinct: 'yes' },
  ]) {
    expect(() => compileCardRuleDefinition({ schemaVersion: 1, abilities: [{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [instruction] }] })).toThrow()
  }
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [createEffect({ targets: objects({}), effect: { kind: 'goad' }, duration: permanentEffect() })] })]))).not.toThrow()
})
