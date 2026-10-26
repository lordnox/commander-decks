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
  test('Perch Protection gifts an extra turn and phases out on the promised gift', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: { p1: [card('Perch Protection', ['Instant'])] },
      battlefield: { p1: [card('Held Bear', ['Creature'], { power: 2, toughness: 2 })] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 }
    const spell = Object.values(ready.objects).find((object) => object.name === 'Perch Protection')!
    const gifts = legalActsFor(ready, 'p1').filter((action) =>
      action.kind === 'castSpell' && action.objectId === spell.id && action.selectedOptionalCosts?.includes(0))
    expect(gifts.map((action) => action.kind === 'castSpell' ? action.costPlayers?.['0'] : undefined))
      .toEqual(['p2', 'p3', 'p4'])
    const gifted = gifts.find((action) => action.kind === 'castSpell' && action.costPlayers?.['0'] === 'p2')!
    const cast = run(server, ready, eventsForAvailableAction(ready, 'p1', gifted)!)
    expect(cast.stack[0]?.execution?.announcement?.costChoices).toMatchObject({
      optional: [0],
      players: { 0: 'p2' },
    })
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.battlefield.filter((id) =>
      resolved.objects[id].subtypes.includes('Bird'))).toHaveLength(4)
    expect(resolved.objects[Object.values(resolved.objects).find((object) => object.name === 'Held Bear')!.id].phasedOut)
      .toBe(true)
    expect(resolved.extraTurns).toEqual(['p2'])
  })

  test('Perch Protection gift recipient survives JSON restore and is hidden from another player', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: { p1: [card('Perch Protection', ['Instant'])] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 }
    const spell = Object.values(ready.objects).find((object) => object.name === 'Perch Protection')!
    const gifted = legalActsFor(ready, 'p1').find((action) =>
      action.kind === 'castSpell' && action.objectId === spell.id && action.costPlayers?.['0'] === 'p3')!
    const cast = run(server, ready, eventsForAvailableAction(ready, 'p1', gifted)!)
    const restored = JSON.parse(JSON.stringify(cast)) as typeof cast
    expect(restored.stack[0]?.execution?.announcement?.costChoices).toMatchObject({
      optional: [0],
      players: { 0: 'p3' },
    })
    expect(pendingPlayerSelectionFor(projectForViewer(restored, 'p2'), 'p1')).toBeUndefined()
    expect(ok(server.rules(restored, { type: 'resolveTop' })).extraTurns).toEqual(['p3'])
  })

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

  test('generic finishGiftCast recipient selection survives JSON restore and stays private', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: {
          p1: [card('Fable of the Restored Promise', ['Instant'], {
            manaCost: '{U}',
            effects: [gift({ draw: 1 }), onResolve(draw(1))],
          })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.U = 1
    const spell = Object.values(ready.objects).find(object => object.name === 'Fable of the Restored Promise')!
    const waiting = ok(server.rules(ready, {
      type: 'castSpell', seat: 'p1', objectId: spell.id, giftPromised: true,
    }))
    const pending = pendingPlayerSelectionFor(waiting, 'p1')!
    expect(pending.action.kind).toBe('finishGiftCast')
    expect(pending.candidates).toEqual(['p2', 'p3', 'p4'])
    expect(pendingPlayerSelectionFor(projectForViewer(waiting, 'p1'), 'p1')).toBeDefined()
    expect(pendingPlayerSelectionFor(projectForViewer(waiting, 'p3'), 'p1')).toBeUndefined()

    const restored = JSON.parse(JSON.stringify(waiting))
    const restoredPending = pendingPlayerSelectionFor(restored, 'p1')!
    const finished = ok(server.rules(restored, {
      type: 'selectPlayers', seat: 'p1', selectionId: restoredPending.id, players: ['p3'],
    }))
    expect(finished.stack[0]).toMatchObject({ giftPromised: true, giftRecipient: 'p3' })
    expect(pendingPlayerSelectionFor(finished, 'p1')).toBeUndefined()
  })
})
