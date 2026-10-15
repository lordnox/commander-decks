import type { Instruction } from './schema/v1'
import { OPTIONAL_ACTION_DIAGNOSTIC_CODE } from './compiler/constants'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, draw, enters, gainLife, may, ref, sequence, spell, whenever } from './v1'

const begin = (instructions: readonly Instruction[] = [may(draw(1))]) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions })] },
    libraries: { p1: [cardTemplate('First'), cardTemplate('Second')] },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
  })))
  return { server, state }
}

for (const accept of [false, true]) {
  test(`may(draw(1)) ${accept ? 'draws on acceptance' : 'leaves library untouched on decline'} after restore`, () => {
    const { server, state } = begin()
    const pending = pendingOptionSelection(state, 'p1')!
    expect(pending.optionalAction).toBeDefined()
    expect(state.zoneOrder.p1.library).toHaveLength(2)
    expect(state.priority).toBeNull()
    expect(state.stack).toHaveLength(1)
    expect(pendingOptionSelection(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
    const restored = restoreJournal(createJournal(state), server.rules).current()
    const answered = ok(server.rules(restored, {
      type: 'selectOption', seat: 'p1', selectionId: pending.id,
      optionId: pending.options[accept ? 0 : 1].id,
    }))
    expect(answered.zoneOrder.p1.library).toEqual(accept ? state.zoneOrder.p1.library.slice(1) : state.zoneOrder.p1.library)
    expect(answered.zoneOrder.p1.hand).toHaveLength(accept ? 1 : 0)
    expect(answered.resolution).toBeUndefined()
    expect(answered.stack).toHaveLength(0)
  })
}

test('may can wrap a group; decline skips the entire group and continues the outer program', () => {
  const { server, state } = begin([
    may(sequence(draw(1), gainLife({ amount: 3, targets: ref('controller') }))),
    gainLife({ amount: 2, targets: ref('controller') }),
  ])
  const pending = pendingOptionSelection(state, 'p1')!
  expect(pending.optionalAction).toBeDefined()
  const next = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: pending.options[1].id }))
  expect(next.players.p1.life).toBe(42)
  expect(next.zoneOrder.p1.library).toEqual(state.zoneOrder.p1.library)
})

test('a may trigger goes on the stack before its resolution-time choice', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), { instructions: [may(draw(1))] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Land observer', { types: ['Creature'], ruleDefinition: definition })] },
    hands: { p1: [cardTemplate('Land fixture', { types: ['Land'] })] },
    libraries: { p1: [cardTemplate('Undrawn')] },
  })
  const triggered = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  expect(triggered.stack).toHaveLength(1)
  expect(pendingOptionSelection(triggered)).toBeUndefined()
  const resolving = resolveStack(server.rules, triggered)
  expect(pendingOptionSelection(resolving)?.optionalAction).toBeDefined()
  expect(resolving.zoneOrder.p1.library).toEqual(triggered.zoneOrder.p1.library)
})

test('optional identity is preserved even when the outer program has more instructions', () => {
  const { state } = begin([may(draw(1)), gainLife({ amount: 1, targets: ref('controller') })])
  expect(pendingOptionSelection(state)?.optionalAction).toBeDefined()
})

for (const accept of [false, true]) {
  test(`may supports non-draw actions with the same optional identity: ${accept ? 'accept' : 'decline'}`, () => {
    const { server, state } = begin([may(gainLife({ amount: 3, targets: ref('controller') }))])
    const pending = pendingOptionSelection(state, 'p1')!
    expect(typeof pending.optionalAction?.key).toBe('string')
    expect(pending.optionalAction?.acceptSlot).toBe(0)
    expect(pending.optionalAction?.declineSlot).toBe(1)
    expect(pending).not.toHaveProperty('optionalDraw')
    const restored = restoreJournal(createJournal(state), server.rules).current()
    const next = ok(server.rules(restored, {
      type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: pending.options[accept ? 0 : 1].id,
    }))
    expect(next.players.p1.life).toBe(accept ? 43 : 40)
    expect(next.zoneOrder.p1.library).toEqual(state.zoneOrder.p1.library)
  })
}

test('may preserves optional intent in canonical data; malformed optional branches are rejected', () => {
  const optional = may(draw(1))
  expect(optional).toMatchObject({ kind: 'chooseInstructions', optional: true })
  const definitions = [
    { instruction: { ...optional, optional: false }, code: OPTIONAL_ACTION_DIAGNOSTIC_CODE.MARKER },
    { instruction: { ...optional, options: [{ instructions: [draw(1)] }, { instructions: [draw(1)] }] }, code: OPTIONAL_ACTION_DIAGNOSTIC_CODE.OPTIONS },
    { instruction: { ...optional, options: [{ instructions: [] }, { instructions: [] }] }, code: OPTIONAL_ACTION_DIAGNOSTIC_CODE.OPTIONS },
  ]
  for (const { instruction, code } of definitions) {
    try {
      compileCardRuleDefinition(card([spell({ instructions: [instruction as never] })]))
      throw new Error('Expected optional-action validation to reject malformed branches')
    } catch (error) {
      expect(error).toHaveProperty('diagnostics')
      expect((error as { diagnostics: Array<{ code: string }> }).diagnostics.map((diagnostic) => diagnostic.code)).toContain(code)
    }
  }
})
