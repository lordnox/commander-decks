import { describe, expect, test } from 'bun:test'
import {
  commanderRules,
  createEngine,
  createGame,
  modernRules,
  newGame,
  standardRules,
} from './index'
import type { GameFormat } from './formats'
import type { Plugin } from './types'
import { bears } from './newGame'

describe('game formats', () => {
  test('Commander supports an arbitrary three-player table', () => {
    const state = newGame(commanderRules, { players: 3 })

    expect(state.format).toBe('commander')
    expect(state.playerOrder).toEqual(['p1', 'p2', 'p3'])
    expect(Object.keys(state.players)).toHaveLength(3)
    expect(state.players.p1.life).toBe(40)
    expect(state.rules.some((rule) => rule.pluginId === 'commander')).toBe(true)
    expect(state.players.p1.data.commanderDamage).toEqual({})
  })

  test('Standard and Modern are two-player, 20-life presets without Commander', () => {
    for (const format of [standardRules, modernRules]) {
      const state = newGame(format)

      expect(state.playerOrder).toEqual(['p1', 'p2'])
      expect(state.players.p1.life).toBe(20)
      expect(state.rules.some((rule) => rule.pluginId === 'commander')).toBe(false)
      expect(format.deck.cardPool).toBe(format.id)
      expect(format.deck.maximumCopies).toBe(4)
    }
  })

  test('Standard cannot cast a card placed in the command zone', () => {
    const game = createGame(standardRules, { command: { p1: [bears()] } })
    const card = Object.values(game.state.objects)[0]
    const result = game.rules(game.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: card.id,
    })

    expect(card.tags).not.toContain('commander')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('castable zone')
  })

  test('custom player IDs drive priority order', () => {
    const game = createGame(modernRules, {
      players: ['alice', 'bob', 'charlie'],
      first: 'bob',
    })
    let state = game.state

    expect(state.active).toBe('bob')
    state = game.rules(state, { type: 'passPriority', seat: 'bob' }).state
    expect(state.priority).toBe('charlie')
    state = game.rules(state, { type: 'passPriority', seat: 'charlie' }).state
    expect(state.priority).toBe('alice')
  })

  test('a custom game can supply its own plugin and player data', () => {
    const suddenDeath: Plugin = {
      id: 'suddenDeath',
      apply: ({ event, draft }) => {
        if (event.type === 'custom' && event.name === 'ringCloses') {
          for (const player of Object.values(draft.players)) player.life = 1
        }
      },
    }
    const format: GameFormat = {
      ...modernRules,
      id: 'three-player-sudden-death',
      name: 'Three-player sudden death',
      defaultPlayers: 3,
      startingLife: 30,
      plugins: [...modernRules.plugins, suddenDeath],
      rules: [...modernRules.rules, suddenDeath.id],
      createPlayerData: (player) => ({ label: player.toUpperCase() }),
    }
    const engine = createEngine(format)
    let state = newGame(format)

    const result = engine.rules(state, { type: 'custom', name: 'ringCloses' })
    if (!result.ok) throw new Error(result.error)
    state = result.state

    expect(state.playerOrder).toHaveLength(3)
    expect(state.players.p1.life).toBe(1)
    expect(state.players.p2.data.label).toBe('P2')
  })

  test('invalid player configurations are rejected', () => {
    expect(() => newGame(standardRules, { players: 1 })).toThrow('at least 2')
    expect(() => newGame(standardRules, { players: ['sam', 'sam'] })).toThrow('unique')
    expect(() => newGame(standardRules, { players: ['sam', 'lee'], first: 'pat' })).toThrow(
      'not in the game',
    )
  })
})
