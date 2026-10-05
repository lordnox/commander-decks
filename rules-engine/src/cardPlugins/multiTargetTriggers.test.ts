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

const NONCREATURE_PERMANENT = { zone: 'battlefield', permanent: true, noncreature: true } as const

const elephant = {
  name: 'Elephant',
  types: ['Creature'],
  subtypes: ['Elephant'],
  colors: ['G'],
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
      { kind: 'object', objectId: named(state, 'Enemy Rock').id },
    ])
    const done = resolveStack(server.rules, stacked)
    expect(named(done, 'Enemy Rock').zone).toBe('graveyard')
    expect(named(done, 'Spared Rock').zone).toBe('battlefield')
    expect(elephants(done, 'p2')).toHaveLength(1)
    expect(elephants(done, 'p2')[0]).toMatchObject({
      token: true,
      power: 3,
      toughness: 3,
      colors: ['G'],
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
