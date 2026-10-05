import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor, sameLegalAct } from '../actions'
import { deckCardTemplate } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'

const PATHWAY = 'Barkchannel Pathway // Tidechannel Pathway'

const game = (...names: string[]) =>
  createServerGame(
    commanderRules,
    { players: 2, hands: { p1: names.map((name) => deckCardTemplate(name)) } },
    { random: () => 0.5 },
  )

const pathway = (state: GameState) =>
  Object.values(state.objects).find((object) => object.name === PATHWAY)!

const landActs = (state: GameState) =>
  legalActsFor(state, 'p1').filter((act) => act.kind === 'playLand')

const tapMana = (server: ReturnType<typeof game>, state: GameState) =>
  ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: pathway(state).id }))
    .players.p1.mana

describe('a card with two land faces (Barkchannel Pathway // Tidechannel Pathway)', () => {
  test('offers one land play per face, each labelled with its face name', () => {
    const server = game(PATHWAY)
    expect(landActs(server.state)).toMatchObject([
      { kind: 'playLand', face: 'front', faceName: 'Barkchannel Pathway' },
      { kind: 'playLand', face: 'back', faceName: 'Tidechannel Pathway' },
    ])
    for (const act of landActs(server.state)) {
      expect(eventsForAvailableAction(server.state, 'p1', act)).toEqual([
        { type: 'playLand', seat: 'p1', objectId: pathway(server.state).id, face: act.kind === 'playLand' ? act.face : undefined },
      ])
    }
  })

  test('the two acts are told apart by face when a client sends one back', () => {
    const state = game(PATHWAY).state
    const [front, back] = landActs(state)
    const id = pathway(state).id
    expect(sameLegalAct(front, { kind: 'playLand', objectId: id, face: 'front' })).toBe(true)
    expect(sameLegalAct(back, { kind: 'playLand', objectId: id, face: 'back' })).toBe(true)
    expect(sameLegalAct(back, { kind: 'playLand', objectId: id, face: 'front' })).toBe(false)
    expect(sameLegalAct(back, { kind: 'playLand', objectId: id })).toBe(false)
  })

  test('playing the back face makes a Tidechannel Pathway that taps for {U}', () => {
    const server = game(PATHWAY)
    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: pathway(server.state).id,
      face: 'back',
    }))
    expect(pathway(played)).toMatchObject({ zone: 'battlefield', types: ['Land'], oracleText: '{T}: Add {U}.' })
    expect(tapMana(server, played)).toEqual({ ...emptyMana(), U: 1 })
  })

  test('playing the front face, or leaving the face out as before, makes the Barkchannel Pathway', () => {
    for (const face of [{ face: 'front' as const }, {}]) {
      const server = game(PATHWAY)
      const played = ok(server.rules(server.state, {
        type: 'playLand',
        seat: 'p1',
        objectId: pathway(server.state).id,
        ...face,
      }))
      expect(pathway(played).oracleText).toBe('{T}: Add {G}.')
      expect(tapMana(server, played)).toEqual({ ...emptyMana(), G: 1 })
    }
  })

  test('a face that is not a land is rejected, and a plain land offers no face choice', () => {
    const server = game('Sea Gate Restoration // Sea Gate, Reborn', 'Forest')
    const spellCard = Object.values(server.state.objects)
      .find((object) => object.name.startsWith('Sea Gate'))!
    const front = server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: spellCard.id,
      face: 'front',
    })
    expect(front.ok).toBe(false)
    expect(front.ok === false && front.error).toContain('no front land face')
    expect(ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: spellCard.id,
      face: 'back',
    })).objects[spellCard.id].types).toEqual(['Land'])
    // One land face (or none to choose between): a single act without a face.
    expect(landActs(server.state).map((act) => act.kind === 'playLand' && act.face)).toEqual([undefined, undefined])
    const forest = Object.values(server.state.objects).find((object) => object.name === 'Forest')!
    expect(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: forest.id,
      face: 'back',
    }).ok).toBe(false)
  })

  test('the chosen face survives a restart by journal replay, and old journals without a face still replay', () => {
    const server = game(PATHWAY)
    const initial = structuredClone(server.state)
    const id = pathway(initial).id
    const withFace: GameEvent = { type: 'playLand', seat: 'p1', objectId: id, face: 'back' }
    const withoutFace: GameEvent = { type: 'playLand', seat: 'p1', objectId: id }

    for (const [event, expected] of [[withFace, '{T}: Add {U}.'], [withoutFace, '{T}: Add {G}.']] as const) {
      let journal = createJournal(initial)
      ok(server.rules(initial, event))
      journal = recordAccepted(journal, event)
      const restored = restoreJournal(JSON.parse(JSON.stringify(journal)), server.rules)
      expect(restored.current().objects[id]).toMatchObject({ zone: 'battlefield', oracleText: expected })
    }
  })
})
