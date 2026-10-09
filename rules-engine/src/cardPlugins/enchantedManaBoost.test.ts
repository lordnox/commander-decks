import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate, forest, type CardTemplate } from '../newGame'
import { pendingOptionSelection } from '../rules/selectOptions'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { chosenColor } from './chosenColor'
import {
  activate,
  addManaChoice,
  chooseColorOnEnter,
  enchantedManaBoost,
  handlerIdsFromEffects,
  pluginIdsFromEffects,
  staticGrant,
} from './effects'
import { manaChoice } from './manaChoice'

const wildGrowth = (): CardTemplate => cardTemplate('Test Wild Growth', {
  types: ['Enchantment'],
  subtypes: ['Aura'],
  manaCost: '{G}',
  oracleText:
    'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
  effects: [enchantedManaBoost({ mana: 'G' })],
})

const utopiaSprawl = (): CardTemplate => cardTemplate('Test Utopia Sprawl', {
  types: ['Enchantment'],
  subtypes: ['Aura'],
  manaCost: '{G}',
  oracleText:
    'Enchant Forest\nAs this Aura enters, choose a color.\n'
    + 'Whenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
  effects: [chooseColorOnEnter(), enchantedManaBoost({ chosenColor: true })],
})

const island = (): CardTemplate => cardTemplate('Island', {
  types: ['Land'],
  subtypes: ['Island'],
  supertypes: ['Basic'],
  tapProduces: { U: 1 },
  oracleText: '{T}: Add {U}.',
})

const bears = (): CardTemplate => cardTemplate('Test Bears', {
  types: ['Creature'],
  subtypes: ['Bear'],
})

const game = (hand: CardTemplate[], battlefield: CardTemplate[]) =>
  createServerGame(
    commanderRules,
    { hands: { p1: hand }, battlefield: { p1: battlefield } },
    { random: () => 0.5, cardPlugins: [activated, chosenColor, manaChoice] },
  )

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const castActs = (state: GameState, name: string) =>
  legalActsFor(state, 'p1').filter((act) =>
    act.kind === 'castSpell' && act.objectId === named(state, name).id)

/** Cast the Aura on `targetId` through the live action layer and let it resolve. */
const castThroughActions = (
  server: ReturnType<typeof game>,
  state: GameState,
  name: string,
  targetId: string,
) => {
  const act = castActs(state, name).find((candidate) =>
    candidate.kind === 'castSpell' && candidate.targetObjectId === targetId)!
  const events = eventsForAvailableAction(state, 'p1', act)!
  const cast = events.reduce(
    (current: GameState, event: GameEvent) => ok(server.rules(current, event)),
    state,
  )
  return resolveStack(server.rules, cast)
}

describe('capability wiring', () => {
  test('effects name the plugins and handlers a host has to load', () => {
    const effects = [chooseColorOnEnter(), enchantedManaBoost({ chosenColor: true })]
    expect(pluginIdsFromEffects(effects)).toEqual(['enchantedManaBoost'])
    expect(handlerIdsFromEffects(effects)).toContain('chosenColor')
    expect(handlerIdsFromEffects([activate({
      id: 'filter',
      manaAbility: true,
      costs: { mana: '{G/U}', tap: true },
      do: [addManaChoice({ G: 2 }, { U: 2 })],
    })])).toEqual(expect.arrayContaining(['activated', 'manaChoice']))
  })
})

