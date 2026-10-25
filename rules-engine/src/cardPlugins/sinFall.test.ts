import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { activated } from './activated'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

describe('Sin Fall routine card support', () => {
  test('Hermit Druid reveals through the first basic land', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Hermit Druid', ['Creature'], '{1}{G}')] },
        libraries: {
          p1: [
            card('Nonbasic', ['Land']),
            card('Spell', ['Instant']),
            forest(),
            card('After', ['Creature']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.G = 1
    const druid = ready.zoneOrder.p1.battlefield[0]
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: druid,
    }))
    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))

    expect(resolved.zoneOrder.p1.graveyard.map((id) => resolved.objects[id].name))
      .toEqual(['Nonbasic', 'Spell'])
    expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name)).toEqual(['Forest'])
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['After'])
  })

  test('Yavimaya gives every land a green mana mode', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            card('Yavimaya, Cradle of Growth', ['Land']),
            cardTemplate('Wastes', {
              types: ['Land'],
              oracleText: '{T}: Add {C}.',
              tapProduces: { C: 1 },
            }),
          ],
        },
      },
    )
    const wastes = Object.values(server.state.objects).find((object) => object.name === 'Wastes')!
    const tapped = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: wastes.id,
      mana: 'G',
    }))

    expect(tapped.players.p1.mana.G).toBe(1)
  })

  test('Portal to Phyrexia makes each opponent sacrifice up to three creatures', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Portal to Phyrexia', ['Artifact'], '{9}')] },
        battlefield: {
          p2: [
            card('First Victim', ['Creature']),
            card('Second Victim', ['Creature']),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const portal = server.state.zoneOrder.p1.hand[0]
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: portal,
      to: 'battlefield',
    }))
    const choosing = ok(server.rules(entered, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p2')!
    expect(selection).toMatchObject({ kind: 'choose', count: 2 })

    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 2,
      objectIds: [...selection.candidates],
    }))
    expect(resolved.zoneOrder.p2.battlefield).toHaveLength(0)
  })

  test('Portal upkeep choice survives restart and reanimates as a Phyrexian', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Portal to Phyrexia', ['Artifact'], '{9}')] },
        hands: { p2: [card('Borrowed Body', ['Creature'], '{4}{G}')] },
      },
    )
    const body = server.state.zoneOrder.p2.hand[0]
    let state = ok(server.rules(server.state, { type: 'move', objectId: body, to: 'graveyard' }))
    state = { ...state, step: 'untap', active: 'p1', priority: 'p1' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.stack).toHaveLength(0)
    const restarted = structuredClone(state)
    const selection = pendingSelectionFor(restarted, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1 })
    const stacked = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [body],
    }))
    expect(stacked.stack[0]?.name).toBe('Portal to Phyrexia')
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.objects[body]).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
    })
    expect(resolved.objects[body].subtypes).toContain('Phyrexian')
  })

  test('Burgeoning offers a private typed land choice after an opponent land play', () => {
    const server = createServerGame(
      commanderRules,
      {
        first: 'p2',
        battlefield: { p1: [card('Burgeoning', ['Enchantment'], '{G}')] },
        hands: {
          p1: [forest()],
          p2: [card('Opponent Land', ['Land'])],
        },
      },
    )
    const opponentLand = server.state.zoneOrder.p2.hand[0]
    let state = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p2',
      objectId: opponentLand,
    }))
    expect(state.stack[0]?.name).toBe('Burgeoning')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1, min: 0 })

    const land = state.zoneOrder.p1.hand[0]
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [land],
    }))
    expect(state.objects[land].zone).toBe('battlefield')
    expect(state.players.p1.landsPlayed).toBe(0)
  })


})
