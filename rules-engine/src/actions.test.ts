import { describe, expect, test } from 'bun:test'
import {
  availableActions,
  eventsForAvailableAction,
  eventsForCombatDeclaration,
  legalActsFor,
  manaAffordances,
} from './actions'
import { commanderRules } from './formats'
import { bears, bolt, forest, newGame } from './newGame'
import type { ManaPool } from './types'

const empty = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } satisfies ManaPool

const objectNamed = (state: ReturnType<typeof newGame>, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('available actions', () => {
  test('an empty tapped-out priority window has no action', () => {
    const state = newGame(commanderRules, {
      hands: { p1: [bolt()] },
      battlefield: { p1: [{ ...forest(), tapped: true }] },
    })
    state.step = 'end'

    expect(availableActions(state, 'p1')).toEqual([])
  })

  test('folds available mana into affordable spells', () => {
    const state = newGame(commanderRules, {
      hands: { p1: [bears()] },
      battlefield: { p1: [forest(), { ...forest(), name: 'Second Forest' }] },
    })

    expect(availableActions(state, 'p1')).toContainEqual({
      kind: 'castSpell',
      objectId: objectNamed(state, 'Grizzly Bears').id,
      name: 'Grizzly Bears',
    })
  })

  test('does not mistake an untapped mana source for a meaningful action', () => {
    const state = newGame(commanderRules, {
      battlefield: { p1: [forest()] },
    })
    state.step = 'end'

    expect(availableActions(state, 'p1')).toEqual([])
  })

  test('offers declarative Ghost Town and fetchland abilities', () => {
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [
          { ...forest(), name: 'Ghost Town' },
          { ...forest(), name: 'Misty Rainforest', supertypes: [] },
        ],
      },
    })
    state.active = 'p2'
    state.priority = 'p1'
    state.step = 'end'

    expect(availableActions(state, 'p1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'activateAbility',
        name: 'Ghost Town',
        abilityId: 'selfBounceLand.ghostTown',
      }),
      expect.objectContaining({
        kind: 'activateAbility',
        name: 'Misty Rainforest',
        abilityId: 'librarySearch.fetch',
      }),
    ]))
  })

  test('untap and cleanup never expose priority actions', () => {
    const state = newGame(commanderRules, {
      hands: { p1: [bolt()] },
      battlefield: { p1: [forest()] },
    })
    state.step = 'untap'
    expect(availableActions(state, 'p1')).toEqual([])
    state.step = 'cleanup'
    expect(availableActions(state, 'p1')).toEqual([])
  })

  test('offers a land only during its controller main phase', () => {
    const state = newGame(commanderRules, { hands: { p1: [forest()] } })
    const land = objectNamed(state, 'Forest')

    expect(availableActions(state, 'p1')).toContainEqual({
      kind: 'playLand',
      objectId: land.id,
      name: 'Forest',
    })
    state.step = 'end'
    expect(availableActions(state, 'p1')).toEqual([])
  })

  test('a free fog is offered only once an attacker threatens damage', () => {
    const kami = {
      ...bears(),
      name: 'Kami of False Hope',
      manaCost: '{W}',
      oracleText:
        'Sacrifice Kami of False Hope: Prevent all combat damage that would be dealt this turn.',
    }
    const state = newGame(commanderRules, {
      battlefield: { p1: [kami], p2: [bears()] },
    })
    const attacker = Object.values(state.objects).find(
      (object) => object.controller === 'p2',
    )!
    state.active = 'p2'

    // Nothing is attacking yet, so a fog would interrupt every empty window.
    for (const step of ['upkeep', 'draw', 'beginCombat', 'declareAttackers'] as const) {
      state.step = step
      expect(availableActions(state, 'p1')).toEqual([])
    }

    attacker.attacking = 'p1'
    state.step = 'declareBlockers'
    expect(availableActions(state, 'p1')).toContainEqual({
      kind: 'activateAbility',
      objectId: objectNamed(state, 'Kami of False Hope').id,
      name: 'Kami of False Hope',
      text: kami.oracleText,
      abilityId: 'kami.fog',
    })

    // Damage is behind us; a later combat declares attackers again.
    state.step = 'postcombatMain'
    expect(availableActions(state, 'p1')).toEqual([])
  })

  test('offers attackers and only offers blockers to a defender', () => {
    const state = newGame(commanderRules, {
      battlefield: { p1: [bears()], p2: [bears()] },
    })
    state.step = 'declareAttackers'
    const attacker = objectNamed(state, 'Grizzly Bears')
    expect(availableActions(state, 'p1')).toContainEqual({
      kind: 'declareAttackers',
      objectIds: [attacker.id],
    })
    expect(legalActsFor(state, 'p1')).toContainEqual({
      kind: 'declareAttackers',
      objectIds: [attacker.id],
    })

    attacker.attacking = 'p2'
    attacker.tapped = true
    state.step = 'declareBlockers'
    state.priority = 'p2'
    expect(availableActions(state, 'p2').some((action) =>
      action.kind === 'declareBlockers')).toBe(true)
    expect(availableActions({ ...state, priority: 'p3' }, 'p3')).toEqual([])
  })

  test('offers a summoning-sick creature with haste as an attacker', () => {
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [
          { ...bears(), name: 'Rankle', oracleText: 'Flying, haste' },
          { ...bears(), name: 'Bear' },
        ],
      },
    })
    state.step = 'declareAttackers'
    const rankle = objectNamed(state, 'Rankle')
    const bear = objectNamed(state, 'Bear')
    rankle.summoningSickness = true
    bear.summoningSickness = true

    expect(availableActions(state, 'p1')).toContainEqual({
      kind: 'declareAttackers',
      objectIds: [rankle.id],
    })
  })

  test('publishes defender-specific attack taxes and builds one paid declaration', () => {
    const state = newGame(commanderRules, {
      battlefield: {
        p1: [bears(), forest()],
        p2: [{ ...bears(), name: 'Baird, Steward of Argive' }],
      },
    })
    const attacker = objectNamed(state, 'Grizzly Bears')
    attacker.summoningSickness = false
    state.step = 'declareAttackers'
    const action = legalActsFor(state, 'p1').find(
      (candidate) => candidate.kind === 'declareAttackers',
    )

    expect(action).toMatchObject({
      kind: 'declareAttackers',
      taxByDefender: { p2: 1 },
    })
    expect(eventsForCombatDeclaration(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p2' }],
    })).toEqual([{
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: attacker.id, defender: 'p2' }],
      payment: [{ objectId: objectNamed(state, 'Forest').id }],
    }])
  })

  test('a counterspell is not an action while the stack is empty', () => {
    const veto = {
      ...bolt(),
      name: "Dovin's Veto",
      types: ['Instant'],
      manaCost: '{W}{U}',
      oracleText: "This spell can't be countered.\nCounter target noncreature spell.",
    }
    const state = newGame(commanderRules, {
      hands: { p1: [veto] },
      battlefield: { p1: [forest(), { ...forest(), name: 'Second Forest' }] },
    })
    state.active = 'p2'
    state.step = 'end'
    state.players.p1.mana = { ...empty, W: 1, U: 1 }

    expect(availableActions(state, 'p1')).toEqual([])

    state.stack = [{
      id: 's1',
      kind: 'spell',
      objectId: 'other',
      controller: 'p2',
      name: 'Windfall',
      targets: [],
    }]
    expect(availableActions(state, 'p1').some((action) =>
      action.kind === 'castSpell' && action.name === "Dovin's Veto")).toBe(true)
  })

  test('accounts for commander tax', () => {
    const commander = {
      ...bears(),
      name: 'Taxed Commander',
      tags: ['commander'],
      zone: 'command' as const,
    }
    const state = newGame(commanderRules, {
      command: { p1: [commander] },
      battlefield: { p1: [forest(), { ...forest(), name: 'Second Forest' }] },
    })
    const card = objectNamed(state, 'Taxed Commander')
    state.players.p1.data.commanderTax = { [card.id]: 2 }

    expect(availableActions(state, 'p1')).toEqual([])
    state.players.p1.mana = { ...empty, G: 1, C: 3 }
    expect(availableActions(state, 'p1').some((action) =>
      action.kind === 'castSpell' && action.objectId === card.id)).toBe(true)
  })
})

