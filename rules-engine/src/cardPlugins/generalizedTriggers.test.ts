import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import { casts, dies, discards, draws, exiled, gainLife, leaves, trigger, type CardEffect } from './effects'

const knight = (name = 'Knight', token = false) => cardTemplate(name, {
  types: ['Creature'], subtypes: ['Knight'], colors: ['W'], power: 2, toughness: 2, token,
})
const watcher = (effects: CardEffect[]) => cardTemplate('Watcher', { types: ['Enchantment'], effects })
const named = (state: GameState, name: string) => Object.values(state.objects).find((object) => object.name === name)!
const game = (effects: CardEffect[], zones: Parameters<typeof createServerGame>[1] = {}, plugins: Plugin[] = []) =>
  createServerGame(commanderRules, {
    players: 3, battlefield: { p1: [watcher(effects), knight()] }, ...zones,
  }, { random: () => 0.5, cardPlugins: plugins })

describe('shared trigger matching', () => {
  test('death watches another white Knight token using pre-death controller and characteristics', () => {
    const effect = dies({ filter: { other: true, token: true, subtypes: ['Knight'], colors: ['W'], controller: 'you' } }, gainLife(1))
    const server = game([effect], { battlefield: { p1: [watcher([effect])], p2: [knight('Knight', true)] } })
    const state = structuredClone(server.state)
    named(state, 'Knight').controller = 'p1'
    const died = ok(server.rules(state, { type: 'sacrifice', objectId: named(state, 'Knight').id }))
    expect(died.stack).toHaveLength(1)
    expect(named(died, 'Watcher').controller).toBe('p1')
    expect(resolveStack(server.rules, died).players.p1.life).toBe(41)
  })

  test('death excludes artifacts, milling, bounce, exile, and opponent creatures', () => {
    const effect = dies({ filter: { controller: 'you' } }, gainLife(1))
    const server = game([effect], {
      battlefield: { p1: [watcher([effect]), knight(), cardTemplate('Rock', { types: ['Artifact'] })], p2: [knight('Enemy')] },
      libraries: { p1: [knight('Milled')] },
    })
    for (const [name, to] of [['Rock', 'graveyard'], ['Enemy', 'graveyard'], ['Milled', 'graveyard'], ['Knight', 'hand'], ['Knight', 'exile']] as const) {
      expect(ok(server.rules(server.state, { type: 'move', objectId: named(server.state, name).id, to })).stack).toHaveLength(0)
    }
  })

  test('filtered leaves sees bounce, death, and exile and survives source removal', () => {
    const server = game([leaves({ filter: { type: 'Creature' } }, gainLife(1))])
    for (const to of ['hand', 'graveyard', 'exile'] as const) {
      const moved = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to }))
      expect(moved.stack).toHaveLength(1)
      const removed = ok(server.rules(moved, { type: 'move', objectId: named(moved, 'Watcher').id, to: 'graveyard' }))
      expect(resolveStack(server.rules, removed).players.p1.life).toBe(41)
    }
  })

  test('unfiltered dies and leaves still watch only the source', () => {
    const server = game([], { battlefield: { p1: [cardTemplate('Self', {
      types: ['Creature'], effects: [dies(gainLife(1)), leaves(gainLife(2))],
    }), knight()] } })
    const other = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to: 'graveyard' }))
    expect(other.stack).toHaveLength(0)
    const self = ok(server.rules(other, { type: 'move', objectId: named(other, 'Self').id, to: 'graveyard' }))
    expect(resolveStack(server.rules, self).players.p1.life).toBe(43)
  })

  test('exile filters origin zones, ownership, and types', () => {
    const effect = exiled({ from: ['graveyard', 'library'], filter: { owner: 'you', type: 'Creature' } }, gainLife(1))
    const server = game([effect], { libraries: { p1: [knight('Library Knight')], p2: [knight('Enemy Library')] } })
    const buried = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to: 'graveyard' }))
    const fromGrave = ok(server.rules(buried, { type: 'move', objectId: named(buried, 'Knight').id, to: 'exile' }))
    expect(fromGrave.stack).toHaveLength(1)
    const fromLibrary = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Library Knight').id, to: 'exile' }))
    expect(fromLibrary.stack).toHaveLength(1)
    for (const name of ['Knight', 'Enemy Library']) {
      expect(ok(server.rules(server.state, { type: 'move', objectId: named(server.state, name).id, to: 'exile' })).stack).toHaveLength(0)
    }
  })

  test('self exile looks back, while a from-anywhere watcher must still exist after the move', () => {
    const server = game([], { battlefield: { p1: [cardTemplate('Self', {
      types: ['Creature'], effects: [exiled(gainLife(1)), exiled({ filter: { type: 'Creature' } }, gainLife(10))],
    })] } })
    const moved = ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Self').id, to: 'exile' }))
    expect(moved.stack).toHaveLength(1)
    expect(resolveStack(server.rules, moved).players.p1.life).toBe(41)
  })

  test('separate exile abilities keep independent once-per-turn keys', () => {
    const server = game([
      exiled({ from: 'battlefield', filter: { type: 'Creature' }, onceEachTurn: true }, gainLife(1)),
      exiled({ from: 'battlefield', filter: { type: 'Creature' }, onceEachTurn: true }, gainLife(2)),
    ], { hands: { p1: [knight('Second')] } })
    const first = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Knight').id, to: 'exile' })))
    expect(first.players.p1.life).toBe(43)
    const entered = ok(server.rules(first, { type: 'move', objectId: named(first, 'Second').id, to: 'battlefield' }))
    const second = ok(server.rules(entered, { type: 'move', objectId: named(entered, 'Second').id, to: 'exile' }))
    expect(second.stack).toHaveLength(0)
  })

  test('draws watches opponents and their second successful draw, once across draw-three', () => {
    const server = game([draws({ player: { not: { relation: 'you' } }, nthThisTurn: 2 }, gainLife(1))], {
      libraries: { p1: [knight()], p2: [knight('A'), knight('B'), knight('C')] },
    })
    const own = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(own.stack).toHaveLength(0)
    const drawn = ok(server.rules(own, { type: 'draw', seat: 'p2', count: 3 }))
    expect(drawn.stack).toHaveLength(1)
    expect(drawn.players.p1.life).toBe(40)
    expect(resolveStack(server.rules, drawn).players.p1.life).toBe(41)
  })

  test('draw filters the drawn object and does not trigger on an empty library', () => {
    const server = game([draws({ filter: { colors: ['W'], type: 'Creature' } }, gainLife(1))], {
      libraries: { p1: [knight(), cardTemplate('Blue', { types: ['Instant'], colors: ['U'] })] },
    })
    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    expect(drawn.stack).toHaveLength(1)
    const settled = resolveStack(server.rules, drawn)
    const empty = ok(server.rules(settled, { type: 'draw', seat: 'p1' }))
    expect(empty.stack).toHaveLength(0)
  })

  test('a prevented draw never triggers', () => {
    const prevent: Plugin = { id: 'preventDraw', replace: ({ event }) => event.type === 'draw' ? null : undefined }
    const server = game([draws({}, gainLife(1))], { libraries: { p1: [knight()] }, builtinRules: [...commanderRules.rules, 'preventDraw'] }, [prevent])
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.stack).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('discard filters the actual discarded card and player, not an ordinary graveyard move', () => {
    const server = game([discards({ player: 'opponent', filter: { type: 'Creature' } }, gainLife(1))], {
      hands: { p1: [knight('Own')], p2: [knight('Enemy'), cardTemplate('Trick', { types: ['Instant'] })] },
    })
    for (const name of ['Own', 'Trick']) {
      const seat = name === 'Own' ? 'p1' : 'p2'
      expect(ok(server.rules(server.state, { type: 'discard', seat, objectId: named(server.state, name).id })).stack).toHaveLength(0)
    }
    const discarded = ok(server.rules(server.state, { type: 'discard', seat: 'p2', objectId: named(server.state, 'Enemy').id }))
    expect(discarded.stack).toHaveLength(1)
    expect(resolveStack(server.rules, discarded).players.p1.life).toBe(41)
    expect(ok(server.rules(server.state, { type: 'move', objectId: named(server.state, 'Enemy').id, to: 'graveyard' })).stack).toHaveLength(0)
  })

  test('cast filters compose OR, AND, and NOT, queue above the spell, and retain the triggering player', () => {
    const effect = casts({ player: 'any', filter: {
      all: [{ colors: ['W'] }, { any: [{ subtypes: ['Knight'] }, { type: 'Instant' }] }],
      not: { type: 'Artifact' },
    } }, gainLife(1))
    const server = game([effect], { hands: { p1: [knight('Spell')], p2: [knight('Enemy Spell')] } })
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Spell').id }))
    expect(cast.stack.map((item) => item.kind)).toEqual(['ability', 'spell'])
    expect(cast.stack[0].payload?.triggeringPlayer).toBe('p1')
    expect(cast.players.p1.life).toBe(40)
    const removed = ok(server.rules(cast, { type: 'move', objectId: named(cast, 'Watcher').id, to: 'graveyard' }))
    expect(resolveStack(server.rules, removed).players.p1.life).toBe(41)
  })

  test('cast OR, AND, and NOT branches reject a white artifact Knight and a blue creature', () => {
    const server = game([casts({ filter: {
      all: [{ colors: ['W'] }, { any: [{ subtypes: ['Knight'] }, { type: 'Instant' }] }],
      not: { type: 'Artifact' },
    } }, gainLife(1))], { hands: { p1: [
      cardTemplate('Artifact Knight', { types: ['Artifact', 'Creature'], colors: ['W'], subtypes: ['Knight'] }),
      cardTemplate('Blue Knight', { types: ['Creature'], colors: ['U'], subtypes: ['Knight'] }),
    ] } })
    for (const name of ['Artifact Knight', 'Blue Knight']) {
      const state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, name).id }))
      expect(state.stack.map((item) => item.kind)).toEqual(['spell'])
    }
  })

  test('the generic builder shares the same matching and once-per-turn handling', () => {
    const effect = trigger('discard', { player: 'you', filter: { type: 'Creature' }, onceEachTurn: true }, gainLife(1))
    expect(structuredClone(effect)).toEqual(effect)
    const server = game([effect], { hands: { p1: [knight('One'), knight('Two')] } })
    let state = server.state
    for (const name of ['One', 'Two']) {
      state = resolveStack(server.rules, ok(server.rules(state, { type: 'discard', seat: 'p1', objectId: named(state, name).id })))
    }
    expect(state.players.p1.life).toBe(41)
  })
})
