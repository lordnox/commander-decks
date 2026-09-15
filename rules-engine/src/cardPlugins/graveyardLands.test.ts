import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import type { CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { AFTERMATH_RECLAIM, graveyardLands } from './graveyardLands'

const card = (
  name: string,
  types: string[],
  zone: CardTemplate['zone'],
  manaCost = '',
): CardTemplate => ({
  name,
  types,
  zone,
  manaCost,
  subtypes: [],
  supertypes: [],
  oracleText: '',
  power: types.includes('Creature') ? 1 : null,
  toughness: types.includes('Creature') ? 1 : null,
  grantedRules: [],
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  attachedTo: null,
  attacking: null,
  blocking: null,
  token: false,
  tags: [],
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const names = (state: GameState, zone: 'battlefield' | 'graveyard') =>
  state.zoneOrder.p1[zone].map((id) => state.objects[id].name)

describe('graveyard lands', () => {
  test('Splendid Reclamation returns every land tapped and finishes resolving', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Splendid Reclamation', ['Sorcery'], 'hand', '{3}{G}')],
        },
        libraries: {
          p1: [
            card('Forest', ['Land'], 'graveyard'),
            card('Island', ['Land'], 'graveyard'),
            card('Not a land', ['Creature'], 'graveyard'),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [graveyardLands] },
    )
    const spell = server.state.zoneOrder.p1.hand[0]
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 }
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(names(resolved, 'battlefield')).toEqual(['Forest', 'Island'])
    expect(names(resolved, 'graveyard')).toEqual([
      'Not a land',
      'Splendid Reclamation',
    ])
    expect(resolved.zoneOrder.p1.battlefield.every(
      (id) => resolved.objects[id].tapped,
    )).toBe(true)
  })

  test('Aftermath Analyst pays, sacrifices itself, and returns every land tapped', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Aftermath Analyst', ['Creature'], 'battlefield')],
        },
        libraries: {
          p1: [
            card('Forest', ['Land'], 'graveyard'),
            card('Spell', ['Instant'], 'graveyard'),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [graveyardLands] },
    )
    const sourceId = server.state.zoneOrder.p1.battlefield[0]
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 }
    const resolved = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: AFTERMATH_RECLAIM,
      seat: 'p1',
      objectId: sourceId,
    }))

    expect(names(resolved, 'battlefield')).toEqual(['Forest'])
    expect(names(resolved, 'graveyard')).toEqual(['Spell', 'Aftermath Analyst'])
    expect(resolved.objects[sourceId].zone).toBe('graveyard')
    expect(resolved.players.p1.mana.G).toBe(0)
    expect(resolved.objects[resolved.zoneOrder.p1.battlefield[0]].tapped).toBe(true)
  })

  test('Aftermath Analyst cannot activate without enough mana', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Aftermath Analyst', ['Creature'], 'battlefield')],
        },
      },
      { random: () => 0.5, cardPlugins: [graveyardLands] },
    )
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: AFTERMATH_RECLAIM,
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not enough mana')
  })
})