describe('events for available actions', () => {
  test('a land play is directly executable', () => {
    const state = newGame(commanderRules, { hands: { p1: [forest()] } })
    const action = availableActions(state, 'p1').find(
      (candidate) => candidate.kind === 'playLand',
    )!

    expect(eventsForAvailableAction(state, 'p1', action)).toEqual([{
      type: 'playLand',
      seat: 'p1',
      objectId: objectNamed(state, 'Forest').id,
    }])
  })

  test('a choice-free permanent gets the shortest mana line', () => {
    const state = newGame(commanderRules, {
      hands: { p1: [bears()] },
      battlefield: { p1: [forest(), { ...forest(), name: 'Second Forest' }] },
    })
    const action = availableActions(state, 'p1').find(
      (candidate) => candidate.kind === 'castSpell',
    )!
    const events = eventsForAvailableAction(state, 'p1', action)!

    expect(events.filter((event) => event.type === 'tapForMana')).toHaveLength(2)
    expect(events.at(-1)).toEqual({
      type: 'castSpell',
      seat: 'p1',
      objectId: objectNamed(state, 'Grizzly Bears').id,
    })
  })

  test('instants and permanents with entry choices stay with the judge', () => {
    const state = newGame(commanderRules, {
      hands: {
        p1: [
          bolt(),
          {
            ...bears(),
            name: 'Choice Creature',
            oracleText: 'As Choice Creature enters, choose a color.',
          },
        ],
      },
      battlefield: {
        p1: [
          forest(),
          { ...forest(), name: 'Second Forest' },
          { ...forest(), name: 'Third Forest' },
        ],
      },
    })
    state.players.p1.mana = { ...empty, R: 1 }
    const actions = availableActions(state, 'p1')

    expect(eventsForAvailableAction(
      state,
      'p1',
      actions.find((action) => action.name === 'Lightning Bolt')!,
    )).toBeNull()
    expect(eventsForAvailableAction(
      state,
      'p1',
      actions.find((action) => action.name === 'Choice Creature')!,
    )).toBeNull()
  })

  test('a supported one-target spell carries its chosen target through the fast path', () => {
    const reanimate = {
      ...bolt(),
      name: 'Reanimate',
      types: ['Sorcery'],
      manaCost: '{B}',
      oracleText: 'Put target creature card from a graveyard onto the battlefield under your control.',
    }
    const target = { ...bears(), name: 'Graveyard Creature' }
    const state = newGame(commanderRules, {
      hands: { p1: [reanimate], p2: [target] },
    })
    const targetObject = objectNamed(state, 'Graveyard Creature')
    targetObject.zone = 'graveyard'
    state.zoneOrder.p2.hand = []
    state.zoneOrder.p2.graveyard = [targetObject.id]
    state.players.p1.mana = { ...empty, B: 1 }

    const action = legalActsFor(state, 'p1').find(
      (candidate) => candidate.kind === 'castSpell',
    )
    expect(action).toMatchObject({
      kind: 'castSpell',
      name: 'Reanimate',
      targetName: 'Graveyard Creature',
      targetObjectId: objectNamed(state, 'Graveyard Creature').id,
    })
    expect(eventsForAvailableAction(state, 'p1', action!).at(-1)).toEqual({
      type: 'castSpell',
      seat: 'p1',
      objectId: objectNamed(state, 'Reanimate').id,
      targets: [{
        kind: 'object',
        objectId: objectNamed(state, 'Graveyard Creature').id,
      }],
    })
  })

  test('a spell whose only choice happens on resolution uses the fast path', () => {
    const fact = {
      ...bolt(),
      name: 'Fact or Fiction',
      types: ['Instant'],
      manaCost: '{3}{U}',
      oracleText: 'Reveal the top five cards of your library. An opponent separates those cards '
        + 'into two piles. Put one pile into your hand and the other into your graveyard.',
    }
    const state = newGame(commanderRules, { hands: { p1: [fact] } })
    state.players.p1.mana = { ...empty, U: 1, C: 3 }

    const action = legalActsFor(state, 'p1').find(
      (candidate) => candidate.kind === 'castSpell' && candidate.name === 'Fact or Fiction',
    )

    expect(action).toBeDefined()
    expect(eventsForAvailableAction(state, 'p1', action!).at(-1)).toEqual({
      type: 'castSpell',
      seat: 'p1',
      objectId: objectNamed(state, 'Fact or Fiction').id,
    })
  })

  // Scapeshift's sacrifice happens on resolution, so nothing about casting it
  // needs a choice and the fast path can send it straight to the stack.
  test('a spell whose only choices happen on resolution stays fast-castable', () => {
    const scapeshift = {
      ...bolt(),
      name: 'Scapeshift',
      types: ['Sorcery'],
      manaCost: '{2}{G}{G}',
      oracleText: 'Sacrifice any number of lands. Search your library for up to that many '
        + 'land cards, put them onto the battlefield tapped, then shuffle.',
    }
    const state = newGame(commanderRules, { hands: { p1: [scapeshift] } })
    state.players.p1.mana = { ...empty, G: 2, C: 2 }
    const action = availableActions(state, 'p1').find(
      (candidate) => candidate.kind === 'castSpell' && candidate.name === 'Scapeshift',
    )!

    expect(eventsForAvailableAction(state, 'p1', action)?.at(-1)).toEqual({
      type: 'castSpell',
      seat: 'p1',
      objectId: objectNamed(state, 'Scapeshift').id,
    })
  })
})

describe('mana affordances', () => {
  test('an untapped forest can be tapped without counting as a stop', () => {
    const state = newGame(commanderRules, {
      battlefield: { p1: [forest()] },
    })
    state.step = 'end'
    const land = objectNamed(state, 'Forest')

    expect(availableActions(state, 'p1')).toEqual([])
    expect(manaAffordances(state, 'p1')).toEqual([{
      kind: 'tapForMana',
      objectId: land.id,
      name: 'Forest',
    }])
    expect(eventsForAvailableAction(state, 'p1', manaAffordances(state, 'p1')[0])).toEqual([{
      type: 'tapForMana',
      seat: 'p1',
      objectId: land.id,
    }])
  })

  test('a land play remains executable from legalActsFor', () => {
    const state = newGame(commanderRules, { hands: { p1: [forest()] } })
    const land = objectNamed(state, 'Forest')

    expect(legalActsFor(state, 'p1')).toContainEqual({
      kind: 'playLand',
      objectId: land.id,
      name: 'Forest',
    })
  })
})
