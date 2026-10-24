import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, Plugin } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { exileForEffect, move, objects, ref, select, target } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!
const setup = (creatures = 1, replacement?: Plugin) => createServerGame(commanderRules, {
  players: 2,
  hands: { p1: [instructionSpell({
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', any: [{ type: 'Artifact' }, { type: 'Enchantment' }], controller: 'opponent' }), count: 1 })] },
    instructions: [exileForEffect({
      chooser: ref('controller'),
      filter: objects({ zone: 'graveyard', owner: 'you', type: 'Creature' }),
      bindChoice: 'offering',
      then: [move({ targets: target(0), to: 'exile' })],
    })],
  })] },
  battlefield: { p2: [cardTemplate('Recipient fixture', { types: ['Artifact'] })] },
  libraries: {
    p1: [
      ...Array.from({ length: creatures }, (_, i) => cardTemplate(`Offering ${i}`, { types: ['Creature'], power: 1, toughness: 1, zone: 'graveyard' })),
      cardTemplate('Noncreature fixture', { types: ['Land'], zone: 'graveyard' }),
    ],
    p2: [cardTemplate('Other owner fixture', { types: ['Creature'], power: 1, toughness: 1, zone: 'graveyard' })],
  },
}, { random: () => 0, ...(replacement ? { cardPlugins: [replacement] } : {}) })

const cast = (server: ReturnType<typeof setup>) => ok(server.rules(server.state, {
  type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
  targets: [{ kind: 'object', objectId: named(server.state, 'Recipient fixture').id }],
}))

test.each([false, true])('optional resolution exile pays or declines after targets are announced (pay=%s)', pay => {
  const server = setup(2)
  const announced = cast(server)
  expect(pendingSelectionFor(announced, 'p1')).toBeUndefined()
  expect(named(announced, 'Offering 0').zone).toBe('graveyard')
  const pending = resolveStack(server.rules, announced)
  const selection = pendingSelectionFor(pending, 'p1')!
  expect(selection.min).toBe(0)
  expect(selection.count).toBe(1)
  expect(selection.candidates.map(id => pending.objects[id].name).sort()).toEqual(['Offering 0', 'Offering 1'])
  const restored = restoreJournal(createJournal(pending), server.rules).current()
  const finished = ok(server.rules(restored, {
    type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count,
    objectIds: pay ? [named(restored, 'Offering 0').id] : [],
  }))
  expect(named(finished, 'Offering 0').zone).toBe(pay ? 'exile' : 'graveyard')
  expect(named(finished, 'Offering 1').zone).toBe('graveyard')
  expect(named(finished, 'Recipient fixture').zone).toBe(pay ? 'exile' : 'battlefield')
  expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
  expect(finished.stack).toHaveLength(0)
})

test('no eligible card skips the optional cost and its effect', () => {
  const server = setup(0)
  const finished = resolveStack(server.rules, cast(server))
  expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
  expect(named(finished, 'Recipient fixture').zone).toBe('battlefield')
  expect(finished.stack).toHaveLength(0)
})

test.each(['countered', 'illegal target'] as const)('%s prevents opening or paying the resolution cost', outcome => {
  const server = setup()
  const announced = cast(server)
  const changed = outcome === 'countered'
    ? ok(server.rules(announced, { type: 'counterStackItem', stackId: announced.stack[0].id }))
    : ok(server.rules(announced, { type: 'move', objectId: named(announced, 'Recipient fixture').id, to: 'hand' }))
  const finished = resolveStack(server.rules, changed)
  expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
  expect(named(finished, 'Offering 0').zone).toBe('graveyard')
})

test('a replacement changing the exile destination still pays the resolution cost (CR 118.11–118.12)', () => {
  const replacement: Plugin = {
    id: 'fixture.redirectExileCost',
    replace: ({ event, state }) => event.type === 'move' && event.to === 'exile' && state.objects[event.objectId]?.zone === 'graveyard'
      ? { ...event, to: 'hand' }
      : undefined,
  }
  const server = setup(1, replacement)
  const pending = resolveStack(server.rules, cast(server))
  const selection = pendingSelectionFor(pending, 'p1')!
  const finished = ok(server.rules(pending, {
    type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count,
    objectIds: selection.candidates,
  }))
  expect(named(finished, 'Offering 0').zone).toBe('hand')
  expect(named(finished, 'Recipient fixture').zone).toBe('exile')
})
