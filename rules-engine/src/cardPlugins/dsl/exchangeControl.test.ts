import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { exchangeControl, KEYWORDS, objects, players, select, target, untilCleanup } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test('exchangeControl snapshots both creature sets, grants haste, and restores at cleanup', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [exchangeControl({
        first: { kind: 'contextRef', name: 'controller' },
        second: target(0),
        permanents: objects({ zone: 'battlefield', type: 'Creature' }),
        duration: untilCleanup(),
        haste: true,
        untap: true,
      })],
    })] },
    battlefield: {
      p1: [cardTemplate('Your Bear', { types: ['Creature'], power: 2, toughness: 2, tapped: true })],
      p2: [cardTemplate('Their Bear', { types: ['Creature'], power: 3, toughness: 3, tapped: true })],
    },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  const resolved = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Instruction fixture').id,
    targets: [{ kind: 'player', player: 'p2' }],
  })))
  const yours = named(resolved, 'Your Bear')
  const theirs = named(resolved, 'Their Bear')
  expect(yours).toMatchObject({ controller: 'p2', tapped: false })
  expect(theirs).toMatchObject({ controller: 'p1', tapped: false })
  expect(hasKeyword(yours, KEYWORDS.haste, resolved)).toBe(true)
  expect(hasKeyword(theirs, KEYWORDS.haste, resolved)).toBe(true)
  const cleanup = ok(server.rules({ ...resolved, step: 'end', priority: 'p1' }, { type: 'advanceStep' }))
  expect(named(cleanup, 'Your Bear').controller).toBe('p1')
  expect(named(cleanup, 'Their Bear').controller).toBe('p2')
  expect(hasKeyword(named(cleanup, 'Your Bear'), KEYWORDS.haste, cleanup)).toBe(false)
})
