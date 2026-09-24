import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { cardDefinition } from './cardRules'
import { choiceEffects } from './choiceEffects'
import { librarySearch } from './librarySearch'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'
import { ward } from './ward'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const land = (name: string) => cardTemplate(name, { types: ['Land'] })
const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const plugins = [onResolve, targetedResolve, activated, choiceEffects, librarySearch, ward]

describe('Homer remaining card wiring', () => {
  test('Fact or Fiction uses a public opponent pile split', () => {
    expect(cardDefinition('Fact or Fiction')?.effects).toMatchObject([
      { op: 'trigger', do: [{ kind: 'opponentPiles', count: 5, reveal: 'public' }] },
    ])
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: { p1: [cardTemplate('Fact or Fiction', { types: ['Instant'], manaCost: '{3}{U}' })] },
        libraries: {
          p1: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Rest'].map((name) =>
            cardTemplate(name, { types: ['Instant'] })),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 3 }
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Fact or Fiction').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(pendingPlayerSelectionFor(resolved, 'p1')).toMatchObject({
      candidates: ['p2', 'p3', 'p4'],
      action: { kind: 'opponentPiles', count: 5 },
    })
  })

  test("Fortune's Favor looks privately and splits face-down and face-up", () => {
    expect(cardDefinition("Fortune's Favor")?.effects).toMatchObject([
      { op: 'targetedResolve', filter: { players: 'opponent' } },
    ])
  })

  test('Ripples of Undeath mills on first main then offers recover', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Ripples of Undeath', { types: ['Enchantment'] })],
        },
        libraries: {
          p1: ['Milled One', 'Milled Two', 'Milled Three', 'Rest'].map((name) =>
            cardTemplate(name, { types: ['Instant'] })),
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const atDraw = { ...server.state, step: 'draw' as const }
    const entered = ok(server.rules(atDraw, { type: 'advanceStep' }))
    expect(entered.stack[0]?.name).toBe('Ripples of Undeath')
    const funded = structuredClone(entered)
    funded.players.p1.mana.C = 1
    const resolved = ok(server.rules(funded, { type: 'resolveTop' }))
    expect(named(resolved, 'Milled One').zone).toBe('graveyard')
    const recover = pendingSelectionFor(resolved, 'p1')
    expect(recover?.candidates).toEqual([
      named(resolved, 'Milled One').id,
      named(resolved, 'Milled Two').id,
      named(resolved, 'Milled Three').id,
    ])
  })

  test('Victimize sacrifices then returns both targeted creatures tapped', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            cardTemplate('Victimize', { types: ['Sorcery'], manaCost: '{2}{B}' }),
            creature('Returned Bear'),
            creature('Returned Elk'),
          ],
        },
        battlefield: { p1: [creature('Fodder Goat')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 }
    ready = ok(server.rules(ready, {
      type: 'move',
      objectId: named(ready, 'Returned Bear').id,
      to: 'graveyard',
    }))
    ready = ok(server.rules(ready, {
      type: 'move',
      objectId: named(ready, 'Returned Elk').id,
      to: 'graveyard',
    }))
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Victimize').id,
      targets: [
        { kind: 'object', objectId: named(ready, 'Returned Bear').id },
        { kind: 'object', objectId: named(ready, 'Returned Elk').id },
      ],
    }))
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    const sacrificed = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'sacrifice',
      count: 1,
      objectIds: [named(choosing, 'Fodder Goat').id],
    }))
    expect(named(sacrificed, 'Fodder Goat').zone).toBe('graveyard')
    expect(named(sacrificed, 'Returned Bear')).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(named(sacrificed, 'Returned Elk')).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(selection.kind).toBe('sacrifice')
  })

  test("Black Sun's Twilight casts with zero creature targets", () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate("Black Sun's Twilight", { types: ['Sorcery'], manaCost: '{X}{B}' })] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 5 }
    const actions = legalActsFor(ready, 'p1').filter((action) =>
      action.kind === 'castSpell' && action.objectId === named(ready, "Black Sun's Twilight").id)
    expect(actions.some((action) => action.kind === 'castSpell' && !action.targetObjectId)).toBe(true)
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, "Black Sun's Twilight").id,
      x: 5,
      targets: [],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, "Black Sun's Twilight").zone).toBe('graveyard')
  })

  test('Lumra CDA equals controlled lands', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Lumra, Bellow of the Woods', {
              types: ['Creature'],
              power: null,
              toughness: null,
            }),
            land('Forest A'),
            land('Forest B'),
          ],
        },
      },
      { random: () => 0.5 },
    )
    const id = named(server.state, 'Lumra, Bellow of the Woods').id
    const synced = ok(server.rules(server.state, { type: 'custom', name: 'cdaLifePt.sync' }))
    expect([synced.objects[id].power, synced.objects[id].toughness]).toEqual([2, 2])
  })

  test('Roaming Throne stamps Ward {2}', () => {
    expect(cardDefinition('Roaming Throne')?.handlerIds).toContain('ward')
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [creature('Roaming Throne')],
        },
        hands: {
          p2: [cardTemplate('Test Hex', { types: ['Instant'], manaCost: '{C}' })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.priority = 'p2'
    ready.players.p2.mana.C = 3
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(ready, 'Test Hex').id,
      targets: [{ kind: 'object', objectId: named(ready, 'Roaming Throne').id }],
    }))
    expect(pendingDialog(cast)).toMatchObject({ kind: 'ward-pay', count: 2 })
  })

  test('Aftermath Analyst mills three on enter', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [creature('Aftermath Analyst', { manaCost: '{1}{G}' })],
        },
        libraries: {
          p1: ['One', 'Two', 'Three', 'Four'].map((name) =>
            cardTemplate(name, { types: ['Instant'] })),
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Aftermath Analyst').id,
    }))
    const entered = resolveStack(server.rules, ok(server.rules(cast, { type: 'resolveTop' })))
    expect(named(entered, 'One').zone).toBe('graveyard')
    expect(named(entered, 'Two').zone).toBe('graveyard')
    expect(named(entered, 'Three').zone).toBe('graveyard')
  })

  test('Zimone and Dina drain on the second draw', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [creature('Zimone and Dina')] },
        libraries: {
          p1: ['One', 'Two'].map((name) => cardTemplate(name, { types: ['Instant'] })),
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const first = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(first.stack).toHaveLength(0)
    const second = ok(server.rules(first, { type: 'draw', seat: 'p1' }))
    expect(pendingPlayerSelectionFor(second, 'p1')).toMatchObject({
      min: 1,
      max: 1,
      candidates: ['p2'],
    })
  })

  test('Malakir Rebirth returns the target if it dies this turn', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Malakir Rebirth', { types: ['Instant'], manaCost: '{B}' })] },
        battlefield: { p1: [creature('Watched Bear')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.B = 1
    const watched = named(ready, 'Watched Bear').id
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Malakir Rebirth').id,
      targets: [{ kind: 'object', objectId: watched }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife - 2)
    expect(resolved.delayedTriggers).toHaveLength(1)
    const died = ok(server.rules(resolved, { type: 'move', objectId: watched, to: 'graveyard' }))
    const returned = resolveStack(server.rules, died)
    expect(returned.objects[watched].zone).toBe('battlefield')
  })

  test('Life from the Loam targets up to three lands in the graveyard', () => {
    expect(cardDefinition('Life from the Loam')?.effects).toMatchObject([
      { op: 'dredge' },
      { op: 'targetedResolve', min: 0, max: 3, optional: true },
    ])
  })

  test('Mole Man plays graveyard lands and stamps mill on Moloids', () => {
    const effects = cardDefinition('Mole Man, Moloid Master')?.effects ?? []
    expect(effects.some((effect) => effect.op === 'static' && effect.playLandsFromGraveyard)).toBe(true)
    const token = effects.flatMap((effect) =>
      effect.op === 'trigger' && effect.on === 'landfall'
        ? effect.do.filter((step) => step.kind === 'createToken')
        : [])[0]
    expect(token?.kind === 'createToken' && token.token.effects).toMatchObject([
      { op: 'trigger', on: 'attacks' },
    ])
  })

  test('Forgotten Cellar is the unlock door, not a second Walk-In Closet', () => {
    expect(cardDefinition('Walk-In Closet')?.effects).toMatchObject([
      { op: 'static', playLandsFromGraveyard: true },
    ])
    expect(cardDefinition('Forgotten Cellar')?.effects).toMatchObject([
      { op: 'trigger', on: 'unlock' },
    ])
  })
})
