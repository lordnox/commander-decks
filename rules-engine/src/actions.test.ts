import { describe, expect, test } from 'bun:test'
import { availableActions } from './actions'
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

  test('keeps a non-mana activated ability as a possible response', () => {
    const kami = {
      ...bears(),
      name: 'Kami of False Hope',
      manaCost: '{W}',
      oracleText:
        'Sacrifice Kami of False Hope: Prevent all combat damage that would be dealt this turn.',
    }
    const state = newGame(commanderRules, { battlefield: { p1: [kami] } })
    state.step = 'beginCombat'

    expect(availableActions(state, 'p1')).toContainEqual({
      kind: 'activateAbility',
      objectId: objectNamed(state, 'Kami of False Hope').id,
      name: 'Kami of False Hope',
      text: kami.oracleText,
    })
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
