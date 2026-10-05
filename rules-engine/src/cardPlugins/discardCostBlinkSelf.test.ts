import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { blinkPlugin } from './blink'
import { ability, blinkSelf } from './effects'

const ABILITY = 'test.reset'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const hand = (count: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`Held ${index + 1}`))

const tide = (...instructions: Parameters<typeof ability>[2][]) => cardTemplate('Tide Elder', {
  types: ['Creature'],
  power: 6,
  toughness: 6,
  effects: [ability(
    { id: ABILITY },
    { discard: 'any', discardCount: 3 },
    ...instructions,
  )],
})

const game = (
  handSize: number,
  ...instructions: Parameters<typeof ability>[2][]
) => {
  const server = createServerGame(commanderRules, {
    hands: { p1: hand(handSize) },
    battlefield: { p1: [tide(...instructions)] },
  }, { random: () => 0.5, cardPlugins: [activated, blinkPlugin] })
  const ready = structuredClone(server.state)
  ready.step = 'precombatMain'
  return { server, ready }
}

const activate = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  choices: string[],
) => server.rules(state, {
  type: 'activateAbility',
  abilityId: ABILITY,
  seat: 'p1',
  objectId: named(state, 'Tide Elder').id,
  choices,
})

const ids = (state: GameState, ...names: string[]) =>
  names.map((name) => named(state, name).id)

const advanceToEndStep = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  while (current.step !== 'end') {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

describe('discard N cards as an activation cost', () => {
  test('is offered only with enough cards and asks for exactly that many from hand', () => {
    const { ready } = game(3, blinkSelf())
    const offer = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'activateAbility' && action.abilityId === ABILITY)
    expect(offer).toMatchObject({
      targetGroups: [{
        label: 'Cards to discard',
        min: 3,
        max: 3,
        purpose: 'cost',
      }],
    })
    const short = game(2, blinkSelf()).ready
    expect(legalActsFor(short, 'p1').some((action) =>
      action.kind === 'activateAbility' && action.abilityId === ABILITY)).toBe(false)
  })

  test('rejects too few, duplicate, and non-hand picks without changing state', () => {
    const { server, ready } = game(4, blinkSelf())
    const picks = ids(ready, 'Held 1', 'Held 2', 'Held 3')
    expect(activate(server, ready, picks.slice(0, 2)).ok).toBe(false)
    expect(activate(server, ready, [picks[0], picks[0], picks[1]]).ok).toBe(false)
    expect(activate(server, ready, [...picks.slice(0, 2), named(ready, 'Tide Elder').id]).ok)
      .toBe(false)
    expect(activate(server, ready, []).ok).toBe(false)
    expect(ready.zoneOrder.p1.hand).toHaveLength(4)
  })

  test('discards exactly the picked cards as the cost and puts the ability on the stack', () => {
    const { server, ready } = game(4, blinkSelf())
    const picks = ids(ready, 'Held 2', 'Held 3', 'Held 4')
    const state = ok(activate(server, ready, picks))
    expect(picks.map((id) => state.objects[id].zone)).toEqual(['graveyard', 'graveyard', 'graveyard'])
    expect(named(state, 'Held 1').zone).toBe('hand')
    expect(state.stack[0]).toMatchObject({ kind: 'ability', abilityId: ABILITY })
  })
})

describe('blinkSelf', () => {
  const paid = (state: GameState) => ids(state, 'Held 1', 'Held 2', 'Held 3')

  test('is clone-safe', () => {
    const instruction = blinkSelf({ when: 'nextEndStep', tapped: true })
    expect(structuredClone(instruction)).toEqual(instruction)
  })

  test('with nextEndStep exiles now and returns tapped at the next end step', () => {
    const { server, ready } = game(3, blinkSelf({ when: 'nextEndStep', tapped: true }))
    const elder = named(ready, 'Tide Elder')
    const started = ok(activate(server, ready, paid(ready)))
    const resolved = resolveStack(server.rules, started)
    expect(resolved.objects[elder.id].zone).toBe('exile')
    expect(resolved.delayedTriggers).toHaveLength(1)

    const restarted = structuredClone(resolved)
    const atEnd = advanceToEndStep(server, restarted)
    const back = resolveStack(server.rules, atEnd)
    expect(back.objects[elder.id]).toMatchObject({
      zone: 'battlefield',
      tapped: true,
      controller: 'p1',
    })
    expect(back.delayedTriggers).toHaveLength(0)
  })

  test('returns under its owner control even when someone else controlled it', () => {
    const server = createServerGame(commanderRules, {
      hands: { p2: hand(3) },
      battlefield: { p1: [tide(blinkSelf({ when: 'nextEndStep', tapped: true }))] },
    }, { random: () => 0.5, cardPlugins: [activated, blinkPlugin] })
    const stolen = structuredClone(server.state)
    stolen.step = 'precombatMain'
    stolen.priority = 'p2'
    const elder = named(stolen, 'Tide Elder')
    elder.controller = 'p2'
    const started = ok(server.rules(stolen, {
      type: 'activateAbility',
      abilityId: ABILITY,
      seat: 'p2',
      objectId: elder.id,
      choices: paid(stolen),
    }))
    const exiled = resolveStack(server.rules, started)
    expect(exiled.objects[elder.id].zone).toBe('exile')
    const back = resolveStack(server.rules, advanceToEndStep(server, exiled))
    expect(back.objects[elder.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p1',
      controller: 'p1',
      tapped: true,
    })
  })

  test('without tapped, immediate blinkSelf returns untapped at once', () => {
    const { server, ready } = game(3, blinkSelf())
    const elder = named(ready, 'Tide Elder')
    const resolved = resolveStack(server.rules, ok(activate(server, ready, paid(ready))))
    expect(resolved.objects[elder.id]).toMatchObject({ zone: 'battlefield', tapped: false })
    expect(resolved.delayedTriggers).toHaveLength(0)
  })

  test('does nothing if the source already left the battlefield', () => {
    const { server, ready } = game(3, blinkSelf({ when: 'nextEndStep', tapped: true }))
    const elder = named(ready, 'Tide Elder')
    const started = ok(activate(server, ready, paid(ready)))
    const removed = ok(server.rules(started, { type: 'move', objectId: elder.id, to: 'graveyard' }))
    const resolved = resolveStack(server.rules, removed)
    expect(resolved.objects[elder.id].zone).toBe('graveyard')
    expect(resolved.delayedTriggers).toHaveLength(0)
  })

  test('does nothing if the source was exiled in response, even though it is in exile', () => {
    const { server, ready } = game(3, blinkSelf({ when: 'nextEndStep', tapped: true }))
    const elder = named(ready, 'Tide Elder')
    const started = ok(activate(server, ready, paid(ready)))
    const exiled = ok(server.rules(started, { type: 'move', objectId: elder.id, to: 'exile' }))
    const resolved = resolveStack(server.rules, exiled)
    expect(resolved.objects[elder.id].zone).toBe('exile')
    expect(resolved.delayedTriggers).toHaveLength(0)
  })
})
