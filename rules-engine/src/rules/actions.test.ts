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
    const draft = makeDraft(server.state)
    const item: StackItem = {
      id: 'stack1',
      kind: 'ability',
      objectId: 'gone-source',
      controller: 'p1',
      name: 'Ephemeral Trigger',
      targets: [],
      payload: {
        instructions: [draw(1)],
      },
    }

    resolveAbility(draft, item)

    const state = freezeDraft(draft)
    expect(state.zoneCounts.p1.hand).toBe(0)
    expect(state.stack).toEqual([
      expect.objectContaining({
        actionId: 'draw',
        payload: { seat: 'p1', remaining: 1 },
      }),
    ])
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
