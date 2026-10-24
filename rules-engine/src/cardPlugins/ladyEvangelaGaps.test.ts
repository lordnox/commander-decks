import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { alternateCosts } from './alternateCosts'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Lady Evangela replacement gaps', () => {
  test("Dovin's Veto remains a legal target but cannot be countered", () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate("Dovin's Veto", { types: ['Instant'], manaCost: '{W}{U}' })],
          p2: [cardTemplate('Threat', { types: ['Instant'], manaCost: '{1}' })],
          p3: [cardTemplate('Wash Away', { types: ['Instant'], manaCost: '{U}' })],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    ready.players.p2.mana.C = 1
    const threat = named(ready, 'Threat')
    const threatCast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: threat.id,
    }))
    threatCast.priority = 'p1'
    threatCast.players.p1.mana.W = 1
    threatCast.players.p1.mana.U = 1
    const veto = named(threatCast, "Dovin's Veto")
    const vetoCast = ok(server.rules(threatCast, {
      type: 'castSpell',
      seat: 'p1',
      objectId: veto.id,
      targets: [{ kind: 'stackItem', stackId: threatCast.stack.find(item => item.objectId === threat.id)!.id }],
    }))
    expect(vetoCast.stack[0].uncounterable).toBe(true)

    vetoCast.priority = 'p3'
    vetoCast.players.p3.mana.U = 2
    vetoCast.players.p3.mana.C = 1
    const wash = named(vetoCast, 'Wash Away')
    const washCast = ok(server.rules(vetoCast, {
      type: 'castSpell',
      seat: 'p3',
      objectId: wash.id,
      selectedAlternativeCost: 0,
      targets: [{ kind: 'stackItem', stackId: vetoCast.stack.find(item => item.objectId === veto.id)!.id }],
    }))
    const washResolved = ok(server.rules(washCast, { type: 'resolveTop' }))
    expect(washResolved.objects[veto.id].zone).toBe('stack')
    expect(washResolved.stack.some((item) => item.objectId === veto.id)).toBe(true)

    const vetoResolved = ok(server.rules(washResolved, { type: 'resolveTop' }))
    expect(vetoResolved.objects[threat.id].zone).toBe('graveyard')
  })

  test('Phial doubles draws from an empty hand and life gains at five or less', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [cardTemplate('Phial of Galadriel', { types: ['Artifact'] })] },
        libraries: { p1: [cardTemplate('A'), cardTemplate('B'), cardTemplate('C')] },
      },
      { random: () => 0.5 },
    )
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(3)

    state.players.p1.life = 5
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 2 }))
    expect(state.players.p1.life).toBe(9)
    state = ok(server.rules(state, { type: 'gainLife', seat: 'p1', amount: 2 }))
    expect(state.players.p1.life).toBe(11)
  })


})
