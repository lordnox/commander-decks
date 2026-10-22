import { expect, test } from 'bun:test'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  compileCardRuleDefinition,
  discard,
  discardHand,
  draw,
  forEachPlayer,
  objects,
  players,
  ref,
  resultAmount,
  spell,
} from './v1'
import type { Plugin } from '../../types'

const fixtures = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`${prefix} ${index}`))

const preventDiscard: Plugin = {
  id: 'test.preventDiscard',
  replace: ({ event }) => (event.type === 'discard' && event.seat === 'p1' ? null : undefined),
}

test('result-max rejects a loop that does not produce the collected field', () => {
  expect(() => compileCardRuleDefinition(card([spell({
    instructions: [forEachPlayer({
      of: players(),
      bindMax: { from: 'discarded', field: 'discardedCount', as: 'greatest' },
      instructions: [],
    })],
  })]))).toThrow()
})

test('player iteration keeps the maximum discarded count after restore', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [
        instructionSpell({ instructions: [
          forEachPlayer({
            of: players(),
            bindMax: { from: 'discarded', field: 'discardedCount', as: 'greatest' },
            instructions: [discardHand({ by: ref('event.player'), bindResult: 'discarded' })],
          }),
          draw({ targets: players(), count: resultAmount('greatest') }),
        ] }),
        ...fixtures(1, 'P1 keep'),
      ],
      p2: fixtures(3, 'P2 keep'),
    },
    libraries: {
      p1: fixtures(4, 'P1 draw'),
      p2: fixtures(4, 'P2 draw'),
    },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  expect(resolved.zoneOrder.p1.hand).toHaveLength(3)
  expect(resolved.zoneOrder.p2.hand).toHaveLength(3)
  expect(Object.values(resolved.objects).filter(object => object.name.startsWith('P1 keep') && object.zone === 'graveyard')).toHaveLength(1)
  expect(Object.values(resolved.objects).filter(object => object.name.startsWith('P2 keep') && object.zone === 'graveyard')).toHaveLength(3)
})

test('greatest discarded count uses actual discards, not prior hand size', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [
        instructionSpell({ instructions: [
          forEachPlayer({
            of: players(),
            bindMax: { from: 'discarded', field: 'discardedCount', as: 'greatest' },
            instructions: [discardHand({ by: ref('event.player'), bindResult: 'discarded' })],
          }),
          draw({ targets: players(), count: resultAmount('greatest') }),
        ] }),
        ...fixtures(4, 'P1 prevented'),
      ],
      p2: fixtures(2, 'P2 keep'),
    },
    libraries: {
      p1: fixtures(4, 'P1 draw'),
      p2: fixtures(4, 'P2 draw'),
    },
  }, { random: () => 0, cardPlugins: [preventDiscard] })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  expect(resolved.zoneOrder.p1.hand).toHaveLength(6)
  expect(resolved.zoneOrder.p2.hand).toHaveLength(2)
  expect(Object.values(resolved.objects).some(object => object.name.startsWith('P1 prevented') && object.zone === 'graveyard')).toBe(false)
  expect(Object.values(resolved.objects).filter(object => object.name.startsWith('P2 keep') && object.zone === 'graveyard')).toHaveLength(2)
})

test('empty hands bind a zero maximum and draw nothing', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      forEachPlayer({
        of: players(),
        bindMax: { from: 'discarded', field: 'discardedCount', as: 'greatest' },
        instructions: [discardHand({ by: ref('event.player'), bindResult: 'discarded' })],
      }),
      draw({ targets: players(), count: resultAmount('greatest') }),
    ] })] },
    libraries: { p1: fixtures(2, 'P1 draw'), p2: fixtures(2, 'P2 draw') },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  expect(resolved.zoneOrder.p1.hand).toHaveLength(0)
  expect(resolved.zoneOrder.p2.hand).toHaveLength(0)
})

test('selected-card discard still binds a numeric discarded count', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [
      instructionSpell({ instructions: [
        discard({
          targets: objects({ zone: 'hand', name: 'Discard' }),
          by: ref('controller'),
          bindResult: 'discarded',
        }),
        draw({ targets: ref('controller'), count: resultAmount('discarded', 'discardedCount') }),
      ] }),
      cardTemplate('Keep'),
      cardTemplate('Discard'),
    ] },
    libraries: { p1: fixtures(2, 'Draw') },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  expect(Object.values(resolved.objects).find(object => object.name === 'Discard')?.zone).toBe('graveyard')
  expect(resolved.zoneOrder.p1.hand).toHaveLength(2)
})
