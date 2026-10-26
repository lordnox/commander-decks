import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import {
  destroyThenTokenForController,
  destroyTargetPermanent,
  entersTargeting,
  entersTargetingUpTo,
} from './effects'
import { HOMER_NAME } from './homer'
import { instructionSpell } from './dsl/instructionTestSupport'
import { createToken, ref } from './dsl/v1'

import {catalogEntry, deckCards} from '../deckCardFixtures'
import {replayCardTemplate} from '../replay'
import {pendingPlayerSelectionFor} from '../rules/selectPlayers'
import { pendingDialogFor } from '../pendingDialog'

const NONCREATURE_PERMANENT = { zone: 'battlefield', permanent: true, noncreature: true } as const

const elephant = {
  name: 'Elephant',
  types: ['Creature'],
  subtypes: ['Elephant'],
  colors: 'G' as const,
  power: 3,
  toughness: 3,
}

const destroyer = cardTemplate('Fixture Destroyer', {
  types: ['Creature'],
  effects: [
    entersTargetingUpTo(3, NONCREATURE_PERMANENT, destroyThenTokenForController(elephant)),
  ],
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const artifact = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Artifact'], ...extra })

const setup = (battlefield: Record<string, ReturnType<typeof cardTemplate>[]>) => {
  const server = createServerGame(
    commanderRules,
    { hands: { p1: [destroyer] }, battlefield, players: 3 },
    { random: () => 0.5, cardPlugins: [] },
  )
  const state = ok(server.rules(server.state, {
    type: 'move',
    objectId: named(server.state, 'Fixture Destroyer').id,
    to: 'battlefield',
  }))
  return { server, state }
}

const choose = (
  state: GameState,
  names: string[],
): GameEvent => ({
  type: 'selectCards',
  seat: 'p1',
  kind: 'choose',
  count: 3,
  objectIds: names.map((name) => named(state, name).id),
})

const elephants = (state: GameState, seat: string) =>
  state.zoneOrder[seat].battlefield
    .map((id) => state.objects[id])
    .filter((object) => object.name === 'Elephant')

describe('up-to-N triggered targets', () => {
  test('opens one private choice for up to three noncreature permanents of any controller', () => {
    const { state } = setup({
      p1: [artifact('Own Rock')],
      p2: [artifact('Enemy Rock'), cardTemplate('Enemy Bear', { types: ['Creature'] })],
      p3: [cardTemplate('Enemy Forest', { types: ['Land'] }), artifact('Enemy Ring'), artifact('Fourth Rock')],
    })
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({
      kind: 'choose',
      count: 3,
      min: 0,
      seat: 'p1',
      destinations: ['skip', 'target'],
    })
    expect(selection.candidates).toContain(named(state, 'Enemy Rock').id)
    expect(selection.candidates).not.toContain(named(state, 'Enemy Bear').id)
    expect(selection.candidates).not.toContain(named(state, 'Fixture Destroyer').id)
    expect(pendingSelectionFor(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(state, 'p1'), 'p1')?.id).toBe(selection.id)
  })

  test('choosing zero targets puts nothing on the stack', () => {
    const { server, state } = setup({ p2: [artifact('Enemy Rock')] })
    const declined = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 3,
      objectIds: [],
    }))
    expect(declined.stack).toHaveLength(0)
    expect(pendingSelectionFor(declined, 'p1')).toBeUndefined()
    expect(named(declined, 'Enemy Rock').zone).toBe('battlefield')
    expect(elephants(declined, 'p2')).toHaveLength(0)
  })

  test('one target is destroyed and its controller, not the destroyer, creates the Elephant', () => {
    const { server, state } = setup({ p2: [artifact('Enemy Rock')], p3: [artifact('Spared Rock')] })
    const stacked = ok(server.rules(state, choose(state, ['Enemy Rock'])))
    expect(stacked.stack[0].targets).toEqual([
      {
        kind: 'object',
        objectId: named(state, 'Enemy Rock').id,
        incarnation: 1,
        zone: 'battlefield',
      },
    ])
    const done = resolveStack(server.rules, stacked)
    expect(named(done, 'Enemy Rock').zone).toBe('graveyard')
    expect(named(done, 'Spared Rock').zone).toBe('battlefield')
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p2')[0]).toMatchObject({
      token: true,
      power: 3,
      toughness: 3,
      colors: 'G' as const,
      subtypes: ['Elephant'],
      controller: 'p2',
    })
    expect(elephants(done, 'p1')).toHaveLength(0)
    expect(elephants(done, 'p3')).toHaveLength(0)
  })

  test('three targets across controllers each give their controller one Elephant', () => {
    const { server, state } = setup({
      p1: [artifact('Own Rock')],
      p2: [artifact('Enemy Rock')],
      p3: [cardTemplate('Enemy Forest', { types: ['Land'] })],
    })
    const stacked = ok(server.rules(
      state,
      choose(state, ['Own Rock', 'Enemy Rock', 'Enemy Forest']),
    ))
    expect(stacked.stack[0].targets).toHaveLength(3)
    const done = resolveStack(server.rules, stacked)
    for (const name of ['Own Rock', 'Enemy Rock', 'Enemy Forest']) {
      expect(named(done, name).zone).toBe('graveyard')
    }
    expect([elephants(done, 'p1'), elephants(done, 'p2'), elephants(done, 'p3')].map((list) => list.length))
      .toEqual([1, 1, 1])
  })

  test('rejects a fourth target, a duplicate, and a permanent that was not offered', () => {
    const { server, state } = setup({
      p2: [artifact('Rock A'), artifact('Rock B'), artifact('Rock C'), artifact('Rock D')],
      p3: [cardTemplate('Enemy Bear', { types: ['Creature'] })],
    })
    const ids = ['Rock A', 'Rock B', 'Rock C', 'Rock D'].map((name) => named(state, name).id)
    const attempt = (objectIds: string[], count = 3) => server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count,
      objectIds,
    })
    expect(attempt(ids).ok).toBe(false)
    expect(attempt([ids[0], ids[0]]).ok).toBe(false)
    expect(attempt([named(state, 'Enemy Bear').id]).ok).toBe(false)
    expect(attempt(ids, 4).ok).toBe(false)
    expect(attempt(ids.slice(0, 3)).ok).toBe(true)
  })

  test('each target is re-checked on resolution and only the legal ones are destroyed', () => {
    const { server, state } = setup({
      p2: [artifact('Rock A'), artifact('Rock B')],
      p3: [artifact('Rock C')],
    })
    const stacked = ok(server.rules(state, choose(state, ['Rock A', 'Rock B', 'Rock C'])))
    // Rock A leaves the battlefield and Rock C stops being a noncreature permanent.
    const changed = structuredClone(ok(server.rules(stacked, {
      type: 'move',
      objectId: named(stacked, 'Rock A').id,
      to: 'exile',
    })))
    named(changed, 'Rock C').types = ['Artifact', 'Creature']
    const done = resolveStack(server.rules, changed)
    expect(named(done, 'Rock A').zone).toBe('exile')
    expect(named(done, 'Rock B').zone).toBe('graveyard')
    expect(named(done, 'Rock C').zone).toBe('battlefield')
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p3')).toHaveLength(0)
  })

  test('the ability fizzles when every target became illegal', () => {
    const { server, state } = setup({ p2: [artifact('Rock A'), artifact('Rock B')] })
    const stacked = ok(server.rules(state, choose(state, ['Rock A', 'Rock B'])))
    const gone = ['Rock A', 'Rock B'].reduce((current, name) => ok(server.rules(current, {
      type: 'move',
      objectId: named(current, name).id,
      to: 'exile',
    })), stacked)
    const done = resolveStack(server.rules, gone)
    expect(elephants(done, 'p2')).toHaveLength(0)
  })

  test('an indestructible target is not destroyed and yields no token', () => {
    const { server, state } = setup({
      p2: [artifact('Plain Rock'), artifact('Hardened Rock', { oracleText: 'Indestructible' })],
    })
    const stacked = ok(server.rules(state, choose(state, ['Plain Rock', 'Hardened Rock'])))
    const done = resolveStack(server.rules, stacked)
    expect(named(done, 'Plain Rock').zone).toBe('graveyard')
    expect(named(done, 'Hardened Rock').zone).toBe('battlefield')
    expect(elephants(done, 'p2')).toHaveLength(1)
  })

  test('a permanent a replacement sends elsewhere yields no token', () => {
    const { server, state } = setup({
      p2: [artifact('Plain Rock'), artifact('Commander Relic', { tags: ['commander'] })],
    })
    const stacked = ok(server.rules(state, choose(state, ['Plain Rock', 'Commander Relic'])))
    const done = resolveStack(server.rules, stacked)
    expect(named(done, 'Plain Rock').zone).toBe('graveyard')
    expect(named(done, 'Commander Relic').zone).toBe('command')
    expect(elephants(done, 'p2')).toHaveLength(1)
  })

  test('a destroyed token still counts as put into a graveyard', () => {
    const { server, state } = setup({ p2: [artifact('Enemy Rock')] })
    const tokenState = structuredClone(state)
    named(tokenState, 'Enemy Rock').token = true
    const done = resolveStack(
      server.rules,
      ok(server.rules(tokenState, choose(tokenState, ['Enemy Rock']))),
    )
    expect(elephants(done, 'p2')).toHaveLength(1)
  })

  test('a host restart restores the open choice and the replayed pick resolves the same way', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [destroyer] },
        battlefield: { p2: [artifact('Enemy Rock')], p3: [artifact('Enemy Ring')] },
        players: 3,
      },
      { random: () => 0.5, cardPlugins: [] },
    )
    const entering: GameEvent = {
      type: 'move',
      objectId: named(server.state, 'Fixture Destroyer').id,
      to: 'battlefield',
    }
    const opened = ok(server.rules(server.state, entering))
    const selection = pendingSelectionFor(opened, 'p1')!

    let journal = createJournal(server.state)
    journal = recordAccepted(journal, entering)
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')).toEqual(selection)

    const pick = choose(restored, ['Enemy Rock', 'Enemy Ring'])
    const done = resolveStack(server.rules, ok(server.rules(restored, pick)))
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p3')).toHaveLength(1)
  })
})

