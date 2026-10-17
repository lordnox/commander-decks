import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import type { CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState, PlayerId } from '../types'
import {
  deckCard,
  fixtureCreature,
  libraryOf,
  named,
} from './cirdanCreatureCards'

const grothamaId = (state: GameState) => named(state, 'Grothama, All-Devouring').id

const attackEvent = (state: GameState, seat: PlayerId, names: string[]): GameEvent => ({
  type: 'declareAttackers',
  seat,
  attackers: names.map((name) => ({ objectId: named(state, name).id, defender: 'p3' })),
})

/** A real entry syncs the grant onto creatures already in play. */
const withGrant = (server: ReturnType<typeof createServerGame>, state: GameState) =>
  ok(server.rules(state, { type: 'custom', name: 'grantCreatureTrigger.sync' }))

const grothamaGame = (
  battlefield: Record<string, CardTemplate[]>,
  options: { first?: PlayerId } = {},
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 4,
      first: options.first ?? 'p2',
      battlefield,
      libraries: Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((seat) => [seat, libraryOf(seat, 20)])),
    },
    { random: () => 0.5 },
  )
  const ready = structuredClone(server.state)
  for (const object of Object.values(ready.objects)) object.summoningSickness = false
  ready.step = 'declareAttackers'
  return { server, ready }
}

const brute = (name: string, power: number, toughness = 4) =>
  fixtureCreature(name, { power, toughness })

describe('Grothama, All-Devouring', () => {


  /** Resolves the stack; each "may fight" pick takes the next answer, `true` fighting Grothama. */
  const resolveFights = (
    server: ReturnType<typeof createServerGame>,
    start: GameState,
    answers: boolean[] = [],
  ) => {
    let state = start
    let offered = 0
    for (let guard = 0; state.stack.length > 0 && guard < 40; guard += 1) {
      state = ok(server.rules(state, { type: 'resolveTop' }))
      const selection = pendingSelectionFor(state, state.active)
      if (!selection) continue
      const fight = answers[offered] ?? true
      offered += 1
      state = ok(server.rules(state, {
        type: 'selectCards',
        seat: selection.seat,
        kind: 'choose',
        count: 1,
        objectIds: fight ? [grothamaId(state)] : [],
      }))
    }
    return { state, offered }
  }


  test('each attacker owner privately chooses whether to fight; fights kill the attackers and fill the ledger by controller', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3), brute('Ogre', 4)],
    })
    const attacked = ok(server.rules(withGrant(server, ready), attackEvent(ready, 'p2', ['Raider', 'Ogre'])))
    expect(attacked.stack).toHaveLength(2)

    const first = ok(server.rules(attacked, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(first, 'p2')!
    expect(selection).toMatchObject({ kind: 'choose', seat: 'p2', count: 1, min: 0, candidates: [grothamaId(first)] })
    expect(pendingSelectionFor(projectForViewer(first, 'p1'), 'p2')).toBeUndefined()

    const { state } = resolveFights(server, attacked)
    expect(named(state, 'Raider').zone).toBe('graveyard')
    expect(named(state, 'Ogre').zone).toBe('graveyard')
    expect(named(state, 'Grothama, All-Devouring').damageDealtBy).toEqual({ p2: 7 })
    expect(named(state, 'Grothama, All-Devouring').damageMarked).toBe(7)
    expect(named(state, 'Grothama, All-Devouring').zone).toBe('battlefield')
  })


  test('a host restart restores the open fight choice', () => {
    const { server, ready } = grothamaGame({
      p1: [deckCard('Grothama, All-Devouring')],
      p2: [brute('Raider', 3)],
    })
    const synced = withGrant(server, ready)
    const event = attackEvent(synced, 'p2', ['Raider'])
    const opened = ok(server.rules(ok(server.rules(synced, event)), { type: 'resolveTop' }))
    const selection = pendingSelectionFor(opened, 'p2')!

    let journal = createJournal(synced)
    journal = recordAccepted(journal, event)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p2')).toEqual(selection)
    const fought = resolveStack(server.rules, ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [grothamaId(restored)],
    })))
    expect(named(fought, 'Raider').zone).toBe('graveyard')
  })
})

