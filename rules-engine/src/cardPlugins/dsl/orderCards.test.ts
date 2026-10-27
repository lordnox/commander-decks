import { expect, test } from 'bun:test'
import type { GameState } from '../../types'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { instructionSpell } from './instructionTestSupport'
import { card, choice, compileCardRuleDefinition, inspectTop, move, objects, orderCards, ref, spell } from './v1'

const setup = (position: 'top' | 'bottom', count = 3) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({ instructions: position === 'bottom'
    ? [
        inspectTop({ player: ref('controller'), count, bindChoice: 'top' }),
        orderCards({ chooser: ref('controller'), bindChoice: 'ordered', cards: choice('top'), position }),
        move({ targets: choice('ordered'), to: 'library', position }),
      ]
    : [
        orderCards({ chooser: ref('controller'), bindChoice: 'ordered', cards: objects({ zone: 'hand', owner: 'you' }), position }),
        move({ targets: choice('ordered'), to: 'library', position }),
      ] }), ...(position === 'top' ? ['Held A', 'Held B', 'Held C'].map((name) => cardTemplate(name)) : [])] },
  libraries: { p1: ['Deck 1', 'Deck 2', 'Deck 3', 'Deck 4'].map((name) => cardTemplate(name)), p2: [cardTemplate('Their Secret')] },
}, { random: () => 0 })

const begin = (server: ReturnType<typeof setup>) => resolveStack(server.rules, ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
})))

const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const names = (state: GameState, ids: readonly string[]) => ids.map((id) => state.objects[id]!.name)

const answer = (state: GameState, order: string[], destination: 'top' | 'bottom', seat = 'p1') => ({
  type: 'selectCards' as const, seat, selectionId: pendingSelectionFor(state, 'p1')!.id, kind: 'scry' as const, count: order.length,
  choices: order.map((name) => ({ objectId: named(state, name).id, destination })),
})

test('orderCards places inspected cards on the library bottom in the submitted order after restore', () => {
  const server = setup('bottom')
  const state = begin(server)
  const selection = pendingSelectionFor(state, 'p1')!
  expect(selection).toMatchObject({ kind: 'scry', destinations: ['bottom'], count: 3 })
  expect(names(state, selection.candidates)).toEqual(['Deck 1', 'Deck 2', 'Deck 3'])
  expect(pendingSelectionFor(server.project(state, 'p2'), 'p1')).toBeUndefined()
  expect(JSON.stringify(server.project(state, 'p2'))).not.toContain('Deck 2')

  for (const invalid of [
    answer(state, ['Deck 3', 'Deck 1'], 'bottom'),
    answer(state, ['Deck 3', 'Deck 3', 'Deck 1'], 'bottom'),
    answer(state, ['Deck 3', 'Deck 4', 'Deck 1'], 'bottom'),
    answer(state, ['Deck 3', 'Deck 2', 'Deck 1'], 'top'),
    answer(state, ['Deck 3', 'Deck 2', 'Deck 1'], 'bottom', 'p2'),
  ]) expect(server.rules(state, invalid).ok).toBe(false)

  const restored = restoreJournal(JSON.parse(JSON.stringify(createJournal(state))), server.rules).current()
  const event = answer(restored, ['Deck 3', 'Deck 1', 'Deck 2'], 'bottom')
  expect(server.rules(restored, event)).toEqual(server.rules(state, event))
  const done = ok(server.rules(restored, event))
  expect(names(done, done.zoneOrder.p1.library)).toEqual(['Deck 4', 'Deck 3', 'Deck 1', 'Deck 2'])
  expect(done.resolution).toBeUndefined()
})

test('orderCards stacks cards on the library top so the first submitted card ends on top', () => {
  const server = setup('top')
  const state = begin(server)
  expect(pendingSelectionFor(state, 'p1')).toMatchObject({ kind: 'scry', destinations: ['top'], count: 3 })
  const done = ok(server.rules(state, answer(state, ['Held B', 'Held C', 'Held A'], 'top')))
  expect(names(done, done.zoneOrder.p1.library)).toEqual(['Held B', 'Held C', 'Held A', 'Deck 1', 'Deck 2', 'Deck 3', 'Deck 4'])
})

test.each([
  [0, ['Deck 1', 'Deck 2', 'Deck 3', 'Deck 4']],
  [1, ['Deck 2', 'Deck 3', 'Deck 4', 'Deck 1']],
])('orderCards binds %s card(s) without opening a choice', (count, library) => {
  const server = setup('bottom', count)
  const done = begin(server)
  expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
  expect(names(done, done.zoneOrder.p1.library)).toEqual(library)
  expect(done.resolution).toBeUndefined()
})

test('orderCards rejects unsupported positions and undeclared card bindings', () => {
  const programs = [
    [orderCards({ chooser: ref('controller'), bindChoice: 'ordered', cards: choice('missing'), position: 'bottom' })],
    [orderCards({ chooser: ref('controller'), bindChoice: 'ordered', cards: objects({ zone: 'hand' }), position: 'middle' as 'top' })],
  ]
  for (const instructions of programs) expect(() => compileCardRuleDefinition(card([spell({ instructions })]))).toThrow()
})