describe('mandatory single triggered target', () => {
  const sniper = cardTemplate('Fixture Sniper', {
    types: ['Creature'],
    effects: [entersTargeting(NONCREATURE_PERMANENT, destroyTargetPermanent('Artifact'))],
  })
  const open = (battlefield: Record<string, ReturnType<typeof cardTemplate>[]>) => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [sniper] }, battlefield, players: 3 },
      { random: () => 0.5, cardPlugins: [] },
    )
    const state = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Fixture Sniper').id,
      to: 'battlefield',
    }))
    return { server, state }
  }
  const pick = (state: GameState, names: string[]): GameEvent => ({
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: 1,
    objectIds: names.map((name) => named(state, name).id),
  })

  test('several candidates offer "not targeted" and need exactly one pick', () => {
    const { server, state } = open({ p2: [artifact('Rock A'), artifact('Rock B')] })
    expect(pendingSelectionFor(state, 'p1')).toMatchObject({
      count: 1,
      min: 1,
      destinations: ['skip', 'target'],
    })
    expect(server.rules(state, pick(state, [])).ok).toBe(false)
    expect(server.rules(state, pick(state, ['Rock A', 'Rock B'])).ok).toBe(false)
    const done = resolveStack(server.rules, ok(server.rules(state, pick(state, ['Rock B']))))
    expect(named(done, 'Rock B').zone).toBe('graveyard')
    expect(named(done, 'Rock A').zone).toBe('battlefield')
  })

  test('a lone candidate is offered as the target only', () => {
    const { state } = open({ p2: [artifact('Only Rock')] })
    expect(pendingSelectionFor(state, 'p1')).toMatchObject({
      min: 1,
      destinations: ['target'],
    })
  })
})

