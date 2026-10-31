import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import {targetedResolve} from './targetedResolve'

const card = (
  name: string,
  types: string[],
  zone: CardTemplate['zone'],
  manaCost = '',
) => cardTemplate(name, { types, zone, manaCost })

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
      { random: () => 0.5 },
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

})

describe('relocated from sinFallGaps.test.ts → graveyardLands.test.ts', () => {
  const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types, ...extra })

  const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Life from the Loam returns up to three lands to hand', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [
              card('Life from the Loam', ['Sorcery'], { manaCost: '{1}{G}' }),
              card('First Land', ['Land']),
              card('Second Land', ['Land']),
              card('Third Land', ['Land']),
            ],
          },
        },
        { random: () => 0.5, cardPlugins: [targetedResolve] },
      )
      let ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
      for (const name of ['First Land', 'Second Land', 'Third Land']) {
        ready = ok(server.rules(ready, {
          type: 'move',
          objectId: named(ready, name).id,
          to: 'graveyard',
        }))
      }
      const spell = named(ready, 'Life from the Loam').id
      const first = named(ready, 'First Land').id
      const second = named(ready, 'Second Land').id
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell,
        targets: [
          { kind: 'object', objectId: first },
          { kind: 'object', objectId: second },
        ],
      }))
      const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(resolved.objects[first].zone).toBe('hand')
      expect(resolved.objects[second].zone).toBe('hand')
      expect(named(resolved, 'Third Land').zone).toBe('graveyard')
    })

  test('Icetill Explorer can play a land from the graveyard', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: { p1: [card('Icetill Explorer', ['Creature'], { power: 2, toughness: 3 })] },
          libraries: {
            p1: [card('Yard Land', ['Land'], { zone: 'graveyard' })],
          },
        },
      )
      const land = named(server.state, 'Yard Land').id
      const played = ok(server.rules(server.state, {
        type: 'playLand',
        seat: 'p1',
        objectId: land,
      }))
      expect(played.objects[land].zone).toBe('battlefield')
    })

})
