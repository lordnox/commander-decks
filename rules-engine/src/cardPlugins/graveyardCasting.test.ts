import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { alternateCosts } from './alternateCosts'
import { effectsOf } from './cardRules'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string, manaCost = '') => cardTemplate(name, {
  types: ['Creature'],
  manaCost,
  power: 1,
  toughness: 1,
})

const moveToGraveyard = (state: GameState, ...names: string[]) => {
  for (const name of names) {
    const object = named(state, name)
    const from = object.zone
    state.zoneOrder[object.owner][from] = state.zoneOrder[object.owner][from]
      .filter((objectId) => objectId !== object.id)
    state.zoneCounts[object.owner][from] -= 1
    state.zoneOrder[object.owner].graveyard.push(object.id)
    state.zoneCounts[object.owner].graveyard += 1
    object.zone = 'graveyard'
  }
}

describe('graveyard casting keywords', () => {
  test('Dread Return pays flashback, resolves from the graveyard, and still casts normally', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            cardTemplate('Dread Return', {
              types: ['Sorcery'],
              manaCost: '{2}{B}{B}',
            }),
            creature('Reanimation Target'),
          ],
        },
        battlefield: {
          p1: [creature('One'), creature('Two'), creature('Three')],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    const fromHand = structuredClone(server.state)
    moveToGraveyard(fromHand, 'Reanimation Target')
    fromHand.players.p1.mana.B = 2
    fromHand.players.p1.mana.C = 2
    const dread = named(fromHand, 'Dread Return')
    const target = named(fromHand, 'Reanimation Target')
    const normallyCast = ok(server.rules(fromHand, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const normallyResolved = ok(server.rules(normallyCast, { type: 'resolveTop' }))
    expect(normallyResolved.objects[dread.id].zone).toBe('graveyard')
    expect(normallyResolved.objects[target.id].zone).toBe('battlefield')

    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Dread Return', 'Reanimation Target')
    const sacrifices = ['One', 'Two', 'Three'].map((name) => named(ready, name).id)
    const flashback = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === dread.id
      && action.castOption === 'flashback')
    expect(flashback).toMatchObject({
      kind: 'castSpell',
      castLabel: 'Flashback—Sacrifice three creatures.',
      targetGroups: [{
        purpose: 'cost',
        min: 3,
        max: 3,
      }],
    })
    expect(legalActsFor(ready, 'p1').some((action) =>
      action.kind === 'castSpell'
      && action.objectId === dread.id
      && !action.castOption)).toBe(false)
    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      castOption: 'flashback',
      sacrifice: sacrifices.slice(0, 2),
      targets: [{ kind: 'object', objectId: target.id }],
    }).ok).toBe(false)

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      castOption: 'flashback',
      sacrifice: sacrifices,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    expect(sacrifices.every((id) => cast.objects[id].zone === 'graveyard')).toBe(true)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[dread.id].zone).toBe('exile')
    expect(resolved.objects[target.id].zone).toBe('battlefield')
  })

  test('a countered flashback spell is exiled', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            cardTemplate('Dread Return', { types: ['Sorcery'], manaCost: '{2}{B}{B}' }),
            creature('Target'),
          ],
          p2: [cardTemplate('Wash Away', { types: ['Instant'], manaCost: '{U}' })],
        },
        battlefield: {
          p1: [creature('One'), creature('Two'), creature('Three')],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts, targetedResolve] },
    )
    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Dread Return', 'Target')
    const dread = named(ready, 'Dread Return')
    const target = named(ready, 'Target')
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      castOption: 'flashback',
      sacrifice: ['One', 'Two', 'Three'].map((name) => named(ready, name).id),
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    cast.priority = 'p2'
    cast.players.p2.mana.U = 1
    const wash = named(cast, 'Wash Away')
    const response = ok(server.rules(cast, {
      type: 'castSpell',
      seat: 'p2',
      objectId: wash.id,
      targets: [{ kind: 'object', objectId: dread.id }],
    }))
    const countered = ok(server.rules(response, { type: 'resolveTop' }))
    expect(countered.objects[dread.id].zone).toBe('exile')
  })

  test('Six grants retrace only to eligible cards during its controller turn', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            cardTemplate('Forest', { types: ['Land'] }),
            creature('Grizzly Bears', '{1}{G}'),
            cardTemplate('Graveyard Sorcery', { types: ['Sorcery'], manaCost: '{1}{G}' }),
          ],
          p2: [cardTemplate('Island', { types: ['Land'] })],
        },
        battlefield: {
          p1: [creature('Six', '{2}{G}')],
        },
      },
      { random: () => 0.5, cardPlugins: [alternateCosts] },
    )
    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Grizzly Bears', 'Graveyard Sorcery')
    ready.players.p1.mana.G = 1
    ready.players.p1.mana.C = 1
    const bear = named(ready, 'Grizzly Bears')
    const forest = named(ready, 'Forest')
    const retrace = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === bear.id
      && action.castOption === 'retrace')
    expect(retrace).toMatchObject({
      kind: 'castSpell',
      castLabel: 'Retrace—Discard a land card.',
      targetGroups: [{
        label: 'Land card to discard',
        purpose: 'cost',
        targets: [{ objectId: forest.id, name: 'Forest' }],
      }],
    })
    expect(legalActsFor(ready, 'p1').some((action) =>
      action.kind === 'castSpell'
      && action.name === 'Graveyard Sorcery'
      && action.castOption === 'retrace')).toBe(false)

    const opponentView = server.project(ready, 'p2')
    expect(opponentView.objects[forest.id]).toBeUndefined()
    expect(JSON.stringify(legalActsFor(opponentView, 'p2'))).not.toContain('Forest')
    expect(JSON.stringify(retrace)).not.toContain('Island')

    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      castOption: 'retrace',
    }).ok).toBe(false)

    const wrongTurn = structuredClone(ready)
    wrongTurn.active = 'p2'
    expect(server.rules(wrongTurn, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      castOption: 'retrace',
      discard: [forest.id],
    }).ok).toBe(false)

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      castOption: 'retrace',
      discard: [forest.id],
    }))
    expect(cast.objects[forest.id].zone).toBe('graveyard')
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[bear.id].zone).toBe('battlefield')
    expect(effectsOf(named(resolved, 'Six')).some((effect) =>
      effect.op === 'trigger' && effect.on === 'attacks')).toBe(true)
  })
})
