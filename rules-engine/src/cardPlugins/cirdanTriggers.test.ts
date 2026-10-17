import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { choiceEffects } from './choiceEffects'
import {
  artifact,
  choose,
  deckCard,
  enter,
  fixtureCreature,
  libraries,
  named,
} from './cirdanCreatureCards'

const terastodonGame = (battlefield: Record<string, CardTemplate[]>, hands: Record<string, CardTemplate[]> = {}) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 3,
      hands: { p1: [deckCard('Terastodon')], ...hands },
      battlefield,
      libraries: libraries(['p1', 'p2', 'p3']),
    },
    { random: () => 0.5 },
  )
  return { server, start: server.state }
}

const elephants = (state: GameState, seat: string) =>
  state.zoneOrder[seat].battlefield
    .map((id) => state.objects[id])
    .filter((object) => object.name === 'Elephant')

const primusGame = (
  battlefield: Record<string, CardTemplate[]> = {
    p1: [artifact('Own Rock')],
    p2: [artifact('Enemy Rock'), fixtureCreature('Enemy Bear')],
    p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
  },
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 3,
      hands: { p1: [deckCard('Woodfall Primus')] },
      battlefield,
      libraries: libraries(['p1', 'p2', 'p3']),
    },
    { random: () => 0.5, cardPlugins: [choiceEffects] },
  )
  return { server, start: server.state }
}

describe('Woodfall Primus', () => {


  test('entering opens a private choice of any controller noncreature permanent, creatures excluded', () => {
    const { server, start } = primusGame({
      p1: [artifact('Own Rock')],
      p2: [
        artifact('Enemy Rock'),
        fixtureCreature('Enemy Bear'),
        artifact('Artifact Beast', { types: ['Artifact', 'Creature'] }),
      ],
      p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
    })
    const state = enter(server, start, 'Woodfall Primus')
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1, min: 1, seat: 'p1' })
    expect(selection.candidates.map((id) => state.objects[id].name).sort())
      .toEqual(['Enemy Forest', 'Enemy Rock', 'Own Rock'])
    expect(pendingSelectionFor(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(state, 'p1'), 'p1')?.id).toBe(selection.id)
  })


  test('a host restart restores the open choice and the replayed pick resolves the same way', () => {
    const { server, start } = primusGame()
    const entering: GameEvent = {
      type: 'move',
      objectId: named(start, 'Woodfall Primus').id,
      to: 'battlefield',
    }
    const opened = ok(server.rules(start, entering))
    const selection = pendingSelectionFor(opened, 'p1')!

    let journal = createJournal(start)
    journal = recordAccepted(journal, entering)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')).toEqual(selection)
    const done = resolveStack(server.rules, ok(server.rules(restored, choose(restored, ['Enemy Forest']))))
    expect(named(done, 'Enemy Forest').zone).toBe('graveyard')
  })
})

describe('Terastodon', () => {
  test('it is a 9/9 whose targets are chosen privately, up to three, noncreature only', () => {
    const { server, start } = terastodonGame({
      p1: [artifact('Own Rock')],
      p2: [artifact('Enemy Rock'), fixtureCreature('Enemy Bear')],
    })
    expect([named(start, 'Terastodon').power, named(start, 'Terastodon').toughness]).toEqual([9, 9])
    const opened = enter(server, start, 'Terastodon')
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 3, min: 0, seat: 'p1' })
    expect(selection.candidates.map((id) => opened.objects[id].name).sort()).toEqual(['Enemy Rock', 'Own Rock'])
    expect(pendingSelectionFor(projectForViewer(opened, 'p3'), 'p1')).toBeUndefined()
  })


  test('a host restart restores the open choice and the replayed pick resolves the same way', () => {
    const { server, start } = terastodonGame({ p2: [artifact('Rock A')], p3: [artifact('Rock B')] })
    const entering: GameEvent = {
      type: 'move',
      objectId: named(start, 'Terastodon').id,
      to: 'battlefield',
    }
    const opened = ok(server.rules(start, entering))
    const selection = pendingSelectionFor(opened, 'p1')!
    let journal = createJournal(start)
    journal = recordAccepted(journal, entering)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')).toEqual(selection)
    const done = resolveStack(
      server.rules,
      ok(server.rules(restored, choose(restored, ['Rock A', 'Rock B'], 3))),
    )
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p3')).toHaveLength(1)
  })
})
