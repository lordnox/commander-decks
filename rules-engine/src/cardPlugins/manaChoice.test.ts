import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate, forest, type CardTemplate } from '../newGame'
import { manaModes } from '../plugins/mana'
import { pendingOptionSelection } from '../rules/selectOptions'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { activate, addManaChoice } from './effects'
import { activatedManaOptions, manaChoice } from './manaChoice'

const GROVE_TEXT = '{T}: Add {C}.\n{G/U}, {T}: Add {G}{G}, {G}{U}, or {U}{U}.'

const grove = (): CardTemplate => cardTemplate('Test Filter Land', {
  types: ['Land'],
  oracleText: GROVE_TEXT,
  tapProduces: { C: 1 },
  effects: [activate({
    id: 'filter.grove',
    manaAbility: true,
    costs: { mana: '{G/U}', tap: true },
    do: [addManaChoice({ G: 2 }, { G: 1, U: 1 }, { U: 2 })],
  })],
})

const island = (): CardTemplate => cardTemplate('Island', {
  types: ['Land'],
  subtypes: ['Island'],
  supertypes: ['Basic'],
  tapProduces: { U: 1 },
  oracleText: '{T}: Add {U}.',
})

const signet = (name = 'Test Signet'): CardTemplate => cardTemplate(name, {
  types: ['Artifact'],
  manaCost: '{2}',
  oracleText: '{1}, {T}: Add {B}{G}.',
})

const spell = (manaCost: string) => cardTemplate('Planner Spell', {
  types: ['Creature'],
  manaCost,
})

const game = (battlefield: CardTemplate[], hand: CardTemplate[] = []) =>
  createServerGame(
    commanderRules,
    { battlefield: { p1: battlefield }, hands: { p1: hand } },
    { random: () => 0.5, cardPlugins: [activated, manaChoice] },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const run = (
  server: ReturnType<typeof game>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

describe('costed mana abilities are not free modes', () => {
  test('a filter land taps for {C} only; its costed clause is not a tap mode', () => {
    expect(manaModes({ oracleText: GROVE_TEXT })).toEqual([{ C: 1 }])
  })

  test('an unlisted Signet gives no free mana', () => {
    const state = game([signet()]).state
    expect(manaModes(named(state, 'Test Signet'))).toEqual([])
    const result = game([signet()]).rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: named(state, 'Test Signet').id,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no mana ability')
  })

  test('life and tap costs stay free, mill and other-sacrifice costs do not', () => {
    expect(manaModes({ oracleText: '{T}, Pay 1 life: Add {G} or {U}.' }))
      .toEqual([{ G: 1 }, { U: 1 }])
    expect(manaModes({ oracleText: '{T}, Mill a card: Add {C}.' })).toEqual([])
    expect(manaModes({ oracleText: 'Sacrifice a creature: Add {C}{C}.' })).toEqual([])
  })

  test('an ability-word prefix does not hide a free tap ability', () => {
    expect(manaModes({
      oracleText: 'Genomic Enhancement — {T}: Add one mana of any color.',
    })).toHaveLength(5)
  })

  test('a land with a basic land type taps for it even without printed text (Dryad Arbor)', () => {
    expect(manaModes({
      oracleText: '(Dryad Arbor is a Forest and has "{T}: Add {G}" only through its type.)',
      types: ['Land', 'Creature'],
      subtypes: ['Forest', 'Dryad'],
    })).toEqual([{ G: 1 }])
  })

  test("a Land Saga taps for {C} once chapter I's lore counter is there (Urza's Saga)", () => {
    const saga = {
      oracleText: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\n'
        + 'I — This Saga gains "{T}: Add {C}."\n'
        + 'II — This Saga gains "{2}, {T}: Create a Construct token."\n'
        + 'III — Search your library for an artifact card.',
      types: ['Land'],
      subtypes: ["Urza's", 'Saga'],
    }
    expect(manaModes({ ...saga, counters: {} })).toEqual([])
    expect(manaModes({ ...saga, counters: { lore: 1 } })).toEqual([{ C: 1 }])
    expect(manaModes({ ...saga, counters: { lore: 2 } })).toEqual([{ C: 1 }])
  })

  test('reminder text that merely quotes a mana ability gives no mana', () => {
    expect(manaModes({
      oracleText: 'Prototype {1}{G}\n(It has "{T}: Add {C}." as an example.)',
      types: ['Artifact', 'Creature'],
      subtypes: ['Golem'],
    })).toEqual([])
  })

  test('bare tapForMana on the filter land adds {C} and cannot pick the filtered colors', () => {
    const server = game([grove()])
    const objectId = named(server.state, 'Test Filter Land').id
    const tapped = ok(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId }))
    expect(tapped.players.p1.mana).toMatchObject({ C: 1, G: 0, U: 0 })
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId,
      mana: 'G',
    }).ok).toBe(false)
  })
})

