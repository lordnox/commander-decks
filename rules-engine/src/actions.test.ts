import { describe, expect, test } from 'bun:test'
import { availableActions, eventsForAvailableAction, legalActsFor, manaAffordances } from './actions'
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

    attacker.attacking = 'p2'
    attacker.tapped = true
    state.step = 'declareBlockers'
    state.priority = 'p2'
    expect(availableActions(state, 'p2').some((action) =>
      action.kind === 'declareBlockers')).toBe(true)
    expect(availableActions({ ...state, priority: 'p3' }, 'p3')).toEqual([])
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
