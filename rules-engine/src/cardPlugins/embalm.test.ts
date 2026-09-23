import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { embalm } from './effectBuilders'
import { EMBALM_ABILITY_ID, graveyardCasting } from './graveyardCasting'
import { activated } from './activated'

const moveToGraveyard = (state: GameState, name: string) => {
  const object = Object.values(state.objects).find((entry) => entry.name === name)!
  const from = object.zone
  state.zoneOrder[object.owner][from] = state.zoneOrder[object.owner][from]
    .filter((objectId) => objectId !== object.id)
  state.zoneCounts[object.owner][from] -= 1
  state.zoneOrder[object.owner].graveyard.push(object.id)
  state.zoneCounts[object.owner].graveyard += 1
  object.zone = 'graveyard'
}

const cryptWarden = () => cardTemplate('Crypt Warden', {
  types: ['Creature'],
  subtypes: ['Human', 'Soldier'],
  manaCost: '{2}{W}',
  manaValue: 3,
  colors: ['W'],
  power: 3,
  toughness: 3,
  effects: [embalm('{4}{W}', { colors: ['W'], extraSubtypes: ['Zombie'] })],
})

describe('embalm', () => {
  test('clone-safe embalm builder stamps parameterized exceptions', () => {
    const stamped = embalm('{3}{U}', { colors: ['U'], extraSubtypes: ['Zombie', 'Horror'] })
    const cloned = structuredClone(stamped)
    expect(cloned).toEqual({
      op: 'embalm',
      manaCost: '{3}{U}',
      colors: ['U'],
      extraSubtypes: ['Zombie', 'Horror'],
    })
  })

  test('pays mana, exiles from the graveyard, and creates a white Zombie token copy', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [cryptWarden()] },
      },
      { random: () => 0.5, cardPlugins: [graveyardCasting, activated] },
    )
    const ready = structuredClone(server.state)
    moveToGraveyard(ready, 'Crypt Warden')
    ready.players.p1.mana.W = 5
    const source = Object.values(ready.objects).find((object) => object.name === 'Crypt Warden')!
    const embalmAct = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'activateAbility'
      && action.objectId === source.id
      && action.abilityId === EMBALM_ABILITY_ID)
    expect(embalmAct).toMatchObject({
      kind: 'activateAbility',
      text: 'Embalm {4}{W}',
    })

    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: source.id,
      abilityId: EMBALM_ABILITY_ID,
    }))
    expect(activatedState.objects[source.id].zone).toBe('exile')
    expect(activatedState.players.p1.mana.W).toBe(0)
    expect(activatedState.stack[0]).toMatchObject({
      kind: 'ability',
      abilityId: EMBALM_ABILITY_ID,
    })
    expect(activatedState.zoneOrder.p1.battlefield).toHaveLength(0)

    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.battlefield).toHaveLength(1)
    const token = resolved.objects[resolved.zoneOrder.p1.battlefield[0]]
    expect(token).toMatchObject({
      name: 'Crypt Warden',
      token: true,
      colors: ['W'],
      manaCost: '',
      manaValue: 0,
      power: 3,
      toughness: 3,
      subtypes: ['Zombie', 'Human', 'Soldier'],
    })
  })

  test('embalm is only legal as a sorcery from your graveyard', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [cryptWarden()] },
        hands: { p2: [cardTemplate('Shock', { types: ['Instant'], manaCost: '{R}' })] },
      },
      { random: () => 0.5, cardPlugins: [graveyardCasting, activated] },
    )
    const onBattlefield = structuredClone(server.state)
    onBattlefield.players.p1.mana.W = 5
    const source = onBattlefield.zoneOrder.p1.battlefield[0]
    expect(legalActsFor(onBattlefield, 'p1').some((action) =>
      action.kind === 'activateAbility'
      && action.objectId === source
      && action.abilityId === EMBALM_ABILITY_ID)).toBe(false)

    const wrongTurn = structuredClone(server.state)
    moveToGraveyard(wrongTurn, 'Crypt Warden')
    wrongTurn.active = 'p2'
    wrongTurn.players.p1.mana.W = 5
    expect(server.rules(wrongTurn, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: Object.values(wrongTurn.objects).find((o) => o.name === 'Crypt Warden')!.id,
      abilityId: EMBALM_ABILITY_ID,
    }).ok).toBe(false)

    const stacked = structuredClone(server.state)
    moveToGraveyard(stacked, 'Crypt Warden')
    stacked.players.p1.mana = { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 }
    stacked.players.p2.mana.R = 1
    stacked.priority = 'p2'
    const shock = Object.values(stacked.objects).find((object) => object.name === 'Shock')!
    const castShock = ok(server.rules(stacked, {
      type: 'castSpell',
      seat: 'p2',
      objectId: shock.id,
      targets: [{ kind: 'player', player: 'p1' }],
    }))
    expect(castShock.stack).toHaveLength(1)
    expect(server.rules(castShock, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: Object.values(castShock.objects).find((o) => o.name === 'Crypt Warden')!.id,
      abilityId: EMBALM_ABILITY_ID,
    }).ok).toBe(false)
  })
})
