import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { deckCardTemplate } from '../deckCardFixtures'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate, forest, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import {
  librarySearch,
} from './librarySearch'
import { pendingSelectionFor } from '../rules/selectCards'
import { legalActsFor } from '../actions'

import {resolveStack} from '../testHelpers'
import {activated} from './activated'

import { choiceEffects } from './choiceEffects'
import {ward} from './ward'

import { createServerGame as createRuntimeGame } from '../runtime'

import { hasKeyword } from '../keywords'
import { allNamed, artifact, choose, deckCard, enter, fixtureCreature, libraries } from './cirdanCreatureCards'
const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const catalogTriggerGame = (name: string, battlefield: Record<string, CardTemplate[]>) => {
  const server = createServerGame(commanderRules, {
    players: 3,
    hands: { p1: [deckCardTemplate(name)] },
    battlefield,
  }, { random: () => 0.5 })
  return { server, start: server.state }
}

const enterCatalogTrigger = (server: ReturnType<typeof createServerGame>, state: GameState, name: string) =>
  ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'battlefield' }))

const elephants = (state: GameState, seat: string) =>
  state.zoneOrder[seat].battlefield.map((id) => state.objects[id]).filter((object) => object.name === 'Elephant')

describe('targeted spell resolution', () => {
  test('Deathsprout rejects a noncreature target', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Deathsprout', {
            types: ['Instant'],
            manaCost: '{1}{B}{B}{G}',
          })],
        },
        battlefield: { p2: [cardTemplate('Rock', { types: ['Artifact'] })] },
      },
      { random: () => 0.5, cardPlugins: [librarySearch] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 1, C: 1 }
    const result = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Deathsprout').id,
      targets: [{ kind: 'object', objectId: named(ready, 'Rock').id }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('canonical targets')
  })

  test('Deathsprout destroys its target and completes the private basic search', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Deathsprout', {
            types: ['Instant'],
            manaCost: '{1}{B}{B}{G}',
          })],
        },
        battlefield: { p2: [cardTemplate('Bear', { types: ['Creature'] })] },
        libraries: { p1: [forest()] },
      },
      { random: () => 0.5, cardPlugins: [librarySearch] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 1, C: 1 }
    const spell = named(ready, 'Deathsprout').id
    const bear = named(ready, 'Bear').id
    const opened = run(server, ready, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell,
        targets: [{ kind: 'object', objectId: bear }],
      },
      { type: 'resolveTop' },
    ])
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection).toBeDefined()
    expect(opened.objects[bear].zone).toBe('graveyard')
    const opponentView = server.project(opened, 'p2')
    expect(opponentView.zoneOrder.p1.library).toEqual([])
    expect(Object.values(opponentView.objects).some((object) => object.name === 'Forest')).toBe(false)

    const basic = named(opened, 'Forest').id
    const resolved = resolveStack(server.rules, ok(server.rules(opened, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [basic] })))
    expect(resolved.objects[bear].zone).toBe('graveyard')
    expect(resolved.objects[basic].zone).toBe('battlefield')
    expect(resolved.objects[basic].tapped).toBe(true)
    expect(resolved.objects[spell].zone).toBe('graveyard')
  })

  test('Reanimate steals the creature and charges its mana value in life', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Reanimate', { types: ['Sorcery'], manaCost: '{B}' })],
          p2: [cardTemplate('Big Sphinx', {
            types: ['Creature'],
            manaCost: '{4}{U}{U}',
            manaValue: 6,
            power: 5,
            toughness: 5,
          })],
        },
      },
      { random: () => 0.5 },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.B = 1
    const spell = named(ready, 'Reanimate').id
    const sphinx = named(ready, 'Big Sphinx').id
    const life = ready.players.p1.life
    const resolved = run(server, ready, [
      { type: 'move', objectId: sphinx, to: 'graveyard' },
      { type: 'castSpell', seat: 'p1', objectId: spell, targets: [{ kind: 'object', objectId: sphinx }] },
      { type: 'resolveTop' },
    ])

    expect(resolved.objects[sphinx].zone).toBe('battlefield')
    expect(resolved.objects[sphinx].controller).toBe('p1')
    expect(resolved.objects[sphinx].owner).toBe('p2')
    expect(resolved.players.p1.life).toBe(life - 6)
    expect(resolved.objects[spell].zone).toBe('graveyard')
  })

})

