import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { onResolve } from './onResolve'

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
      { random: () => 0.5, cardPlugins: [onResolve] },
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
