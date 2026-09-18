import { describe, expect, test } from 'bun:test'
import { draw } from '../cardPlugins/effects'
import { freezeDraft, makeDraft } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { StackItem } from '../types'
import { resolveAbility } from './actions'

describe('resolveAbility', () => {
  test('resolves payload instructions when the source object is gone', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [cardTemplate('Drawn', ['Instant'])] },
      players: 2,
    })
    const stacked = {
      ...server.state,
      stack: [{
        id: 'stack1',
        kind: 'ability' as const,
        objectId: 'gone-source',
        controller: 'p1',
        name: 'Ephemeral Trigger',
        targets: [],
        payload: {
          instructions: [draw(1)],
        },
      }],
    }

    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(resolved.zoneCounts.p1.hand).toBe(1)
    expect(resolved.stack.some((item) => item.actionId === 'draw')).toBe(false)
  })

  test('still requires a live source for abilityId lookups', () => {
    const server = createServerGame(commanderRules, { players: 2 })
    const draft = makeDraft(server.state)
    const item: StackItem = {
      id: 'stack1',
      kind: 'ability',
      objectId: 'gone-source',
      controller: 'p1',
      name: 'Missing Source',
      targets: [],
      abilityId: 'draw',
    }

    resolveAbility(draft, item)

    expect(freezeDraft(draft).zoneCounts.p1.hand).toBe(0)
  })
})
