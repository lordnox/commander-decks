import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  choice,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createToken,
  destroy,
  forEach,
  objects,
  ref,
  select,
  self,
  target,
  whenever,
} from './v1'

const elephant = {
  name: 'Elephant',
  types: ['Creature'],
  subtypes: ['Elephant'],
  colors: ['G'],
  power: 3,
  toughness: 3,
}

const destroyer = cardTemplate('Fixture Destroyer', {
  types: ['Creature'],
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', not: { type: 'Creature' } }), min: 0, max: 3 })] },
      instructions: [
        destroy({ targets: target(0), bindChoice: 'destroyed' }),
        forEach({
          of: choice('destroyed'),
          instructions: [createToken({ count: 1, targets: ref('event.player'), token: elephant })],
        }),
      ],
    }),
  ]))),
})

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

const elephants = (state: GameState, seat: string) =>
  state.zoneOrder[seat].battlefield
    .map(id => state.objects[id])
    .filter(object => object.name === 'Elephant')

const artifact = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Artifact'], ...extra })

const setup = (battlefield: Record<string, ReturnType<typeof cardTemplate>[]>) => {
  const server = createServerGame(
    commanderRules,
    { hands: { p1: [destroyer] }, battlefield, players: 3 },
    { random: () => 0.5 },
  )
  const state = ok(server.rules(server.state, {
    type: 'move',
    objectId: named(server.state, 'Fixture Destroyer').id,
    to: 'battlefield',
  }))
  return { server, state }
}

const choose = (state: GameState, names: string[]) => ({
  type: 'selectCards' as const,
  seat: 'p1' as const,
  kind: 'choose' as const,
  count: pendingSelectionFor(state, 'p1')!.count,
  objectIds: names.map(name => named(state, name).id),
})

test('each destroyed permanent gives its pre-move controller one token', () => {
  const { server, state } = setup({
    p1: [artifact('Own Rock')],
    p2: [artifact('Enemy Rock')],
    p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
  })
  const done = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Own Rock', 'Enemy Rock', 'Enemy Forest']))))
  for (const name of ['Own Rock', 'Enemy Rock', 'Enemy Forest']) {
    expect(named(done, name).zone).toBe('graveyard')
  }
  expect([elephants(done, 'p1'), elephants(done, 'p2'), elephants(done, 'p3')].map(list => list.length)).toEqual([1, 1, 1])
})

test('two permanents of one controller yield two tokens', () => {
  const { server, state } = setup({ p2: [artifact('Rock A'), artifact('Rock B')] })
  const done = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A', 'Rock B']))))
  expect(elephants(done, 'p2')).toHaveLength(2)
  expect(elephants(done, 'p1')).toHaveLength(0)
})

test('an indestructible permanent is not destroyed and yields no token', () => {
  const { server, state } = setup({
    p2: [artifact('Plain Rock'), artifact('Hardened Rock', { oracleText: 'Indestructible' })],
  })
  const done = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Plain Rock', 'Hardened Rock']))))
  expect(named(done, 'Plain Rock').zone).toBe('graveyard')
  expect(named(done, 'Hardened Rock').zone).toBe('battlefield')
  expect(elephants(done, 'p2')).toHaveLength(1)
})

test('a commander redirected from the graveyard yields no token', () => {
  const { server, state } = setup({
    p2: [artifact('Plain Rock'), artifact('Commander Relic', { tags: ['commander'] })],
  })
  const done = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Plain Rock', 'Commander Relic']))))
  expect(named(done, 'Plain Rock').zone).toBe('graveyard')
  expect(named(done, 'Commander Relic').zone).toBe('command')
  expect(elephants(done, 'p2')).toHaveLength(1)
})

test('a destroyed token still counts as put into a graveyard', () => {
  const { server, state } = setup({ p2: [artifact('Enemy Rock')] })
  const tokenState = structuredClone(state)
  named(tokenState, 'Enemy Rock').token = true
  const done = resolveStack(server.rules, ok(server.rules(tokenState, choose(tokenState, ['Enemy Rock']))))
  expect(elephants(done, 'p2')).toHaveLength(1)
})
