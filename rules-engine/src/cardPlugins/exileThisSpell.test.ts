import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { instructionSpell } from './dsl/instructionTestSupport'
import { discard, draw, exileThisSpell, players } from './dsl/v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const spell = (name: string, instructions: NonNullable<Parameters<typeof instructionSpell>[0]['instructions']>) => ({
  ...instructionSpell({ instructions }, '{1}'),
  name,
  types: ['Sorcery'],
  manaValue: 1,
})

const castAndResolve = (
  server: ReturnType<typeof createServerGame>,
  name: string,
) => {
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 1
  const cast = ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, name).id,
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

const game = (hand: ReturnType<typeof cardTemplate>[]) => createServerGame(commanderRules, {
  hands: { p1: hand },
  libraries: { p1: [cardTemplate('Top Card')] },
}, { random: () => 0.5 })

describe('exileThisSpell', () => {
  test('a resolving spell without it goes to the graveyard', () => {
    const server = game([spell('Plain Wish', [draw(1)])])
    const state = castAndResolve(server, 'Plain Wish')
    expect(named(state, 'Plain Wish').zone).toBe('graveyard')
  })

  test('the resolving spell is exiled after its instructions ran', () => {
    const server = game([spell('Vanishing Wish', [draw(1), exileThisSpell()])])
    const state = castAndResolve(server, 'Vanishing Wish')
    expect(named(state, 'Top Card').zone).toBe('hand')
    expect(named(state, 'Vanishing Wish').zone).toBe('exile')
    expect(state.zoneOrder.p1.exile).toContain(named(state, 'Vanishing Wish').id)
    expect(state.zoneOrder.p1.graveyard).not.toContain(named(state, 'Vanishing Wish').id)
  })

  test('still exiles after a private choice paused the resolution, and survives a restart', () => {
    const server = game([
      spell('Costly Wish', [discard({ targets: players(), count: 1 }), exileThisSpell()]),
      cardTemplate('Fodder'),
    ])
    const paused = castAndResolve(server, 'Costly Wish')
    const selection = pendingSelectionFor(paused, 'p1')!
    expect(selection.candidates.map((id) => paused.objects[id].name)).toEqual(['Fodder'])
    expect(paused.resolution?.kind).toBe('canonicalSpell')
    const restarted = structuredClone(paused)
    const state = resolveStack(server.rules, ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(restarted, 'Fodder').id],
    })))
    expect(named(state, 'Fodder').zone).toBe('graveyard')
    expect(named(state, 'Costly Wish').zone).toBe('exile')
  })
})
