import { describe, expect, test } from 'bun:test'
import {
  eventsForAvailableAction,
  legalActsFor,
  pendingPlayerSelectionFor,
  projectForViewer,
} from '../index'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { draw as drawPlugin } from '../rules/draw'
import {
  draw,
  gainLife,
  gift,
  ifGiftNotPromised,
  ifGiftPromised,
  onResolve,
} from './effects'
import { giftCast } from './giftCast'
import { onResolve as onResolvePlugin } from './onResolve'

const card = (
  name: string,
  types: string[],
  extra: Parameters<typeof cardTemplate>[1] = {},
) => cardTemplate(name, { types, ...extra })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const plugins = [giftCast, onResolvePlugin, drawPlugin]

describe('gift cast and extra turns', () => {
  test('promised gift creates a tapped token for the chosen opponent before other effects', () => {
    const server = createServerGame(
      commanderRules,
      {
        libraries: { p1: [card('Library Card', ['Instant'], { manaCost: '{0}' })] },
        hands: {
          p1: [card('Fable of the Gifted Minnow', ['Sorcery'], {
            manaCost: '{U}',
            effects: [
              gift({
                label: 'Gift a tapped Minnow',
                token: {
                  name: 'Minnow',
                  types: ['Creature'],
                  subtypes: ['Fish'],
                  power: 1,
                  toughness: 1,
                  tapped: true,
                },
              }),
              onResolve(draw(1)),
            ],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 }
    const spell = Object.values(ready.objects).find((object) =>
      object.name === 'Fable of the Gifted Minnow')!
    const gifted = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === spell.id
      && action.giftPromised
      && action.giftRecipientId === 'p2')!
    const cast = run(server, ready, eventsForAvailableAction(ready, 'p1', gifted)!)
    expect(cast.stack[0].giftPromised).toBe(true)
    expect(cast.stack[0].giftRecipient).toBe('p2')
    const p1HandBefore = cast.zoneCounts.p1.hand
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    const fish = Object.values(resolved.objects).find((object) =>
      object.name === 'Minnow' && object.controller === 'p2')
    expect(fish?.tapped).toBe(true)
    expect(resolved.zoneCounts.p1.hand).toBe(p1HandBefore + 1)
  })

  test('ifGiftPromised branches on the stack item without card names', () => {
    const server = createServerGame(
      commanderRules,
      {
        libraries: { p2: [card('Gifted Card', ['Instant'], { manaCost: '{0}' })] },
        hands: {
          p1: [card('Fable of Conditional Generosity', ['Sorcery'], {
            manaCost: '{1}',
            effects: [
              gift({ label: 'Gift a card', draw: 1 }),
              onResolve(
                ifGiftPromised(gainLife(5)),
                ifGiftNotPromised(gainLife(1)),
              ),
            ],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const spell = Object.values(ready.objects).find((object) =>
      object.name === 'Fable of Conditional Generosity')!
    const plain = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === spell.id
      && !action.giftPromised)!
    const plainReady = structuredClone(ready)
    plainReady.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const plainResolved = run(
      server,
      run(server, plainReady, eventsForAvailableAction(plainReady, 'p1', plain)!),
      [{ type: 'resolveTop' }],
    )
    expect(plainResolved.players.p1.life).toBe(41)

    const giftedReady = structuredClone(ready)
    giftedReady.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const gifted = legalActsFor(giftedReady, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.objectId === spell.id
      && action.giftPromised
      && action.giftRecipientId === 'p2')!
    const giftedResolved = run(
      server,
      run(server, giftedReady, eventsForAvailableAction(giftedReady, 'p1', gifted)!),
      [{ type: 'resolveTop' }],
    )
    expect(giftedResolved.zoneCounts.p2.hand).toBe(1)
    expect(giftedResolved.players.p1.life).toBe(45)
  })

  test('gift extra turn queues before normal turn order', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Fable of Borrowed Moments', ['Sorcery'], {
            manaCost: '{1}',
            effects: [
              gift({ label: 'Gift an extra turn', extraTurn: true }),
              onResolve(gainLife(1)),
            ],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 }
    const spell = Object.values(ready.objects).find((object) =>
      object.name === 'Fable of Borrowed Moments')!
    const gifted = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell'
      && action.giftPromised
      && action.giftRecipientId === 'p3')!
    const cast = run(server, ready, eventsForAvailableAction(ready, 'p1', gifted)!)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.extraTurns).toEqual(['p3'])

    let state = { ...resolved, step: 'cleanup' as const, active: 'p1' }
    const afterP1 = ok(server.rules(state, { type: 'advanceStep' }))
    expect(afterP1.active).toBe('p3')
    expect(afterP1.step).toBe('untap')
    expect(afterP1.extraTurns).toEqual([])
  })

  test('opens selectPlayers when gift is promised without a recipient', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Fable of the Open Promise', ['Instant'], {
            manaCost: '{U}',
            effects: [gift({ draw: 1 }), onResolve(draw(1))],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.U = 1
    const spell = Object.values(ready.objects).find((object) =>
      object.name === 'Fable of the Open Promise')!
    const prevented = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      giftPromised: true,
    }))
    expect(prevented.stack).toHaveLength(0)
    const pending = pendingPlayerSelectionFor(prevented, 'p1')
    expect(pending?.action.kind).toBe('finishGiftCast')
    const projected = projectForViewer(prevented, 'p2')
    expect(pendingPlayerSelectionFor(projected, 'p1')).toBeUndefined()
    expect(pendingPlayerSelectionFor(projected, 'p2')).toBeUndefined()

    const cast = ok(server.rules(prevented, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending!.id,
      players: ['p2'],
    }))
    expect(cast.stack[0]?.giftRecipient).toBe('p2')
  })
})
