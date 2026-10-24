import type { GameState, PlayerId } from '../../types'
import type { PlayerEffect, PlayerEffectDuration } from '../../plugins/playerEffectConstants'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import {
  createPlayerEffect,
  loseLife,
  PLAYER_EFFECT_DURATIONS,
  PLAYER_EFFECTS,
  players,
  ref,
  select,
  target,
  winGame,
} from './v1'

const withEffect = (
  playerEffect: PlayerEffect,
  duration: PlayerEffectDuration = PLAYER_EFFECT_DURATIONS.untilCleanup,
  later: ReturnType<typeof instructionSpell>[] = [],
) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [instructionSpell({ instructions: [createPlayerEffect({ targets: players({ relation: 'any' }), playerEffect, duration })] }), ...later],
    },
  }, { random: () => 0 })
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
  })))
  return { server, state }
}

const advance = (server: ReturnType<typeof createServerGame>, state: GameState, step: GameState['step'], active: PlayerId = state.active) =>
  ok(server.rules({ ...state, step, active, priority: active, passedInRow: [] }, { type: 'advanceStep' }))

const targetedLoss = instructionSpell({
  decisions: { targets: [select({ filter: players({ relation: 'any' }), count: 1 })] },
  instructions: [loseLife({ targets: target(0), amount: 1 })],
})

test('player hexproof stops opponents targeting that player but not the player themself', () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.hexproof, PLAYER_EFFECT_DURATIONS.untilCleanup, [targetedLoss])
  const spell = state.zoneOrder.p1.hand[0]
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false)
  expect(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true)
})

test("can't lose life replaces life loss and forbids paying life", () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.cannotLoseLife)
  const lost = ok(server.rules(state, { type: 'loseLife', seat: 'p2', amount: 3 }))
  expect(lost.players.p2.life).toBe(state.players.p2.life)
  expect(server.rules(state, { type: 'payLife', seat: 'p2', amount: 2 }).ok).toBe(false)
  const damaged = ok(server.rules(state, { type: 'dealDamage', sourceId: state.zoneOrder.p1.graveyard[0], target: { kind: 'player', player: 'p2' }, amount: 4 }))
  expect(damaged.players.p2.life).toBe(state.players.p2.life)
})

test("can't lose the game keeps a player at zero life in the game until the effect ends", () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.cannotLoseGame)
  const empty = ok(server.rules(state, { type: 'setLifeTotal', seat: 'p2', total: 0 }))
  expect(empty.players.p2.lost).toBe(false)
  expect(empty.ended).toBeFalsy()
  const cleanup = advance(server, empty, 'end')
  expect(cleanup.players.p2.lost).toBe(true)
})

test("can't win the game replaces a win-the-game effect", () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.cannotWinGame, PLAYER_EFFECT_DURATIONS.untilCleanup, [instructionSpell({ instructions: [winGame({ targets: ref('controller') })] })])
  const blocked = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] })))
  expect(blocked.players.p2.lost).toBe(false)
  const winner = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [winGame({ targets: ref('controller') })] })] },
  }, { random: () => 0 })
  const won = resolveStack(winner.rules, ok(winner.rules(winner.state, { type: 'castSpell', seat: 'p1', objectId: winner.state.zoneOrder.p1.hand[0] })))
  expect(won.players.p2.lost).toBe(true)
})

test('until-cleanup player effects end at cleanup and survive restore before then', () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.cannotLoseLife)
  const restored = restoreJournal(createJournal(state), server.rules).current()
  expect(ok(server.rules(restored, { type: 'loseLife', seat: 'p1', amount: 2 })).players.p1.life).toBe(state.players.p1.life)
  const cleanup = advance(server, restored, 'end')
  expect(cleanup.step).toBe('cleanup')
  expect(ok(server.rules(cleanup, { type: 'loseLife', seat: 'p1', amount: 2 })).players.p1.life).toBe(state.players.p1.life - 2)
})

test("until-your-next-turn effects outlast the opponent's turn and end when the creator's turn begins", () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.cannotLoseLife, PLAYER_EFFECT_DURATIONS.untilYourNextTurn)
  const opponentTurn = advance(server, state, 'cleanup', 'p1')
  expect(opponentTurn.active).toBe('p2')
  expect(ok(server.rules(opponentTurn, { type: 'loseLife', seat: 'p2', amount: 2 })).players.p2.life).toBe(state.players.p2.life)
  const ownTurn = advance(server, opponentTurn, 'cleanup', 'p2')
  expect(ownTurn.active).toBe('p1')
  expect(ok(server.rules(ownTurn, { type: 'loseLife', seat: 'p2', amount: 2 })).players.p2.life).toBe(state.players.p2.life - 2)
})

test('createPlayerEffect rejects unknown effects and durations', () => {
  expect(() => instructionSpell({ instructions: [createPlayerEffect({ targets: ref('controller'), playerEffect: 'flying' as PlayerEffect, duration: PLAYER_EFFECT_DURATIONS.untilCleanup })] })).toThrow()
  expect(() => instructionSpell({ instructions: [createPlayerEffect({ targets: ref('controller'), playerEffect: PLAYER_EFFECTS.hexproof, duration: 'forever' as PlayerEffectDuration })] })).toThrow()
})


test("a sole survivor wins immediately even when an effect prevents winning", () => {
  const { server, state } = withEffect(PLAYER_EFFECTS.cannotWinGame)
  const won = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'concede', seat: 'p2' }))
  expect(won.players.p1.lost).toBe(false)
  expect(won.players.p2.lost).toBe(true)
  expect(won.ended).toBe(true)
})
