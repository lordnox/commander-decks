import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelection, pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { choiceEffects } from './choiceEffects'
import { modalSpell } from './modalSpell'
import { onResolve } from './onResolve'

const card = (
  name: string,
  types: string[],
  extra: Parameters<typeof cardTemplate>[1] | string = {},
) => cardTemplate(name, {
  types,
  ...(typeof extra === 'string' ? { manaCost: extra } : extra),
})

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plugins = [onResolve, modalSpell, choiceEffects]

describe('Sin-fall modal and saga behavior', () => {
  test('Frantic Search untaps up to three tapped lands after looting', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            card('Island 1', ['Land'], { subtypes: ['Island'] }),
            card('Island 2', ['Land'], { subtypes: ['Island'] }),
            card('Island 3', ['Land'], { subtypes: ['Island'] }),
            card('Island 4', ['Land'], { subtypes: ['Island'] }),
          ],
        },
        hands: {
          p1: [
            card('Frantic Search', ['Instant'], { manaCost: '{2}{U}' }),
            card('Keep', ['Instant']),
            card('Dump', ['Instant']),
          ],
        },
        libraries: { p1: [card('Drawn One', ['Instant']), card('Drawn Two', ['Instant'])] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
    for (const island of ['Island 1', 'Island 2', 'Island 3']) {
      named(state, island).tapped = true
    }
    named(state, 'Island 4').tapped = false
    const spell = named(state, 'Frantic Search').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 3, min: 0, untapSelected: true })
    const toUntap = selection.candidates.slice(0, 2)
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 3,
      objectIds: toUntap,
    }))
    expect(toUntap.every((id) => !state.objects[id].tapped)).toBe(true)
    expect(named(state, 'Island 4').tapped).toBe(false)
  })

  test('Summon: Leviathan chapter II draws when a sea creature attacks', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Summon: Leviathan', ['Enchantment', 'Creature'], {
            subtypes: ['Saga', 'Leviathan'],
            manaCost: '{4}{U}{U}',
          })],
        },
        battlefield: {
          p1: [card('Sin', ['Legendary', 'Creature'], {
            subtypes: ['Avatar', 'Leviathan'],
            power: 7,
            toughness: 7,
          })],
        },
        libraries: { p1: [card('Top Card', ['Instant'])] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 4 }
    const leviathan = named(state, 'Summon: Leviathan').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: leviathan }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[leviathan].counters.lore).toBe(1)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = { ...state, step: 'draw', active: 'p1', priority: 'p1' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.objects[leviathan].counters.lore).toBe(2)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.rules.some((rule) => rule.pluginId === 'attackSubtypeDraw')).toBe(true)
    const sin = named(state, 'Sin').id
    state.step = 'declareAttackers'
    state.priority = 'p1'
    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: sin, defender: 'p2' }],
    }))
    expect(named(state, 'Top Card').zone).toBe('hand')
  })

  test('Profane Command rejects a single mode and drains the chosen player for X', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Profane Command', ['Sorcery'], '{X}{B}{B}')],
        },
        battlefield: {
          p2: [card('Bear', ['Creature'], { power: 3, toughness: 3 })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 2 }
    const spell = named(state, 'Profane Command').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, x: 2 }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingDialog(state)).toMatchObject({ kind: 'choose-modes' })
    expect(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: ['Target player loses X life.'] },
    }).ok).toBe(false)
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: {
        modes: [
          'Target player loses X life.',
          'Target creature gets -X/-X until end of turn.',
        ],
      },
    }))
    const bear = named(state, 'Bear')
    const pickPlayer = pendingPlayerSelection(state)!
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pickPlayer.id,
      players: ['p2'],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const pickCreature = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bear.id],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p2.life).toBe(38)
    expect(state.objects[bear.id]).toMatchObject({ power: 1, toughness: 1 })
  })

  test('Will of the Sultai mills a chosen opponent and returns lands on the first mode', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Will of the Sultai', ['Sorcery'], { manaCost: '{2}{B}{G}' })],
        },
        libraries: {
          p2: [card('Milled A', ['Instant']), card('Milled B', ['Instant']), card('Milled C', ['Instant'])],
          p1: [card('Yard Land', ['Land'], { zone: 'graveyard' })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 1, C: 2 }
    const spell = named(state, 'Will of the Sultai').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: {
        modes: [
          'Target player mills three cards. Return all land cards from your graveyard tapped.',
        ],
      },
    }))
    const pick = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pick.id,
      players: ['p2'],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p2.graveyard).toHaveLength(3)
    expect(named(state, 'Yard Land').zone).toBe('battlefield')
    expect(named(state, 'Yard Land').tapped).toBe(true)
  })

  test('Profane Command fear mode survives restart and grants fear to multiple creatures', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Profane Command', ['Sorcery'], '{X}{B}{B}')],
        },
        battlefield: {
          p1: [
            card('One', ['Creature'], { power: 1, toughness: 1 }),
            card('Two', ['Creature'], { power: 1, toughness: 1 }),
          ],
          p3: [],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 2 }
    const spell = named(state, 'Profane Command').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell, x: 2 }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: {
        modes: [
          'Up to X target creatures gain fear until end of turn.',
          'Target player loses X life.',
        ],
      },
    }))
    const pickPlayer = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pickPlayer.id,
      players: ['p3'],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 2, min: 0 })
    const one = named(state, 'One').id
    const two = named(state, 'Two').id
    const restarted = structuredClone(state)
    state = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 2,
      objectIds: [one, two],
    }))
    expect(state.objects[one].oracleText.toLowerCase()).toContain('fear')
    expect(state.objects[two].oracleText.toLowerCase()).toContain('fear')
    expect(state.players.p3.life).toBe(38)
  })
})
