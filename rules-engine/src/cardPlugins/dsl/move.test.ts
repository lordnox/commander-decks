import { expect, test } from 'bun:test'
import { freezeDraft, makeDraft } from '../../draft'
import { prepareResolutionStep, startCanonicalResolution } from '../../driver'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, Plugin } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { characteristic, createDefinitionSnapshot, gainLife, self, whenever, card, choice, compileCardRuleDefinition, loseLife, move, objects, putCounters, ref, select, spell, target } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const names = (state: GameState, zone: 'battlefield' | 'graveyard') =>
  state.zoneOrder.p1[zone].map((id) => state.objects[id].name)
const setup = () => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Land' } }), count: 1 })] },
    instructions: [move({ targets: target(0), to: 'exile' }), loseLife({ amount: 3, targets: ref('controller') })],
  })] },
  battlefield: { p2: [cardTemplate('Legacy Bear', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Forest', { types: ['Land'] })] },
}, { random: () => 0 })

const cast = (server: ReturnType<typeof setup>, state = server.state, targetName = 'Legacy Bear') => ok(server.rules(state, {
  type: 'castSpell', seat: 'p1', objectId: named(state, 'Instruction fixture').id,
  targets: [{ kind: 'object', objectId: named(state, targetName).id }],
}))

test('move to exile continues with controller life loss exactly once', () => {
  const server = setup()
  const resolved = resolveStack(server.rules, cast(server))
  expect(named(resolved, 'Legacy Bear').zone).toBe('exile')
  expect(named(resolved, 'Instruction fixture').zone).toBe('graveyard')
  expect(resolved.players.p1.life).toBe(37)
  expect(resolved.players.p2.life).toBe(40)
})

test('move target filter rejects lands; illegal targets skip subsequent life loss', () => {
  const server = setup()
  expect(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(server.state, 'Forest').id }],
  }).ok).toBe(false)
  const pending = cast(server)
  const gone = ok(server.rules(pending, { type: 'move', objectId: named(pending, 'Legacy Bear').id, to: 'hand' }))
  const resolved = resolveStack(server.rules, gone)
  expect(resolved.players.p1.life).toBe(40)
  expect(named(resolved, 'Legacy Bear').zone).toBe('hand')
})

test('move with attacking object filter bounces only attacking permanents', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      instructions: [move({ targets: objects({ zone: 'battlefield', attacking: true }), to: 'hand' })],
    })] },
    battlefield: {
      p2: [
        cardTemplate('Attacker', { types: ['Creature'], power: 2, toughness: 2, attacking: 'p2' }),
        cardTemplate('Idle', { types: ['Creature'], power: 1, toughness: 1 }),
      ],
    },
  }, { random: () => 0 })
  const casted = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [],
  }))
  const resolved = resolveStack(server.rules, casted)
  expect(named(resolved, 'Attacker').zone).toBe('hand')
  expect(named(resolved, 'Idle').zone).toBe('battlefield')
})

test('move and life-loss program restores before resolution', () => {
  const server = setup()
  const pending = cast(server)
  const restored = restoreJournal(createJournal(pending), server.rules)
  expect(resolveStack(server.rules, restored.current())).toEqual(resolveStack(server.rules, pending))
})

test('move onto the battlefield with tapped enters tapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      instructions: [move({
        targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
        to: 'battlefield',
        tapped: true,
      })],
    })] },
    libraries: {
      p1: [
        cardTemplate('Milled Forest', { types: ['Land'], zone: 'graveyard' }),
        cardTemplate('Milled Mountain', { types: ['Land'], zone: 'graveyard' }),
        cardTemplate('Milled Spell', { types: ['Instant'], zone: 'graveyard' }),
      ],
    },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [],
  })))
  expect(names(resolved, 'battlefield').sort()).toEqual(['Milled Forest', 'Milled Mountain'])
  expect(names(resolved, 'graveyard')).toContain('Milled Spell')
  expect(resolved.zoneOrder.p1.battlefield.every((id) => resolved.objects[id].tapped)).toBe(true)
})

