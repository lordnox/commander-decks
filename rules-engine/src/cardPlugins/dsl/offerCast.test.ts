import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { createJournal, recordAccepted, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import { onResolve as onResolveEffect, targetOnResolve } from '../effects'
import { onResolve } from '../onResolve'
import { targetedResolve } from '../targetedResolve'
import {
  card,
  chooseInstructions,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  draw,
  gainLife,
  offerCast,
  players,
  ref,
  select,
  SPELL_CAST_TIMING,
  spell,
  target,
} from './v1'

const definition = (maxManaValue: number) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ instructions: [offerCast({ maxManaValue, notLand: true })] }),
  ])))

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const testCard = (
  name: string,
  types: string[],
  manaCost: string,
  manaValue: number,
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, { types, manaCost, manaValue, ...extra })

const freeCaster = (types = ['Sorcery']) => testCard('Free Caster', types, '{0}', 0, {
  ruleDefinition: definition(5),
})

const game = (caster = freeCaster(), extraHand: ReturnType<typeof cardTemplate>[] = []) =>
  createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [
          caster,
          testCard('Cheap Bear', ['Creature'], '{2}{G}', 3),
          testCard('Big Beast', ['Creature'], '{4}{G}{G}', 6),
          testCard('Zero Trick', ['Instant'], '{0}', 0, {
            effects: [onResolveEffect({ kind: 'gainLife', count: 1 })],
          }),
          cardTemplate('Hand Land', { types: ['Land'] }),
          ...extraHand,
        ],
        p2: [testCard('Rival Bear', ['Creature'], '{1}', 1)],
      },
      battlefield: { p2: [cardTemplate('Rival Guard', { types: ['Creature'] })] },
    },
    { random: () => 0.5, cardPlugins: [onResolve, targetedResolve] },
  )

const castable = (state: GameState) =>
  legalActsFor(state, 'p1').flatMap(action =>
    action.kind === 'castSpell' ? [action.name] : [])

