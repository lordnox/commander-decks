import { expect, test } from 'bun:test'
import type { LibraryVisibility } from './v1'
import type { GameState } from '../../types'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { replicaSnapshotError } from '../../plugins/hiddenInformation'
import { pendingSelectionFor } from '../../rules/selectCards'
import { instructionSpell } from './instructionTestSupport'
import { card, choice, chooseCards, compileCardRuleDefinition, inspectTop, LIBRARY_VISIBILITY, move, objects, ref, remaining, spell } from './v1'

const setup = (visibility: LibraryVisibility = LIBRARY_VISIBILITY.private, size = 6) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ instructions: [
    inspectTop({ player: ref('controller'), count: 4, bindChoice: 'top', visibility }),
    chooseCards({ chooser: ref('controller'), bindChoice: 'picked', filter: objects({ zone: 'library', among: choice('top'), type: 'Land' }), viewCards: choice('top'), min: 0, max: 1 }),
    move({ targets: choice('picked'), to: 'hand' }),
    move({ targets: remaining(choice('top'), choice('picked')), to: 'graveyard' }),
  ] })] },
  libraries: { p1: Array.from({ length: size }, (_, index) => cardTemplate(`Inspected ${index}`, { types: [index % 2 ? 'Instant' : 'Land'] })) },
}, { random: () => 0 })

const begin = (server: ReturnType<typeof setup>) => resolveStack(server.rules, ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
})))

const answer = (state: GameState, ids: string[]) => {
  const selection = pendingSelectionFor(state, 'p1')!
  return { type: 'selectCards' as const, seat: 'p1', selectionId: selection.id, kind: 'choose' as const, count: selection.count, objectIds: ids }
}

test.each([LIBRARY_VISIBILITY.private, LIBRARY_VISIBILITY.public])('bounded %s inspection shows context without making deeper or nonmatching cards selectable', visibility => {
  const server = setup(visibility)
  const state = begin(server)
  const top = server.state.zoneOrder.p1.library.slice(0, 4)
  const selection = pendingSelectionFor(state, 'p1')!
  expect(selection.candidates).toEqual([top[0]!, top[2]!])
  expect(selection.visibleCards).toEqual(top)
  expect(selection.viewLibrary).toBeUndefined()
  expect(state.priority).toBeNull()
  expect(state.zoneOrder.p1.hand).toHaveLength(0)
  const own = server.project(state, 'p1')
  expect(top.every(id => own.objects[id])).toBe(true)
  expect(replicaSnapshotError(own)).toBeUndefined()
  expect(own.objects[server.state.zoneOrder.p1.library[4]!]).toBeUndefined()
  const opponent = server.project(state, 'p2')
  expect(top.every(id => !opponent.objects[id])).toBe(true)
  expect(opponent.log.some(line => line.includes('Inspected 3'))).toBe(visibility === LIBRARY_VISIBILITY.public)
  for (const ids of [[top[1]!], [server.state.zoneOrder.p1.library[4]!], [top[0]!, top[2]!]]) {
    expect(server.rules(state, answer(state, ids)).ok).toBe(false)
  }
  const event = answer(state, [top[2]!])
  const direct = ok(server.rules(state, event))
  const restored = ok(server.rules(JSON.parse(JSON.stringify(state)), event))
  expect(restored).toEqual(direct)
  expect(restored.zoneOrder.p1.hand).toEqual([top[2]!])
  expect(restored.zoneOrder.p1.library).toEqual(server.state.zoneOrder.p1.library.slice(4))
  expect(restored.zoneOrder.p1.graveyard).toEqual([top[0]!, top[1]!, top[3]!, server.state.zoneOrder.p1.hand[0]!])
  expect(restored.resolution).toBeUndefined()
})

test.each([0, 1, 3])('inspection clamps to a short library and permits declining the selection (size=%s)', size => {
  const server = setup(LIBRARY_VISIBILITY.public, size)
  let state = begin(server)
  if (pendingSelectionFor(state, 'p1')) state = ok(server.rules(state, answer(state, [])))
  expect(state.zoneOrder.p1.library).toEqual([])
  expect(state.zoneOrder.p1.hand).toEqual([])
  expect(state.zoneOrder.p1.graveyard).toHaveLength(size + 1)
  expect(state.resolution).toBeUndefined()
})

test('inspection bindings, bounded views, and random movement reject invalid programs', () => {
  const programs = [
    [inspectTop({ player: ref('controller'), count: -1, bindChoice: 'top' })],
    [chooseCards({ chooser: ref('controller'), bindChoice: 'pick', filter: objects(), viewCards: choice('unknown'), count: 1 })],
    [move({ targets: ref('source'), to: 'hand', order: 'random' })],
  ]
  for (const instructions of programs) expect(() => compileCardRuleDefinition(card([spell({ instructions })]))).toThrow()
})

test.each([false, true])('bounded land-or-hand selection preserves untouched cards and randomizes only the remainder (land=%s)', pickLand => {
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [cardTemplate('Planar Genesis', { manaCost: '{0}' })] },
    libraries: { p1: [cardTemplate('Land', { types: ['Land'] }), ...Array.from({ length: 5 }, (_, i) => cardTemplate(`Other ${i}`, { types: ['Instant'] }))] },
  }, { random: () => 0 })
  const original = server.state.zoneOrder.p1.library
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  const first = answer(state, pickLand ? [original[0]!] : [])
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), first))
  if (!pickLand) {
    expect(pendingSelectionFor(state, 'p1')?.candidates).toEqual(original.slice(0, 4))
    const event = answer(state, [original[2]!])
    const direct = ok(server.rules(state, event))
    expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
    state = direct
  }
  expect(state.zoneOrder.p1.library.slice(0, 2)).toEqual(original.slice(4))
  expect(new Set(state.zoneOrder.p1.library.slice(2))).toEqual(new Set(original.slice(0, 4).filter(id => id !== original[pickLand ? 0 : 2])))
  if (pickLand) expect(state.objects[original[0]!]).toMatchObject({ zone: 'battlefield', tapped: true })
  else expect(state.zoneOrder.p1.hand).toEqual([original[2]!])
  expect(state.resolution).toBeUndefined()
})