const seaCard = (name: string, types: string[], subtypes: string[] = []) =>
  cardTemplate(name, { types, subtypes })

const homerGame = () => createServerGame(
  commanderRules,
  {
    players: 4,
    hands: { p1: [seaCard('Forest', ['Land'])] },
    battlefield: {
      p1: [
        seaCard(HOMER_NAME, ['Creature'], ['Crab', 'Druid']),
        seaCard('Two-Type Creature', ['Creature'], ['Crab', 'Lobster']),
        seaCard('Bear', ['Creature'], ['Bear']),
      ],
    },
    libraries: {
      p1: Array.from({ length: 6 }, (_, index) => seaCard(`P1 ${index}`, ['Instant'])),
      p2: Array.from({ length: 6 }, (_, index) => seaCard(`P2 ${index}`, ['Instant'])),
      p3: Array.from({ length: 6 }, (_, index) => seaCard(`P3 ${index}`, ['Instant'])),
      p4: Array.from({ length: 6 }, (_, index) => seaCard(`P4 ${index}`, ['Instant'])),
    },
  },
  { random: () => 0 },
)

const pickHomerPlayers = (
  server: ReturnType<typeof homerGame>,
  state: GameState,
  players: string[],
) => {
  const pick = pendingPlayerSelectionFor(state, 'p1')!
  return ok(server.rules(state, {
    type: 'selectPlayers',
    seat: 'p1',
    selectionId: pick.id,
    players,
  }))
}