describe('Aura casting through the action layer', () => {
  test('offers one cast per legal enchant target and none for illegal ones', () => {
    const server = game([utopiaSprawl()], [forest(), island(), bears()])
    const targets = castActs(server.state, 'Test Utopia Sprawl')
      .map((act) => act.kind === 'castSpell' ? act.targetName : undefined)
    expect(targets).toEqual(['Forest'])

    const land = game([wildGrowth()], [forest(), island(), bears()])
    expect(castActs(land.state, 'Test Wild Growth')
      .map((act) => act.kind === 'castSpell' ? act.targetName : undefined))
      .toEqual(['Forest', 'Island'])
  })

  test.each(['Enchant player', 'Enchant opponent', 'Enchant artifact or creature'])(
    '%s is not parsed, so the Aura stays castable',
    (line) => {
      const aura = cardTemplate('Test Curse', {
        types: ['Enchantment'],
        subtypes: ['Aura', 'Curse'],
        manaCost: '{G}',
        oracleText: line,
      })
      const server = game([aura], [])
      server.state.players.p1.mana.G = 1
      expect(availableActions(server.state, 'p1')).toContainEqual(
        expect.objectContaining({ kind: 'castSpell', name: 'Test Curse' }),
      )
    },
  )

  test('Enchant creature Auras are offered per creature', () => {
    const aura = cardTemplate('Test Pacifism', {
      types: ['Enchantment'],
      subtypes: ['Aura'],
      manaCost: '{G}',
      oracleText: 'Enchant creature',
    })
    const server = game([aura], [forest(), bears()])
    expect(castActs(server.state, 'Test Pacifism')
      .map((act) => act.kind === 'castSpell' ? act.targetName : undefined))
      .toEqual(['Test Bears'])
  })

  test('an Aura with nothing to enchant is not offered', () => {
    const server = game([utopiaSprawl()], [island(), forest()])
    server.state.objects[named(server.state, 'Forest').id].zone = 'exile'
    expect(castActs(server.state, 'Test Utopia Sprawl')).toEqual([])
  })

  test('a cast without a target is not planned, and the kernel rejects it', () => {
    const server = game([wildGrowth()], [forest()])
    const aura = named(server.state, 'Test Wild Growth')
    server.state.players.p1.mana.G = 1
    expect(eventsForAvailableAction(server.state, 'p1', {
      kind: 'castSpell',
      objectId: aura.id,
      name: aura.name,
    })).toBeNull()
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: aura.id,
    }).ok).toBe(false)
  })

  test('the kernel rejects an illegal enchant target', () => {
    const server = game([utopiaSprawl()], [island(), bears(), forest()])
    server.state.players.p1.mana.G = 1
    const aura = named(server.state, 'Test Utopia Sprawl')
    for (const wrong of ['Island', 'Test Bears']) {
      const result = server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: aura.id,
        targets: [{ kind: 'object', objectId: named(server.state, wrong).id }],
      })
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain('must enchant a forest')
    }
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: aura.id,
      targets: [{ kind: 'object', objectId: named(server.state, 'Forest').id }],
    }).ok).toBe(true)
  })

  test('an enchanted overlay Forest counts as a Forest', () => {
    const server = game([utopiaSprawl()], [
      island(),
      cardTemplate('Test Yavimaya', { types: ['Land'], effects: [staticGrant('forestOverlay')] }),
    ])
    expect(castActs(server.state, 'Test Utopia Sprawl')
      .map((act) => act.kind === 'castSpell' ? act.targetName : undefined))
      .toEqual(['Island', 'Test Yavimaya'])
  })

  test('an Aura whose target left before it resolves does not enter', () => {
    const server = game([wildGrowth()], [forest()])
    const land = named(server.state, 'Forest')
    const act = castActs(server.state, 'Test Wild Growth')[0]
    server.state.players.p1.mana.G = 1
    const cast = eventsForAvailableAction(server.state, 'p1', act)!
      .reduce((current: GameState, event) => ok(server.rules(current, event)), server.state)
    const gone = ok(server.rules(cast, { type: 'move', objectId: land.id, to: 'graveyard' }))
    const resolved = resolveStack(server.rules, gone)
    expect(named(resolved, 'Test Wild Growth').zone).toBe('graveyard')
  })
})