describe('catalog creature enters-with-target triggers', () => {
  test('Woodfall Primus privately offers every legal noncreature permanent, including its controller\'s', () => {
    const { server, start } = catalogTriggerGame('Woodfall Primus', {
      p1: [cardTemplate('Own Rock', { types: ['Artifact'] })],
      p2: [
        cardTemplate('Enemy Rock', { types: ['Artifact'] }),
        cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Artifact Beast', { types: ['Artifact', 'Creature'] }),
      ],
      p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
    })
    const opened = enterCatalogTrigger(server, start, 'Woodfall Primus')
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1, min: 1, seat: 'p1' })
    expect(selection.candidates.map((id) => opened.objects[id].name).sort())
      .toEqual(['Enemy Forest', 'Enemy Rock', 'Own Rock'])
    expect(pendingSelectionFor(projectForViewer(opened, 'p2'), 'p1')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(opened, 'p1'), 'p1')?.id).toBe(selection.id)
  })

  test('Woodfall Primus restores its exact open target choice and resolves the replayed pick', () => {
    const { server, start } = catalogTriggerGame('Woodfall Primus', {
      p1: [cardTemplate('Own Rock', { types: ['Artifact'] })],
      p2: [cardTemplate('Enemy Rock', { types: ['Artifact'] })],
      p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
    })
    const entering: GameEvent = { type: 'move', objectId: named(start, 'Woodfall Primus').id, to: 'battlefield' }
    const opened = ok(server.rules(start, entering))
    const selection = pendingSelectionFor(opened, 'p1')!
    let journal = createJournal(start)
    journal = recordAccepted(journal, entering)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')).toEqual(selection)
    const done = resolveStack(server.rules, ok(server.rules(restored, choose(restored, ['Enemy Forest']))) )
    expect(named(done, 'Enemy Forest').zone).toBe('graveyard')
  })

  test('Terastodon offers exactly the legal noncreature targets privately, up to three', () => {
    const { server, start } = catalogTriggerGame('Terastodon', {
      p1: [cardTemplate('Own Rock', { types: ['Artifact'] })],
      p2: [
        cardTemplate('Enemy Rock', { types: ['Artifact'] }),
        cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 }),
      ],
    })
    expect([named(start, 'Terastodon').power, named(start, 'Terastodon').toughness]).toEqual([9, 9])
    const opened = enterCatalogTrigger(server, start, 'Terastodon')
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', min: 0, seat: 'p1' })
    expect(selection.count).toBe(selection.candidates.length)
    expect(selection.candidates.map((id) => opened.objects[id].name).sort()).toEqual(['Enemy Rock', 'Own Rock'])
    expect(pendingSelectionFor(projectForViewer(opened, 'p3'), 'p1')).toBeUndefined()
  })

  test('Terastodon restores its exact open choice and creates an Elephant for each target controller', () => {
    const { server, start } = catalogTriggerGame('Terastodon', {
      p2: [cardTemplate('Rock A', { types: ['Artifact'] })],
      p3: [cardTemplate('Rock B', { types: ['Artifact'] })],
    })
    const entering: GameEvent = { type: 'move', objectId: named(start, 'Terastodon').id, to: 'battlefield' }
    const opened = ok(server.rules(start, entering))
    const selection = pendingSelectionFor(opened, 'p1')!
    let journal = createJournal(start)
    journal = recordAccepted(journal, entering)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')).toEqual(selection)
    const done = resolveStack(server.rules, ok(server.rules(restored, choose(restored, ['Rock A', 'Rock B'], selection.count))))
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p3')).toHaveLength(1)
  })
})

const victimizeGame = () => {
  const server = createServerGame(
    commanderRules,
    {
      hands: {
        p1: [
          cardTemplate('Victimize'),
          cardTemplate('Returned Bear', { types: ['Creature'] }),
          cardTemplate('Returned Elk', { types: ['Creature'] }),
        ],
      },
      battlefield: {
        p1: [
          cardTemplate('Fodder Goat', { types: ['Creature'] }),
          cardTemplate('Home Rock', { types: ['Artifact'] }),
        ],
        p2: [cardTemplate('Enemy Bear', { types: ['Creature'] })],
      },
    },
    { random: () => 0.5 },
  )
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 }
  const withYard = run(server, ready, [
    { type: 'move', objectId: named(ready, 'Returned Bear').id, to: 'graveyard' },
    { type: 'move', objectId: named(ready, 'Returned Elk').id, to: 'graveyard' },
  ])
  return { server, ready: withYard }
}

