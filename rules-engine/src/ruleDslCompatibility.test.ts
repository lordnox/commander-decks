import { expect, test } from 'bun:test'
import fixture from '../migration/compatibility-fixtures/rules-engine-v0.json'
import { commanderRules } from './formats'
import { createServerGame } from './runtime'
import { pendingSelectionFor } from './rules/selectCards'
import { pendingPlayerSelectionFor } from './rules/selectPlayers'
import type { GameEvent, GameState } from './types'

const stateFixture = (state: unknown) => structuredClone(state) as GameState
const eventFixture = (event: unknown) => structuredClone(event) as GameEvent

test('Part 00 restores and consumes the open typed card-choice fixture exactly once', () => {
  const saved = fixture.savedStates.openCardChoice
  const server = createServerGame(commanderRules)
  const state = stateFixture(saved.state)

  expect(pendingSelectionFor(state, 'p1')?.id).toBe(saved.pendingId)
  const answer = eventFixture(saved.answer)
  const resolved = server.rules(state, answer)
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) return
  expect(resolved.state.objects[saved.expected.movedObjectId].zone)
    .toBe('graveyard')
  expect(saved.expected.destination).toBe('graveyard')
  expect(pendingSelectionFor(resolved.state, 'p1')).toBeUndefined()

  expect(server.rules(resolved.state, answer)).toMatchObject({ ok: false })
})

test('Part 00 restores and consumes the open typed player-choice fixture exactly once', () => {
  const saved = fixture.savedStates.openPlayerChoice
  const server = createServerGame(commanderRules)
  const state = stateFixture(saved.state)

  expect(pendingPlayerSelectionFor(state, 'p1')?.id).toBe(saved.pendingId)
  const answer = eventFixture(saved.answer)
  const resolved = server.rules(state, answer)
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) return
  expect(resolved.state.players.p1.life).toBe(saved.expected.p1Life)
  expect(resolved.state.players.p2.life).toBe(saved.expected.p2Life)
  expect(pendingPlayerSelectionFor(resolved.state, 'p1')).toBeUndefined()

  expect(server.rules(resolved.state, answer)).toMatchObject({ ok: false })
})
