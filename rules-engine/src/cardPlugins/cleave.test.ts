import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { alternateCosts } from './alternateCosts'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = () => createServerGame(
  commanderRules,
  {
    hands: {
      p1: [cardTemplate('Wash Away', { types: ['Instant'], manaCost: '{U}' })],
      p2: [cardTemplate('Threat', { types: ['Instant'], manaCost: '{0}' })],
    },
    battlefield: {
      p2: [cardTemplate('Permanent', { types: ['Artifact'] })],
    },
  },
  { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
)

const castThreat = (from: 'hand' | 'exile' = 'hand') => {
  const server = game()
  let state = structuredClone(server.state)
  const threat = named(state, 'Threat')
  if (from === 'exile') {
    state = ok(server.rules(state, {
      type: 'move',
      objectId: threat.id,
      to: 'exile',
    }))
    state.castableZones.push('exile')
  }
  state.priority = 'p2'
  state = ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p2',
    objectId: threat.id,
  }))
  state.priority = 'p1'
  return { server, state, threat }
}

describe('cleave', () => {
  test('uncleaved Wash Away cannot target a spell cast from hand', () => {
    const { server, state, threat } = castThreat()
    state.players.p1.mana.U = 1
    const wash = named(state, 'Wash Away')
    const result = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: wash.id,
      targets: [{ kind: 'object', objectId: threat.id }],
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('illegal target')
  })

  test('legal acts offer printed and cleave modes for an eligible spell', () => {
    const { state, threat } = castThreat('exile')
    state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 1 }
    const wash = named(state, 'Wash Away')
    const actions = legalActsFor(state, 'p1').filter((action) =>
      action.kind === 'castSpell'
      && action.objectId === wash.id
      && action.targetObjectId === threat.id)

    expect(actions).toHaveLength(2)
    expect(actions).toContainEqual(expect.objectContaining({
      targetObjectId: threat.id,
    }))
    expect(actions).toContainEqual(expect.objectContaining({
      castOption: 'cleave',
      castLabel: 'Cleave {1}{U}{U}',
      targetObjectId: threat.id,
    }))
  })

  test('cleaved Wash Away counters a spell cast from hand and pays its cleave cost', () => {
    const { server, state, threat } = castThreat()
    state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 1 }
    const wash = named(state, 'Wash Away')
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: wash.id,
      castOption: 'cleave',
      targets: [{ kind: 'object', objectId: threat.id }],
    }))

    expect(cast.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    expect(cast.stack[0].castOption).toBe('cleave')

    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[threat.id].zone).toBe('graveyard')
    expect(resolved.objects[wash.id].zone).toBe('graveyard')
    expect(resolved.stack).toHaveLength(0)
  })

  test('cleave does not make nonspell targets legal', () => {
    const { server, state } = castThreat()
    state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 1 }
    const result = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Wash Away').id,
      castOption: 'cleave',
      targets: [{ kind: 'object', objectId: named(state, 'Permanent').id }],
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('illegal target')
  })
})
