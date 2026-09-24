import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelection } from '../rules/selectPlayers'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { activated } from './activated'
import { choiceEffects } from './choiceEffects'
import { modalSpell } from './modalSpell'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'

const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types, ...extra })

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Sin Fall remaining card support', () => {
  test('Life from the Loam returns up to three lands to hand', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            card('Life from the Loam', ['Sorcery'], { manaCost: '{1}{G}' }),
            card('First Land', ['Land']),
            card('Second Land', ['Land']),
            card('Third Land', ['Land']),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolve, targetedResolve] },
    )
    let ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    for (const name of ['First Land', 'Second Land', 'Third Land']) {
      ready = ok(server.rules(ready, {
        type: 'move',
        objectId: named(ready, name).id,
        to: 'graveyard',
      }))
    }
    const spell = named(ready, 'Life from the Loam').id
    const first = named(ready, 'First Land').id
    const second = named(ready, 'Second Land').id
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      targets: [
        { kind: 'object', objectId: first },
        { kind: 'object', objectId: second },
      ],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[first].zone).toBe('hand')
    expect(resolved.objects[second].zone).toBe('hand')
    expect(named(resolved, 'Third Land').zone).toBe('graveyard')
  })

  test('Lotus Field asks to sacrifice two lands on entry', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [forest(), forest('Island')] },
        hands: { p1: [card('Lotus Field', ['Land'])] },
      },
    )
    const lotus = named(server.state, 'Lotus Field').id
    const entered = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: lotus,
    }))
    const choosing = ok(server.rules(entered, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    expect(selection).toMatchObject({ kind: 'sacrifice', count: 2 })
    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'sacrifice',
      count: 2,
      objectIds: selection.candidates.slice(0, 2),
    }))
    expect(resolved.zoneOrder.p1.battlefield).toHaveLength(1)
  })

  test('Mystic Sanctuary with three other Islands returns an instant to the top', () => {
    const islands = [1, 2, 3].map((index) =>
      card(`Island ${index}`, ['Land'], { subtypes: ['Island'] }))
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: islands },
        hands: { p1: [card('Mystic Sanctuary', ['Land'], { subtypes: ['Island'] })] },
        libraries: {
          p1: [card('Brainstorm', ['Instant'], { zone: 'graveyard' })],
        },
      },
    )
    const sanctuary = named(server.state, 'Mystic Sanctuary').id
    const instant = named(server.state, 'Brainstorm').id
    const entered = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: sanctuary,
    }))
    const selection = pendingSelectionFor(entered, 'p1')!
    expect(selection.candidates).toContain(instant)
    const stacked = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [instant],
    }))
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.library[0]).toBe(instant)
  })

  test('Hall of Storm Giants animates when the graveyard is deep enough', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Hall of Storm Giants', ['Land'])] },
        libraries: {
          p1: Array.from({ length: 7 }, (_, index) =>
            card(`Filler ${index}`, ['Instant'], { zone: 'graveyard' as const })),
        },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 6 }
    const hall = named(ready, 'Hall of Storm Giants').id
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'hall.animate',
      seat: 'p1',
      objectId: hall,
    }))
    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect(resolved.objects[hall]).toMatchObject({
      types: ['Land', 'Creature'],
      power: 7,
      toughness: 7,
    })
  })

  test('Lair of the Hydra pays X and becomes an X/X', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Lair of the Hydra', ['Land'])] },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 4 }
    const lair = named(ready, 'Lair of the Hydra').id
    const illegal = server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'lair.animate',
      seat: 'p1',
      objectId: lair,
      x: 0,
    })
    expect(illegal.ok).toBe(false)
    const activatedState = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'lair.animate',
      seat: 'p1',
      objectId: lair,
      x: 4,
    }))
    const resolved = ok(server.rules(activatedState, { type: 'resolveTop' }))
    expect(resolved.objects[lair]).toMatchObject({ power: 4, toughness: 4 })
    expect(resolved.players.p1.mana).toMatchObject({ G: 0, C: 0 })
  })

  test('Hedron Crab mills a chosen player on landfall', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Hedron Crab', ['Creature'])] },
        hands: { p1: [forest()] },
        libraries: {
          p2: [card('A', ['Instant']), card('B', ['Instant']), card('C', ['Instant'])],
        },
      },
    )
    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: named(server.state, 'Forest').id,
    }))
    const pending = pendingPlayerSelection(played)!
    const chosen = ok(server.rules(played, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending.id,
      players: ['p2'],
    }))
    const milled = ok(server.rules(chosen, { type: 'resolveTop' }))
    expect(milled.zoneOrder.p2.graveyard).toHaveLength(3)
  })

  test('Frantic Search draws two then discards two', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            card('Frantic Search', ['Instant'], { manaCost: '{2}{U}' }),
            card('Keep', ['Instant']),
            card('Dump', ['Instant']),
          ],
        },
        libraries: { p1: [card('Drawn One', ['Instant']), card('Drawn Two', ['Instant'])] },
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
    const spell = named(state, 'Frantic Search').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(4)
    expect(state.stack[0]).toMatchObject({ actionId: 'discard' })
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.stack[0]?.waiting).toBe('choice')
    const dump = named(state, 'Dump').id
    const keep = named(state, 'Keep').id
    state = ok(server.rules(state, {
      type: 'continueAction',
      seat: 'p1',
      stackId: state.stack[0].id,
      payload: { objectIds: [dump, keep] },
    }))
    expect([dump, keep].every((id) => state.objects[id].zone === 'graveyard')).toBe(true)
  })

  test('Retreat to Hagra can drain the table on landfall', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Retreat to Hagra', ['Enchantment'])] },
        hands: { p1: [forest()] },
      },
      { random: () => 0.5, cardPlugins: [choiceEffects, modalSpell] },
    )
    let state = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: named(server.state, 'Forest').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingDialog(state)?.kind).toBe('choose-modes')
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: ['Each opponent loses 1 life and you gain 1 life.'] },
    }))
    expect(state.players.p1.life).toBe(41)
    expect(state.playerOrder.slice(1).every((seat) => state.players[seat].life === 39)).toBe(true)
  })

  test('Colossification attaches, taps, and pumps the creature', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [card('Bear', ['Creature'], { power: 2, toughness: 2 })],
        },
        hands: {
          p1: [card('Colossification', ['Enchantment'], {
            subtypes: ['Aura'],
            manaCost: '{5}{G}{G}',
          })],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 5 }
    const aura = named(ready, 'Colossification').id
    const bear = named(ready, 'Bear').id
    const entered = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: aura,
      targets: [{ kind: 'object', objectId: bear }],
    })))
    expect(entered.objects[aura].attachedTo).toBe(bear)
    expect(entered.objects[bear]).toMatchObject({
      tapped: true,
      power: 22,
      toughness: 22,
    })
  })

  test("Summon: Titan mills then returns lands on chapter II", () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Summon: Titan', ['Enchantment', 'Creature'], {
          subtypes: ['Saga', 'Giant'],
          manaCost: '{3}{G}{G}',
          oracleText: 'I — Mill five cards.\nII — Return all land cards from your graveyard to the battlefield tapped.\nIII — Until end of turn, another target creature you control gains trample and gets +X/+X, where X is the number of lands you control.',
        })] },
        libraries: {
          p1: [
            card('A', ['Instant']),
            card('B', ['Instant']),
            card('C', ['Instant']),
            card('D', ['Instant']),
            card('Buried Forest', ['Land']),
          ],
        },
      },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 3 }
    const titan = named(ready, 'Summon: Titan').id
    let state = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: titan }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[titan].counters.lore).toBe(1)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.graveyard).toHaveLength(5)
    state = { ...state, step: 'draw', active: 'p1', priority: 'p1' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.objects[titan].counters.lore).toBe(2)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(named(state, 'Buried Forest').zone).toBe('battlefield')
    expect(named(state, 'Buried Forest').tapped).toBe(true)
  })

  test('Icetill Explorer can play a land from the graveyard', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [card('Icetill Explorer', ['Creature'], { power: 2, toughness: 3 })] },
        libraries: {
          p1: [card('Yard Land', ['Land'], { zone: 'graveyard' })],
        },
      },
    )
    const land = named(server.state, 'Yard Land').id
    const played = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: land,
    }))
    expect(played.objects[land].zone).toBe('battlefield')
  })
})
