import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction, legalActsFor } from '../actions'
import { createJournal, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { commanderRules } from '../formats'
import { manaModes } from '../plugins/mana'
import { activated } from './activated'
import {
  extort,
  pendingExtortFor,
} from './extort'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const land = (name: string, oracleText: string) =>
  cardTemplate(name, { types: ['Land'], oracleText })

describe('Lady Evangela mana gaps', () => {
  test('Exotic Orchard uses stamped opponent-land capabilities and rejects colorless', () => {
    const orchard = land('Exotic Orchard', '{T}: Add one mana of any color that a land an opponent controls could produce.')
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [orchard],
        p2: [
          land('Island', '({T}: Add {U}.)'),
          land('Wastes', '{T}: Add {C}.'),
        ],
      },
      players: 2,
    })
    const source = named(server.state, 'Exotic Orchard')
    source.name = 'Copied Orchard'

    expect(manaModes(source, server.state)).toEqual([{ U: 1 }])
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: source.id,
      mana: 'C',
    }).ok).toBe(false)
  })

  test('Reflecting Pool follows mana types from another controlled land', () => {
    const pool = land('Reflecting Pool', '{T}: Add one mana of any type that a land you control could produce.')
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          pool,
          land('Underground Sea', '({T}: Add {U} or {B}.)'),
        ],
      },
      players: 2,
    })
    const source = named(server.state, 'Reflecting Pool')

    expect(manaModes(source, server.state)).toEqual([{ U: 1 }, { B: 1 }])
    expect(legalActsFor(server.state, 'p1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tapForMana', objectId: source.id, mana: 'U' }),
      expect.objectContaining({ kind: 'tapForMana', objectId: source.id, mana: 'B' }),
    ]))
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: source.id,
      mana: 'R',
    }).ok).toBe(false)
  })

  test("Nirkana Revenant's black pump is enumerated, paid, and resolves", () => {
    const revenant = cardTemplate('Nirkana Revenant', {
      types: ['Creature'],
      power: 4,
      toughness: 4,
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [revenant] }, players: 2 },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    server.state.players.p1.mana.B = 1
    const source = named(server.state, 'Nirkana Revenant')
    const action = availableActions(server.state, 'p1').find(
      (candidate) =>
        candidate.kind === 'activateAbility'
        && candidate.abilityId === 'nirkanaRevenant.pump',
    )
    expect(action).toBeDefined()

    const activatedState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'nirkanaRevenant.pump',
      seat: 'p1',
      objectId: source.id,
    }))
    expect(activatedState.players.p1.mana.B).toBe(0)
    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect(resolved.objects[source.id]).toMatchObject({ power: 5, toughness: 5 })

    const illegal = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'nirkanaRevenant.pump',
      seat: 'p2',
      objectId: source.id,
    })
    expect(illegal.ok).toBe(false)
  })
})

describe('extort', () => {
  const setup = () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Crypt Ghast', { types: ['Creature'] }),
            land('Plains', '({T}: Add {W}.)'),
          ],
        },
        hands: {
          p1: [cardTemplate('Test Instant', {
            types: ['Instant'],
            manaCost: '{1}',
          })],
        },
        players: 3,
      },
      { random: () => 0.5, cardPlugins: [extort] },
    )
    server.state.players.p1.mana = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Test Instant').id,
    }))
    return { server, cast }
  }

  test('triggers above the spell, waits until resolution, and offers typed choices', () => {
    const { server, cast } = setup()
    expect(cast.stack.map((item) => item.name)).toEqual([
      'Crypt Ghast — Extort',
      'Test Instant',
    ])
    expect(pendingExtortFor(cast, 'p1')).toBeUndefined()

    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const pending = pendingExtortFor(choosing, 'p1')!
    expect(choosing.stack.map((item) => item.name)).toEqual(['Test Instant'])
    expect(availableActions(choosing, 'p1')).toEqual([
      expect.objectContaining({ kind: 'payExtort', triggerId: pending.triggerId }),
      expect.objectContaining({ kind: 'payExtort', mana: 'W' }),
    ])
    expect(server.rules(choosing, { type: 'resolveTop' }).ok).toBe(false)
  })

  test('legal payment drains every opponent and gains the total', () => {
    const { server, cast } = setup()
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const pending = pendingExtortFor(choosing, 'p1')!
    const paid = ok(server.rules(choosing, {
      type: 'payExtort',
      seat: 'p1',
      triggerId: pending.triggerId,
      mana: 'W',
    }))

    expect(paid.players.p1).toMatchObject({ life: 42, mana: { W: 0 } })
    expect(paid.players.p2.life).toBe(39)
    expect(paid.players.p3.life).toBe(39)
    expect(pendingExtortFor(paid, 'p1')).toBeUndefined()
  })

  test('declining is legal while stale, wrong-seat, and unfunded payments fail', () => {
    const { server, cast } = setup()
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const pending = pendingExtortFor(choosing, 'p1')!

    expect(server.rules(choosing, {
      type: 'payExtort',
      seat: 'p2',
      triggerId: pending.triggerId,
      mana: 'W',
    }).ok).toBe(false)
    expect(server.rules(choosing, {
      type: 'payExtort',
      seat: 'p1',
      triggerId: pending.triggerId,
      mana: 'B',
    }).ok).toBe(false)

    const declined = ok(server.rules(choosing, {
      type: 'payExtort',
      seat: 'p1',
      triggerId: pending.triggerId,
    }))
    expect(declined.players.p1.life).toBe(40)
    expect(server.rules(declined, {
      type: 'payExtort',
      seat: 'p1',
      triggerId: pending.triggerId,
    }).ok).toBe(false)
  })

  test('payment state survives journal serialization and action conversion', () => {
    const { server, cast } = setup()
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const restored = restoreJournal(createJournal(choosing), server.rules).current()
    const pending = pendingExtortFor(restored, 'p1')!
    const action = legalActsFor(restored, 'p1').find(
      (candidate) => candidate.kind === 'payExtort' && candidate.mana === 'W',
    )!
    expect(pending).toBeDefined()
    expect(eventsForAvailableAction(restored, 'p1', action)).toEqual([
      {
        type: 'payExtort',
        seat: 'p1',
        triggerId: pending.triggerId,
        mana: 'W',
      },
    ])
  })

  test('payment action can activate a mana ability during the payment window', () => {
    const { server, cast } = setup()
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    choosing.players.p1.mana.W = 0
    const plains = named(choosing, 'Plains')
    const pending = pendingExtortFor(choosing, 'p1')!
    const action = legalActsFor(choosing, 'p1').find(
      (candidate) => candidate.kind === 'payExtort' && candidate.mana === 'W',
    )!

    expect(eventsForAvailableAction(choosing, 'p1', action)).toEqual([
      {
        type: 'tapForMana',
        seat: 'p1',
        objectId: plains.id,
      },
      {
        type: 'payExtort',
        seat: 'p1',
        triggerId: pending.triggerId,
        mana: 'W',
      },
    ])
  })
})
