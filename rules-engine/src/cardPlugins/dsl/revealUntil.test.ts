import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { objects, ref, revealUntil } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const card = (name: string, types: string[]) => cardTemplate(name, { types })

describe('revealUntil', () => {
  test('reveals until a land, puts it in hand, and orders the rest on the bottom', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [instructionSpell({
          instructions: [revealUntil({
            targets: ref('controller'),
            match: objects({ zone: 'library', type: 'Land' }),
            foundTo: 'hand',
            rest: 'orderBottom',
          })],
        })],
      },
      libraries: {
        p1: [
          card('First Spell', ['Instant']),
          card('Wanted Land', ['Land']),
          card('Next Spell', ['Sorcery']),
        ],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Instruction fixture').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(named(state, 'Wanted Land').zone).toBe('hand')
    const order = pendingSelectionFor(state, 'p1')!
    expect(order.candidates.map((id) => state.objects[id].name)).toEqual(['First Spell'])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'scry',
      count: 1,
      choices: [{ objectId: order.candidates[0], destination: 'bottom' }],
    }))
    state = resolveStack(server.rules, state)
    expect(named(state, 'First Spell').zone).toBe('library')
    expect(named(state, 'Next Spell').zone).toBe('library')
  })
})
