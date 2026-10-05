import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { draw as drawPlugin } from '../rules/draw'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { delve, draw, onResolve } from './effects'
import { onResolve as onResolvePlugin } from './onResolve'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const GRAVEYARD = ['Gy One', 'Gy Two', 'Gy Three', 'Gy Four']

const game = () => {
  const server = createServerGame(
    commanderRules,
    {
      hands: {
        p1: [
          cardTemplate('Dig Deep', {
            types: ['Instant'],
            manaCost: '{4}{U}',
            effects: [delve(), onResolve(draw(1))],
          }),
          cardTemplate('Plain Spell', {
            types: ['Instant'],
            manaCost: '{4}{U}',
            effects: [onResolve(draw(1))],
          }),
          cardTemplate('Hand Fodder', { types: ['Sorcery'] }),
          ...GRAVEYARD.map((name) => cardTemplate(name, { types: ['Sorcery'] })),
        ],
        p2: [cardTemplate('Opposing Gy', { types: ['Sorcery'] })],
      },
      battlefield: { p1: [cardTemplate('Battlefield Fodder', { types: ['Artifact'] })] },
      libraries: { p1: [cardTemplate('Drawn Card', { types: ['Sorcery'] })] },
    },
    { random: () => 0.5, cardPlugins: [onResolvePlugin, drawPlugin] },
  )
  let state = server.state
  for (const name of [...GRAVEYARD, 'Opposing Gy']) {
    state = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, name).id,
      to: 'graveyard',
    }))
  }
  state = structuredClone(state)
  state.players.p1.mana.U = 1
  return { server, state }
}

const ids = (state: GameState, names: string[]) =>
  names.map((name) => named(state, name).id)

describe('delve', () => {
  test('exiled graveyard cards pay generic mana only and leave on cast', () => {
    const { server, state } = game()
    const delved = ids(state, GRAVEYARD)
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Dig Deep').id,
      delve: delved,
    }))

    expect(cast.players.p1.mana.U).toBe(0)
    expect(delved.every((objectId) => cast.objects[objectId].zone === 'exile')).toBe(true)
    expect(cast.stack[0]).toMatchObject({ kind: 'spell', name: 'Dig Deep' })
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[named(state, 'Dig Deep').id].zone).toBe('graveyard')
    expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name))
      .toContain('Drawn Card')
  })

  test('delving fewer cards leaves the rest of the generic cost to mana', () => {
    const { server, state } = game()
    state.players.p1.mana.C = 2
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Dig Deep').id,
      delve: ids(state, ['Gy One', 'Gy Two']),
    }))
    expect(cast.players.p1.mana).toMatchObject({ U: 0, C: 0 })
    expect(cast.zoneOrder.p1.graveyard.map((id) => cast.objects[id].name))
      .toEqual(['Gy Three', 'Gy Four'])

    state.players.p1.mana.C = 1
    const short = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Dig Deep').id,
      delve: ids(state, ['Gy One', 'Gy Two']),
    })
    expect(short).toMatchObject({ ok: false, error: 'not enough mana' })
  })

  test('delve cannot pay the colored part of the cost', () => {
    const { server, state } = game()
    state.players.p1.mana.U = 0
    const result = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Dig Deep').id,
      delve: ids(state, GRAVEYARD),
    })
    expect(result).toMatchObject({ ok: false, error: 'not enough mana' })
  })

  test('rejects illegal delve picks', () => {
    const { server, state } = game()
    const spell = named(state, 'Dig Deep').id
    const cast = (delved: string[], objectId = spell) => server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId,
      delve: delved,
    })

    expect(cast(ids(state, ['Gy One', 'Gy One'])))
      .toMatchObject({ ok: false, error: 'duplicate delve card' })
    expect(cast(ids(state, ['Opposing Gy']))).toMatchObject({ ok: false, error: 'illegal delve card' })
    expect(cast(ids(state, ['Hand Fodder']))).toMatchObject({ ok: false, error: 'illegal delve card' })
    expect(cast(ids(state, ['Battlefield Fodder'])))
      .toMatchObject({ ok: false, error: 'illegal delve card' })
    expect(cast(['missing'])).toMatchObject({ ok: false, error: 'illegal delve card' })
    expect(cast(ids(state, ['Gy One']), named(state, 'Plain Spell').id))
      .toMatchObject({ ok: false, error: 'Plain Spell does not have delve' })
  })

  test('cannot delve more cards than the generic cost', () => {
    const { server, state } = game()
    const pile = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Hand Fodder').id,
      to: 'graveyard',
    }))
    const result = server.rules(pile, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(pile, 'Dig Deep').id,
      delve: [...ids(pile, GRAVEYARD), named(pile, 'Hand Fodder').id],
    })
    expect(result).toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
  })

  test('a free cast has no generic cost to delve', () => {
    const { server, state } = game()
    const result = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Dig Deep').id,
      withoutPayingMana: true,
      delve: ids(state, ['Gy One']),
    })
    expect(result).toMatchObject({ ok: false, error: 'delve exceeds the generic mana cost' })
  })

  test('legal acts offer a graveyard picker sized to what mana cannot cover', () => {
    const { server, state } = game()
    const castOf = (current: GameState) => legalActsFor(current, 'p1').find((action) =>
      action.kind === 'castSpell' && action.objectId === named(current, 'Dig Deep').id)

    expect(castOf(state)).toMatchObject({
      targetGroups: [{ delve: true, purpose: 'cost', min: 4, max: 4 }],
    })
    const rich = structuredClone(state)
    rich.players.p1.mana.C = 3
    const action = castOf(rich)!
    expect(action).toMatchObject({ targetGroups: [{ delve: true, min: 1, max: 4 }] })

    const picked = ids(rich, ['Gy Two'])
    const events = eventsForAvailableAction(rich, 'p1', { ...action, delve: picked })!
    expect(events.at(-1)).toMatchObject({ type: 'castSpell', delve: picked })
    const cast = events.reduce((current, event) => ok(server.rules(current, event)), rich)
    expect(cast.objects[picked[0]].zone).toBe('exile')
    expect(cast.stack[0]).toMatchObject({ name: 'Dig Deep' })
    expect(eventsForAvailableAction(rich, 'p1', { ...action, delve: [] })).toBeNull()
  })

  test('no cast is offered when even a full delve cannot pay', () => {
    const { state } = game()
    state.players.p1.mana.U = 0
    expect(legalActsFor(state, 'p1').some((action) =>
      action.kind === 'castSpell' && action.objectId === named(state, 'Dig Deep').id)).toBe(false)
  })

  test('a spell without delve gets no picker', () => {
    const { state } = game()
    state.players.p1.mana.C = 4
    const plain = legalActsFor(state, 'p1').find((action) =>
      action.kind === 'castSpell' && action.objectId === named(state, 'Plain Spell').id)
    expect(plain).toBeDefined()
    expect(plain && 'targetGroups' in plain).toBe(false)
  })
})
