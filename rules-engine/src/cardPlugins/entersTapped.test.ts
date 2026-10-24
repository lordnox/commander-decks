import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { resolveStack } from '../testHelpers'
import type { GameState, ReduceResult } from '../types'
import { choiceEffects } from './choiceEffects'
import { entersTapped } from './entersTapped'

import {catalogEntry, deckCards, loadCardPlugins} from '../deckCardFixtures'
import {replayCardTemplate} from '../replay'
import {pendingPlayerSelectionFor} from '../rules/selectPlayers'
import {pendingOptionSelection} from '../rules/selectOptions'
import {pendingDialogFor} from '../pendingDialog'
import {DECLINE_LIFE_OPTION, PAY_LIFE_OPTION} from './dsl/v1'

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
    expect(next.objects[objectId].zone).toBe('hand')
    const pending = pendingOptionSelection(next, 'p1')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
  })

  test.each([
    'Tanglespan Bridgeworks',
    'Fell Mire',
    'Boggart Bog',
  ])('%s asks for the three life its Oracle text prints, not two', (name) => {
    const server = game([land(name)])
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    const pending = pendingOptionSelection(next, 'p1')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
    expect(pending.options[0]?.label).toContain('3 life')
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

const kambalNames = ['Godless Shrine', 'Vault of Champions', 'Concealed Courtyard', 'Bojuka Bog', 'Boggart Trawler // Boggart Bog']
const kambalPlugins = await loadCardPlugins(kambalNames)
const kambalFixture = (name: string) => {
  const entry = deckCards('3_kambal-taxing-the-token-economy').find((card) => card.name === name)!
  const catalog = catalogEntry(entry)
  if (name.startsWith('Boggart')) catalog.faces![0].stats = '3/1'
  return replayCardTemplate(name, catalog)
}
const kambalLand = () => cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })
const kambalGame = (name: string, landCount = 0) => createServerGame(commanderRules, {
  hands: { p1: [kambalFixture(name)] },
  battlefield: { p1: Array.from({ length: landCount }, kambalLand) },
  libraries: { p1: [cardTemplate('Own card', { zone: 'graveyard' })], p2: [cardTemplate('Enemy card', { zone: 'graveyard' }), cardTemplate('Enemy card two', { zone: 'graveyard' })] },
}, { random: () => 0.5, cardPlugins: kambalPlugins })

describe('relocated from kambalManaGraveyards.test.ts → entersTapped.test.ts', () => {
  test.each([0, 1, 2, 3, 4])('Courtyard checks other lands at %i', (count) => {
      const server = kambalGame('Concealed Courtyard', count)
      const id = server.state.zoneOrder.p1.hand[0]
      const state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
      expect(state.objects[id].tapped).toBe(count >= 3)
    })

  test.each([false, true])('Vault checks living opponents (%s)', (duel) => {
      const server = kambalGame('Vault of Champions')
      if (duel) { server.state.players.p3.lost = true; server.state.players.p4.lost = true }
      const id = server.state.zoneOrder.p1.hand[0]
      expect(ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id })).objects[id].tapped).toBe(duel)
    })

  test.each([true, false])('Godless Shrine life choice applies only to its land (pay=%s)', (accepted) => {
      const server = kambalGame('Godless Shrine')
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
      const pending = pendingOptionSelection(state, 'p1')!
      expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
      expect(pendingDialogFor(state, 'p1')).toBeUndefined()
      state = ok(server.rules(state, {
        type: 'selectOption',
        seat: 'p1',
        selectionId: pending.id,
        optionId: accepted ? PAY_LIFE_OPTION : DECLINE_LIFE_OPTION,
      }))
      expect(state.players.p1.life).toBe(40 - (accepted ? 2 : 0))
      expect(state.objects[id].tapped).toBe(!accepted)
    })

  test.each([true, false])('Boggart Bog life choice applies only to its land (pay=%s)', (accepted) => {
      const server = kambalGame('Boggart Trawler // Boggart Bog')
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
      const pending = pendingOptionSelection(state, 'p1')!
      expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
      expect(pendingDialogFor(state, 'p1')).toBeUndefined()
      state = ok(server.rules(state, {
        type: 'selectOption',
        seat: 'p1',
        selectionId: pending.id,
        optionId: accepted ? PAY_LIFE_OPTION : DECLINE_LIFE_OPTION,
      }))
      expect(state.players.p1.life).toBe(40 - (accepted ? 3 : 0))
      expect(state.objects[id].tapped).toBe(!accepted)
    })

  test('Boggart Bog cannot pay three life at two life', () => {
      const server = kambalGame('Boggart Trawler // Boggart Bog')
      server.state.players.p1.life = 2
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
      const pending = pendingOptionSelection(state, 'p1')!
      state = ok(server.rules(state, {
        type: 'selectOption',
        seat: 'p1',
        selectionId: pending.id,
        optionId: PAY_LIFE_OPTION,
      }))
      expect(state.players.p1.life).toBe(2)
      expect(state.objects[id].tapped).toBe(true)
    })

})