const castBoth = (
  server: ReturnType<typeof createServerGame>,
  ready: GameState,
) => ok(server.rules(ready, {
  type: 'castSpell',
  seat: 'p1',
  objectId: named(ready, 'Victimize').id,
  targets: [
    { kind: 'object', objectId: named(ready, 'Returned Bear').id },
    { kind: 'object', objectId: named(ready, 'Returned Elk').id },
  ],
}))

describe('sacrifice then return N targeted graveyard creatures tapped', () => {

  test('sacrificing a battlefield creature returns both targets tapped', () => {
    const { server, ready } = victimizeGame()
    const choosing = ok(server.rules(castBoth(server, ready), { type: 'resolveTop' }))
    expect(pendingSelectionFor(choosing, 'p1')).toMatchObject({
      kind: 'choose',
      count: 1,
    })
    expect(pendingSelectionFor(choosing, 'p1')?.min).toBe(1)
    expect(pendingSelectionFor(choosing, 'p1')?.candidates).toContain(
      named(choosing, 'Fodder Goat').id,
    )
    expect(pendingSelectionFor(choosing, 'p1')?.candidates).not.toContain(
      named(choosing, 'Home Rock').id,
    )
    expect(pendingSelectionFor(choosing, 'p1')?.candidates).not.toContain(
      named(choosing, 'Enemy Bear').id,
    )
    expect(pendingSelectionFor(choosing, 'p1')?.candidates).not.toContain(
      named(choosing, 'Returned Bear').id,
    )
    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(choosing, 'Fodder Goat').id],
    }))
    expect(named(resolved, 'Fodder Goat').zone).toBe('graveyard')
    expect(named(resolved, 'Returned Bear')).toMatchObject({
      zone: 'battlefield',
      tapped: true,
      controller: 'p1',
    })
    expect(named(resolved, 'Returned Elk')).toMatchObject({
      zone: 'battlefield',
      tapped: true,
      controller: 'p1',
    })
  })

  test('an empty sacrifice is illegal while a creature remains', () => {
    const { server, ready } = victimizeGame()
    const choosing = ok(server.rules(castBoth(server, ready), { type: 'resolveTop' }))
    expect(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }).ok).toBe(false)
    expect(named(choosing, 'Returned Bear').zone).toBe('graveyard')
    expect(named(choosing, 'Fodder Goat').zone).toBe('battlefield')
  })

  test('failing the sacrifice with no creature leaves both cards in the graveyard', () => {
    const { server, ready } = victimizeGame()
    const sacrificed = ok(server.rules(ready, {
      type: 'sacrifice',
      objectId: named(ready, 'Fodder Goat').id,
    }))
    const failed = ok(server.rules(castBoth(server, sacrificed), { type: 'resolveTop' }))
    expect(pendingSelectionFor(failed, 'p1')).toBeUndefined()
    expect(named(failed, 'Returned Bear').zone).toBe('graveyard')
    expect(named(failed, 'Returned Elk').zone).toBe('graveyard')
  })

  test('cannot choose 0 or 1 target when 2 are required', () => {
    const { server, ready } = victimizeGame()
    const spell = named(ready, 'Victimize').id
    const bear = named(ready, 'Returned Bear').id
    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
    }).ok).toBe(false)
    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      targets: [{ kind: 'object', objectId: bear }],
    }).ok).toBe(false)
    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      targets: [
        { kind: 'object', objectId: bear },
        { kind: 'object', objectId: bear },
      ],
    }).ok).toBe(false)
    const acts = legalActsFor(ready, 'p1').filter((action) =>
      action.kind === 'castSpell' && action.name === 'Victimize')
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({
      targetGroups: [{ min: 2, max: 2 }],
    })
  })

  test('a host restart preserves an open sacrifice choice', () => {
    const { server, ready } = victimizeGame()
    const choosing = ok(server.rules(castBoth(server, ready), { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    const restarted = structuredClone(choosing)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(selection.id)
    expect(pendingSelectionFor(projectForViewer(restarted, 'p2'), 'p2')).toBeUndefined()
    const resolved = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(restarted, 'Fodder Goat').id],
    }))
    expect(named(resolved, 'Returned Bear').zone).toBe('battlefield')
    expect(named(resolved, 'Returned Elk').tapped).toBe(true)
  })
})

