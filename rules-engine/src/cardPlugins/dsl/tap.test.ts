import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { choice, chooseCards, objects, ref, tap, untap } from './v1'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

test.each([true, false])('tap-state instruction sets only matching permanents to tapped=%s', tapped => {
  const filter = objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } })
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [tapped ? tap(filter) : untap(filter)] })] },
    battlefield: {
      p1: [cardTemplate('Owned creature', { types: ['Creature'], tapped: !tapped })],
      p2: [cardTemplate('Other creature', { types: ['Creature'], tapped: !tapped }), cardTemplate('Other artifact', { types: ['Artifact'], tapped: !tapped })],
    },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const state = resolveStack(server.rules, cast)
  expect(named(state, 'Other creature').tapped).toBe(tapped)
  expect(named(state, 'Owned creature').tapped).toBe(!tapped)
  expect(named(state, 'Other artifact').tapped).toBe(!tapped)
})

test('a bounded untap choice resumes after restore and leaves unchosen lands tapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      chooseCards({ bindChoice: 'lands', chooser: ref('controller'), filter: objects({ zone: 'battlefield', type: 'Land' }), min: 0, max: 2 }),
      untap(choice('lands')),
    ] })] },
    battlefield: { p1: ['First', 'Second', 'Third'].map(name => cardTemplate(name, { types: ['Land'], tapped: true })) },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const paused = resolveStack(server.rules, cast)
  const restored = JSON.parse(JSON.stringify(paused))
  const pick = pendingSelectionFor(restored, 'p1')!
  const state = ok(server.rules(restored, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 2, objectIds: [named(restored, 'Second').id] }))
  expect(named(state, 'First').tapped).toBe(true)
  expect(named(state, 'Second').tapped).toBe(false)
  expect(named(state, 'Third').tapped).toBe(true)
  expect(state.resolution).toBeUndefined()
})


test.each([
  { seat: 'p1', tapped: true, matches: true },
  { seat: 'p1', tapped: false, matches: false },
  { seat: 'p2', tapped: true, matches: false },
])('tapped-entry filtering checks controller and entry state (%j)', ({ seat, tapped, matches }) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Amulet of Vigor')] },
    hands: { [seat]: [cardTemplate('Entry fixture', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder[seat].hand[0]
  const entered = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield', tapped }))
  expect(entered.stack).toHaveLength(matches ? 1 : 0)
  const resolved = resolveStack(server.rules, entered)
  expect(resolved.objects[id].tapped).toBe(matches ? false : tapped)
  const tappedLater = ok(server.rules(resolved, { type: 'tap', objectId: id }))
  expect(tappedLater.stack).toHaveLength(0)
})

test('tap skipNextUntap leaves the permanent tapped through its controller next untap', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [tap(objects({ zone: 'battlefield', type: 'Creature' }), { skipNextUntap: true })] })] },
    battlefield: { p2: [cardTemplate('Foe', { types: ['Creature'] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  expect(named(state, 'Foe')).toMatchObject({ tapped: true, skipNextUntap: true })
  state = ok(server.rules({ ...state, step: 'cleanup', active: state.active, priority: null }, { type: 'advanceStep' }))
  expect(state.active).toBe('p2')
  expect(state.step).toBe('untap')
  expect(named(state, 'Foe')).toMatchObject({ tapped: true })
  expect(named(state, 'Foe').skipNextUntap).toBeUndefined()
})

test('an untap instruction cannot affect an entering permanent that left and returned before its trigger resolves', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Amulet of Vigor')] },
    hands: { p1: [cardTemplate('Returning fixture', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield', tapped: true }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  state = ok(server.rules(state, { type: 'move', objectId: id, to: 'battlefield' }))
  state = ok(server.rules(state, { type: 'tap', objectId: id }))
  const resolved = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(resolved.objects[id].tapped).toBe(true)
})

test('catalog Minamo, School at Water\'s Edge untaps a legendary permanent', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [
      cardTemplate("Minamo, School at Water's Edge"),
      cardTemplate('Legendary fixture', { types: ['Creature'], supertypes: ['Legendary'], power: 1, toughness: 1, tapped: true }),
    ] },
  }, { random: () => 0.5 })
  const minamo = named(server.state, "Minamo, School at Water's Edge").id
  const legend = named(server.state, 'Legendary fixture').id
  const state = structuredClone(server.state)
  state.step = 'precombatMain'
  state.players.p1.mana.U = 1
  const resolved = resolveStack(server.rules, ok(server.rules(state, {
    type: 'activateAbility', seat: 'p1', objectId: minamo, abilityId: '$.abilities[0]',
    targets: [{ kind: 'object', objectId: legend }],
  })))
  expect(resolved.objects[legend].tapped).toBe(false)
})

test('catalog Githzerai Monk taps every creature its controller does not control when it enters', () => {
  const creature = (name: string) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2 })
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Githzerai Monk')] },
    battlefield: { p1: [creature('Fixture Ally')], p2: [creature('Fixture Foe')] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 2, U: 1, B: 0, R: 0, G: 0, C: 0 }
  const state = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'move', objectId: named(ready, 'Githzerai Monk').id, to: 'battlefield',
  })))
  expect(named(state, 'Fixture Ally').tapped).toBe(false)
  expect(named(state, 'Githzerai Monk').tapped).toBe(false)
  expect(named(state, 'Fixture Foe').tapped).toBe(true)
})

test('catalog Frantic Search untaps up to three chosen tapped lands after looting', () => {
  const island = (name: string) => cardTemplate(name, { types: ['Land'], subtypes: ['Island'] })
  const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [island('Island 1'), island('Island 2'), island('Island 3'), island('Island 4')] },
    hands: { p1: [cardTemplate('Frantic Search'), instant('Keep'), instant('Dump')] },
    libraries: { p1: [instant('Drawn One'), instant('Drawn Two')] },
  }, { random: () => 0.5 })
  let state = structuredClone(server.state)
  state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
  for (const name of ['Island 1', 'Island 2', 'Island 3']) named(state, name).tapped = true
  named(state, 'Island 4').tapped = false
  state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: named(state, 'Frantic Search').id }))
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const discard = pendingSelectionFor(state, 'p1')!
  state = ok(server.rules(state, {
    type: 'selectCards', seat: 'p1', kind: 'discard', count: 2, objectIds: discard.candidates.slice(0, 2),
  }))
  const selection = pendingSelectionFor(state, 'p1')!
  expect(selection).toMatchObject({ kind: 'choose', count: 3, min: 0 })
  const toUntap = selection.candidates.slice(0, 2)
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 3, objectIds: toUntap }))
  expect(toUntap.every((id) => !state.objects[id].tapped)).toBe(true)
  expect(named(state, 'Island 4').tapped).toBe(false)
})
