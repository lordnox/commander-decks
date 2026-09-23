import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { cardDefinition, effectsFor } from './cardRules'
import { exilePayoffs } from './exilePayoffs'
import { linkedExile } from './linkedExile'
import { missingCardPlugins } from './index'

const plugins = [activated, exilePayoffs, linkedExile]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const fromPool = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra, effects: effectsFor(name) })

const part34Registered = [
  'Angel of Sanctions',
  'Banisher Priest',
  'Bishop of Binding',
  'Fiend Hunter',
  'Glorious Protector',
  'Lumbering Battlement',
  'Palace Jailer',
  'Werefox Bodyguard',
]

describe('Dack Fayden part 34 — linked exile cages', () => {
  test('registered part-34 cards are in the card pool table', () => {
    expect(missingCardPlugins(part34Registered)).toEqual([])
    for (const name of part34Registered) {
      expect(cardDefinition(name)?.effects.length).toBeGreaterThan(0)
    }
  })

  test('Fiend Hunter exiles on ETB and returns the hostage when it dies', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Caged Prey', { types: ['Creature'], power: 3, toughness: 3, controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Caged Prey').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [preyId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[preyId]).toMatchObject({ zone: 'exile', exiledWith: hunterId })

    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'graveyard' }))
    expect(state.objects[preyId]).toMatchObject({
      zone: 'battlefield',
      controller: state.objects[preyId].owner,
    })
  })

  test('Fiend Hunter returns the hostage when blinked off the battlefield', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Blink Prey', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Blink Prey').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [preyId],
    }))
    state = resolveStack(server.rules, state)

    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'hand' }))
    expect(state.objects[preyId].zone).toBe('battlefield')
  })

  test('Banisher Priest cages an opponent creature on ETB', () => {
    const priest = fromPool('Banisher Priest', { controller: 'p1' })
    const foe = cardTemplate('Opponent Bear', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [priest] }, battlefield: { p2: [foe] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const priestId = named(server.state, 'Banisher Priest').id
    const foeId = named(server.state, 'Opponent Bear').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: priestId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [foeId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[foeId].zone).toBe('exile')
  })

  test('Palace Jailer becomes monarch and exiles until an opponent takes the crown', () => {
    const jailer = fromPool('Palace Jailer', { controller: 'p1' })
    const hostage = cardTemplate('Jail Hostage', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 3, hands: { p1: [jailer] }, battlefield: { p2: [hostage] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const jailerId = named(server.state, 'Palace Jailer').id
    const hostageId = named(server.state, 'Jail Hostage').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: jailerId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [hostageId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.monarch).toBe('p1')
    expect(state.objects[hostageId]).toMatchObject({
      zone: 'exile',
      exiledUntilOpponentMonarch: true,
    })

    state = ok(server.rules(state, { type: 'becomeMonarch', seat: 'p2' }))
    expect(state.objects[hostageId].zone).toBe('battlefield')
  })

  test('Bishop of Binding registers attack pump from linked exile power', () => {
    const effects = effectsFor('Bishop of Binding')
    const attack = effects.find((effect) => effect.op === 'trigger' && effect.on === 'attacks')
    expect(attack?.do).toEqual([{ kind: 'pumpFromLinkedExilePower', applyTo: 'stackTarget' }])
  })

  test('Lumbering Battlement grows for each linked exile and releases them when it leaves', () => {
    const battlement = fromPool('Lumbering Battlement', { controller: 'p1', power: 4, toughness: 5 })
    const ally = cardTemplate('Battlement Ally', { types: ['Creature'], controller: 'p1' })
    const token = cardTemplate('Battlement Token', { types: ['Creature'], controller: 'p1', token: true })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [battlement] }, battlefield: { p1: [ally, token] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const battlementId = named(server.state, 'Lumbering Battlement').id
    const allyId = named(server.state, 'Battlement Ally').id
    const tokenId = named(server.state, 'Battlement Token').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: battlementId,
      to: 'battlefield',
    })))
    const pick = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: pick.count,
      objectIds: [allyId, tokenId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[battlementId]).toMatchObject({ power: 8, toughness: 9 })

    state = ok(server.rules(state, { type: 'sacrifice', objectId: battlementId }))
    expect(state.objects[allyId].zone).toBe('battlefield')
    expect(state.objects[tokenId].zone).toBe('battlefield')
  })

  test('Werefox Bodyguard may exile zero or one non-Fox creature', () => {
    const fox = fromPool('Werefox Bodyguard', { controller: 'p1', subtypes: ['Fox', 'Elf', 'Knight'] })
    const mark = cardTemplate('Werefox Mark', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [fox] }, battlefield: { p2: [mark] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const foxId = named(server.state, 'Werefox Bodyguard').id
    const markId = named(server.state, 'Werefox Mark').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: foxId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(state.objects[markId].zone).toBe('battlefield')
  })

  test('link-exile target selection is visible only to the choosing seat after projection', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Hidden Prey', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    expect(pendingSelectionFor(entered, 'p1')?.candidates.length).toBeGreaterThan(0)
    const p1View = server.project(entered, 'p1')
    const p2View = server.project(entered, 'p2')
    expect(pendingSelectionFor(p1View, 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(p2View, 'p2')).toBeUndefined()
  })
})
