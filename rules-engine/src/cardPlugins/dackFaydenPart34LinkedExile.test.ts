import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { exilePayoffs } from './exilePayoffs'
import { linkedExile } from './linkedExile'

const plugins = [activated, exilePayoffs, linkedExile]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const fromPool = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

// Remaining interaction-lifecycle rows for #403; catalog gameplay lives in dsl/linkExile.test.ts.
describe('Dack Fayden part 34 — linked exile cages', () => {
  test('link-exile target selection is visible only to the choosing seat after projection', () => {
    const hunter = fromPool('Fiend Hunter')
    const prey = cardTemplate('Hidden Prey', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    expect(pendingSelectionFor(entered, 'p1')?.candidates.length).toBeGreaterThan(0)
    const p1View = server.project(entered, 'p1')
    const p2View = server.project(entered, 'p2')
    expect(pendingSelectionFor(p1View, 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(p2View, 'p2')).toBeUndefined()
  })

  test('host restart preserves an open link-exile target choice', () => {
    const hunter = fromPool('Fiend Hunter')
    const prey = cardTemplate('Restart Prey', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Restart Prey').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    const before = pendingSelectionFor(entered, 'p1')
    expect(before).toBeDefined()
    const restarted = structuredClone(entered)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(before?.id)
    const finished = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [preyId],
    }))
    expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
    expect(finished.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, finished)
    expect(resolved.objects[preyId].zone).toBe('exile')
  })
})
