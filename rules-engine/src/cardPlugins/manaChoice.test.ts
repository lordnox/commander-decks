import { describe, expect, test } from 'bun:test'
import { legalActsFor, availableActions, eventsForAvailableAction } from '../actions'
import { deckCardTemplate } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { createJournal, restoreJournal } from '../journal'
import { cardTemplate, forest } from '../newGame'
import type { CardTemplate } from '../newGame'
import { manaModes } from '../plugins/mana'
import { pendingOptionSelection } from '../rules/selectOptions'
import { createServerGame } from '../runtime'
import { resolveStack, ok } from '../testHelpers'
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
  test.each(['W', 'U', 'B', 'R', 'G'] as const)('catalog Firdoch Core taps for the chosen mana color %s', color => {
    const server = game([deckCardTemplate('Firdoch Core')])
    const core = named(server.state, 'Firdoch Core')
    const result = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: core.id, mana: color })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players.p1.mana[color]).toBe(1)
      expect(result.state.objects[core.id].tapped).toBe(true)
    }
  })
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

    const restarted = restoreJournal(createJournal(opened), server.rules).current()
    expect(pendingOptionSelection(restarted, 'p1')?.id).toBe(pending.id)

    expect(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'RR',
    }).ok).toBe(false)
    expect(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'UU',
    }).ok).toBe(false)
    expect(server.rules(restarted, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const resolved = ok(server.rules(restarted, {
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

describe('registered legacy cost and mana integration', () => {

  const floodedGrove = () => deckCardTemplate('Flooded Grove')
  const waterloggedGrove = () => deckCardTemplate('Waterlogged Grove')
  const signet = () => deckCardTemplate('Simic Signet')
  const island = () => deckCardTemplate('Island')
  const game = (options: {
    hand?: CardTemplate[]
    battlefield?: CardTemplate[]
    library?: number
    opponent?: CardTemplate[]
  }) =>
    createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: options.hand ?? [] },
        battlefield: { p1: options.battlefield ?? [], p2: options.opponent ?? [] },
        libraries: {
          p1: Array.from({ length: options.library ?? 12 }, (_, index) => cardTemplate(`Library ${index}`)),
        },
      },
      { random: () => 0.5 },
    )

  type Server = ReturnType<typeof game>

  const named = (state: GameState, name: string) =>
    Object.values(state.objects).filter((object) => object.name === name)

  const one = (state: GameState, name: string) => named(state, name)[0]

  const run = (server: Server, state: GameState, events: GameEvent[]) =>
    events.reduce((current, event) => ok(server.rules(current, event)), state)

  const withPool = (state: GameState, pool: Partial<GameState['players']['p1']['mana']>) => {
    const next = structuredClone(state)
    next.players.p1.mana = { ...emptyMana(), ...pool }
    return next
  }

  const castActs = (state: GameState, name: string) =>
    legalActsFor(state, 'p1').filter((act) =>
      act.kind === 'castSpell' && act.name === name)

  describe('hybrid-cost filter land', () => {
    const filter = (state: GameState, choices?: string[]): GameEvent => ({
      type: 'activateAbility',
      seat: 'p1',
      objectId: one(state, 'Flooded Grove').id,
      abilityId: '$.abilities[1]',
      manaAbility: true,
      ...(choices ? { choices } : {}),
    })

    test('a free tap adds {C}', () => {
      const server = game({ battlefield: [floodedGrove()] })
      const tapped = ok(server.rules(server.state, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(server.state, 'Flooded Grove').id,
      }))
      expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), C: 1 })
    })

    test.each([
      ['GG', { G: 2 }],
      ['UG', { G: 1, U: 1 }],
      ['UU', { U: 2 }],
    ])('{G/U}, {T} filters into %s', (choice, pool) => {
      for (const paid of ['G', 'U'] as const) {
        const server = game({ battlefield: [floodedGrove()] })
        const state = withPool(server.state, { [paid]: 1 })
        const next = ok(server.rules(state, filter(state, [choice])))
        expect(next.players.p1.mana).toEqual({ ...emptyMana(), ...pool })
        expect(one(next, 'Flooded Grove').tapped).toBe(true)
      }
    })

    test('it cannot filter without {G} or {U}, with another color, or into an unprinted pool', () => {
      const server = game({ battlefield: [floodedGrove()] })
      expect(server.rules(server.state, filter(server.state, ['GG'])).ok).toBe(false)
      const red = withPool(server.state, { R: 1 })
      expect(server.rules(red, filter(red, ['GG'])).ok).toBe(false)
      const green = withPool(server.state, { G: 1 })
      expect(server.rules(green, filter(green, ['RR'])).ok).toBe(false)
      expect(server.rules(green, filter(green, ['GGG'])).ok).toBe(false)
    })

    test('the planner turns an Island into {G}{G} for a {G}{G} spell', () => {
      const spell = cardTemplate('Planner Spell', { types: ['Creature'], manaCost: '{G}{G}' })
      const server = game({ battlefield: [floodedGrove(), island()], hand: [spell] })
      const act = castActs(server.state, 'Planner Spell')[0]
      const events = eventsForAvailableAction(server.state, 'p1', act)!
      expect(events.map((event) => event.type)).toEqual(['tapForMana', 'activateAbility', 'castSpell'])
      expect(one(run(server, server.state, events), 'Planner Spell').zone).toBe('stack')
    })
  })

  describe('life-paid mana and sacrifice-to-draw costs', () => {
    const draw = (state: GameState): GameEvent => ({
      type: 'activateAbility',
      seat: 'p1',
      objectId: one(state, 'Waterlogged Grove').id,
      abilityId: '$.abilities[0]',
    })

    test.each(['G', 'U'] as const)('{T}, pay 1 life adds {%s}', (mana) => {
      const server = game({ battlefield: [waterloggedGrove()] })
      const next = ok(server.rules(server.state, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(server.state, 'Waterlogged Grove').id,
        mana,
      }))
      const resolved = resolveStack(server.rules, next)
      expect(resolved.players.p1.mana).toEqual({ ...emptyMana(), [mana]: 1 })
      expect(resolved.players.p1.life).toBe(server.state.players.p1.life - 1)
    })

    test('it makes no colorless mana, and no mana at 0 life', () => {
      const server = game({ battlefield: [waterloggedGrove()] })
      expect(server.rules(server.state, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(server.state, 'Waterlogged Grove').id,
        mana: 'C',
      }).ok).toBe(false)
      const dead = structuredClone(server.state)
      dead.players.p1.life = 0
      expect(server.rules(dead, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(dead, 'Waterlogged Grove').id,
        mana: 'G',
      }).ok).toBe(false)
    })

    test('{1}, {T}, sacrifice it: draw a card', () => {
      const server = game({ battlefield: [waterloggedGrove()] })
      const paid = withPool(server.state, { C: 1 })
      const handBefore = paid.zoneOrder.p1.hand.length
      const activated = ok(server.rules(paid, draw(paid)))
      expect(one(activated, 'Waterlogged Grove').zone).toBe('graveyard')
      expect(activated.players.p1.mana).toEqual(emptyMana())
      const drawn = resolveStack(server.rules, activated)
      expect(drawn.zoneOrder.p1.hand.length).toBe(handBefore + 1)
    })

    test('the draw needs {1} and an untapped land', () => {
      const server = game({ battlefield: [waterloggedGrove()] })
      expect(server.rules(server.state, draw(server.state)).ok).toBe(false)
      const tapped = ok(server.rules(server.state, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(server.state, 'Waterlogged Grove').id,
        mana: 'G',
      }))
      expect(server.rules(withPool(tapped, { C: 1 }), draw(tapped)).ok).toBe(false)
    })
  })

  describe('generic-cost two-color mana ability', () => {
    const filter = (state: GameState): GameEvent => ({
      type: 'activateAbility',
      seat: 'p1',
      objectId: one(state, 'Simic Signet').id,
      abilityId: '$.abilities[0]',
      manaAbility: true,
    })

    test('{1}, {T} adds {G}{U}', () => {
      const server = game({ battlefield: [signet()] })
      const paid = withPool(server.state, { C: 1 })
      const next = ok(server.rules(paid, filter(paid)))
      expect(next.players.p1.mana).toEqual({ ...emptyMana(), G: 1, U: 1 })
      expect(one(next, 'Simic Signet').tapped).toBe(true)
    })

    test('it is not a free tap and needs its {1}', () => {
      const server = game({ battlefield: [signet()] })
      expect(server.rules(server.state, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(server.state, 'Simic Signet').id,
      }).ok).toBe(false)
      expect(server.rules(server.state, filter(server.state)).ok).toBe(false)
    })

    test('an untapped Signet cannot be activated twice', () => {
      const server = game({ battlefield: [signet()] })
      const paid = withPool(server.state, { C: 2 })
      const once = ok(server.rules(paid, filter(paid)))
      expect(server.rules(once, filter(once)).ok).toBe(false)
    })

    test('the planner pays {1} from a land to cast a {G}{U} spell', () => {
      const spell = cardTemplate('Planner Spell', { types: ['Creature'], manaCost: '{G}{U}' })
      const server = game({ battlefield: [signet(), island()], hand: [spell] })
      const events = eventsForAvailableAction(server.state, 'p1', castActs(server.state, 'Planner Spell')[0])!
      expect(events.map((event) => event.type)).toEqual(['tapForMana', 'activateAbility', 'castSpell'])
      expect(one(run(server, server.state, events), 'Planner Spell').zone).toBe('stack')
    })
  })
})
