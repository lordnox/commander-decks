import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameState } from '../types'
import { targetOnResolve, type TargetFilter } from './effects'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const board = [
  cardTemplate('Wild Ox', { types: ['Creature'], power: 5, toughness: 5, manaValue: 4 }),
  cardTemplate('Tiny Elf', {
    types: ['Creature'],
    subtypes: ['Elf'],
    power: 1,
    toughness: 1,
    manaValue: 1,
  }),
  cardTemplate('Goblin Token', {
    types: ['Creature'],
    power: 2,
    toughness: 2,
    token: true,
    manaValue: 0,
  }),
  cardTemplate('Big Elemental', { types: ['Creature'], power: 7, toughness: 7, manaValue: 7 }),
  cardTemplate('Forest', {
    types: ['Land'],
    subtypes: ['Forest'],
    supertypes: ['Basic'],
  }),
  cardTemplate('Wastes', { types: ['Land'] }),
]

const probe = (filter: TargetFilter) => cardTemplate('Probe', {
  types: ['Instant'],
  effects: [targetOnResolve('select', filter)],
})

const setup = (filter: TargetFilter, overlay?: 'forestOverlay') => {
  const server = createServerGame(
    commanderRules,
    { hands: { p1: [probe(filter)] }, battlefield: { p2: board } },
    { random: () => 0.5, cardPlugins: [targetedResolve] },
  )
  const ready = structuredClone(server.state)
  if (overlay) {
    ready.rules.push({
      instanceId: 'overlay',
      pluginId: overlay,
      sourceId: null,
      timestamp: 99,
      params: {},
    })
  }
  const legal = (name: string) => server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Probe').id,
    targets: [{ kind: 'object', objectId: named(ready, name).id }],
  }).ok
  const offered = () => {
    const acts = legalActsFor(ready, 'p1').filter((action) =>
      action.kind === 'castSpell' && action.name === 'Probe')
    return acts.flatMap((action) => action.targetName ?? []).sort()
  }
  return { legal, offered }
}

describe('TargetFilter predicates', () => {
  test('nontoken rejects tokens and offers only card permanents', () => {
    const { legal, offered } = setup({ zone: 'battlefield', type: 'Creature', nontoken: true })
    expect(legal('Wild Ox')).toBe(true)
    expect(legal('Goblin Token')).toBe(false)
    expect(offered()).toEqual(['Big Elemental', 'Tiny Elf', 'Wild Ox'])
  })

  test('powerAtLeast needs the creature power to reach the threshold', () => {
    const { legal, offered } = setup({ zone: 'battlefield', type: 'Creature', powerAtLeast: 5 })
    expect(legal('Wild Ox')).toBe(true)
    expect(legal('Big Elemental')).toBe(true)
    expect(legal('Tiny Elf')).toBe(false)
    expect(legal('Forest')).toBe(false)
    expect(offered()).toEqual(['Big Elemental', 'Wild Ox'])
  })

  test('subtype matches printed subtypes', () => {
    const { legal } = setup({ zone: 'battlefield', subtype: 'Elf' })
    expect(legal('Tiny Elf')).toBe(true)
    expect(legal('Wild Ox')).toBe(false)
  })

  test('the Forest subtype honors the forest overlay for every land', () => {
    const filter = { zone: 'battlefield', subtype: 'Forest' } satisfies TargetFilter
    const plain = setup(filter)
    expect(plain.legal('Forest')).toBe(true)
    expect(plain.legal('Wastes')).toBe(false)
    const overlaid = setup(filter, 'forestOverlay')
    expect(overlaid.legal('Wastes')).toBe(true)
    expect(overlaid.legal('Wild Ox')).toBe(false)
  })

  test('manaValue eq, min, and max bound the mana value', () => {
    expect(setup({ zone: 'battlefield', type: 'Creature', manaValue: { eq: 4 } }).legal('Wild Ox'))
      .toBe(true)
    expect(setup({ zone: 'battlefield', type: 'Creature', manaValue: { eq: 4 } }).legal('Tiny Elf'))
      .toBe(false)
    const ranged = setup({ zone: 'battlefield', type: 'Creature', manaValue: { min: 1, max: 4 } })
    expect(ranged.legal('Tiny Elf')).toBe(true)
    expect(ranged.legal('Wild Ox')).toBe(true)
    expect(ranged.legal('Big Elemental')).toBe(false)
    expect(ranged.legal('Goblin Token')).toBe(false)
  })

  test('manaValue parity treats zero as even', () => {
    const even = setup({ zone: 'battlefield', type: 'Creature', manaValue: { parity: 'even' } })
    expect(even.legal('Wild Ox')).toBe(true)
    expect(even.legal('Goblin Token')).toBe(true)
    expect(even.legal('Tiny Elf')).toBe(false)
    expect(even.legal('Big Elemental')).toBe(false)
    const odd = setup({ zone: 'battlefield', type: 'Creature', manaValue: { parity: 'odd' } })
    expect(odd.legal('Tiny Elf')).toBe(true)
    expect(odd.legal('Big Elemental')).toBe(true)
    expect(odd.legal('Goblin Token')).toBe(false)
  })

  test('predicates combine', () => {
    const { legal } = setup({
      zone: 'battlefield',
      type: 'Creature',
      nontoken: true,
      powerAtLeast: 5,
      manaValue: { max: 5 },
    })
    expect(legal('Wild Ox')).toBe(true)
    expect(legal('Big Elemental')).toBe(false)
    expect(legal('Tiny Elf')).toBe(false)
  })

  test('an illegal cast is rejected with the targeting error', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [probe({ zone: 'battlefield', nontoken: true })] }, battlefield: { p2: board } },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const result = server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Probe').id,
      targets: [{ kind: 'object', objectId: named(server.state, 'Goblin Token').id }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('illegal target')
    expect(ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Probe').id,
      targets: [{ kind: 'object', objectId: named(server.state, 'Wild Ox').id }],
    })).stack).toHaveLength(1)
  })
})
