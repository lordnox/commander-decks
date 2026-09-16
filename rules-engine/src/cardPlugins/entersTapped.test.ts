import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { entersTapped } from './entersTapped'

const land = (name: string, subtypes: string[] = []) =>
  cardTemplate(name, { types: ['Land'], subtypes })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (hand: CardTemplate[], battlefield: CardTemplate[] = []) =>
  createServerGame(
    commanderRules,
    { hands: { p1: hand }, battlefield: { p1: battlefield } },
    { random: () => 0.5, cardPlugins: [entersTapped] },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('entersTapped', () => {
  test('a land drop that Oracle taps enters tapped', () => {
    const server = game([land('Zagoth Triome', ['Swamp', 'Forest', 'Island'])])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    expect(next.objects[objectId].tapped).toBe(true)
  })

  test.each([
    'Dakmor Salvage',
    'Myriad Landscape',
    'Thawing Glaciers',
  ])('%s enters tapped', (name) => {
    const server = game([land(name)])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId,
    }))
    expect(next.objects[objectId].tapped).toBe(true)
  })

  test('a land with no entry rule is untapped', () => {
    const server = game([land('Forest', ['Forest'])])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    expect(next.objects[objectId].tapped).toBe(false)
  })

  test('Hall of Storm Giants enters untapped as an early land and tapped later', () => {
    const early = game([land('Hall of Storm Giants')], [land('Island', ['Island'])])
    const earlyId = early.state.zoneOrder.p1.hand[0]
    expect(ok(early.rules(early.state, { type: 'playLand', seat: 'p1', objectId: earlyId }))
      .objects[earlyId].tapped).toBe(false)

    const late = game(
      [land('Hall of Storm Giants')],
      [land('Island', ['Island']), land('Forest', ['Forest'])],
    )
    const lateId = late.state.zoneOrder.p1.hand[0]
    expect(ok(late.rules(late.state, { type: 'playLand', seat: 'p1', objectId: lateId }))
      .objects[lateId].tapped).toBe(true)
  })

  test('Mystic Sanctuary is untapped only behind three other Islands', () => {
    const islands = [1, 2, 3].map(() => land('Island', ['Island']))
    const server = game([land('Mystic Sanctuary', ['Island'])], islands)
    const objectId = server.state.zoneOrder.p1.hand[0]
    expect(ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
      .objects[objectId].tapped).toBe(false)

    const short = game([land('Mystic Sanctuary', ['Island'])], islands.slice(0, 2))
    const shortId = short.state.zoneOrder.p1.hand[0]
    expect(ok(short.rules(short.state, { type: 'playLand', seat: 'p1', objectId: shortId }))
      .objects[shortId].tapped).toBe(true)
  })

  test('a land put onto the battlefield without being played still enters tapped', () => {
    const server = game([land('Lotus Field')])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
    expect(named(next, 'Lotus Field').tapped).toBe(true)
  })

  test('another seat\'s lands are not counted for the conditional forms', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [land('Lair of the Hydra')] },
        battlefield: { p2: [land('Forest', ['Forest']), land('Forest', ['Forest'])] },
      },
      { random: () => 0.5, cardPlugins: [entersTapped] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    expect(next.objects[objectId].tapped).toBe(false)
  })
})