describe('relocated from homerPass2.test.ts → targetedResolve.test.ts', () => {
  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  const plugins = [activated, choiceEffects, librarySearch, ward]

  test("Black Sun's Twilight casts with zero creature targets", () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate("Black Sun's Twilight", { types: ['Sorcery'], manaCost: '{X}{B}' })] },
        },
        { random: () => 0.5, cardPlugins: plugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 5 }
      const actions = legalActsFor(ready, 'p1').filter((action) =>
        action.kind === 'castSpell' && action.objectId === named(ready, "Black Sun's Twilight").id)
      expect(actions.some((action) => action.kind === 'castSpell' && !action.targetObjectId)).toBe(true)
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(ready, "Black Sun's Twilight").id,
        x: 5,
        targets: [],
      }))
      const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(named(resolved, "Black Sun's Twilight").zone).toBe('graveyard')
    })

})

describe('relocated from homerRest.test.ts → targetedResolve.test.ts', () => {
  const createServerGame: typeof createRuntimeGame = (format, options) =>
    createRuntimeGame(format, options, {
      random: () => 0.5,
      cardPlugins: [
        choiceEffects,
        librarySearch,
        activated,
      ],
    })

  const named = (state: import('../types').GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('a bounce land asks which land to return', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Simic Growth Chamber', { types: ['Land'] })] },
          battlefield: {
            p1: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })],
          },
        },
      )
      const entered = resolveStack(server.rules, ok(server.rules(server.state, {
        type: 'playLand',
        seat: 'p1',
        objectId: named(server.state, 'Simic Growth Chamber').id,
      })))
      expect(pendingSelectionFor(entered, 'p1')?.candidates).toEqual(expect.arrayContaining([
        named(entered, 'Simic Growth Chamber').id, named(entered, 'Forest').id,
      ]))
      expect(named(entered, 'Simic Growth Chamber').tapped).toBe(true)
      const selection = pendingSelectionFor(entered, 'p1')!
      const forest = named(entered, 'Forest').id
      const returned = ok(server.rules(entered, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [forest] }))
      expect(returned.objects[forest].zone).toBe('hand')
      expect(named(returned, 'Simic Growth Chamber').zone).toBe('battlefield')
      expect(returned.resolution).toBeUndefined()
    })

  test('Join the Dead uses descend 4 for its full penalty', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Join the Dead', { types: ['Instant'] })] },
          battlefield: {
            p2: [cardTemplate('Target', { types: ['Creature'], power: 10, toughness: 10 })],
          },
          libraries: {
            p1: [
              cardTemplate('Land', { types: ['Land'], zone: 'graveyard' }),
              cardTemplate('Creature', { types: ['Creature'], zone: 'graveyard' }),
              cardTemplate('Artifact', { types: ['Artifact'], zone: 'graveyard' }),
              cardTemplate('Enchantment', { types: ['Enchantment'], zone: 'graveyard' }),
            ],
          },
        },
      )
      const spell = named(server.state, 'Join the Dead')
      const target = named(server.state, 'Target')
      const ready = structuredClone(server.state)
      ready.players.p1.mana.B = 2
      ready.players.p1.mana.C = 1
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell.id,
        targets: [{ kind: 'object', objectId: target.id }],
      }))
      const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(resolved.objects[target.id].zone).toBe('graveyard')
    })

  test('Stitch Together changes destination at threshold', () => {
      const graveyard = [
        cardTemplate('Returned', { types: ['Creature'], zone: 'graveyard' }),
        ...Array.from({ length: 6 }, (_, index) =>
          cardTemplate(`Grave ${index}`, { types: ['Instant'], zone: 'graveyard' })),
      ]
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Stitch Together', { types: ['Sorcery'] })] },
          libraries: { p1: graveyard },
        },
      )
      const spell = named(server.state, 'Stitch Together')
      const target = named(server.state, 'Returned')
      const ready = structuredClone(server.state)
      ready.players.p1.mana.B = 2
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell.id,
        targets: [{ kind: 'object', objectId: target.id }],
      }))
      const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(resolved.objects[target.id].zone).toBe('battlefield')
    })

  test('Black Sun’s Twilight scales with X and reanimates tapped at five', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [cardTemplate('Black Sun\'s Twilight', {
              types: ['Instant'],
              manaCost: '{X}{B}',
            })],
          },
          battlefield: {
            p2: [cardTemplate('Target', { types: ['Creature'], power: 6, toughness: 6 })],
          },
          libraries: {
            p1: [cardTemplate('Returned', {
              types: ['Creature'],
              manaValue: 4,
              zone: 'graveyard',
            })],
          },
        },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 6, R: 0, G: 0, C: 0 }
      const spell = named(ready, 'Black Sun\'s Twilight')
      const target = named(ready, 'Target')
      const returned = named(ready, 'Returned')
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell.id,
        x: 5,
        targets: [{ kind: 'object', objectId: target.id }],
      }))
      const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
      const selection = pendingSelectionFor(choosing, 'p1')!
      expect(choosing.objects[target.id]).toMatchObject({ power: 1, toughness: 1 })
      const resolved = ok(server.rules(choosing, {
        type: 'selectCards',
        seat: 'p1',
        kind: 'choose',
        count: selection.count,
        objectIds: [returned.id],
      }))
      expect(resolved.objects[returned.id]).toMatchObject({
        zone: 'battlefield',
        tapped: true,
      })
    })

  test('Fell the Profane destroys the target creature or planeswalker', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Fell the Profane', { types: ['Instant'] })] },
          battlefield: {
            p2: [cardTemplate('Target', { types: ['Creature'], power: 2, toughness: 2 })],
          },
        },
      )
      server.state.players.p1.mana = { ...server.state.players.p1.mana, B: 2, C: 2 }
      const target = named(server.state, 'Target')
      const cast = ok(server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(server.state, 'Fell the Profane').id,
        targets: [{ kind: 'object', objectId: target.id }],
      }))
      const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(resolved.objects[target.id].zone).toBe('graveyard')
      expect(resolved.players.p2.life).toBe(40)
    })

})

