import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { draw, drawAtNextUpkeep, gainLife, onResolve } from './effects'
import { choiceEffects } from './choiceEffects'
import { onResolve as onResolvePlugin } from './onResolve'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('runInstructions', () => {
  test('gainLife goes through the life event', () => {
    const spell = cardTemplate('Life Test', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [onResolve(gainLife(3))],
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [spell] } },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Life Test').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife + 3)
    expect(resolved.log).toContain('p1 gains 3 life')
  })

  test('drawAtNextUpkeep draws on the next upkeep', () => {
    const spell = cardTemplate('Delay Test', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [onResolve(draw(1), drawAtNextUpkeep(2))],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell] },
        libraries: {
          p1: [
            cardTemplate('Now'),
            cardTemplate('Later One'),
            cardTemplate('Later Two'),
            cardTemplate('Turn Draw'),
          ],
          p2: [
            cardTemplate('P2a'),
            cardTemplate('P2b'),
            cardTemplate('P2c'),
            cardTemplate('P2d'),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Delay Test').id,
    }))
    let state = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(state, 'Now').zone).toBe('hand')
    expect(state.players.p1.data.delayedDraw).toEqual([{ count: 2 }])

    while (!(state.active === 'p1' && state.step === 'upkeep' && state.turn > 1)) {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    expect(named(state, 'Later One').zone).toBe('hand')
    expect(named(state, 'Later Two').zone).toBe('hand')
  })

  test('optional delayed draws open a may-draw dialog', () => {
    const spell = cardTemplate('Optional Delay', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [onResolve(drawAtNextUpkeep(1, 'you', true))],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell] },
        libraries: {
          p1: [cardTemplate('Maybe'), cardTemplate('Pad One'), cardTemplate('Pad Two')],
          p2: [cardTemplate('Opp A'), cardTemplate('Opp B'), cardTemplate('Opp C')],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin, choiceEffects] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Optional Delay').id,
    }))
    let state = ok(server.rules(cast, { type: 'resolveTop' }))
    while (!(state.active === 'p1' && state.step === 'upkeep' && state.turn > 1)) {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    expect(pendingDialog(state)).toMatchObject({ kind: 'may-draw', seat: 'p1', count: 1 })
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(named(state, 'Maybe').zone).toBe('hand')
  })
})