const saga = (lore: number) => cardTemplate("Test Urza's Saga", {
  types: ['Land'],
  subtypes: ["Urza's", 'Saga'],
  counters: lore > 0 ? { lore } : {},
  oracleText: 'I — This Saga gains "{T}: Add {C}."\nIII — Search your library for an artifact card.',
})

describe('a Land Saga that gains a mana ability', () => {
  test('taps for {C} once it has its lore counter, not before', () => {
    const before = game([saga(0)])
    const objectId = named(before.state, "Test Urza's Saga").id
    expect(before.rules(before.state, { type: 'tapForMana', seat: 'p1', objectId }).ok).toBe(false)
    const after = game([saga(1)])
    const tapped = ok(after.rules(after.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: named(after.state, "Test Urza's Saga").id,
    }))
    expect(tapped.players.p1.mana.C).toBe(1)
  })
})

describe('activated mana abilities with a choice of pool', () => {
  test('the costed ability is a plannable option per pool, hybrid cost included', () => {
    const state = game([grove()]).state
    expect(activatedManaOptions(state, named(state, 'Test Filter Land')).map((option) => ({
      cost: option.cost,
      choice: option.choice,
      pool: option.pool,
    }))).toEqual([
      { cost: '{G/U}', choice: 'GG', pool: { G: 2 } },
      { cost: '{G/U}', choice: 'UG', pool: { G: 1, U: 1 } },
      { cost: '{G/U}', choice: 'UU', pool: { U: 2 } },
    ])
  })

  test('activating with a named pool pays the hybrid cost and adds that pool', () => {
    const server = game([grove()])
    const objectId = named(server.state, 'Test Filter Land').id
    server.state.players.p1.mana.U = 1
    const next = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId,
      abilityId: 'filter.grove',
      manaAbility: true,
      choices: ['GG'],
    }))
    expect(next.players.p1.mana).toMatchObject({ U: 0, G: 2 })
    expect(next.objects[objectId].tapped).toBe(true)
    expect(pendingOptionSelection(next)).toBeUndefined()
  })

  test('the hybrid cost can be paid with either of its colors', () => {
    const server = game([grove()])
    const objectId = named(server.state, 'Test Filter Land').id
    for (const paid of ['G', 'U'] as const) {
      const state = structuredClone(server.state)
      state.players.p1.mana[paid] = 1
      const next = ok(server.rules(state, {
        type: 'activateAbility',
        seat: 'p1',
        objectId,
        abilityId: 'filter.grove',
        manaAbility: true,
        choices: ['UU'],
      }))
      expect(next.players.p1.mana).toMatchObject({ [paid]: 0, U: 2 })
    }
  })

  test('an unaffordable or unoffered activation is rejected', () => {
    const server = game([grove()])
    const objectId = named(server.state, 'Test Filter Land').id
    const filter = (choices: string[]) => server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId,
      abilityId: 'filter.grove',
      manaAbility: true,
      choices,
    })
    expect(filter(['GG']).ok).toBe(false)
    server.state.players.p1.mana.R = 1
    expect(filter(['GG']).ok).toBe(false)
    server.state.players.p1.mana.G = 1
    expect(filter(['RR']).ok).toBe(false)
    expect(filter(['GG']).ok).toBe(true)
  })

  test('without a named pool the controller chooses privately and the pick resolves', () => {
    const server = game([grove()])
    const objectId = named(server.state, 'Test Filter Land').id
    server.state.players.p1.mana.G = 1
    const opened = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId,
      abilityId: 'filter.grove',
      manaAbility: true,
    }))
    const pending = pendingOptionSelection(opened, 'p1')!
    expect(pending.options.map(({ id, label }) => `${id}:${label}`)).toEqual([
      'GG:{G}{G}',
      'UG:{U}{G}',
      'UU:{U}{U}',
    ])
    expect(opened.players.p1.mana.G).toBe(0)
    expect(server.project(opened, 'p1').players.p1.data['kernel.pendingOptionSelection'])
      .toBeDefined()
    expect(server.project(opened, 'p2').players.p1.data['kernel.pendingOptionSelection'])
      .toBeUndefined()

    expect(server.rules(opened, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'RR',
    }).ok).toBe(false)
    expect(server.rules(opened, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'UU',
    }).ok).toBe(false)
    expect(server.rules(opened, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const resolved = ok(server.rules(opened, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'UG',
    }))
    expect(resolved.players.p1.mana).toMatchObject({ G: 1, U: 1 })
    expect(pendingOptionSelection(resolved)).toBeUndefined()
  })
})