describe('Aura mana boost', () => {
  test('Wild Growth adds an extra {G} when the enchanted land is tapped, and only that land', () => {
    const server = game([wildGrowth()], [forest(), forest()])
    const [enchanted, other] = server.state.zoneOrder.p1.battlefield
    server.state.players.p1.mana.G = 1
    const entered = castThroughActions(server, server.state, 'Test Wild Growth', enchanted)
    expect(named(entered, 'Test Wild Growth')).toMatchObject({
      zone: 'battlefield',
      attachedTo: enchanted,
    })

    const boosted = ok(server.rules(entered, { type: 'tapForMana', seat: 'p1', objectId: enchanted }))
    expect(boosted.players.p1.mana.G).toBe(2)
    const plain = ok(server.rules(entered, { type: 'tapForMana', seat: 'p1', objectId: other }))
    expect(plain.players.p1.mana.G).toBe(1)
  })

  test('the boost also follows a {T} mana ability of the enchanted land', () => {
    const filter = cardTemplate('Test Filter Land', {
      types: ['Land'],
      oracleText: '{G/U}, {T}: Add {G}{G}, {G}{U}, or {U}{U}.',
      effects: [
        activate({
          id: 'filter.grove',
          manaAbility: true,
          costs: { mana: '{G/U}', tap: true },
          do: [addManaChoice({ G: 2 }, { U: 2 })],
        }),
      ],
    })
    const server = game([wildGrowth()], [forest(), filter])
    const filterId = named(server.state, 'Test Filter Land').id
    server.state.players.p1.mana.G = 1
    const entered = castThroughActions(server, server.state, 'Test Wild Growth', filterId)
    entered.players.p1.mana.U = 1
    const next = ok(server.rules(entered, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: filterId,
      abilityId: 'filter.grove',
      manaAbility: true,
      choices: ['UU'],
    }))
    expect(next.players.p1.mana).toMatchObject({ U: 2, G: 1 })
  })

  test('the boost ends when the enchanted land leaves and the Aura goes with it', () => {
    const server = game([wildGrowth()], [forest()])
    const land = server.state.zoneOrder.p1.battlefield[0]
    server.state.players.p1.mana.G = 1
    const entered = castThroughActions(server, server.state, 'Test Wild Growth', land)
    const gone = ok(server.rules(entered, { type: 'move', objectId: land, to: 'graveyard' }))
    expect(named(gone, 'Test Wild Growth').zone).toBe('graveyard')
    expect(gone.rules.some((rule) => rule.pluginId === 'enchantedManaBoost')).toBe(false)
  })

  test('two Auras on one land each add a mana', () => {
    const server = game([wildGrowth(), wildGrowth()], [forest()])
    const land = server.state.zoneOrder.p1.battlefield[0]
    const [first, second] = server.state.zoneOrder.p1.hand
    server.state.players.p1.mana.G = 2
    let state = server.state
    for (const auraId of [first, second]) {
      const act = legalActsFor(state, 'p1').find((candidate) =>
        candidate.kind === 'castSpell' && candidate.objectId === auraId)!
      state = resolveStack(server.rules, eventsForAvailableAction(state, 'p1', act)!
        .reduce((current: GameState, event) => ok(server.rules(current, event)), state))
    }
    const tapped = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: land }))
    expect(tapped.players.p1.mana.G).toBe(3)
  })
})

describe('Utopia Sprawl style chosen color', () => {
  const enterWithChoice = () => {
    const server = game([utopiaSprawl()], [forest(), island()])
    const land = named(server.state, 'Forest').id
    server.state.players.p1.mana.G = 1
    const entered = castThroughActions(server, server.state, 'Test Utopia Sprawl', land)
    return { server, entered, land }
  }

  test('opens a private color choice as the Aura enters and stores the pick', () => {
    const { server, entered } = enterWithChoice()
    const pending = pendingOptionSelection(entered, 'p1')!
    expect(pending.options.map(({ id }) => id)).toEqual(['W', 'U', 'B', 'R', 'G'])
    expect(server.project(entered, 'p1').players.p1.data['kernel.pendingOptionSelection'])
      .toBeDefined()
    expect(server.project(entered, 'p2').players.p1.data['kernel.pendingOptionSelection'])
      .toBeUndefined()
    expect(server.rules(entered, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    expect(server.rules(entered, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'C',
    }).ok).toBe(false)
    expect(server.rules(entered, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'U',
    }).ok).toBe(false)

    const chosen = ok(server.rules(entered, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'U',
    }))
    expect(named(chosen, 'Test Utopia Sprawl').chosenColor).toBe('U')
    expect(pendingOptionSelection(chosen)).toBeUndefined()
  })

  test('tapping the enchanted Forest adds the chosen color, once chosen', () => {
    const { server, entered, land } = enterWithChoice()
    const pending = pendingOptionSelection(entered, 'p1')!
    expect(server.rules(entered, { type: 'tapForMana', seat: 'p1', objectId: land }).ok).toBe(false)

    const chosen = ok(server.rules(entered, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'R',
    }))
    const tapped = ok(server.rules(chosen, { type: 'tapForMana', seat: 'p1', objectId: land }))
    expect(tapped.players.p1.mana).toMatchObject({ G: 1, R: 1 })
  })

  test('an enchanted overlay Forest is boosted too', () => {
    const server = game([utopiaSprawl()], [
      cardTemplate('Test Yavimaya', {
        types: ['Land'],
        tapProduces: { G: 1 },
        oracleText: '{T}: Add {G}.',
        effects: [staticGrant('forestOverlay')],
      }),
      island(),
    ])
    const islandId = named(server.state, 'Island').id
    server.state.players.p1.mana.G = 1
    const entered = castThroughActions(server, server.state, 'Test Utopia Sprawl', islandId)
    const chosen = ok(server.rules(entered, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pendingOptionSelection(entered, 'p1')!.id,
      optionId: 'B',
    }))
    const tapped = ok(server.rules(chosen, { type: 'tapForMana', seat: 'p1', objectId: islandId }))
    expect(tapped.players.p1.mana).toMatchObject({ U: 1, B: 1 })
  })
})
