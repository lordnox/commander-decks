import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { PENDING_PLAYER_SELECTION, type PendingPlayerSelection } from './selectPlayers'

test('selectPlayers rejects stale and duplicate typed target submissions', () => {
  const server = createServerGame(commanderRules, {
    battlefield: {
      p1: [cardTemplate('Queza, Augur of Agonies', { types: ['Creature'] })],
    },
  }, { random: () => 0.5 })
  const source = server.state.zoneOrder.p1.battlefield[0]
  const selection: PendingPlayerSelection = {
    id: 'players-1',
    seat: 'p1',
    candidates: ['p2', 'p3', 'p4'],
    min: 1,
    max: 1,
    sourceId: source,
    source: 'Queza, Augur of Agonies',
    prompt: 'Choose target opponent.',
    abilityId: 'queza.drain',
    instructions: [{ kind: 'loseLifeTargetPlayer', amount: 1 }],
  }
  server.state.players.p1.data[PENDING_PLAYER_SELECTION] = [selection]
  server.state.priority = 'p1'

  expect(server.rules(server.state, {
    type: 'selectPlayers',
    selectionId: 'stale',
    seat: 'p1',
    players: ['p2'],
  })).toMatchObject({ ok: false })
  expect(server.rules(server.state, {
    type: 'selectPlayers',
    selectionId: selection.id,
    seat: 'p1',
    players: ['p2', 'p2'],
  })).toMatchObject({ ok: false })

  const selected = ok(server.rules(server.state, {
    type: 'selectPlayers',
    selectionId: selection.id,
    seat: 'p1',
    players: ['p3'],
  }))
  expect(selected.stack[0]).toMatchObject({
    abilityId: 'queza.drain',
    targets: [{ kind: 'player', player: 'p3' }],
  })
  expect(selected.players.p1.data[PENDING_PLAYER_SELECTION]).toBeUndefined()
})