const offered = (server = game()) => {
  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Free Caster').id,
  }))
  return { server, state: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const castFree = (state: GameState, name: string, extra: object = {}) => ({
  type: 'castSpell' as const,
  seat: 'p1',
  objectId: named(state, name).id,
  alternativeCost: 'withoutPayingMana' as const,
  ...extra,
})

describe('canonical offerCast from a private hand', () => {
  test('offers every nonland card within the mana value cap, or a decline', () => {
    const { state } = offered()
    const acts = legalActsFor(state, 'p1')

    expect(acts.filter(action => action.kind === 'castSpell').map(action => action.name).sort())
      .toEqual(['Cheap Bear', 'Zero Trick'])
    expect(acts.every(action =>
      action.kind !== 'castSpell' || action.alternativeCost === 'withoutPayingMana')).toBe(true)
    expect(acts.find(action => action.kind === 'declineFreeCast'))
      .toMatchObject({ objectId: named(state, 'Free Caster').id, name: 'Free Caster' })
    expect(acts).toHaveLength(3)
  })

  test('casting the pick pays nothing, clears the offer, and the spell resolves normally', () => {
    const { server, state } = offered()
    expect(server.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const act = legalActsFor(state, 'p1').find(action =>
      action.kind === 'castSpell' && action.name === 'Cheap Bear')!
    const events = eventsForAvailableAction(state, 'p1', act)!
    expect(events).toEqual([castFree(state, 'Cheap Bear')])
    const cast = ok(server.rules(state, events[0]))

    expect(cast.stack[0]).toMatchObject({ name: 'Cheap Bear', castFrom: 'hand' })
    expect(cast.players.p1.mana).toEqual(state.players.p1.mana)
    expect(legalActsFor(cast, 'p1').some(action => action.kind === 'declineFreeCast')).toBe(false)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, 'Cheap Bear').zone).toBe('battlefield')
    expect(named(resolved, 'Zero Trick').zone).toBe('hand')
    expect(server.rules(resolved, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
  })

  test('the offer is optional', () => {
    const { server, state } = offered()
    const declined = ok(server.rules(state, {
      type: 'declineFreeCast',
      seat: 'p1',
      objectId: named(state, 'Free Caster').id,
    }))

    expect(server.rules(declined, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
    expect(named(declined, 'Cheap Bear').zone).toBe('hand')
    expect(named(declined, 'Free Caster').zone).toBe('graveyard')
    expect(server.rules(declined, castFree(declined, 'Cheap Bear')))
      .toMatchObject({ ok: false, error: 'card is not awaiting a free cast' })
  })

  test('rejects cards over the cap, lands, other zones, other seats, and plain casts', () => {
    const { server, state } = offered()
    const reject = (event: object) =>
      expect(server.rules(state, event as never)).toMatchObject({
        ok: false,
        error: 'card is not awaiting a free cast',
      })

    reject(castFree(state, 'Big Beast'))
    reject(castFree(state, 'Hand Land'))
    expect(server.rules(state, { ...castFree(state, 'Rival Bear'), seat: 'p2' }).ok).toBe(false)
    expect(server.rules(state, castFree(state, 'Free Caster')).ok).toBe(false)
    expect(server.rules(state, castFree(state, 'Rival Guard')).ok).toBe(false)
    expect(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Cheap Bear').id,
    }).ok).toBe(false)
    expect(server.rules(state, {
      type: 'declineFreeCast',
      seat: 'p1',
      objectId: named(state, 'Cheap Bear').id,
    })).toMatchObject({ ok: false, error: 'card is not awaiting a free cast' })
  })

  test('cast during resolution ignores sorcery timing', () => {
    const server = game(freeCaster(['Instant']))
    const theirTurn = structuredClone(server.state)
    theirTurn.active = 'p2'
    theirTurn.step = 'declareBlockers'
    theirTurn.priority = 'p1'
    const cast = ok(server.rules(theirTurn, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(theirTurn, 'Free Caster').id,
    }))
    const pending = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(pending.priority).toBe('p1')

    expect(legalActsFor(pending, 'p1').some(action =>
      action.kind === 'castSpell' && action.name === 'Cheap Bear')).toBe(true)
    const bear = ok(server.rules(pending, castFree(pending, 'Cheap Bear')))
    expect(bear.stack[0]).toMatchObject({ name: 'Cheap Bear' })
  })

  test('a targeted card is offered per target and keeps its target', () => {
    const bolt = testCard('Free Bolt', ['Instant'], '{R}', 1, {
      effects: [targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' })],
    })
    const { server, state } = offered(game(freeCaster(), [bolt]))
    const targeted = legalActsFor(state, 'p1').filter(action =>
      action.kind === 'castSpell' && action.name === 'Free Bolt')
    const guard = named(state, 'Rival Guard').id

    expect(targeted.map(action => action.kind === 'castSpell' && action.targetObjectId))
      .toContain(guard)
    const act = targeted.find(action =>
      action.kind === 'castSpell' && action.targetObjectId === guard)!
    const events = eventsForAvailableAction(state, 'p1', act)!
    const cast = ok(server.rules(state, events[0]))
    expect(cast.stack[0]).toMatchObject({ name: 'Free Bolt', targets: [{ kind: 'object', objectId: guard }] })
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, 'Rival Guard').zone).toBe('graveyard')
  })

  test('nothing is offered when no card in hand qualifies', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [freeCaster(), testCard('Big Beast', ['Creature'], '{6}', 6)] },
      },
      { random: () => 0.5 },
    )
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Free Caster').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(legalActsFor(resolved, 'p1').some(action => action.kind === 'declineFreeCast')).toBe(false)
    expect(server.rules(resolved, { type: 'passPriority', seat: 'p1' }).ok).toBe(true)
  })

  test('other seats learn nothing about the hand from the pending offer', () => {
    const { state } = offered()
    const opponent = JSON.stringify(projectForViewer(state, 'p2'))

    for (const name of ['Cheap Bear', 'Big Beast', 'Zero Trick', 'Hand Land']) {
      expect(opponent).not.toContain(name)
    }
    expect(legalActsFor(state, 'p2').some(action => action.kind === 'castSpell')).toBe(false)
  })

  test('the offer survives a journal restart', () => {
    const server = game()
    let journal = createJournal(server.state)
    for (const event of [
      { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Free Caster').id },
      { type: 'resolveTop' },
    ] as const) {
      journal = recordAccepted(journal, event)
    }
    const history = restoreJournal(journal, server.rules)
    const restored = history.current()

    expect(legalActsFor(restored, 'p1').map(action => action.kind).sort())
      .toEqual(['castSpell', 'castSpell', 'declineFreeCast'])
    expect(ok(server.rules(restored, castFree(restored, 'Zero Trick'))).stack[0])
      .toMatchObject({ name: 'Zero Trick' })
  })

  test('a draw that brings the only castable card opens the offer with it', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [cardTemplate('Draw Then Cast', {
          types: ['Sorcery'],
          manaCost: '{0}',
          manaValue: 0,
          ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
            spell({ instructions: [draw(1), offerCast({ maxManaValue: 5, notLand: true })] }),
          ]))),
        })] },
        libraries: { p1: [
          testCard('Drawn Bear', ['Creature'], '{2}{G}', 3),
          testCard('Drawn Land', ['Land'], '', 0, { types: ['Land'] }),
        ] },
      },
      { random: () => 0.5 },
    )
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Draw Then Cast').id,
    }))
    const state = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(state, 'Drawn Bear').zone).toBe('hand')
    expect(castable(state)).toEqual(['Drawn Bear'])
    expect(legalActsFor(state, 'p1').some(action => action.kind === 'declineFreeCast')).toBe(true)
  })
})

