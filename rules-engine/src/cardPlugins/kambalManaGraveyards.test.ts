import { describe, expect, test } from 'bun:test'
import { catalogEntry, deckCards, loadCardPlugins } from '../deckCardFixtures'
import { cardTemplate } from '../newGame'
import { replayCardTemplate } from '../replay'
import { commanderRules } from '../formats'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { pendingDialogFor, DIALOG_CHOSEN } from '../pendingDialog'
import { legalActsFor } from '../actions'
import { enters, createTokenInstruction } from './effects'
import { missingCardPlugins } from './index'

const names = ['Godless Shrine', 'Vault of Champions', 'Concealed Courtyard', 'Bojuka Bog', 'Boggart Trawler // Boggart Bog']
const plugins = await loadCardPlugins(names)
const fixture = (name: string) => {
  const entry = deckCards('3_kambal-taxing-the-token-economy').find((card) => card.name === name)!
  const catalog = catalogEntry(entry)
  if (name.startsWith('Boggart')) catalog.faces![0].stats = '3/1'
  return replayCardTemplate(name, catalog)
}
const land = () => cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })
const game = (name: string, landCount = 0) => createServerGame(commanderRules, {
  hands: { p1: [fixture(name)] },
  battlefield: { p1: Array.from({ length: landCount }, land) },
  libraries: { p1: [cardTemplate('Own card', { zone: 'graveyard' })], p2: [cardTemplate('Enemy card', { zone: 'graveyard' }), cardTemplate('Enemy card two', { zone: 'graveyard' })] },
}, { random: () => 0.5, cardPlugins: plugins })

describe('Kambal added mana and graveyard cards', () => {
  test('all five cards register through loadable handlers', () => expect(missingCardPlugins(names)).toEqual([]))
  test.each([0, 1, 2, 3, 4])('Courtyard checks other lands at %i', (count) => {
    const server = game('Concealed Courtyard', count)
    const id = server.state.zoneOrder.p1.hand[0]
    const state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
    expect(state.objects[id].tapped).toBe(count >= 3)
  })
  test.each([false, true])('Vault checks living opponents (%s)', (duel) => {
    const server = game('Vault of Champions')
    if (duel) { server.state.players.p3.lost = true; server.state.players.p4.lost = true }
    const id = server.state.zoneOrder.p1.hand[0]
    expect(ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id })).objects[id].tapped).toBe(duel)
  })
  test.each(['Godless Shrine', 'Boggart Trawler // Boggart Bog'])('%s life choice applies only to its land', (name) => {
    for (const accepted of [true, false]) {
      const server = game(name)
      const id = server.state.zoneOrder.p1.hand[0]
      let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
      const dialog = pendingDialogFor(state, 'p1')!
      const amount = name === 'Godless Shrine' ? 2 : 3
      expect(dialog.count).toBe(amount)
      expect(pendingPlayerSelectionFor(state, 'p1')).toBeUndefined()
      state = ok(server.rules(state, { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { accepted } }))
      expect(state.players.p1.life).toBe(40 - (accepted ? amount : 0))
      expect(state.objects[id].tapped).toBe(!accepted)
    }
  })
  test('Boggart Bog cannot pay three life at two life', () => {
    const server = game('Boggart Trawler // Boggart Bog')
    server.state.players.p1.life = 2
    const id = server.state.zoneOrder.p1.hand[0]
    let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
    state = ok(server.rules(state, { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { accepted: true } }))
    expect(state.players.p1.life).toBe(2)
    expect(state.objects[id].tapped).toBe(true)
  })
  test('Bojuka Bog triggers on a land drop and can exile its controller graveyard', () => {
    const server = game('Bojuka Bog')
    const id = server.state.zoneOrder.p1.hand[0]
    let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
    expect(state.objects[id].tapped).toBe(true)
    const selection = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: selection.id, players: ['p1'] }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(state.zoneOrder.p1.exile).toHaveLength(1)
    expect(state.zoneOrder.p2.graveyard).toHaveLength(2)
  })
  test.each(['Bojuka Bog', 'Boggart Trawler // Boggart Bog'])('%s targets a player then exiles at resolution on a move entry', (name) => {
    const server = game(name)
    const id = server.state.zoneOrder.p1.hand[0]
    let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice.candidates).toContain('p1')
    expect(state.zoneOrder.p2.graveyard.length).toBe(2)
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: choice.id, players: ['p2'] }))
    expect(state.zoneOrder.p2.graveyard.length).toBe(2)
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p2.graveyard.length).toBe(0)
    expect(state.zoneOrder.p2.exile.length).toBe(2)
    expect(state.zoneOrder.p1.graveyard.length).toBe(1)
    expect(pendingDialogFor(state, 'p1')).toBeUndefined()
  })
  test('Trawler exile still resolves after its source stops being a creature', () => {
    const server = game('Boggart Trawler // Boggart Bog')
    const id = server.state.zoneOrder.p1.hand[0]
    let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: choice.id, players: ['p2'] }))
    // Model a continuous effect removing Creature after the trigger is on the stack.
    state = { ...state, objects: { ...state.objects, [id]: { ...state.objects[id], types: ['Enchantment'] } } }
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p2.graveyard).toHaveLength(0)
    expect(state.zoneOrder.p2.exile).toHaveLength(2)
  })
  test('a token copy of Trawler carries its graveyard exile trigger', () => {
    const trawler = fixture('Boggart Trawler // Boggart Bog')
    const maker = cardTemplate('Copy maker', { types: ['Creature'], effects: [enters(createTokenInstruction({
      name: trawler.name, types: ['Creature'], subtypes: ['Goblin'], power: 3, toughness: 1,
      effects: trawler.effects,
    }))] })
    const server = createServerGame(commanderRules, { hands: { p1: [maker] } }, { random: () => 0.5, cardPlugins: plugins })
    const id = server.state.zoneOrder.p1.hand[0]
    const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' })))
    expect(pendingPlayerSelectionFor(state, 'p1')).toBeDefined()
    expect(pendingDialogFor(state, 'p1')).toBeUndefined()
  })
  test('Trawler casts its front face, triggers, and resets after the land face leaves', () => {
    const server = game('Boggart Trawler // Boggart Bog')
    const id = server.state.zoneOrder.p1.hand[0]
    server.state.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 }
    expect(legalActsFor(server.state, 'p1').map((act) => act.kind)).toEqual(expect.arrayContaining(['castSpell', 'playLand']))
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: id }))
    state = resolveStack(server.rules, state)
    expect(state.objects[id].types).toContain('Creature')
    expect(pendingPlayerSelectionFor(state, 'p1')).toBeDefined()
    expect(pendingDialogFor(state, 'p1')).toBeUndefined()
    const fresh = game('Boggart Trawler // Boggart Bog')
    const landId = fresh.state.zoneOrder.p1.hand[0]
    let played = ok(fresh.rules(fresh.state, { type: 'playLand', seat: 'p1', objectId: landId }))
    played = ok(fresh.rules(played, { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1', payload: { accepted: true } }))
    played = ok(fresh.rules(played, { type: 'move', objectId: landId, to: 'hand' }))
    expect(played.objects[landId].types).toContain('Creature')
  })
})