test('move onto the battlefield without tapped leaves a land untapped', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      instructions: [move({
        targets: objects({ zone: 'graveyard', owner: 'you', type: 'Land' }),
        to: 'battlefield',
      })],
    })] },
    libraries: { p1: [cardTemplate('Milled Island', { types: ['Land'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Instruction fixture').id,
    targets: [],
  })))
  expect(named(resolved, 'Milled Island').tapped).toBe(false)
})

test('kernel move events honor tapped on battlefield enter', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    libraries: { p1: [cardTemplate('Direct Forest', { types: ['Land'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const landId = server.state.zoneOrder.p1.graveyard[0]
  const moved = ok(server.rules(server.state, {
    type: 'move',
    objectId: landId,
    to: 'battlefield',
    tapped: true,
  }))
  expect(moved.objects[landId].tapped).toBe(true)
})

test('move binds fresh public-zone identities through grouped moves and subsequent actions', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      move({ targets: objects({ zone: 'battlefield' }), to: 'exile', bindChoice: 'exiled' }),
      move({ targets: choice('exiled'), to: 'battlefield', bindChoice: 'returned' }),
      putCounters({ targets: choice('returned'), counter: '+1/+1', count: 1 }),
    ] })] },
    battlefield: { p1: [cardTemplate('First fixture', { types: ['Creature'], power: 1, toughness: 1 })], p2: [cardTemplate('Second fixture', { types: ['Creature'], power: 1, toughness: 1 })] },
  }, { random: () => 0 })
  const casted = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const resolved = resolveStack(server.rules, casted)
  for (const name of ['First fixture', 'Second fixture']) expect(named(resolved, name)).toMatchObject({ zone: 'battlefield', incarnation: named(casted, name).incarnation + 2, counters: { '+1/+1': 1 } })
})

test('a redirected move cannot bind a card that did not reach the requested public zone', () => {
  const redirect: Plugin = { id: 'test.redirectMove', replace: ({ event }) => event.type === 'move' && event.to === 'exile' ? { ...event, to: 'hand' } : undefined }
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [move({ targets: objects({ zone: 'battlefield' }), to: 'exile', bindChoice: 'exiled' }), move({ targets: choice('exiled'), to: 'battlefield' })] })] },
    battlefield: { p1: [cardTemplate('Fixture', { types: ['Artifact'] })] },
  }, { random: () => 0, cardPlugins: [redirect] })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id })))
  expect(named(resolved, 'Fixture').zone).toBe('hand')
})

test('move binding validation preserves lexical scope and requires a public destination', () => {
  for (const instructions of [
    [move({ targets: choice('missing'), to: 'exile' })],
    [move({ targets: objects(), to: 'hand', bindChoice: 'hidden' })],
    [move({ targets: objects(), to: 'exile', bindChoice: 'duplicate' }), move({ targets: objects(), to: 'exile', bindChoice: 'duplicate' })],
  ]) expect(() => compileCardRuleDefinition(card([spell({ instructions })]))).toThrow()
})

test('a restored move continuation binds the committed incarnation before its next instruction', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [move({ targets: objects({ zone: 'battlefield' }), to: 'exile', bindChoice: 'exiled' }), move({ targets: choice('exiled'), to: 'battlefield' })] })] },
    battlefield: { p1: [cardTemplate('Fixture', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  const state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id }))
  const draft = makeDraft(state)
  startCanonicalResolution(draft, draft.stack[0]!)
  prepareResolutionStep(draft)
  const id = named(state, 'Fixture').id
  draft.move(id, 'exile')
  const restored = makeDraft(JSON.parse(JSON.stringify(freezeDraft(draft))))
  expect(prepareResolutionStep(restored)).toEqual({ kind: 'events', events: [{ type: 'move', objectId: id, to: 'battlefield' }] })
  expect(restored.resolution?.kind === 'canonicalSpell' && restored.resolution.choices?.exiled).toEqual([{ kind: 'object', objectId: id, zone: 'exile', incarnation: state.objects[id]!.incarnation + 1 }])
})

