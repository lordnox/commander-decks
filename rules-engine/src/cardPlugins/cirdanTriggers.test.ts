import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { hasKeyword } from '../keywords'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { effectsFor } from './cardRules'
import { choiceEffects } from './choiceEffects'
import {
  allNamed,
  artifact,
  choose,
  deckCard,
  enter,
  fixtureCreature,
  libraries,
  named,
} from './cirdanCreatureCards'
import { cardPluginEntry } from './index'

const pick = (state: GameState, ids: string[]): GameEvent => ({
  type: 'selectCards',
  seat: 'p1',
  kind: 'choose',
  count: 3,
  objectIds: ids,
})

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

const kill = (server: ReturnType<typeof createServerGame>, state: GameState) =>
  resolveStack(server.rules, ok(server.rules(state, {
    type: 'sacrifice',
    objectId: named(state, 'Woodfall Primus').id,
  })))

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
  test('registers a mandatory noncreature-permanent destroy on enter and persist', () => {
    expect(effectsFor('Woodfall Primus')).toEqual([
      {
        op: 'trigger',
        on: 'enters',
        targets: { filter: { zone: 'battlefield', permanent: true, noncreature: true } },
        do: [{ kind: 'destroyTargetPermanent', types: [] }],
      },
      {
        op: 'trigger',
        on: 'dies',
        if: { kind: 'lacksCounter', counter: '-1/-1' },
        do: [{ kind: 'returnSelfWithCounter', counter: '-1/-1' }],
      },
    ])
    expect(cardPluginEntry('Woodfall Primus')?.handlerIds).toEqual(['choiceEffects'])
  })


  test('Oracle trample comes from the printed text', () => {
    const { start } = primusGame()
    expect(hasKeyword(named(start, 'Woodfall Primus'), 'trample', start)).toBe(true)
    expect([named(start, 'Woodfall Primus').power, named(start, 'Woodfall Primus').toughness]).toEqual([6, 6])
  })

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

  test('the chosen permanent is destroyed and nothing else is', () => {
    const { server, start } = primusGame()
    const opened = enter(server, start, 'Woodfall Primus')
    const done = resolveStack(server.rules, ok(server.rules(opened, choose(opened, ['Enemy Rock']))))
    expect(named(done, 'Enemy Rock').zone).toBe('graveyard')
    expect(named(done, 'Own Rock').zone).toBe('battlefield')
    expect(named(done, 'Enemy Bear').zone).toBe('battlefield')
    expect(named(done, 'Enemy Forest').zone).toBe('battlefield')
    expect(pendingSelectionFor(done, 'p1')).toBeUndefined()
  })

  test('it must target if it can, even its own permanent', () => {
    const { server, start } = primusGame({ p1: [artifact('Own Rock')], p2: [fixtureCreature('Enemy Bear')] })
    const opened = enter(server, start, 'Woodfall Primus')
    expect(pendingSelectionFor(opened, 'p1')!.candidates.map((id) => opened.objects[id].name))
      .toEqual(['Own Rock'])
    expect(server.rules(opened, choose(opened, [])).ok).toBe(false)
    const done = resolveStack(server.rules, ok(server.rules(opened, choose(opened, ['Own Rock']))))
    expect(named(done, 'Own Rock').zone).toBe('graveyard')
  })

  test('illegal picks are rejected: a creature, two targets, a duplicate, another seat', () => {
    const { server, start } = primusGame()
    const opened = enter(server, start, 'Woodfall Primus')
    expect(server.rules(opened, choose(opened, ['Enemy Bear'])).ok).toBe(false)
    expect(server.rules(opened, choose(opened, ['Enemy Rock', 'Own Rock'], 2)).ok).toBe(false)
    expect(server.rules(opened, choose(opened, ['Enemy Rock', 'Enemy Rock'], 2)).ok).toBe(false)
    expect(server.rules(opened, choose(opened, ['Enemy Rock'], 1, 'p2')).ok).toBe(false)
    expect(server.rules(opened, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
  })

  test('with no noncreature permanent anywhere, the ability never goes on the stack', () => {
    const { server, start } = primusGame({ p2: [fixtureCreature('Enemy Bear')] })
    const state = enter(server, start, 'Woodfall Primus')
    expect(state.stack).toEqual([])
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  })

  test('an opponent permanent with hexproof cannot be chosen, but your own can', () => {
    const { server, start } = primusGame({
      p1: [artifact('Own Shroud', { oracleText: 'Hexproof' })],
      p2: [artifact('Enemy Shroud', { oracleText: 'Hexproof' }), artifact('Enemy Rock')],
    })
    const opened = enter(server, start, 'Woodfall Primus')
    expect(pendingSelectionFor(opened, 'p1')!.candidates.map((id) => opened.objects[id].name).sort())
      .toEqual(['Enemy Rock', 'Own Shroud'])
  })

  test('an indestructible permanent survives', () => {
    const { server, start } = primusGame({
      p2: [artifact('Hardened Rock', { oracleText: 'Indestructible' })],
    })
    const opened = enter(server, start, 'Woodfall Primus')
    const done = resolveStack(server.rules, ok(server.rules(opened, choose(opened, ['Hardened Rock']))))
    expect(named(done, 'Hardened Rock').zone).toBe('battlefield')
  })

  test('a target that became a creature before resolution is illegal and survives', () => {
    const { server, start } = primusGame()
    const opened = enter(server, start, 'Woodfall Primus')
    const stacked = ok(server.rules(opened, choose(opened, ['Enemy Rock'])))
    expect(stacked.stack).toHaveLength(1)
    const animated = structuredClone(stacked)
    named(animated, 'Enemy Rock').types = ['Artifact', 'Creature']
    const done = resolveStack(server.rules, animated)
    expect(named(done, 'Enemy Rock').zone).toBe('battlefield')
  })

  test('a target that left the battlefield fizzles the ability', () => {
    const { server, start } = primusGame()
    const opened = enter(server, start, 'Woodfall Primus')
    const stacked = ok(server.rules(opened, choose(opened, ['Enemy Rock'])))
    const gone = ok(server.rules(stacked, {
      type: 'move',
      objectId: named(stacked, 'Enemy Rock').id,
      to: 'exile',
    }))
    const done = resolveStack(server.rules, gone)
    expect(named(done, 'Enemy Rock').zone).toBe('exile')
    expect(done.stack).toEqual([])
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

  describe('persist', () => {
    test('it returns with a -1/-1 counter, destroys another permanent, and then stays dead', () => {
      const { server, start } = primusGame({
        p2: [artifact('Rock A'), artifact('Rock B')],
      })
      let state = enter(server, start, 'Woodfall Primus')
      state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A']))))
      expect(named(state, 'Rock A').zone).toBe('graveyard')

      state = kill(server, state)
      const back = named(state, 'Woodfall Primus')
      expect(back.zone).toBe('battlefield')
      expect(back.counters).toEqual({ '-1/-1': 1 })
      expect([back.power, back.toughness]).toEqual([5, 5])
      // It entered again, so its enter trigger asks for a new target.
      expect(pendingSelectionFor(state, 'p1')!.candidates.map((id) => state.objects[id].name))
        .toEqual(['Rock B'])
      state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock B']))))
      expect(named(state, 'Rock B').zone).toBe('graveyard')

      state = kill(server, state)
      expect(named(state, 'Woodfall Primus').zone).toBe('graveyard')
      expect(state.stack).toEqual([])
    })

    test('exiled instead of dying, it does not persist', () => {
      const { server, start } = primusGame({ p2: [artifact('Rock A')] })
      let state = enter(server, start, 'Woodfall Primus')
      state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A']))))
      state = ok(server.rules(state, {
        type: 'move',
        objectId: named(state, 'Woodfall Primus').id,
        to: 'exile',
      }))
      expect(resolveStack(server.rules, state).objects[named(state, 'Woodfall Primus').id].zone).toBe('exile')
    })

    test('it returns under its owner, not the thief who killed it', () => {
      const { server, start } = primusGame({ p2: [artifact('Rock A')] })
      let state = enter(server, start, 'Woodfall Primus')
      state = resolveStack(server.rules, ok(server.rules(state, choose(state, ['Rock A']))))
      state = structuredClone(state)
      named(state, 'Woodfall Primus').controller = 'p2'
      state = kill(server, state)
      expect(named(state, 'Woodfall Primus')).toMatchObject({ zone: 'battlefield', controller: 'p1' })
    })
  })
})

describe('Terastodon', () => {
  test('registers an up-to-three noncreature-permanent destroy with a per-controller Elephant', () => {
    expect(effectsFor('Terastodon')).toEqual([{
      op: 'trigger',
      on: 'enters',
      targets: { filter: { zone: 'battlefield', permanent: true, noncreature: true }, min: 0, max: 3 },
      do: [{
        kind: 'destroyThenTokenForController',
        token: {
          name: 'Elephant',
          types: ['Creature'],
          subtypes: ['Elephant'],
          colors: ['G'],
          power: 3,
          toughness: 3,
        },
      }],
    }])
  })



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

  test('choosing nothing is the "you may" declined: no stack item, nothing destroyed', () => {
    const { server, start } = terastodonGame({ p2: [artifact('Enemy Rock')] })
    const opened = enter(server, start, 'Terastodon')
    const declined = ok(server.rules(opened, pick(opened, [])))
    expect(declined.stack).toEqual([])
    expect(named(declined, 'Enemy Rock').zone).toBe('battlefield')
    expect(elephants(declined, 'p2')).toHaveLength(0)
  })

  test('duplicate-named targets are separate permanents: each controller gets one Elephant per permanent', () => {
    const { server, start } = terastodonGame({
      p1: [artifact('Rock')],
      p2: [artifact('Rock'), artifact('Rock')],
      p3: [artifact('Rock')],
    })
    const opened = enter(server, start, 'Terastodon')
    const rocks = allNamed(opened, 'Rock')
    expect(rocks).toHaveLength(4)
    const p2Rocks = rocks.filter((rock) => rock.controller === 'p2').map((rock) => rock.id)
    const p3Rock = rocks.find((rock) => rock.controller === 'p3')!.id
    const done = resolveStack(
      server.rules,
      ok(server.rules(opened, pick(opened, [...p2Rocks, p3Rock]))),
    )
    for (const id of [...p2Rocks, p3Rock]) expect(done.objects[id].zone).toBe('graveyard')
    expect(done.objects[rocks.find((rock) => rock.controller === 'p1')!.id].zone).toBe('battlefield')
    expect(elephants(done, 'p2')).toHaveLength(2)
    expect(elephants(done, 'p3')).toHaveLength(1)
    expect(elephants(done, 'p1')).toHaveLength(0)
    for (const elephant of [...elephants(done, 'p2'), ...elephants(done, 'p3')]) {
      expect(elephant).toMatchObject({
        token: true,
        power: 3,
        toughness: 3,
        colors: ['G'],
        subtypes: ['Elephant'],
        types: ['Creature'],
      })
    }
  })

  test('a repeated pick of the same duplicate-named object is rejected', () => {
    const { server, start } = terastodonGame({ p2: [artifact('Rock'), artifact('Rock')] })
    const opened = enter(server, start, 'Terastodon')
    const [first] = allNamed(opened, 'Rock')
    expect(server.rules(opened, pick(opened, [first.id, first.id])).ok).toBe(false)
  })

  test('it can destroy three of its controller own permanents; their Elephants come back to its controller', () => {
    const { server, start } = terastodonGame({
      p1: [artifact('Rock A'), artifact('Rock B'), artifact('Rock C')],
    })
    const opened = enter(server, start, 'Terastodon')
    const done = resolveStack(
      server.rules,
      ok(server.rules(opened, choose(opened, ['Rock A', 'Rock B', 'Rock C'], 3))),
    )
    expect(elephants(done, 'p1')).toHaveLength(3)
  })

  test('the Elephant goes to whoever controlled the permanent, not its owner', () => {
    const { server, start } = terastodonGame({
      p2: [artifact('Stolen Rock')],
    })
    const prepared = structuredClone(start)
    named(prepared, 'Stolen Rock').owner = 'p3'
    const opened = enter(server, prepared, 'Terastodon')
    const done = resolveStack(server.rules, ok(server.rules(opened, choose(opened, ['Stolen Rock'], 3))))
    expect(named(done, 'Stolen Rock').zone).toBe('graveyard')
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p3')).toHaveLength(0)
  })

  test('a token destroyed this way still gives its controller an Elephant', () => {
    const { server, start } = terastodonGame({ p2: [artifact('Treasure Token', { token: true })] })
    const opened = enter(server, start, 'Terastodon')
    const done = resolveStack(server.rules, ok(server.rules(opened, choose(opened, ['Treasure Token'], 3))))
    expect(elephants(done, 'p2')).toHaveLength(1)
  })

  test('an indestructible permanent and a commander headed for the command zone give no Elephant', () => {
    const { server, start } = terastodonGame({
      p2: [
        artifact('Plain Rock'),
        artifact('Hardened Rock', { oracleText: 'Indestructible' }),
        artifact('Commander Relic', { tags: ['commander'] }),
      ],
    })
    const opened = enter(server, start, 'Terastodon')
    const done = resolveStack(
      server.rules,
      ok(server.rules(opened, choose(opened, ['Plain Rock', 'Hardened Rock', 'Commander Relic'], 3))),
    )
    expect(named(done, 'Plain Rock').zone).toBe('graveyard')
    expect(named(done, 'Hardened Rock').zone).toBe('battlefield')
    expect(named(done, 'Commander Relic').zone).toBe('command')
    expect(elephants(done, 'p2')).toHaveLength(1)
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
