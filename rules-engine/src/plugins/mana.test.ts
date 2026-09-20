import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { rules } from '../kernel'
import { bears, forest, newGame } from '../testGame'
import type { GameState, ReduceResult } from '../types'
import { lands } from './lands'
import { mana } from './mana'
import { manaBurn } from './manaBurn'
import { damage } from './damage'
import { life } from './life'

const catalog = createCatalog([mana, lands, manaBurn])

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const idOf = (state: GameState, name: string, zone: string) =>
  Object.values(state.objects).find((object) => object.name === name && object.zone === zone)!.id

const base = () =>
  newGame({
    builtinRules: ['mana', 'lands'],
    hands: { p1: [forest()] },
    battlefield: { p1: [forest()], p2: [forest()] },
  })

describe('mana', () => {
  test('tapping a battlefield Forest adds {G} and taps it', () => {
    const state = base()
    const objectId = idOf(state, 'Forest', 'battlefield')
    const next = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog))
    expect(next.players.p1.mana.G).toBe(1)
    expect(next.objects[objectId].tapped).toBe(true)
    expect(next.players.p2.mana.G).toBe(0)
  })

  test('tapping an already tapped permanent fails', () => {
    const state = base()
    const objectId = idOf(state, 'Forest', 'battlefield')
    const tapped = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog))
    const result = rules(tapped, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('already tapped')
  })

  test('tapping a permanent you do not control fails', () => {
    const state = base()
    const objectId = Object.values(state.objects).find(
      (object) => object.zone === 'battlefield' && object.controller === 'p2',
    )!.id
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('does not control')
  })

  test('tapping a card in hand fails', () => {
    const state = base()
    const objectId = idOf(state, 'Forest', 'hand')
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not on the battlefield')
  })

  test('a permanent without a mana ability cannot be tapped for mana', () => {
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [bears()] } })
    const objectId = idOf(state, 'Grizzly Bears', 'battlefield')
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no mana ability')
  })

  test('Phial of Galadriel produces the chosen color without judge fallback', () => {
    const phial = {
      ...bears(),
      name: 'Phial of Galadriel',
      types: ['Artifact'],
      oracleText: '{T}: Add one mana of any color.',
      tapProduces: undefined,
    }
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [phial] } })
    const objectId = idOf(state, 'Phial of Galadriel', 'battlefield')

    const missingChoice = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(missingChoice.ok).toBe(false)
    expect(missingChoice.ok === false && missingChoice.error).toContain('needs a mana color')

    const next = ok(rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'U',
    }, catalog))
    expect(next.players.p1.mana.U).toBe(1)
    expect(next.objects[objectId].tapped).toBe(true)
  })

  test('a bounce land taps for both of its printed symbols', () => {
    const chamber = {
      ...forest(),
      name: 'Simic Growth Chamber',
      oracleText: "This land enters tapped.\nWhen this land enters, return a land you control"
        + " to its owner's hand.\n{T}: Add {G}{U}.",
      tapProduces: { G: 1 },
    }
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [chamber] } })
    const objectId = idOf(state, 'Simic Growth Chamber', 'battlefield')
    const next = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog))
    expect(next.players.p1.mana.G).toBe(1)
    expect(next.players.p1.mana.U).toBe(1)
  })

  test('a dual land can be tapped for either printed color', () => {
    const pool = {
      ...forest(),
      name: 'Breeding Pool',
      oracleText: '({T}: Add {G} or {U}.)\nAs this land enters, you may pay 2 life.'
        + " If you don't, it enters tapped.",
      tapProduces: { G: 1 },
    }
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [pool] } })
    const objectId = idOf(state, 'Breeding Pool', 'battlefield')
    const blue = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId, mana: 'U' }, catalog))
    expect(blue.players.p1.mana).toMatchObject({ G: 0, U: 1 })
    const green = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId, mana: 'G' }, catalog))
    expect(green.players.p1.mana).toMatchObject({ G: 1, U: 0 })
  })

  test('a triome offers all three of its colors', () => {
    const triome = {
      ...forest(),
      name: 'Zagoth Triome',
      oracleText: '({T}: Add {B}, {G}, or {U}.)\nThis land enters tapped.',
      tapProduces: { B: 1 },
    }
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [triome] } })
    const objectId = idOf(state, 'Zagoth Triome', 'battlefield')
    for (const mana of ['B', 'G', 'U'] as const) {
      const next = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId, mana }, catalog))
      expect(next.players.p1.mana[mana]).toBe(1)
    }
    const red = rules(state, { type: 'tapForMana', seat: 'p1', objectId, mana: 'R' }, catalog)
    expect(red.ok).toBe(false)
  })

  test('a summoning sick mana creature cannot be tapped', () => {
    const state = newGame({
      builtinRules: ['mana'],
      hands: { p1: [{ ...bears(), tapProduces: { G: 1 } }] },
    })
    const objectId = idOf(state, 'Grizzly Bears', 'hand')
    const entered = ok(rules(state, { type: 'move', objectId, to: 'battlefield' }, catalog))
    expect(entered.objects[objectId].summoningSickness).toBe(true)
    const result = rules(entered, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('summoning sickness')
  })

  test('haste permits a summoning sick mana creature to tap without removing sickness', () => {
    const state = newGame({
      builtinRules: ['mana'],
      hands: {
        p1: [{
          ...bears(),
          oracleText: 'Haste\n{T}: Add {G}.',
          tapProduces: { G: 1 },
        }],
      },
    })
    const objectId = idOf(state, 'Grizzly Bears', 'hand')
    const entered = ok(rules(state, { type: 'move', objectId, to: 'battlefield' }, catalog))
    const tapped = ok(rules(entered, { type: 'tapForMana', seat: 'p1', objectId }, catalog))

    expect(tapped.objects[objectId]).toMatchObject({
      tapped: true,
      summoningSickness: true,
    })
    expect(tapped.players.p1.mana.G).toBe(1)
  })

  test('addMana fills only the named seat, emptyManaPools clears everyone', () => {
    const state = base()
    const added = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2, C: 1 } }, catalog))
    expect(added.players.p1.mana.R).toBe(2)
    expect(added.players.p1.mana.C).toBe(1)
    const p2Added = ok(rules(added, { type: 'addMana', seat: 'p2', mana: { U: 1 } }, catalog))
    const emptied = ok(rules(p2Added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    expect(emptied.players.p2.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  })

  test.each([
    ['Adarkar Wastes', 'W', 'U'],
    ['Caves of Koilos', 'W', 'B'],
    ['Underground River', 'U', 'B'],
  ] as const)('%s damages you only when it produces colored mana', (name, first, second) => {
    const wastes = {
      ...forest(),
      name,
      subtypes: [],
      supertypes: [],
      oracleText: `{T}: Add {C}.\n{T}: Add {${first}} or {${second}}. `
        + 'This land deals 1 damage to you.',
      tapProduces: { C: 1 },
    }
    const catalogWithDamage = createCatalog([mana, lands, manaBurn, damage, life])
    const state = newGame({
      builtinRules: ['mana', 'damage', 'life'],
      battlefield: { p1: [wastes] },
    })
    const objectId = idOf(state, name, 'battlefield')
    const colorless = ok(rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalogWithDamage))
    expect(colorless.players.p1.mana.C).toBe(1)
    expect(colorless.players.p1.life).toBe(40)

    const colored = ok(rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: second,
    }, catalogWithDamage))
    expect(colored.players.p1.mana[second]).toBe(1)
    expect(colored.players.p1.life).toBe(39)
  })

  test('Arcane Signet uses the generic commander-identity mana path', () => {
    const signet = {
      ...bears(),
      name: 'Arcane Signet',
      types: ['Artifact'],
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      tapProduces: undefined,
    }
    const eva = {
      ...bears(),
      name: 'Lady Evangela',
      colors: ['W', 'U', 'B'],
      tags: ['commander'],
    }
    const state = newGame({
      builtinRules: ['mana'],
      battlefield: { p1: [signet] },
      command: { p1: [eva] },
    })
    const objectId = idOf(state, 'Arcane Signet', 'battlefield')

    const black = ok(rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'B',
    }, catalog))
    expect(black.players.p1.mana.B).toBe(1)
    expect(rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'R',
    }, catalog).ok).toBe(false)
  })

  test("Command Tower produces only the commander's identity colors", () => {
    const tower = {
      ...forest(),
      name: 'Command Tower',
      subtypes: [],
      supertypes: [],
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      tapProduces: undefined,
    }
    const eva = {
      ...bears(),
      name: 'Lady Evangela',
      manaCost: '{W}{U}{B}',
      colors: ['W', 'U', 'B'],
      tags: ['commander'],
    }
    const state = newGame({
      builtinRules: ['mana'],
      battlefield: { p1: [tower] },
      command: { p1: [eva] },
    })
    const objectId = idOf(state, 'Command Tower', 'battlefield')
    const missing = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalog)
    expect(missing.ok).toBe(false)
    expect(missing.ok === false && missing.error).toContain('identity')

    const blue = ok(rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'U',
    }, catalog))
    expect(blue.players.p1.mana.U).toBe(1)

    const red = rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'R',
    }, catalog)
    expect(red.ok).toBe(false)
  })

  test('Mana Confluence pays 1 life for any color and refuses at 0 life', () => {
    const confluence = {
      ...forest(),
      name: 'Mana Confluence',
      subtypes: [],
      supertypes: [],
      oracleText: '{T}, Pay 1 life: Add one mana of any color.',
      tapProduces: undefined,
    }
    const catalogWithLife = createCatalog([mana, lands, manaBurn, damage, life])
    const state = newGame({
      builtinRules: ['mana', 'damage', 'life'],
      battlefield: { p1: [confluence] },
    })
    const objectId = idOf(state, 'Mana Confluence', 'battlefield')
    const missing = rules(state, { type: 'tapForMana', seat: 'p1', objectId }, catalogWithLife)
    expect(missing.ok).toBe(false)

    const blue = ok(rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'U',
    }, catalogWithLife))
    expect(blue.players.p1.mana.U).toBe(1)
    expect(blue.players.p1.life).toBe(39)

    const broke = structuredClone(state)
    broke.players.p1.life = 0
    expect(rules(broke, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'U',
    }, catalogWithLife).ok).toBe(false)
  })

  test('Cabal Coffers does not free-tap for {B}', () => {
    const coffers = {
      ...forest(),
      name: 'Cabal Coffers',
      subtypes: [],
      supertypes: [],
      oracleText: '{2}, {T}: Add {B} for each Swamp you control.',
      tapProduces: undefined,
    }
    const state = newGame({ builtinRules: ['mana'], battlefield: { p1: [coffers] } })
    const objectId = idOf(state, 'Cabal Coffers', 'battlefield')
    const result = rules(state, { type: 'tapForMana', seat: 'p1', objectId, mana: 'B' }, catalog)
    expect(result.ok).toBe(false)
  })

  test('emptying pools without manaBurn costs no life', () => {
    const state = base()
    const added = ok(rules(state, { type: 'addMana', seat: 'p1', mana: { R: 2 } }, catalog))
    const emptied = ok(rules(added, { type: 'emptyManaPools' }, catalog))
    expect(emptied.players.p1.life).toBe(40)
  })
})