describe('landfall player-target mill', () => {
  test('triggers when a land token enters', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [seaCard(HOMER_NAME, ['Creature'], ['Crab'])] },
        hands: { p1: [instructionSpell({
          instructions: [createToken({
            count: 1,
            targets: ref('controller'),
            token: { name: 'Land Token', types: ['Land'] },
          })],
        })] },
      },
      { random: () => 0 },
    )
    const triggered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.hand[0],
    })))
    expect(pendingPlayerSelectionFor(triggered, 'p1')).toMatchObject({ min: 0 })
  })

  test('triggers when a land spell resolves', () => {
    const server = homerGame()
    const landId = server.state.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: landId,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[landId].zone).toBe('battlefield')
    expect(pendingPlayerSelectionFor(resolved, 'p1')).toMatchObject({ min: 0 })
  })

  test('landfall waits for any number of player targets, then mills each target', () => {
    const server = homerGame()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    expect(pendingPlayerSelectionFor(triggered, 'p1')).toMatchObject({ min: 0, seat: 'p1' })
    expect(server.rules(triggered, { type: 'passPriority', seat: 'p1' })).toMatchObject({
      ok: false,
    })
    const stacked = pickHomerPlayers(server, triggered, ['p2', 'p4'])
    expect(pendingPlayerSelectionFor(stacked, 'p1')).toBeUndefined()
    expect(stacked.stack[0]?.kind).toBe('ability')
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(resolved.zoneOrder.p2.graveyard).toHaveLength(4)
    expect(resolved.zoneOrder.p3.graveyard).toHaveLength(0)
    expect(resolved.zoneOrder.p4.graveyard).toHaveLength(4)
  })

  test('each sea-creature permanent counts once even with two relevant types', () => {
    const server = homerGame()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    const stacked = pickHomerPlayers(server, triggered, ['p1'])
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(4)
  })

  test('changeling counts a noncreature permanent as a Crab', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [seaCard('Forest', ['Land'])] },
        battlefield: {
          p1: [
            seaCard(HOMER_NAME, ['Creature'], ['Crab']),
            cardTemplate('Firdoch Core', {
              types: ['Artifact'],
              oracleText: 'Changeling (This card is every creature type.)',
            }),
          ],
        },
        libraries: {
          p1: Array.from({ length: 4 }, (_, index) => seaCard(`Card ${index}`, ['Instant'])),
        },
      },
      { random: () => 0 },
    )
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    const stacked = pickHomerPlayers(server, triggered, ['p1'])
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(4)
  })

  test('counts sea creatures when the triggered ability resolves', () => {
    const server = homerGame()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    let stacked = pickHomerPlayers(server, triggered, ['p2'])
    const otherCrab = stacked.zoneOrder.p1.battlefield.find(
      (id) => stacked.objects[id].name === 'Two-Type Creature',
    )!
    stacked = ok(server.rules(stacked, {
      type: 'move',
      objectId: otherCrab,
      to: 'graveyard',
    }))
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p2.graveyard).toHaveLength(2)
  })

  test('choosing no targets is legal', () => {
    const server = homerGame()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    const stacked = pickHomerPlayers(server, triggered, [])
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(pendingPlayerSelectionFor(resolved, 'p1')).toBeUndefined()
    expect(resolved.playerOrder.map((seat) => resolved.zoneOrder[seat].graveyard.length))
      .toEqual([0, 0, 0, 0])
  })

  test('rejects duplicate, unknown, and wrong-controller target submissions', () => {
    const server = homerGame()
    const landId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(
      server.state,
      { type: 'playLand', seat: 'p1', objectId: landId },
    ))
    const pick = pendingPlayerSelectionFor(triggered, 'p1')!
    for (const event of [
      { type: 'selectPlayers' as const, seat: 'p1', selectionId: pick.id, players: ['p2', 'p2'] },
      { type: 'selectPlayers' as const, seat: 'p1', selectionId: pick.id, players: ['nobody'] },
      { type: 'selectPlayers' as const, seat: 'p2', selectionId: pick.id, players: ['p1'] },
    ]) {
      expect(server.rules(triggered, event).ok).toBe(false)
    }
  })
})

