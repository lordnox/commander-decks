import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { addUntilCleanupRule, onResolve as onResolveEffect } from '../cardPlugins/effects'
import { onResolve } from '../cardPlugins/onResolve'
import { deckCardTemplate, loadCardPlugins } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import type { CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { resolveStack, ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'

const legacyFlashPlugins = await loadCardPlugins(["Alchemist's Refuge"])

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Grant Flash', {
            types: ['Instant'],
            manaCost: '{0}',
            manaValue: 0,
            effects: [onResolveEffect(addUntilCleanupRule('flashGrant'))],
          }),
          cardTemplate('Surprise Bear', { types: ['Creature'], manaCost: '{0}', manaValue: 0 }),
          cardTemplate('Surprise Sorcery', { types: ['Sorcery'], manaCost: '{0}', manaValue: 0 }),
        ],
        p2: [cardTemplate('Rival Bear', { types: ['Creature'], manaCost: '{0}', manaValue: 0 })],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolve] },
  )
  return server
}

const granted = () => {
  const server = game()
  const cast = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(server.state, 'Grant Flash').id,
  }))
  return { server, state: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const castOf = (server: ReturnType<typeof game>, state: GameState, name: string, seat = 'p1') =>
  server.rules(state, { type: 'castSpell', seat, objectId: named(state, name).id })

/** The opponent's combat, with p1 holding priority. */
const opponentsTurn = (state: GameState): GameState => ({
  ...structuredClone(state),
  active: 'p2',
  step: 'declareBlockers' as const,
  priority: 'p1',
})

describe('turn-long flash grant', () => {
  test('without the grant, a creature or sorcery cannot be cast off-turn', () => {
    const server = game()
    const state = opponentsTurn(server.state)
    expect(castOf(server, state, 'Surprise Bear'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    expect(castOf(server, state, 'Surprise Sorcery'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    expect(legalActsFor(state, 'p1').some((action) =>
      action.kind === 'castSpell' && action.name === 'Surprise Bear')).toBe(false)
  })

  test('the grant lets its controller cast non-instants outside their main phase', () => {
    const { server, state: afterGrant } = granted()
    expect(afterGrant.rules.find((rule) => rule.pluginId === 'flashGrant')?.params)
      .toMatchObject({ untilCleanup: true, controller: 'p1' })

    const offTurn = opponentsTurn(afterGrant)
    expect(legalActsFor(offTurn, 'p1').some((action) =>
      action.kind === 'castSpell' && action.name === 'Surprise Bear')).toBe(true)
    const bear = ok(castOf(server, offTurn, 'Surprise Bear'))
    expect(bear.stack[0]).toMatchObject({ name: 'Surprise Bear' })

    const combat = { ...structuredClone(afterGrant), step: 'beginCombat' as const }
    expect(castOf(server, combat, 'Surprise Sorcery').ok).toBe(true)
  })

  test('the grant lets a non-instant be cast with another spell on the stack', () => {
    const { server, state: afterGrant } = granted()
    const withRival = ok(server.rules(opponentsTurn(afterGrant), {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(afterGrant, 'Surprise Sorcery').id,
    }))
    expect(withRival.stack).toHaveLength(1)
    expect(castOf(server, withRival, 'Surprise Bear').ok).toBe(true)
  })

  test('the grant does not extend to other seats or to priority they lack', () => {
    const { server, state: afterGrant } = granted()
    const rival = { ...opponentsTurn(afterGrant), active: 'p1', priority: 'p2' }
    expect(castOf(server, rival, 'Rival Bear', 'p2'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    expect(legalActsFor(rival, 'p2').some((action) =>
      action.kind === 'castSpell' && action.name === 'Rival Bear')).toBe(false)

    const noPriority = { ...opponentsTurn(afterGrant), priority: 'p2' }
    expect(castOf(server, noPriority, 'Surprise Bear'))
      .toMatchObject({ ok: false, error: 'seat does not have priority' })
  })

  test('the grant ends at cleanup', () => {
    const { server, state: afterGrant } = granted()
    const ending = { ...structuredClone(afterGrant), step: 'end' as const }
    const cleanup = ok(server.rules(ending, { type: 'advanceStep' }))
    expect(cleanup.step).toBe('cleanup')
    expect(cleanup.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
    const nextTurn = ok(server.rules(cleanup, { type: 'advanceStep' }))

    const later = { ...opponentsTurn(nextTurn), priority: 'p1' }
    expect(castOf(server, later, 'Surprise Bear'))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
  })
})

// Preserve registered legacy execution until the canonical mechanic migration (#383).
describe('registered legacy cost and mana integration', () => {

  const refuge = () => deckCardTemplate("Alchemist's Refuge")
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
      { random: () => 0.5, cardPlugins: legacyFlashPlugins },
    )

  type Server = ReturnType<typeof game>

  const named = (state: GameState, name: string) =>
    Object.values(state.objects).filter((object) => object.name === name)

  const one = (state: GameState, name: string) => named(state, name)[0]

  const withPool = (state: GameState, pool: Partial<GameState['players']['p1']['mana']>) => {
    const next = structuredClone(state)
    next.players.p1.mana = { ...emptyMana(), ...pool }
    return next
  }

  const surprise = () => cardTemplate('Surprise Bear', {
    types: ['Creature'],
    manaCost: '{0}',
    manaValue: 0,
  })

  const opponentsCombat = (state: GameState) => ({
    ...structuredClone(state),
    active: 'p2',
    step: 'declareBlockers' as const,
    priority: 'p1',
  })

  describe("paid activation and controller-scoped flash duration", () => {
    const activateEvent = (state: GameState): GameEvent => ({
      type: 'activateAbility',
      seat: 'p1',
      objectId: one(state, "Alchemist's Refuge").id,
      abilityId: '$.abilities[1]',
    })
    const castOf = (server: Server, state: GameState) =>
      server.rules(state, { type: 'castSpell', seat: 'p1', objectId: one(state, 'Surprise Bear').id })

    test('its free tap adds {C} and grants nothing', () => {
      const server = game({ battlefield: [refuge()], hand: [surprise()] })
      const tapped = ok(server.rules(server.state, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(server.state, "Alchemist's Refuge").id,
      }))
      expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), C: 1 })
      expect(tapped.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
    })

    test('{G}{U}, {T} grants flash for the turn: paid, tapped, then a creature is cast off-turn', () => {
      const server = game({ battlefield: [refuge()], hand: [surprise()] })
      const off = opponentsCombat(server.state)
      expect(castOf(server, off))
        .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })

      const paid = withPool(server.state, { G: 1, U: 1 })
      const activated = ok(server.rules(paid, activateEvent(paid)))
      expect(activated.players.p1.mana).toEqual(emptyMana())
      expect(one(activated, "Alchemist's Refuge").tapped).toBe(true)
      // The grant waits on the stack and exists only once the ability resolves.
      expect(activated.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
      const granted = resolveStack(server.rules, activated)
      expect(granted.rules.find((rule) => rule.pluginId === 'flashGrant')?.params)
        .toMatchObject({ untilCleanup: true, controller: 'p1' })

      const bear = castOf(server, opponentsCombat(granted))
      expect(ok(bear).stack[0]).toMatchObject({ name: 'Surprise Bear' })
      expect(legalActsFor(opponentsCombat(granted), 'p1').some((act) =>
        act.kind === 'castSpell' && act.name === 'Surprise Bear')).toBe(true)
    })

    test('it needs both colors, an untapped Refuge, and its controller', () => {
      const server = game({ battlefield: [refuge()] })
      const noMana = server.rules(server.state, activateEvent(server.state))
      expect(noMana.ok).toBe(false)
      const wrongColors = withPool(server.state, { G: 2 })
      expect(server.rules(wrongColors, activateEvent(wrongColors)).ok).toBe(false)

      const paid = withPool(server.state, { G: 1, U: 1 })
      const tapped = ok(server.rules(paid, {
        type: 'tapForMana',
        seat: 'p1',
        objectId: one(paid, "Alchemist's Refuge").id,
      }))
      expect(server.rules(withPool(tapped, { G: 1, U: 1 }), activateEvent(tapped)).ok).toBe(false)

      expect(server.rules(paid, { ...activateEvent(paid), seat: 'p2' } as GameEvent).ok).toBe(false)
    })

    test('the grant is the controller\'s and ends at cleanup', () => {
      const server = game({ battlefield: [refuge()], hand: [surprise()] })
      const paid = withPool(server.state, { G: 1, U: 1 })
      const granted = resolveStack(server.rules, ok(server.rules(paid, activateEvent(paid))))

      const rival = { ...opponentsCombat(granted), active: 'p1', priority: 'p2' } as GameState
      expect(server.rules(rival, {
        type: 'castSpell',
        seat: 'p2',
        objectId: one(rival, 'Surprise Bear').id,
      }).ok).toBe(false)

      const ending = { ...structuredClone(granted), step: 'end' as const }
      const cleanup = ok(server.rules(ending, { type: 'advanceStep' }))
      expect(cleanup.step).toBe('cleanup')
      expect(cleanup.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
      const later = { ...opponentsCombat(ok(server.rules(cleanup, { type: 'advanceStep' }))), priority: 'p1' }
      expect(castOf(server, later as GameState))
        .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
    })
  })
})