describe('later-turn exile offerCast', () => {
  test('the offered exile card is unavailable this turn and free next turn', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({ instructions: [offerCast({ zone: 'exile', laterTurn: true, notLand: true, timing: SPELL_CAST_TIMING.sorcery })] }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          testCard('Later Caster', ['Sorcery'], '{0}', 0, { ruleDefinition: definition }),
          testCard('Exile Bear', ['Creature'], '{2}{G}', 3),
        ],
      },
    }, { random: () => 0.5, cardPlugins: [onResolve, targetedResolve] })
    const bear = named(server.state, 'Exile Bear')
    const exiled = ok(server.rules(server.state, { type: 'move', objectId: bear.id, to: 'exile' }))
    const caster = named(exiled, 'Later Caster')
    const cast = ok(server.rules(exiled, { type: 'castSpell', seat: 'p1', objectId: caster.id }))
    const offered = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(legalActsFor(offered, 'p1').some(action => action.kind === 'declineFreeCast')).toBe(false)
    expect(server.rules(offered, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      alternativeCost: 'withoutPayingMana',
    }).ok).toBe(false)
    const later = { ...offered, turn: offered.turn + 1 }
    expect(legalActsFor(later, 'p1').some(action =>
      action.kind === 'castSpell' && action.objectId === bear.id)).toBe(true)
    const free = ok(server.rules(later, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      alternativeCost: 'withoutPayingMana',
    }))
    expect(free.objects[bear.id].zone).toBe('stack')
  })
})

describe('offerCast from a chosen opponent hand', () => {
  const stealDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({
      decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [chooseInstructions({
        chooser: target(0),
        options: [
          { label: 'Accept', instructions: [
            draw({ count: 1, targets: target(0) }),
            offerCast({ chooser: ref('controller'), from: target(0), notLand: true, inspect: true, takeControl: true }),
          ] },
          { label: 'Decline', instructions: [gainLife({ amount: 2, targets: ref('controller') })] },
        ],
      })],
    }),
  ])))

  const stealGame = () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: {
        p1: [testCard('Steal Caster', ['Sorcery'], '{0}', 0, { ruleDefinition: stealDefinition })],
        p2: [testCard('Rival Land', ['Land'], '', 0)],
      },
      libraries: { p2: [testCard('Drawn Rival Bear', ['Creature'], '{3}{G}', 4)] },
    }, { random: () => 0.5 })
    const cast = ok(server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Steal Caster').id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const state = ok(server.rules(cast, { type: 'resolveTop' }))
    return { server, state, pending: pendingOptionSelection(state, 'p2')! }
  }

  test('the targeted opponent chooses; declining runs only the other branch', () => {
    const { server, state, pending } = stealGame()
    expect(pending.seat).toBe('p2')
    const declined = ok(server.rules(state, { type: 'selectOption', seat: 'p2', selectionId: pending.id, optionId: pending.options[1].id }))
    expect(declined.players.p1.life).toBe(state.players.p1.life + 2)
    expect(declined.zoneOrder.p2.hand).toHaveLength(1)
    expect(legalActsFor(declined, 'p1').some(action => action.kind === 'declineFreeCast')).toBe(false)
  })

  test('accepting draws first, then the caster sees that hand and free-casts a nonland card under their control', () => {
    const { server, state, pending } = stealGame()
    const accepted = ok(server.rules(state, { type: 'selectOption', seat: 'p2', selectionId: pending.id, optionId: pending.options[0].id }))
    expect(named(accepted, 'Drawn Rival Bear').zone).toBe('hand')
    expect(castable(accepted)).toEqual(['Drawn Rival Bear'])
    expect(projectForViewer(accepted, 'p1').objects[named(accepted, 'Drawn Rival Bear').id]?.name).toBe('Drawn Rival Bear')
    expect(projectForViewer(accepted, 'p3').objects[named(accepted, 'Drawn Rival Bear').id]).toBeUndefined()

    const cast = ok(server.rules(accepted, castFree(accepted, 'Drawn Rival Bear')))
    expect(cast.stack[0]).toMatchObject({ name: 'Drawn Rival Bear', controller: 'p1' })
    expect(cast.players.p1.mana).toEqual(accepted.players.p1.mana)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, 'Drawn Rival Bear')).toMatchObject({ zone: 'battlefield', controller: 'p1', owner: 'p2' })
  })
})