const kambalFixture = (name: string) => {
  const entry = deckCards('3_kambal-taxing-the-token-economy').find((card) => card.name === name)!
  const catalog = catalogEntry(entry)
  if (name.startsWith('Boggart')) catalog.faces![0].stats = '3/1'
  return replayCardTemplate(name, catalog)
}
const kambalLand = () => cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })
const kambalGame = (name: string, landCount = 0) => createServerGame(commanderRules, {
  hands: { p1: [kambalFixture(name)] },
  battlefield: { p1: Array.from({ length: landCount }, kambalLand) },
  libraries: { p1: [cardTemplate('Own card', { zone: 'graveyard' })], p2: [cardTemplate('Enemy card', { zone: 'graveyard' }), cardTemplate('Enemy card two', { zone: 'graveyard' })] },
}, { random: () => 0.5 })

describe('relocated from kambalManaGraveyards.test.ts → multiTargetTriggers.test.ts', () => {
  test('Bojuka Bog triggers on a land drop and can exile its controller graveyard', () => {
      const server = kambalGame('Bojuka Bog')
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
      expect(state.objects[id].tapped).toBe(true)
      const selection = pendingPlayerSelectionFor(state, 'p1')!
      state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: selection.id, players: ['p1'] }))
      state = resolveStack(server.rules, state)
      expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
      expect(state.zoneOrder.p1.exile).toHaveLength(1)
      expect(state.zoneOrder.p2.graveyard).toHaveLength(2)
    })

  test.each(['Bojuka Bog', 'Boggart Trawler // Boggart Bog'])('%s targets a player then exiles at resolution on a move entry', (name) => {
      const server = kambalGame(name)
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
      const choice = pendingPlayerSelectionFor(state, 'p1')!
      expect(choice.candidates).toContain('p1')
      expect(state.zoneOrder.p2.graveyard.length).toBe(2)
      state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: choice.id, players: ['p2'] }))
      expect(state.zoneOrder.p2.graveyard.length).toBe(2)
      state = resolveStack(server.rules, state)
      expect(state.zoneOrder.p2.graveyard.length).toBe(0)
      expect(state.zoneOrder.p2.exile.length).toBe(2)
      expect(state.zoneOrder.p1.graveyard.length).toBe(1)
      expect(pendingDialogFor(state, 'p1')).toBeUndefined()
    })

  test('Trawler exile still resolves after its source stops being a creature', () => {
      const server = kambalGame('Boggart Trawler // Boggart Bog')
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
      const choice = pendingPlayerSelectionFor(state, 'p1')!
      state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: choice.id, players: ['p2'] }))
      // Model a continuous effect removing Creature after the trigger is on the stack.
      state = { ...state, objects: { ...state.objects, [id]: { ...state.objects[id], types: ['Enchantment'] } } }
      state = resolveStack(server.rules, state)
      expect(state.zoneOrder.p2.graveyard).toHaveLength(0)
      expect(state.zoneOrder.p2.exile).toHaveLength(2)
    })

})
