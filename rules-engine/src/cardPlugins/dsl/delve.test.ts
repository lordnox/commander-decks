import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  compileCardRuleDefinition,
  delve,
  draw,
  ref,
  spell,
} from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

const graveCards = (count: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`Grave ${index + 1}`, { types: ['Sorcery'] }))

const setup = (options: {
  manaCost?: string
  reductions?: number
  delve?: boolean
  graveyard?: number
  extraPool?: Partial<Record<'U' | 'C', number>>
} = {}) => {
  const manaCost = options.manaCost ?? '{6}{U}{U}'
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [
        instructionSpell({
          ...(options.delve === false ? {} : { costs: [delve()] }),
          ...(options.reductions ? { costReductions: [{ generic: options.reductions }] } : {}),
          instructions: [draw({ count: 1, targets: ref('controller') })],
        }, manaCost),
        ...graveCards(options.graveyard ?? 7),
      ],
      p2: [cardTemplate('Foreign grave card', { types: ['Sorcery'] })],
    },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  let state = server.state
  for (const object of graveCards(options.graveyard ?? 7)) {
    const id = named(state, object.name).id
    state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
  }
  const ready = structuredClone(state)
  ready.players.p1.mana = {
    ...ready.players.p1.mana,
    U: options.extraPool?.U ?? 2,
    C: options.extraPool?.C ?? 0,
  }
  return { server, state: ready, spellId: named(ready, 'Instruction fixture').id }
}

const graveIds = (state: GameState) =>
  Array.from({ length: 7 }, (_, index) => named(state, `Grave ${index + 1}`).id)

test('delve compiles as a kind-only cost', () => {
  expect(compileCardRuleDefinition(card([spell({ costs: [delve()], instructions: [] })])).definition.abilities[0])
    .toMatchObject({ kind: 'spell', costs: [{ kind: 'delve' }] })
  expect(() => compileCardRuleDefinition(card([spell({ costs: [{ kind: 'delve', extra: true } as never], instructions: [] })])))
    .toThrow()
})

test('exile chosen graveyard cards pays generic mana and leaves colored requirements', () => {
  const { server, state, spellId } = setup()
  const six = graveIds(state).slice(0, 6)
  const baseline = structuredClone(state)
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: six.slice(0, 3) }))
    .toMatchObject({ ok: false, error: 'not enough mana' })
  expect(state).toEqual(baseline)
  const cast = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: six }))
  expect(six.every(id => cast.objects[id].zone === 'exile')).toBe(true)
  expect(named(cast, 'Grave 7').zone).toBe('graveyard')
  expect(cast.players.p1.mana.U).toBe(0)
  expect(cast.stack[0]).toMatchObject({ name: 'Instruction fixture' })
  expect(ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'castSpell', seat: 'p1', objectId: spellId, delve: six })))
    .toEqual(cast)
  const resolved = resolveStack(server.rules, cast)
  expect(resolved.objects[spellId].zone).toBe('graveyard')
  expect(resolved.zoneOrder.p1.hand.map(id => resolved.objects[id].name)).toEqual(['Drawn'])
})

test('delve cannot exceed remaining generic mana after reductions', () => {
  const { server, state, spellId } = setup({ reductions: 1 })
  const seven = graveIds(state)
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: seven.slice(0, 6) }))
    .toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
  const five = seven.slice(0, 5)
  const paid = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: five }))
  expect(five.every(id => paid.objects[id].zone === 'exile')).toBe(true)
  expect(named(paid, 'Grave 6').zone).toBe('graveyard')
})

test('delve cannot pay colored mana or exile illegal cards', () => {
  const { server, state, spellId } = setup({ extraPool: { U: 0, C: 1 } })
  const seven = graveIds(state)
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: seven }))
    .toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: seven.slice(0, 6) }))
    .toMatchObject({ ok: false, error: 'not enough mana' })
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: [seven[0]!, seven[0]!] }))
    .toMatchObject({ ok: false, error: 'duplicate delve card' })
  const without = setup({ delve: false })
  expect(server.rules(without.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: without.spellId,
    delve: graveIds(without.state).slice(0, 1),
  })).toMatchObject({ ok: false, error: 'Instruction fixture does not have delve' })
})

