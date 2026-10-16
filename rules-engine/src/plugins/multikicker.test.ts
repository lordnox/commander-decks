import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { resolveStack } from '../testHelpers'
import type { GameEvent, GameState, ReduceResult } from '../types'
import {
  enters,
  multikicker,
  putChargeCountersFromTimesKicked,
} from '../cardPlugins/effects'

import {targetedResolve} from '../cardPlugins/targetedResolve'
const quartzCoil = () => cardTemplate('Quartz Coil', {
  types: ['Artifact'],
  manaCost: '{0}',
  effects: [
    multikicker('{1}'),
    enters(putChargeCountersFromTimesKicked()),
  ],
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

describe('multikicker', () => {
  test('multikicker(cost) builders are independent clones', () => {
    const first = multikicker('{1}')
    const second = multikicker('{2}')
    expect(first).not.toBe(second)
    expect(first).toEqual({ op: 'castCost', multikicker: '{1}' })
    expect(second).toEqual({ op: 'castCost', multikicker: '{2}' })
  })

  test('N=0 enters with no charge counters', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [quartzCoil()] } },
      { random: () => 0.5 },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.priority = 'p1'
    const spell = ready.zoneOrder.p1.hand[0]

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      timesKicked: 0,
    }))
    expect(cast.stack[0].timesKicked).toBe(0)
    expect(cast.stack[0].kicked).toBeUndefined()
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[spell].counters.charge).toBeUndefined()
    expect(resolved.objects[spell].enteredWithTimesKicked).toBe(0)
  })

  test('N=3 enters with three charge counters and spends the extra mana', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [quartzCoil()] } },
      { random: () => 0.5 },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 }
    const spell = ready.zoneOrder.p1.hand[0]

    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell,
      timesKicked: 3,
    }))
    expect(cast.stack[0]).toMatchObject({ timesKicked: 3, kicked: true })
    expect(cast.players.p1.mana.C).toBe(0)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[spell].counters.charge).toBe(3)
    expect(resolved.objects[spell].enteredWithTimesKicked).toBe(3)
  })

  test('legal actions expose each affordable multikicker count', () => {
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [quartzCoil()] } },
      { random: () => 0.5 },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 }
    const spell = ready.zoneOrder.p1.hand[0]
    const counts = legalActsFor(ready, 'p1')
      .filter((action) => action.kind === 'castSpell')
      .filter((action) => action.objectId === spell)
      .map((action) => action.timesKicked)
      .sort((left, right) => (left ?? 0) - (right ?? 0))
    expect(counts).toEqual([0, 1, 2])

    const kickedTwice = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === spell
      && action.timesKicked === 2)!
    const events = eventsForAvailableAction(ready, 'p1', kickedTwice)!
    const cast = run(server, ready, events)
    expect(cast.stack[0].timesKicked).toBe(2)
  })
})

describe('relocated from homerKeywordCosts.test.ts → multikicker.test.ts', () => {
  const card = (
    name: string,
    types: string[],
    extra: Parameters<typeof cardTemplate>[1] = {},
  ) => cardTemplate(name, { types, ...extra })

  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  const ok = (result: ReduceResult) => {
    if (!result.ok) throw new Error(result.error)
    return result.state
  }

  const run = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    events: GameEvent[],
  ) => events.reduce((current, event) => ok(server.rules(current, event)), state)

  test('Tear Asunder offers both costs, charges kicker, and uses the kicked target filter', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [card('Tear Asunder', ['Instant'], { manaCost: '{1}{G}' })],
          },
          battlefield: {
            p2: [
              card('Relic', ['Artifact']),
              card('Bear', ['Creature']),
            ],
          },
        },
        { random: () => 0.5, cardPlugins: [targetedResolve] },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 1, C: 2 }
      const spell = named(ready, 'Tear Asunder')
      const relic = named(ready, 'Relic')
      const bear = named(ready, 'Bear')
      const actions = legalActsFor(ready, 'p1')
        .filter((action) => action.kind === 'castSpell')
        .filter((action) => action.objectId === spell.id)

      expect(actions.some((action) =>
        action.kind === 'castSpell'
        && action.targetObjectId === relic.id
        && !action.kicked)).toBe(true)
      expect(actions.some((action) =>
        action.kind === 'castSpell'
        && action.targetObjectId === relic.id
        && action.kicked)).toBe(true)
      expect(actions.some((action) =>
        action.kind === 'castSpell'
        && action.targetObjectId === bear.id
        && action.kicked)).toBe(true)
      expect(actions.some((action) =>
        action.kind === 'castSpell'
        && action.targetObjectId === bear.id
        && !action.kicked)).toBe(false)

      const underfunded = structuredClone(ready)
      underfunded.players.p1.mana.B = 0
      underfunded.players.p1.mana.C = 1
      const illegal = server.rules(underfunded, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spell.id,
        targets: [{ kind: 'object', objectId: bear.id }],
        kicked: true,
      })
      expect(illegal.ok).toBe(false)
      expect(illegal.ok === false && illegal.error).toBe('not enough mana')

      const kicked = actions.find((action) =>
        action.kind === 'castSpell'
        && action.kicked
        && action.targetObjectId === bear.id)!
      const events = eventsForAvailableAction(ready, 'p1', kicked)!
      const cast = run(server, ready, events)
      expect(cast.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
      expect(cast.stack[0].kicked).toBe(true)

      const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
      expect(resolved.objects[bear.id].zone).toBe('exile')
      expect(resolved.objects[spell.id].zone).toBe('graveyard')
    })

})
