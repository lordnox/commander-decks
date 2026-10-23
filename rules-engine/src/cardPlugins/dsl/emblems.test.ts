import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEmblem,
  drawDuringOtherPlayersSteps,
  objects,
  players,
  ref,
  spell,
  staticAbility,
  untapDuringOtherPlayersSteps,
} from './v1'
import { instructionSpell } from './instructionTestSupport'

const commandEmblem = {
  name: 'Test Emblem',
  subtypes: ['Teferi'],
  oracleText: 'Untap permanents you control during each opponent untap step. Draw during each opponent draw step.',
  abilities: [
    { ...staticAbility(untapDuringOtherPlayersSteps(objects({ zone: 'battlefield', controller: 'you' }))), activeIn: ['command'] as const },
    { ...staticAbility(drawDuringOtherPlayersSteps(players({ relation: 'you' }))), activeIn: ['command'] as const },
  ],
}

test('createEmblem places a source-independent program in the command zone', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({
      instructions: [createEmblem({ targets: ref('controller'), emblem: commandEmblem })],
    })] },
    battlefield: { p1: [cardTemplate('Tapped Rock', { types: ['Artifact'], tapped: true })] },
    libraries: { p1: [cardTemplate('Drawn card')] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  const emblem = Object.values(resolved.objects).find(object => object.types.includes('Emblem'))!
  expect(emblem.zone).toBe('command')
  expect(emblem.token).toBe(false)
  expect(emblem.controller).toBe('p1')
  expect(emblem.subtypes).toEqual(['Teferi'])
  expect(resolved.zoneOrder.p1.command).toContain(emblem.id)
  let state = { ...resolved, active: 'p1' as const, step: 'cleanup' as const }
  const beforeHand = state.zoneOrder.p1.hand.length
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(Object.values(state.objects).find(object => object.name === 'Tapped Rock')?.tapped).toBe(false)
  state = ok(server.rules(state, { type: 'advanceStep' }))
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(state.step).toBe('draw')
  expect(state.zoneOrder.p1.hand.length).toBe(beforeHand + 1)
})

test('an emblem in the command zone untaps and draws during opponent steps', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card(commandEmblem.abilities)))
  const server = createServerGame(commanderRules, {
    command: { p1: [cardTemplate('Test Emblem', {
      types: ['Emblem'],
      subtypes: ['Teferi'],
      zone: 'command',
      ruleDefinition: definition,
    })] },
    battlefield: { p1: [cardTemplate('Tapped Rock', { types: ['Artifact'], tapped: true })] },
    libraries: { p1: [cardTemplate('Drawn card')] },
  }, { random: () => 0 })
  let state = { ...server.state, active: 'p1' as const, step: 'cleanup' as const }
  const beforeHand = state.zoneOrder.p1.hand.length
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(state.active).toBe('p2')
  expect(Object.values(state.objects).find(object => object.name === 'Tapped Rock')?.tapped).toBe(false)
  state = ok(server.rules(state, { type: 'advanceStep' }))
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(state.step).toBe('draw')
  expect(state.zoneOrder.p1.hand.length).toBe(beforeHand + 1)
})

test('createEmblem is a compile-time instruction on a spell program', () => {
  expect(() => compileCardRuleDefinition(card([spell({
    instructions: [createEmblem({ targets: ref('controller'), emblem: commandEmblem })],
  })]))).not.toThrow()
})
