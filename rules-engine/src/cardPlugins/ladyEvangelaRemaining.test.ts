import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import { activated } from './activated'
import { castCosts } from './castCosts'
import { choiceEffects } from './choiceEffects'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plugins: Plugin[] = [
  activated,
  castCosts,
  onResolve,
  targetedResolve,
  choiceEffects,
]

const ready = (state: GameState, seat = 'p1') => {
  const next = structuredClone(state)
  next.active = seat
  next.priority = seat
  next.step = 'precombatMain'
  next.players[seat].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  return next
}

describe('Lady Evangela remaining coverage', () => {
  test('Hatred pays X life and pumps only power', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Hatred', { types: ['Instant'], manaCost: '{3}{B}{B}' })] },
        battlefield: {
          p1: [cardTemplate('Wall of Blood', {
            types: ['Creature'],
            power: 0,
            toughness: 2,
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state)
    const wall = named(state, 'Wall of Blood')
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Hatred').id,
      x: 5,
      targets: [{ kind: 'object', objectId: wall.id }],
    }))
    expect(state.players.p1.life).toBe(35)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[wall.id].power).toBe(5)
    expect(state.objects[wall.id].toughness).toBe(2)
  })

  test('Infernal Contract draws four and loses half life rounded up', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Infernal Contract', { types: ['Sorcery'], manaCost: '{B}{B}{B}' })],
        },
        libraries: {
          p1: Array.from({ length: 4 }, (_, index) => cardTemplate(`Draw ${index}`)),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = ready(server.state)
    state.players.p1.life = 15
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Infernal Contract').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(4)
    expect(state.players.p1.life).toBe(7)
  })
})
