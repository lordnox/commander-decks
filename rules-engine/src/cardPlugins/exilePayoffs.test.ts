import { describe, expect, test } from 'bun:test'
import { gameObjectFieldDefaults } from '../definitions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameObject, GameState, PlayerId, ReduceResult } from '../types'
import { activated } from './activated'
import {
  ability,
  handler,
  pumpFromLinkedExilePower,
  pumpPerLinkedExile,
  putLinkedExileToGraveyardGainLife,
} from './effects'
import { exilePayoffs } from './exilePayoffs'
import { PENDING_SELECTION } from '../rules/selectCards'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const linkExile = (source: GameObject, card: GameObject) => {
  card.zone = 'exile'
  card.exiledWith = source.id
  source.exiledCards = [...(source.exiledCards ?? []), card.id]
}

const exiledFixture = (name: string, power: number, manaValue: number) =>
  cardTemplate(name, {
    types: ['Creature'],
    power,
    toughness: power,
    manaCost: `{${manaValue}}`,
    manaValue,
  })

const addExiled = (state: GameState, seat: PlayerId, template: ReturnType<typeof cardTemplate>) => {
  const id = `ex${Object.keys(state.objects).length}`
  state.objects[id] = {
    ...gameObjectFieldDefaults(),
    ...template,
    id,
    owner: seat,
    controller: seat,
    zone: 'exile',
  }
  state.zoneOrder[seat].exile.push(id)
  state.zoneCounts[seat].exile += 1
  return state.objects[id]
}

describe('exile payoffs', () => {
  test('static pump grows with each card exiled with the source', () => {
    const hoarder = cardTemplate('Linked Exile Hoarder Fixture', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      effects: [pumpPerLinkedExile(1, 1)],
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [hoarder] } },
      { random: () => 0.5 },
    )
    const source = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]
    const first = addExiled(server.state, 'p1', exiledFixture('Exiled One Fixture', 3, 3))
    const second = addExiled(server.state, 'p1', exiledFixture('Exiled Two Fixture', 5, 5))
    linkExile(source, first)
    linkExile(source, second)

    const state = ok(server.rules(server.state, { type: 'custom', name: 'exilePayoffs.sync' }))
    expect([state.objects[source.id].power, state.objects[source.id].toughness]).toEqual([3, 3])
  })

  test('does not enqueue exilePayoffs.sync after an unrelated event once the pump is current', () => {
    const hoarder = cardTemplate('Linked Exile Hoarder Fixture', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      effects: [pumpPerLinkedExile(1, 1)],
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [hoarder] } },
      { random: () => 0.5 },
    )
    const source = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]
    linkExile(source, addExiled(server.state, 'p1', exiledFixture('Exiled One Fixture', 3, 3)))

    const synced = ok(server.rules(server.state, { type: 'custom', name: 'exilePayoffs.sync' }))
    const logBefore = synced.log.length

    const afterLife = ok(server.rules(synced, { type: 'gainLife', seat: 'p1', amount: 1 }))
    const syncLog = afterLife.log.slice(logBefore).filter((line) => line.includes('exilePayoffs.sync'))
    expect(syncLog).toEqual([])
    expect(exilePayoffs.sba?.({ state: afterLife } as never)).toEqual([])
  })

  test('pumps itself until end of turn by the power of a linked exiled card', () => {
    const source = cardTemplate('Power Borrower Fixture', {
      types: ['Creature'],
      power: 2,
      toughness: 2,
      effects: [
        handler('exilePayoffs'),
        ability({ id: 'borrow' }, { tap: true }, pumpFromLinkedExilePower('self')),
      ],
    })
    const exiled = exiledFixture('Strong Exile Fixture', 4, 4)
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [source] } },
      { random: () => 0.5, cardPlugins: [activated, exilePayoffs] },
    )
    const hoarder = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]
    const card = addExiled(server.state, 'p1', exiled)
    linkExile(hoarder, card)

    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hoarder.id,
      abilityId: 'borrow',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect([state.objects[hoarder.id].power, state.objects[hoarder.id].toughness]).toEqual([6, 6])
  })

  test('puts a linked exiled card into its owner graveyard and gains life equal to mana value', () => {
    const source = cardTemplate('Exile Recycler Fixture', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      effects: [
        handler('exilePayoffs'),
        ability({ id: 'recycle' }, { tap: true }, putLinkedExileToGraveyardGainLife()),
      ],
    })
    const exiled = exiledFixture('Recyclable Exile Fixture', 2, 3)
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [source] } },
      { random: () => 0.5, cardPlugins: [activated, exilePayoffs] },
    )
    const recycler = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]
    const card = addExiled(server.state, 'p1', exiled)
    linkExile(recycler, card)
    const lifeBefore = server.state.players.p1.life

    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: recycler.id,
      abilityId: 'recycle',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[card.id].zone).toBe('graveyard')
    expect(state.objects[card.id].exiledWith).toBeUndefined()
    expect(state.objects[recycler.id].exiledCards).toEqual([])
    expect(state.players.p1.life).toBe(lifeBefore + 3)
  })

  test('chooses among several linked exiled cards before pumping', () => {
    const source = cardTemplate('Power Chooser Fixture', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      effects: [
        handler('exilePayoffs'),
        ability({ id: 'pick' }, { tap: true }, pumpFromLinkedExilePower('self')),
      ],
    })
    const weak = exiledFixture('Weak Exile Fixture', 1, 1)
    const strong = exiledFixture('Strong Exile Fixture', 6, 6)
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [source] } },
      { random: () => 0.5, cardPlugins: [activated, exilePayoffs] },
    )
    const chooser = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]
    const weakCard = addExiled(server.state, 'p1', weak)
    const strongCard = addExiled(server.state, 'p1', strong)
    linkExile(chooser, weakCard)
    linkExile(chooser, strongCard)

    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: chooser.id,
      abilityId: 'pick',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.data[PENDING_SELECTION]).toBeTruthy()

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [strongCard.id],
    }))
    expect(state.stack[0]?.payload?.instructions).toEqual([
      { kind: 'pumpFromLinkedExilePowerApply', applyTo: 'self' },
    ])

    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect([state.objects[chooser.id].power, state.objects[chooser.id].toughness]).toEqual([7, 7])
  })

  test('structuredClone keeps pumpPerLinkedExile static effects', () => {
    const stamped = [pumpPerLinkedExile(2, 2)]
    expect(structuredClone(stamped)).toEqual(stamped)
  })

  test('pumps a stack target using linked exile power', () => {
    const source = cardTemplate('Power Donor Fixture', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      effects: [
        handler('exilePayoffs'),
        ability(
          { id: 'donate' },
          { tap: true },
          pumpFromLinkedExilePower('stackTarget'),
        ),
      ],
    })
    const recipient = cardTemplate('Power Recipient Fixture', {
      types: ['Creature'],
      power: 2,
      toughness: 2,
    })
    const exiled = exiledFixture('Donor Exile Fixture', 5, 5)
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [source, recipient] } },
      { random: () => 0.5, cardPlugins: [activated, exilePayoffs] },
    )
    const donor = server.state.objects[server.state.zoneOrder.p1.battlefield[0]]
    const target = server.state.objects[server.state.zoneOrder.p1.battlefield[1]]
    const card = addExiled(server.state, 'p1', exiled)
    linkExile(donor, card)

    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: donor.id,
      abilityId: 'donate',
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect([state.objects[target.id].power, state.objects[target.id].toughness]).toEqual([7, 7])
  })
})