test('entry counters exist before entry-trigger capture and keep a zero-toughness permanent alive', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(self.enters, { instructions: [gainLife({ targets: ref('controller'), amount: characteristic(ref('triggering.object.after'), 'power', { information: 'currentOrLastKnown' }) })] }),
  ])))
  const fixture = cardTemplate('Entry fixture', { types: ['Creature'], power: 0, toughness: 0, ruleDefinition: definition })
  const withFixture = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [move({ targets: objects({ zone: 'hand', type: 'Creature' }), to: 'battlefield', enterCounters: { '+1/+1': 1, charge: 2 } })] }), fixture] },
  }, { random: () => 0 })
  const casted = ok(withFixture.rules(withFixture.state, { type: 'castSpell', seat: 'p1', objectId: withFixture.state.zoneOrder.p1.hand[0] }))
  const restored = restoreJournal(createJournal(casted), withFixture.rules).current()
  const entered = ok(withFixture.rules(restored, { type: 'resolveTop' }))
  expect(entered.stack).toHaveLength(1)
  expect(named(entered, 'Entry fixture')).toMatchObject({ zone: 'battlefield', power: 1, toughness: 1, counters: { '+1/+1': 1, charge: 2 } })
  const left = ok(withFixture.rules(entered, { type: 'move', objectId: named(entered, 'Entry fixture').id, to: 'hand' }))
  const resolved = resolveStack(withFixture.rules, left)
  expect(named(resolved, 'Entry fixture')).toMatchObject({ zone: 'hand', power: 0, toughness: 0, counters: {} })
  expect(resolved.players.p1.life).toBe(41)
})

test.each(['redirect', 'tapped', 'sameZone'] as const)('entry counters respect the final move destination and actual entry (%s)', mode => {
  const rewrite: Plugin = { id: 'test.entryRewrite', replace: ({ event }) => event.type === 'move' && event.to === 'battlefield'
    ? { ...event, ...(mode === 'redirect' ? { to: 'hand' as const } : { tapped: true }) } : undefined }
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ instructions: [move({ targets: objects({ type: 'Creature' }), to: 'battlefield', enterCounters: { '+1/+1': 2 } })] }), ...(mode === 'sameZone' ? [] : [cardTemplate('Entry fixture', { types: ['Creature'], power: 1, toughness: 1 })])] },
    battlefield: { p1: mode === 'sameZone' ? [cardTemplate('Entry fixture', { types: ['Creature'], power: 1, toughness: 1 })] : [] },
  }, { random: () => 0, cardPlugins: mode === 'sameZone' ? [] : [rewrite] })
  const casted = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  const resolved = resolveStack(server.rules, casted)
  const fixture = named(resolved, 'Entry fixture')
  expect(fixture.zone).toBe(mode === 'redirect' ? 'hand' : 'battlefield')
  expect(fixture.counters).toEqual(mode === 'tapped' ? { '+1/+1': 2 } : {})
  expect(fixture.power).toBe(mode === 'tapped' ? 3 : 1)
  if (mode === 'tapped') expect(fixture.tapped).toBe(true)
})

test('entry-counter validation rejects non-battlefield moves, empty names and negative counts', () => {
  for (const instruction of [
    move({ targets: objects(), to: 'hand', enterCounters: { charge: 1 } }),
    move({ targets: objects(), to: 'battlefield', enterCounters: { '': 1 } }),
    move({ targets: objects(), to: 'battlefield', enterCounters: { charge: -1 } }),
  ]) expect(() => compileCardRuleDefinition(card([spell({ instructions: [instruction] })]))).toThrow()
})
