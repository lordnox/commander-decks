import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { activated } from './activated'
import { castCosts } from './castCosts'
import { onResolve } from './onResolve'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost })

describe('Sin Fall routine card support', () => {
  test('Exsanguinate drains each opponent for X and gains the total', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [card('Exsanguinate', ['Sorcery'], '{X}{B}{B}')] } },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 3 }
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 3,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(resolved.players.p1.life).toBe(49)
    expect(resolved.playerOrder.slice(1).map((seat) => resolved.players[seat].life))
      .toEqual([37, 37, 37])
  })

  test('Toxic Deluge pays life while casting and applies negative X globally', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Toxic Deluge', ['Sorcery'], '{2}{B}')] },
        battlefield: {
          p1: [cardTemplate('Large', { types: ['Creature'], power: 5, toughness: 5 })],
          p2: [cardTemplate('Small', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      },
      { random: () => 0.5, cardPlugins: [castCosts, onResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 }
    const spell = ready.zoneOrder.p1.hand[0]
    const illegal = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 40,
    })
    expect(illegal.ok).toBe(false)

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      x: 3,
    }))
    expect(cast.players.p1.life).toBe(37)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(Object.values(resolved.objects).find((object) => object.name === 'Large'))
      .toMatchObject({ power: 2, toughness: 2 })
    expect(Object.values(resolved.objects).find((object) => object.name === 'Small')?.zone)
      .toBe('graveyard')
  })

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
      abilityId: 'hermitDruid.reveal',
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
})
