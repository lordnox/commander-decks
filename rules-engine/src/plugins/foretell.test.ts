import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { alternateCosts } from '../cardPlugins/alternateCosts'
import { foretell as foretellEffect } from '../cardPlugins/effectBuilders'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { spells } from './spells'
import { foretell, FORETELL_CAST_ID } from './foretell'

const distantOmen = () => cardTemplate('Distant Omen', {
  types: ['Sorcery'],
  manaCost: '{3}{U}',
  effects: [foretellEffect('{1}{U}')],
})

const game = () => createServerGame(
  commanderRules,
  {
    hands: { p1: [distantOmen()], p2: [] },
  },
  { random: () => 0.5, cardPlugins: [foretell, alternateCosts, spells] },
)

const named = (state: { objects: Record<string, { name: string }> }, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('foretell', () => {
  test('stamps a clone-safe foretell builder on effects', () => {
    const effect = foretellEffect('{1}{U}')
    expect(structuredClone(effect)).toEqual({ op: 'foretell', manaCost: '{1}{U}' })
  })

  test('foretell special action exiles face down and pays two generic', () => {
    const server = game()
    let state = structuredClone(server.state)
    const card = named(state, 'Distant Omen')
    state.players.p1.mana.C = 2
    state = ok(server.rules(state, { type: 'foretell', seat: 'p1', objectId: card.id }))

    expect(state.players.p1.mana.C).toBe(0)
    expect(state.objects[card.id].zone).toBe('exile')
    expect(state.objects[card.id].foretold).toBe(true)
    expect(state.objects[card.id].foretoldTurn).toBe(1)
    expect(state.objects[card.id].knownTo).toEqual(['p1'])
    expect(state.zoneOrder.p1.hand).not.toContain(card.id)
    expect(state.zoneOrder.p1.exile).toContain(card.id)
  })

  test('opponents do not see a face-down foretold card in exile', () => {
    const server = game()
    let state = structuredClone(server.state)
    const card = named(state, 'Distant Omen')
    state.players.p1.mana.C = 2
    state = ok(server.rules(state, { type: 'foretell', seat: 'p1', objectId: card.id }))

    const owner = server.project(state, 'p1')
    expect(owner.objects[card.id]?.name).toBe('Distant Omen')

    const opponent = server.project(state, 'p2')
    expect(opponent.objects[card.id]).toBeUndefined()
    expect(opponent.zoneOrder.p1.exile).not.toContain(card.id)
  })

  test('same-turn foretell cast is illegal', () => {
    const server = game()
    let state = structuredClone(server.state)
    const card = named(state, 'Distant Omen')
    state.players.p1.mana.C = 2
    state = ok(server.rules(state, { type: 'foretell', seat: 'p1', objectId: card.id }))
    state.players.p1.mana.U = 1
    state.players.p1.mana.C = 1

    const result = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: card.id,
      castOption: FORETELL_CAST_ID,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('foretell cost')
  })

  test('a later turn offers and resolves a foretell cast from exile', () => {
    const server = game()
    let state = structuredClone(server.state)
    const card = named(state, 'Distant Omen')
    state.players.p1.mana.C = 2
    state = ok(server.rules(state, { type: 'foretell', seat: 'p1', objectId: card.id }))
    state.turn = 2
    state.players.p1.mana.U = 1
    state.players.p1.mana.C = 1

    const actions = legalActsFor(state, 'p1').filter((action) =>
      action.kind === 'castSpell'
      && action.objectId === card.id
      && action.castOption === FORETELL_CAST_ID)
    expect(actions).toHaveLength(1)

    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: card.id,
      castOption: FORETELL_CAST_ID,
    }))
    expect(state.stack[0].castOption).toBe(FORETELL_CAST_ID)
    expect(state.objects[card.id].foretold).toBeUndefined()
    expect(state.objects[card.id].knownTo).toEqual(state.playerOrder)
  })

  test('legal acts expose foretell during a main-phase special-action window', () => {
    const server = game()
    const state = structuredClone(server.state)
    state.players.p1.mana.C = 2
    const card = named(state, 'Distant Omen')

    const actions = legalActsFor(state, 'p1').filter((action) =>
      action.kind === 'foretell' && action.objectId === card.id)
    expect(actions).toHaveLength(1)
  })
})
