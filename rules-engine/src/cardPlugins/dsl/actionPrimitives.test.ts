import { resolveStack } from '../../testHelpers'
import { describe, expect, test } from 'bun:test'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import {
  amount,
  activated,
  tapCost,
  card,
  compareAmount,
  createToken,
  destroy,
  damage,
  players,
  ifThen,
  mill,
  objects,
  proliferate,
  ref,
  sacrifice,
  sequence,
} from './v1'
import { compileCardRuleDefinition, createDefinitionSnapshot } from './compiler'
import type { Instruction } from './schema/v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import type { ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const run = (instructions: Instruction[]) => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
    kind: 'spell',
    costs: [],
    decisions: { targets: [] },
    instructions,
  }])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Part07 action spell', { types: ['Sorcery'], manaCost: '{0}', manaValue: 0, ruleDefinition: definition })] },
    battlefield: { p1: [cardTemplate('Part07 victim', { types: ['Creature'], power: 2, toughness: 2 })] },
    libraries: { p1: [cardTemplate('Part07 milled card')] },
  }, { random: () => 0 })
  const spell = Object.values(server.state.objects).find((object) => object.name === 'Part07 action spell')!
  return ok(server.rules(ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id })), { type: 'resolveTop' }))
}

describe('actionPrimitives', () => {
  test('keeps destruction, milling, and token creation as semantic events', () => {
    const state = run([
      destroy({ targets: objects({ zone: 'battlefield', name: 'Part07 victim' }) }),
      mill({ count: amount(1), targets: ref('controller') }),
      createToken({
        count: amount(1),
        targets: ref('controller'),
        token: { name: 'Part07 token', types: ['Creature'], power: 1, toughness: 1 },
      }),
    ])
    expect(Object.values(state.objects).find((object) => object.name === 'Part07 victim')?.zone).toBe('graveyard')
    expect(Object.values(state.objects).find((object) => object.name === 'Part07 milled card')?.zone).toBe('graveyard')
    expect(Object.values(state.objects).filter((object) => object.name === 'Part07 token' && object.zone === 'battlefield').length).toBeGreaterThan(0)
  })

  test('conditional branches are distinct nested program scopes', () => {
    const state = run([ifThen(compareAmount(amount(2), 'gte', amount(1)), {
      then: [{ kind: 'gainLife', amount: amount(2), targets: ref('controller') }],
      otherwise: [{ kind: 'loseLife', amount: amount(2), targets: ref('controller') }],
    })])
    expect(state.players.p1.life).toBe(42)
  })

  test('action builders preserve semantic node identity', () => {
    expect(sacrifice({ targets: objects({ type: 'Creature' }) }).kind).toBe('sacrifice')
    expect(proliferate({ targets: ref('controller') }).kind).toBe('proliferate')
    expect(sequence(destroy({ targets: objects({}) })).kind).toBe('sequence')
  })
})

test.each([0, 1, 3].flatMap(library => [false, true].map(countered => ({ library, countered }))))('activated mill waits for resolution and survives restore (%j)', ({ library, countered }) => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [tapCost()], instructions: [mill({ targets: ref('controller'), count: 2 })] })])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Mill activation fixture', { types: ['Artifact'], ruleDefinition: definition })] },
    libraries: { p1: Array.from({ length: library }, (_, index) => cardTemplate(`Library fixture ${index}`, { types: ['Instant'] })) },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]
  let state = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' }))
  expect(state.objects[source].tapped).toBe(true)
  expect(state.stack).toHaveLength(1)
  expect(state.zoneOrder.p1.library).toHaveLength(library)
  expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
  state = JSON.parse(JSON.stringify(state))
  if (countered) state = ok(server.rules(state, { type: 'counterStackItem', stackId: state.stack[0].id }))
  state = resolveStack(server.rules, state)
  const moved = countered ? 0 : Math.min(2, library)
  expect(state.zoneOrder.p1.library).toHaveLength(library - moved)
  expect(state.zoneOrder.p1.graveyard).toHaveLength(moved)
  expect(state.stack).toHaveLength(0)
})

// Minimal spell program: the catalog separately owns its printed damage amount.
test('damage instruction applies once to every selected player and finishes the spell', () => {
  const state = run([damage({ source: ref('source'), targets: players(), amount: 4 })])
  expect(state.players.p1.life).toBe(36)
  expect(state.players.p2.life).toBe(36)
  expect(Object.values(state.objects).find(object => object.name === 'Part07 action spell')?.zone).toBe('graveyard')
  expect(state.stack).toHaveLength(0)
  expect(state.resolution).toBeUndefined()
})

test('catalog spell composes draw and life loss exactly once', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate("Night's Whisper", { types: ['Sorcery'], manaCost: '{0}' })] },
    libraries: {
      p1: ['Whisper One', 'Whisper Two', 'Whisper Three'].map((name) => cardTemplate(name)),
    },
  }, { random: () => 0 })
  const whisper = server.state.objects[server.state.zoneOrder.p1.hand[0]]!
  expect(whisper.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor("Night's Whisper"))
  expect(whisper.effects).toEqual([])
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }))
  const resolved = resolveStack(server.rules, cast)
  expect(resolved.players.p1.life).toBe(38)
  expect(resolved.zoneOrder.p1.hand).toHaveLength(2)
  expect(resolved.objects[whisper.id].zone).toBe('graveyard')
})