test.each([0, 1, 2])('variable inspection moves every matching card and post-move untap uses only their new identities (graveyard=%s)', graveyard => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate("Animist's Awakening", { manaCost: '{0}' }), ...Array.from({ length: graveyard }, () => cardTemplate('Prior spell', { types: ['Instant', 'Sorcery'] }))] },
    battlefield: { p1: [cardTemplate('Unrelated land', { types: ['Land'], tapped: true })] },
    libraries: { p1: [cardTemplate('First land', { types: ['Land'] }), cardTemplate('Other', { types: ['Instant'] }), cardTemplate('Second land', { types: ['Land'] }), cardTemplate('Last inspected', { types: ['Sorcery'] }), cardTemplate('Untouched')] },
  }, { random: () => 0 })
  const original = server.state.zoneOrder.p1.library
  let ready = server.state
  for (const objectId of server.state.zoneOrder.p1.hand.slice(1)) ready = ok(server.rules(ready, { type: 'move', objectId, to: 'graveyard' }))
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0]!, x: 4 }))
  const state = resolveStack(server.rules, JSON.parse(JSON.stringify(cast)))
  for (const id of [original[0]!, original[2]!]) expect(state.objects[id]).toMatchObject({ zone: 'battlefield', tapped: graveyard < 2 })
  expect(state.objects[server.state.zoneOrder.p1.battlefield[0]!].tapped).toBe(true)
  expect(state.zoneOrder.p1.library[0]).toBe(original[4]!)
  expect(new Set(state.zoneOrder.p1.library.slice(1))).toEqual(new Set([original[1]!, original[3]!]))
})

test('random bottom ordering uses persisted randomness without shuffling the untouched prefix', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [
      inspectTop({ player: ref('controller'), count: 4, bindChoice: 'top' }),
      move({ targets: choice('top'), to: 'library', position: 'bottom', order: 'random' }),
    ] })] }, libraries: { p1: Array.from({ length: 6 }, (_, i) => cardTemplate(`Card ${i}`)) },
  }, { random: () => 0 })
  const original = server.state.zoneOrder.p1.library
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  const state = resolveStack(server.rules, cast)
  expect(state.zoneOrder.p1.library.slice(0, 2)).toEqual(original.slice(4))
  expect(state.zoneOrder.p1.library.slice(2)).toEqual([original[0]!, original[1]!, original[3]!, original[2]!])
  expect(resolveStack(server.rules, JSON.parse(JSON.stringify(cast)))).toEqual(state)
})


test.each([0, 1])('a land-or-hand fallback handles an empty inspected segment without a stalled choice (size=%s)', size => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Planar Genesis', { manaCost: '{0}' })] },
    libraries: { p1: Array.from({ length: size }, () => cardTemplate('Nonland', { types: ['Instant'] })) },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  if (size > 0) {
    const inspected = pendingSelectionFor(state, 'p1')!
    expect(inspected.count).toBe(0)
    expect(inspected.visibleCards).toEqual(server.state.zoneOrder.p1.library)
    expect(server.project(state, 'p1').objects[inspected.visibleCards![0]!]).toBeDefined()
    state = ok(server.rules(state, answer(state, [])))
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection.min).toBe(1)
    expect(server.rules(state, answer(state, [])).ok).toBe(false)
    state = ok(server.rules(state, answer(state, [selection.candidates[0]!])))
  }
  expect(state.zoneOrder.p1.hand).toHaveLength(size)
  expect(state.resolution).toBeUndefined()
})

test.each(['Dark Confidant', 'Dark Tutelage'])('%s reveals into hand without drawing and uses the revealed mana value', name => {
  for (const scenario of [
    { size: 0, manaValue: 0, redirected: false },
    { size: 1, manaValue: 0, redirected: false },
    { size: 1, manaValue: 5, redirected: false },
    { size: 1, manaValue: 5, redirected: true },
  ]) {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate(name)] },
      libraries: { p1: scenario.size ? [cardTemplate('Revealed fixture', { types: [scenario.manaValue ? 'Instant' : 'Land'], manaValue: scenario.manaValue })] : [] },
    }, { random: () => 0, cardPlugins: [{
      id: 'test.revealIsNotDraw',
      replace: ({ event }) => {
        if (event.type === 'draw') throw new Error('Putting the revealed card into hand must not draw')
        if (scenario.redirected && event.type === 'move' && event.to === 'hand') return { ...event, to: 'exile' }
      },
    }] })
    let state = ok(server.rules({ ...server.state, step: 'untap' }, { type: 'advanceStep' }))
    expect(state.stack).toHaveLength(1)
    state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
    expect(state.players.p1.life).toBe(40 - scenario.manaValue)
    expect(state.players.p1.lost).toBe(false)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    if (scenario.size) {
      const revealed = Object.values(state.objects).find(object => object.name === 'Revealed fixture')!
      expect(revealed.zone).toBe(scenario.redirected ? 'exile' : 'hand')
      expect(state.log.some(line => line.includes('Revealed fixture'))).toBe(true)
    }
  }
})
