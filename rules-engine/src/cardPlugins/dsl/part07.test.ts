import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compareAmount,
  createToken,
  destroy,
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

describe('Rule DSL Part 07 action primitives', () => {
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
