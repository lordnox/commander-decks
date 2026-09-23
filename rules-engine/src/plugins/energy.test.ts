import { describe, expect, test } from 'bun:test'
import { activated } from '../cardPlugins/activated'
import {
  ability,
  activate,
  draw,
  getEnergy,
  onResolve,
} from '../cardPlugins/effects'
import { onResolve as onResolvePlugin } from '../cardPlugins/onResolve'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { resolveStack } from '../testHelpers'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('player energy', () => {
  test('addEnergy and payEnergy adjust the public pool', () => {
    const server = createServerGame(commanderRules, { players: 2 })
    let state = ok(server.rules(server.state, { type: 'addEnergy', seat: 'p1', amount: 4 }))
    expect(state.players.p1.energy).toBe(4)
    state = ok(server.rules(state, { type: 'payEnergy', seat: 'p1', amount: 2 }))
    expect(state.players.p1.energy).toBe(2)
  })

  test('paying more energy than available is illegal', () => {
    const server = createServerGame(commanderRules, { players: 2 })
    const result = server.rules(server.state, { type: 'payEnergy', seat: 'p1', amount: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected illegal payEnergy')
    expect(result.error).toContain('cannot pay')
  })

  test('energy persists across turns', () => {
    const server = createServerGame(commanderRules, { players: 2 })
    let state = ok(server.rules(server.state, { type: 'addEnergy', seat: 'p1', amount: 3 }))
    while (state.step !== 'end') {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.players.p1.energy).toBe(3)
  })
})

describe('player energy via instructions', () => {
  test('resolve getEnergy then pay energy to activate', () => {
    const grant = cardTemplate('Charge Glyph', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [onResolve(getEnergy(3))],
    })
    const spender = cardTemplate('Flux Siphon', {
      types: ['Artifact'],
      effects: [
        ability({ id: 'sip' }, { energy: 2 }, draw(1)),
      ],
    })
    const top = cardTemplate('Spare Electron', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [grant] },
        battlefield: { p1: [spender] },
        libraries: { p1: [top] },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin, activated] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
      },
    }
    const grantId = Object.values(withMana.objects).find((o) => o.name === 'Charge Glyph')!.id
    const spenderId = Object.values(withMana.objects).find((o) => o.name === 'Flux Siphon')!.id
    let state = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: grantId,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.energy).toBe(3)

    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'sip',
      seat: 'p1',
      objectId: spenderId,
    }))
    expect(state.players.p1.energy).toBe(1)
    state = resolveStack(server.rules, state)
    expect(Object.values(state.objects).some((o) => o.name === 'Spare Electron' && o.zone === 'hand'))
      .toBe(true)
  })

  test('cannot activate when energy cost is unaffordable', () => {
    const spender = cardTemplate('Flux Siphon', {
      types: ['Artifact'],
      effects: [
        activate({
          id: 'sip',
          costs: { energy: 2 },
          do: [draw(1)],
        }),
      ],
    })
    const server = createServerGame(
      commanderRules,
      { players: 2, battlefield: { p1: [spender] } },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const spenderId = Object.values(server.state.objects).find((o) => o.name === 'Flux Siphon')!.id
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'sip',
      seat: 'p1',
      objectId: spenderId,
    })
    expect(result.ok).toBe(false)
  })
})
