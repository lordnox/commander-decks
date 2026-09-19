import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
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
    const cleaned = ok(server.rules(
      { ...resolved, step: 'end', priority: 'p1' },
      { type: 'advanceStep' },
    ))
    expect(Object.values(cleaned.objects).find((object) => object.name === 'Large'))
      .toMatchObject({ power: 5, toughness: 5 })
    expect(Object.values(cleaned.objects).find((object) => object.name === 'Small'))
      .toMatchObject({ power: 2, toughness: 2 })
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

  test('Reprocess uses a typed optional sacrifice and draws per chosen permanent', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Reprocess', ['Sorcery'], '{2}{B}{B}')] },
        battlefield: {
          p1: [
            card('Relic', ['Artifact']),
            card('Body', ['Creature']),
            card('Song', ['Enchantment']),
          ],
        },
        libraries: { p1: [card('Fresh', ['Instant'])] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 2 }
    const spell = ready.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell }))
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!

    expect(selection).toMatchObject({ kind: 'sacrifice', count: 2, min: 0 })
    expect(server.project(choosing, 'p2').players.p1.data['kernel.pendingSelection'])
      .toBeUndefined()

    const relic = Object.values(choosing.objects).find((object) => object.name === 'Relic')!
    const resolved = ok(server.rules(structuredClone(choosing), {
      type: 'selectCards',
      seat: 'p1',
      kind: 'sacrifice',
      count: selection.count,
      objectIds: [relic.id],
    }))
    expect(resolved.objects[relic.id].zone).toBe('graveyard')
    expect(Object.values(resolved.objects).find((object) => object.name === 'Fresh')?.zone)
      .toBe('hand')
    expect(Object.values(resolved.objects).find((object) => object.name === 'Song')?.zone)
      .toBe('battlefield')
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
    expect(selection).toMatchObject({ kind: 'sacrifice', count: 2 })

    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'sacrifice',
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
    expect(state.stack[0]?.name).toBe('Portal to Phyrexia')
    state = ok(server.rules(state, { type: 'resolveTop' }))

    const restarted = structuredClone(state)
    const selection = pendingSelectionFor(restarted, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 1 })
    const resolved = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [body],
    }))
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

  test('Rain of Filth grants an actionable land-sacrifice mana ability until cleanup', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Rain of Filth', ['Instant'], '{B}')] },
        battlefield: { p1: [forest()] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.B = 1
    const rain = ready.zoneOrder.p1.hand[0]
    let state = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: rain,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const land = state.zoneOrder.p1.battlefield[0]
    expect(legalActsFor(state, 'p1')).toContainEqual(expect.objectContaining({
      kind: 'activateAbility',
      objectId: land,
      abilityId: 'sacrificeLandMana.black',
    }))

    state = ok(server.rules(state, {
      type: 'activateAbility',
      abilityId: 'sacrificeLandMana.black',
      seat: 'p1',
      objectId: land,
      manaAbility: true,
    }))
    expect(state.objects[land].zone).toBe('graveyard')
    expect(state.players.p1.mana.B).toBe(1)
  })
})