describe('relocated from cirdanTriggers.test.ts → targetedResolve.test.ts', () => {
  const pick = (state: GameState, ids: string[]): GameEvent => ({
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: pendingSelectionFor(state, 'p1')!.count,
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
      { random: () => 0.5 },
    )
    return { server, start: server.state }
  }

    test('Oracle trample comes from the printed text', () => {
      const { start } = primusGame()
      expect(hasKeyword(named(start, 'Woodfall Primus'), 'trample')).toBe(true)
      expect([named(start, 'Woodfall Primus').power, named(start, 'Woodfall Primus').toughness]).toEqual([6, 6])
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

    test('choosing nothing is the "you may" declined: no stack item, nothing destroyed', () => {
      const { server, start } = terastodonGame({ p2: [artifact('Enemy Rock')] })
      const opened = enter(server, start, 'Terastodon')
      const declined = ok(server.rules(opened, pick(opened, [])))
      const done = declined.stack.length > 0 ? resolveStack(server.rules, declined) : declined
      expect(named(done, 'Enemy Rock').zone).toBe('battlefield')
      expect(elephants(done, 'p2')).toHaveLength(0)
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
          colors: 'G',
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
        ok(server.rules(opened, pick(opened, ['Rock A', 'Rock B', 'Rock C'].map(name => named(opened, name).id)))),
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
      const done = resolveStack(server.rules, ok(server.rules(opened, pick(opened, [named(opened, 'Stolen Rock').id]))))
      expect(named(done, 'Stolen Rock').zone).toBe('graveyard')
      expect(elephants(done, 'p2')).toHaveLength(1)
      expect(elephants(done, 'p3')).toHaveLength(0)
    })

    test('a token destroyed this way still gives its controller an Elephant', () => {
      const { server, start } = terastodonGame({ p2: [artifact('Treasure Token', { token: true })] })
      const opened = enter(server, start, 'Terastodon')
      const done = resolveStack(server.rules, ok(server.rules(opened, pick(opened, [named(opened, 'Treasure Token').id]))))
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
        ok(server.rules(opened, pick(opened, ['Plain Rock', 'Hardened Rock', 'Commander Relic'].map(name => named(opened, name).id)))),
      )
      expect(named(done, 'Plain Rock').zone).toBe('graveyard')
      expect(named(done, 'Hardened Rock').zone).toBe('battlefield')
      expect(named(done, 'Commander Relic').zone).toBe('command')
      expect(elephants(done, 'p2')).toHaveLength(1)
    })
})