describe('the action planner uses the same mana abilities', () => {
  const cast = (server: ReturnType<typeof game>) => {
    const objectId = named(server.state, 'Planner Spell').id
    const action = availableActions(server.state, 'p1').find((candidate) =>
      candidate.kind === 'castSpell' && candidate.objectId === objectId)
    return action ? eventsForAvailableAction(server.state, 'p1', action) : null
  }

  test('a filter land turns one Forest into {U}{U} to cast a {U}{U} spell', () => {
    const server = game([forest(), grove()], [spell('{U}{U}')])
    const events = cast(server)!
    expect(events.map((event) => event.type)).toEqual([
      'tapForMana',
      'activateAbility',
      'castSpell',
    ])
    const next = run(server, server.state, events)
    expect(named(next, 'Planner Spell').zone).toBe('stack')
    expect(next.players.p1.mana.U).toBe(0)
  })

  test('the free {C} tap is preferred when it already pays', () => {
    const server = game([grove()], [spell('{1}')])
    expect(cast(server)!.map((event) => event.type)).toEqual(['tapForMana', 'castSpell'])
  })

  test('a filter land cannot fund colored mana without something to filter', () => {
    const server = game([grove()], [spell('{U}{U}')])
    expect(cast(server)).toBeNull()
  })

  test('a listed Signet funds a spell by paying {1} from another land', () => {
    const server = game(
      [forest(), cardTemplate('Dimir Signet', {
        types: ['Artifact'],
        manaCost: '{2}',
        oracleText: '{1}, {T}: Add {U}{B}.',
      })],
      [spell('{U}{B}')],
    )
    const events = cast(server)!
    expect(events.map((event) => event.type)).toEqual([
      'tapForMana',
      'activateAbility',
      'castSpell',
    ])
    expect(named(run(server, server.state, events), 'Planner Spell').zone).toBe('stack')
  })

  test('an unlisted Signet funds nothing', () => {
    const server = game([forest(), signet()], [spell('{B}{G}')])
    expect(cast(server)).toBeNull()
  })

  test('two sources and a filter land can chain into one cast', () => {
    const server = game([forest(), island(), grove()], [spell('{G}{U}{U}')])
    const events = cast(server)!
    const next = run(server, server.state, events)
    expect(named(next, 'Planner Spell').zone).toBe('stack')
  })
})
