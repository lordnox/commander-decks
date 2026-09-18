import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { resolveStack } from '../testHelpers'
import type { GameState, ReduceResult } from '../types'
import { choiceEffects } from './choiceEffects'
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
    'Charcoal Diamond',
    'Dakmor Salvage',
    'Mistvault Bridge',
    'Myriad Landscape',
    "Raffine's Tower",
    'Sky Diamond',
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

  test.each([
    ['Glacial Fortress', ['Plains', 'Island']],
    ['Drowned Catacomb', ['Island', 'Swamp']],
  ] as const)('%s checks the listed basic land types', (name, subtypes) => {
    const bare = game([land(name)])
    const bareId = bare.state.zoneOrder.p1.hand[0]
    expect(ok(bare.rules(bare.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: bareId,
    })).objects[bareId].tapped).toBe(true)

    const enabled = game([land(name)], [land('Typed land', [subtypes[0]])])
    const enabledId = enabled.state.zoneOrder.p1.hand[0]
    expect(ok(enabled.rules(enabled.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: enabledId,
    })).objects[enabledId].tapped).toBe(false)
  })

  test.each([
    'Eclipsed Steppe',
    'Sunken Hollow',
  ])('%s needs two basic lands to enter untapped', (name) => {
    const oneBasic = game(
      [land(name)],
      [cardTemplate('Plains', { types: ['Land'], supertypes: ['Basic'] })],
    )
    const oneId = oneBasic.state.zoneOrder.p1.hand[0]
    expect(ok(oneBasic.rules(oneBasic.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: oneId,
    })).objects[oneId].tapped).toBe(true)

    const twoBasics = game(
      [land(name)],
      [
        cardTemplate('Plains', { types: ['Land'], supertypes: ['Basic'] }),
        cardTemplate('Island', { types: ['Land'], supertypes: ['Basic'] }),
      ],
    )
    const twoId = twoBasics.state.zoneOrder.p1.hand[0]
    expect(ok(twoBasics.rules(twoBasics.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: twoId,
    })).objects[twoId].tapped).toBe(false)
  })

  test.each([
    'Godless Shrine',
    'Hallowed Fountain',
  ])('%s asks whether to pay two life', (name) => {
    const server = game([land(name)])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId,
    }))
    expect(next.objects[objectId].tapped).toBe(false)
    expect(next.players.p1.data['kernel.pendingDialog']).toMatchObject([{
      source: name,
      kind: 'may-pay-life',
      count: 2,
    }])
  })

  test('Morphic Pool checks for two opponents', () => {
    const headsUp = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [land('Morphic Pool')] },
      },
      { random: () => 0.5, cardPlugins: [entersTapped] },
    )
    const headsUpId = headsUp.state.zoneOrder.p1.hand[0]
    expect(ok(headsUp.rules(headsUp.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: headsUpId,
    })).objects[headsUpId].tapped).toBe(true)

    const multiplayer = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: { p1: [land('Morphic Pool')] },
      },
      { random: () => 0.5, cardPlugins: [entersTapped] },
    )
    const multiplayerId = multiplayer.state.zoneOrder.p1.hand[0]
    expect(ok(multiplayer.rules(multiplayer.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: multiplayerId,
    })).objects[multiplayerId].tapped).toBe(false)
  })

  test('a land put onto the battlefield without being played still enters tapped', () => {
    const server = game([land('Lotus Field')])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
    expect(named(next, 'Lotus Field').tapped).toBe(true)
  })

  test('a surveil land both enters tapped and opens its surveil', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [land('Shadowy Backstreet', ['Plains', 'Swamp'])] },
        libraries: { p1: [land('Swamp', ['Swamp'])] },
      },
      { random: () => 0.5, cardPlugins: [entersTapped, choiceEffects] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]

    const played = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    expect(played.objects[objectId].tapped).toBe(true)

    // The enter trigger owes a surveil, so the land is not done entering when
    // it hits the battlefield tapped.
    const resolved = resolveStack(server.rules, played)
    expect(pendingSelectionFor(resolved, 'p1')).toMatchObject({
      kind: 'surveil',
      source: 'Shadowy Backstreet',
    })
  })

  test('Temple of Deceit enters tapped and opens a typed scry choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [land('Temple of Deceit')] },
        libraries: { p1: [land('Island', ['Island'])] },
      },
      { random: () => 0.5, cardPlugins: [entersTapped, choiceEffects] },
    )
    const objectId = server.state.zoneOrder.p1.hand[0]
    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId,
    }))

    expect(played.objects[objectId].tapped).toBe(true)
    const resolved = resolveStack(server.rules, played)
    expect(pendingSelectionFor(resolved, 'p1')).toMatchObject({
      kind: 'scry',
      source: 'Temple of Deceit',
      destinations: ['top', 'bottom'],
    })
  })

  test('Choked Estuary reveals a matching hand card or enters tapped', () => {
    const estuary = land('Choked Estuary')
    const island = land('Island', ['Island'])
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [estuary, island] } },
      { random: () => 0.5, cardPlugins: [entersTapped] },
    )
    const estuaryId = named(server.state, 'Choked Estuary').id
    const islandId = named(server.state, 'Island').id
    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: estuaryId,
    }))
    expect(pendingSelectionFor(played, 'p1')).toMatchObject({
      kind: 'reveal',
      min: 0,
      candidates: [islandId],
    })

    const revealed = ok(server.rules(played, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'reveal',
      count: 1,
      objectIds: [islandId],
    }))
    expect(revealed.objects[estuaryId].tapped).toBe(false)
    expect(revealed.objects[islandId].knownTo).toEqual(revealed.playerOrder)

    const declinedServer = createServerGame(
      commanderRules,
      { hands: { p1: [estuary, island] } },
      { random: () => 0.5, cardPlugins: [entersTapped] },
    )
    const declinedId = named(declinedServer.state, 'Choked Estuary').id
    const opened = ok(declinedServer.rules(declinedServer.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: declinedId,
    }))
    const declined = ok(declinedServer.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'reveal',
      count: 1,
      objectIds: [],
    }))
    expect(declined.objects[declinedId].tapped).toBe(true)
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
