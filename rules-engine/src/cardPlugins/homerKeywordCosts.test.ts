import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { pendingSelectionFor } from '../rules/selectCards'
import { targetedResolve } from './targetedResolve'

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

describe('Homer keyword casting costs', () => {
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
      .filter((action) => action.kind === 'castSpell' && action.objectId === spell.id)

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

  test('Price of Fame only reduces for a legendary target and still destroys then surveils', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Price of Fame', ['Instant'], { manaCost: '{3}{B}' })],
        },
        battlefield: {
          p2: [
            card('Legend', ['Creature'], { supertypes: ['Legendary'] }),
            card('Citizen', ['Creature']),
          ],
        },
        libraries: {
          p1: [card('Top', ['Instant']), card('Second', ['Land'])],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 1 }
    const spell = named(ready, 'Price of Fame')
    const legend = named(ready, 'Legend')
    const citizen = named(ready, 'Citizen')
    const actions = legalActsFor(ready, 'p1')
      .filter((action) => action.kind === 'castSpell' && action.objectId === spell.id)

    expect(actions.map((action) => action.targetObjectId)).toEqual([legend.id])
    const illegal = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      targets: [{ kind: 'object', objectId: citizen.id }],
    })
    expect(illegal.ok).toBe(false)
    expect(illegal.ok === false && illegal.error).toBe('not enough mana')

    const cast = run(server, ready, eventsForAvailableAction(ready, 'p1', actions[0])!)
    expect(cast.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    const surveilling = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(surveilling.objects[legend.id].zone).toBe('graveyard')
    const pending = pendingSelectionFor(surveilling, 'p1')!
    expect(pending).toMatchObject({ kind: 'surveil', count: 2, source: 'Price of Fame' })

    const resolved = ok(server.rules(surveilling, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'surveil',
      count: 2,
      choices: pending.candidates.map((objectId) => ({ objectId, destination: 'top' })),
    }))
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
    expect(resolved.objects[spell.id].zone).toBe('graveyard')
  })

  test('Drag to the Roots costs two less only with delirium and destroys its target', () => {
    const graveyardCards = [
      card('Creature Card', ['Creature']),
      card('Instant Card', ['Instant']),
      card('Sorcery Card', ['Sorcery']),
      card('Land Card', ['Land']),
    ]
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [
            card('Drag to the Roots', ['Instant'], { manaCost: '{2}{B}{G}' }),
            ...graveyardCards,
          ],
        },
        battlefield: {
          p2: [card('Monolith', ['Artifact'])],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 1, C: 0 }
    const spell = named(ready, 'Drag to the Roots')
    const target = named(ready, 'Monolith')
    const castEvent: GameEvent = {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }

    const illegal = server.rules(ready, castEvent)
    expect(illegal.ok).toBe(false)
    expect(illegal.ok === false && illegal.error).toBe('not enough mana')

    const delirious = run(
      server,
      ready,
      graveyardCards.map((entry): GameEvent => ({
        type: 'move',
        objectId: named(ready, entry.name).id,
        to: 'graveyard',
      })),
    )
    const actions = legalActsFor(delirious, 'p1')
      .filter((action) =>
        action.kind === 'castSpell'
        && action.objectId === spell.id
        && action.targetObjectId === target.id)
    expect(actions).toHaveLength(1)

    const cast = run(
      server,
      delirious,
      eventsForAvailableAction(delirious, 'p1', actions[0])!,
    )
    expect(cast.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[target.id].zone).toBe('graveyard')
    expect(resolved.objects[spell.id].zone).toBe('graveyard')
  })
})
