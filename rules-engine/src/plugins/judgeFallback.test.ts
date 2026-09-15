import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createServerGame } from '../runtime'

describe('judge fallback', () => {
  test('runs primitive effects through the normal reducer and traces the fallback', () => {
    const game = createServerGame(commanderRules, { first: 'p1' })
    const result = game.rules(game.state, {
      type: 'judgeFallback',
      seat: 'p1',
      source: 'Unsupported triggered ability',
      reason: 'the card trigger has no registered plugin',
      effects: [{ type: 'loseLife', seat: 'p2', amount: 2 }],
    })

    expect(result.ok).toBe(true)
    expect(result.state.players.p2.life).toBe(38)
    expect(result.state.log.at(-2)).toContain('judge fallback')
    expect(result.trace.map(({ depth, event }) => [depth, event.type])).toEqual([
      [0, 'judgeFallback'],
      [1, 'loseLife'],
    ])
  })

  test('rejects administrative, nested, and unexplained fallbacks', () => {
    const game = createServerGame(commanderRules, { first: 'p1' })
    const base = {
      type: 'judgeFallback' as const,
      seat: 'p1',
      source: 'Unsupported effect',
      reason: 'missing card plugin',
    }

    expect(game.rules(game.state, { ...base, reason: '', effects: [
      { type: 'loseLife', seat: 'p2', amount: 1 },
    ] }).ok).toBe(false)
    expect(game.rules(game.state, { ...base, effects: [
      { type: 'authoritativeSync', snapshot: game.state },
    ] }).ok).toBe(false)
    expect(game.rules(game.state, { ...base, effects: [{
      ...base,
      effects: [{ type: 'loseLife', seat: 'p2', amount: 1 }],
    }] }).ok).toBe(false)
  })

  test('rolls back the whole fallback when a primitive effect is illegal', () => {
    const game = createServerGame(commanderRules, { first: 'p1' })
    const result = game.rules(game.state, {
      type: 'judgeFallback',
      seat: 'p1',
      source: 'Unsupported effect',
      reason: 'missing card plugin',
      effects: [
        { type: 'loseLife', seat: 'p2', amount: 2 },
        { type: 'passPriority', seat: 'p2' },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.state).toEqual(game.state)
  })
})
