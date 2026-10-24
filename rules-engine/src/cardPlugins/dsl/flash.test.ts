import { expect, test } from 'bun:test'
import { legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { hasKeyword } from '../../keywords'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { card, chooseCards, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, grantKeywordEffect, KEYWORDS, keyword, objects, ref, untilCleanup } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const setup = (printed = false) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [
    cardTemplate('Flash fixture', { types: ['Creature'], manaCost: '{1}', power: 1, toughness: 1,
      ...(printed ? { oracleText: 'Flash' } : { ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.flash]))) }) }),
    cardTemplate('Ordinary fixture', { types: ['Creature'], manaCost: '{1}', power: 1, toughness: 1 }),
    cardTemplate('Response fixture', { types: ['Instant'], manaCost: '{0}' }),
  ] },
}, { random: () => 0 })
const opponentsCombat = (state: GameState) => ({ ...structuredClone(state), active: 'p2', priority: 'p1', step: 'beginCombat' as const })
const cast = (server: ReturnType<typeof setup>, state: GameState, name = 'Flash fixture') => server.rules(state, { type: 'castSpell', seat: 'p1', objectId: named(state, name).id })

test.each([false, true])('flash permits off-turn casting and responses with printed=%s', printed => {
  const server = setup(printed)
  const state = opponentsCombat(server.state)
  state.players.p1.mana.C = 2
  expect(hasKeyword(named(state, 'Flash fixture'), KEYWORDS.flash, state)).toBe(true)
  const restored = restoreJournal(createJournal(state), server.rules).current()
  expect(legalActsFor(restored, 'p1').some(action => action.kind === 'castSpell' && action.name === 'Flash fixture')).toBe(true)
  expect(legalActsFor(restored, 'p1').some(action => action.kind === 'castSpell' && action.name === 'Ordinary fixture')).toBe(false)
  expect(cast(server, restored, 'Ordinary fixture').ok).toBe(false)
  const response = ok(cast(server, restored, 'Response fixture'))
  expect(response.stack).toHaveLength(1)
  expect(legalActsFor(response, 'p1').some(action => action.kind === 'castSpell' && action.name === 'Flash fixture')).toBe(true)
  expect(ok(cast(server, response)).stack).toHaveLength(2)
})

test('flash does not bypass priority, mana payment, or permission to cast from another zone', () => {
  const server = setup()
  const state = opponentsCombat(server.state)
  expect(cast(server, state).ok).toBe(false)
  state.players.p1.mana.C = 1
  expect(cast(server, { ...state, priority: 'p2' }).ok).toBe(false)
  const graveyard = ok(server.rules(state, { type: 'move', objectId: named(state, 'Flash fixture').id, to: 'graveyard' }))
  expect(hasKeyword(named(graveyard, 'Flash fixture'), KEYWORDS.flash, graveyard)).toBe(true)
  expect(cast(server, graveyard).ok).toBe(false)
  expect(legalActsFor(graveyard, 'p1').some(action => action.kind === 'castSpell' && action.name === 'Flash fixture')).toBe(false)
})

test('a canonical flash grant to a hand card affects timing only until cleanup', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [createEffect({ targets: objects({ zone: 'hand', type: 'Creature' }), effect: grantKeywordEffect(KEYWORDS.flash), duration: untilCleanup() })] }), cardTemplate('Granted fixture', { types: ['Creature'], manaCost: '{0}', power: 1, toughness: 1 })] },
  }, { random: () => 0 })
  const granted = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id })))
  const offTurn = opponentsCombat(granted)
  expect(ok(server.rules(offTurn, { type: 'castSpell', seat: 'p1', objectId: named(offTurn, 'Granted fixture').id })).stack).toHaveLength(1)
  const moved = ok(server.rules(granted, { type: 'move', objectId: named(granted, 'Granted fixture').id, to: 'graveyard' }))
  const returned = ok(server.rules(moved, { type: 'move', objectId: named(moved, 'Granted fixture').id, to: 'hand' }))
  expect(hasKeyword(named(returned, 'Granted fixture'), KEYWORDS.flash, returned)).toBe(false)
  const cleanup = ok(server.rules({ ...granted, step: 'end' }, { type: 'advanceStep' }))
  expect(hasKeyword(named(cleanup, 'Granted fixture'), KEYWORDS.flash, cleanup)).toBe(false)
  expect(server.rules(opponentsCombat(cleanup), { type: 'castSpell', seat: 'p1', objectId: named(cleanup, 'Granted fixture').id }).ok).toBe(false)
})

test('a flash grant made to a permanent spell follows resolution but not a later blink', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [createEffect({ targets: objects({ zone: 'stack', type: 'Creature' }), effect: grantKeywordEffect(KEYWORDS.flash), duration: untilCleanup() })] }), cardTemplate('Spell fixture', { types: ['Creature'], manaCost: '{0}', power: 1, toughness: 1 })] },
  }, { random: () => 0 })
  const id = named(server.state, 'Spell fixture').id
  const creature = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }))
  const reply = ok(server.rules(creature, { type: 'castSpell', seat: 'p1', objectId: named(creature, 'Instruction fixture').id }))
  const granted = ok(server.rules(reply, { type: 'resolveTop' }))
  expect(hasKeyword(granted.objects[id]!, KEYWORDS.flash, granted)).toBe(true)
  const permanent = resolveStack(server.rules, granted)
  expect(hasKeyword(permanent.objects[id]!, KEYWORDS.flash, permanent)).toBe(true)
  const exiled = ok(server.rules(permanent, { type: 'move', objectId: id, to: 'exile' }))
  const returned = ok(server.rules(exiled, { type: 'move', objectId: id, to: 'battlefield' }))
  expect(hasKeyword(returned.objects[id]!, KEYWORDS.flash, returned)).toBe(false)
})

test('object filters match printed and granted flash, not oracle-text mentions', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        cardTemplate('Printed flash', { types: ['Creature'], oracleText: 'Flash', power: 1, toughness: 1 }),
        cardTemplate('Mention', { types: ['Creature'], oracleText: 'Target creature gains flash until end of turn.', power: 1, toughness: 1 }),
        cardTemplate('Granted fixture', { types: ['Creature'], power: 1, toughness: 1 }),
      ],
    },
    hands: { p1: [instructionSpell({
      instructions: [
        createEffect({ targets: objects({ zone: 'battlefield', name: 'Granted fixture' }), effect: grantKeywordEffect(KEYWORDS.flash), duration: untilCleanup() }),
        chooseCards({
          bindChoice: 'found',
          chooser: ref('controller'),
          filter: objects({ zone: 'battlefield', keyword: KEYWORDS.flash }),
          min: 0,
          max: 2,
        }),
      ],
    })] },
  }, { random: () => 0 })
  const choosing = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id,
  })))
  expect(pendingSelectionFor(choosing, 'p1')!.candidates.map(id => choosing.objects[id]!.name).sort())
    .toEqual(['Granted fixture', 'Printed flash'])
})

test('the shared keyword validator still rejects unsupported printed and granted abilities', () => {
  expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'keyword', keyword: 'unknown' }] })).toThrow()
  expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [{ kind: 'createEffect', targets: objects(), duration: untilCleanup(), effect: { kind: 'grantKeyword', keyword: 'unknown' } }] }] })).toThrow()
})