test('the unreduced delve cap rejects seven cards even with spare generic and sufficient blue mana', () => {
  const { server, state, spellId } = setup({ extraPool: { U: 2, C: 1 } })
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: graveIds(state) }))
    .toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
  const dry = structuredClone(state)
  dry.players.p1.mana.U = 0
  dry.players.p1.mana.C = 0
  expect(server.rules(dry, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: graveIds(dry).slice(0, 6) }))
    .toMatchObject({ ok: false, error: 'not enough mana' })
})

test('partial delve pays the remaining generic amount from mana', () => {
  const { server, state, spellId } = setup({ manaCost: '{4}{U}', extraPool: { U: 1, C: 2 } })
  const chosen = graveIds(state).slice(0, 2)
  const cast = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: chosen }))
  expect(cast.players.p1.mana).toMatchObject({ U: 0, C: 0 })
  expect(cast.zoneOrder.p1.graveyard).toEqual(graveIds(state).slice(2))
  const short = structuredClone(state)
  short.players.p1.mana.C = 1
  expect(server.rules(short, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: chosen })).toMatchObject({ ok: false, error: 'not enough mana' })
})

test('delve rejects foreign, hand, battlefield and missing cards', () => {
  const { server, state, spellId } = setup()
  let prepared = ok(server.rules(state, { type: 'move', objectId: named(state, 'Grave 1').id, to: 'hand' }))
  prepared = ok(server.rules(prepared, { type: 'move', objectId: named(prepared, 'Grave 2').id, to: 'battlefield' }))
  prepared = ok(server.rules(prepared, { type: 'move', objectId: named(prepared, 'Foreign grave card').id, to: 'graveyard' }))
  for (const id of ['missing', named(prepared, 'Grave 1').id, named(prepared, 'Grave 2').id, named(prepared, 'Foreign grave card').id]) {
    expect(server.rules(prepared, { type: 'castSpell', seat: 'p1', objectId: spellId, delve: [id] })).toMatchObject({ ok: false, error: 'illegal delve card' })
  }
})

test('a free cast has no generic amount available for delve', () => {
  const { server, state, spellId } = setup()
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spellId, withoutPayingMana: true, delve: graveIds(state).slice(0, 1) })).toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
})

test('action offers size the delve picker to the mana shortfall and submit picked cards', () => {
  const { server, state, spellId } = setup({ manaCost: '{4}{U}', extraPool: { U: 1 } })
  const actionFor = (current: GameState) => legalActsFor(current, 'p1').filter(action => action.kind === 'castSpell').find(action => action.objectId === spellId)
  expect(actionFor(state)).toMatchObject({ targetGroups: [{ delve: true, purpose: 'cost', min: 4, max: 4 }] })
  const rich = structuredClone(state)
  rich.players.p1.mana.C = 3
  const action = actionFor(rich)!
  expect(action).toMatchObject({ targetGroups: [{ delve: true, min: 1, max: 4 }] })
  const picked = [named(rich, 'Grave 2').id]
  const events = eventsForAvailableAction(rich, 'p1', { ...action, delve: picked })!
  expect(events.at(-1)).toMatchObject({ type: 'castSpell', delve: picked })
  const cast = events.reduce((current, event) => ok(server.rules(current, event)), rich)
  expect(cast.objects[picked[0]].zone).toBe('exile')
  expect(cast.stack[0]).toMatchObject({ name: 'Instruction fixture' })
  expect(eventsForAvailableAction(rich, 'p1', { ...action, delve: [] })).toBeNull()
  const dry = structuredClone(state)
  dry.players.p1.mana.U = 0
  expect(actionFor(dry)).toBeUndefined()
  const ordinary = setup({ delve: false, extraPool: { U: 2, C: 6 } })
  const plain = legalActsFor(ordinary.state, 'p1').filter(action => action.kind === 'castSpell').find(action => action.objectId === ordinary.spellId)
  expect(plain).toBeDefined()
  expect(plain?.targetGroups ?? []).toHaveLength(0)
})
