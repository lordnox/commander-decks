import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createServerGame } from '../runtime'
import { cardTemplate } from '../newGame'
import { jointExploration } from './jointExploration'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost, power: null, toughness: null })

test('Joint Exploration draws after its scry choice has completed', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [card('Joint Exploration', ['Instant'], '{1}{U}')] },
    libraries: { p1: [card('Drawn Land', ['Land'])] },
  }, { random: () => 0.5, cardPlugins: [jointExploration] })
  const state = server.state
  const spell = state.zoneOrder.p1.hand[0]
  state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 }
  const cast = server.rules(
    state,
    { type: 'castSpell', seat: 'p1', objectId: spell, kicked: true },
  )
  if (!cast.ok) throw new Error(cast.error)
  expect(cast.state.stack[0].kicked).toBe(true)

  const resolved = server.rules(cast.state, { type: 'resolveTop' })
  if (!resolved.ok) throw new Error(resolved.error)
  expect(resolved.state.zoneCounts.p1.hand).toBe(1)
  expect(resolved.state.log).toContain('p1 resolves Joint Exploration')
})
