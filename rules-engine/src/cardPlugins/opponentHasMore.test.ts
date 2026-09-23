import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  branch,
  controllerLife,
  draw,
  enters,
  entersTapped as entersTappedEffect,
  gainLife,
  landfall,
  opponentHasMore,
  opponentsAtMost,
  serializableEffects,
} from './effects'
import { entersTapped } from './entersTapped'

const land = (name: string) => cardTemplate(name, {
  types: ['Land'],
  tapProduces: { G: 1 },
})

const creature = (name: string) => cardTemplate(name, { types: ['Creature'] })

const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const playFromHand = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
) => {
  const objectId = named(state, name).id
  return resolveStack(server.rules, ok(server.rules(state, {
    type: 'move',
    objectId,
    to: 'battlefield',
  })))
}

describe('opponentHasMore', () => {
  test('serializableEffects keeps clone-safe opponentHasMore tags', () => {
    const effects = serializableEffects([enters(
      branch(opponentHasMore('lands'), [draw(1)]),
    )])
    expect(effects[0]).toMatchObject({
      op: 'trigger',
      do: [{ kind: 'if', if: { kind: 'opponentHasMore', stat: 'lands' } }],
    })
    expect(serializableEffects([enters(branch(controllerLife(40), [gainLife(1)]))])[0])
      .toMatchObject({ do: [{ if: { kind: 'controllerLife', min: 40 } }] })
    expect(serializableEffects([entersTappedEffect(opponentsAtMost(1))])[0])
      .toMatchObject({ if: { kind: 'opponentsAtMost', max: 1 } })
  })

  test('opponentsAtMost still taps a two-player fixture land on enter', () => {
    const springs = cardTemplate('Fixture Springs', {
      types: ['Land'],
      effects: [entersTappedEffect(opponentsAtMost(1))],
    })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [springs] } },
      { random: () => 0.5, cardPlugins: [entersTapped] },
    )
    const entered = playFromHand(server, server.state, 'Fixture Springs')
    expect(entered.objects[named(entered, 'Fixture Springs').id].tapped).toBe(true)
  })

  test('ETB branch draws when an opponent controls more lands', () => {
    const surveyor = cardTemplate('Fixture Surveyor', {
      types: ['Creature'],
      effects: [enters(
        branch(opponentHasMore('lands'), [draw(1)], [gainLife(1)]),
      )],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [surveyor] },
        battlefield: { p2: [land('Extra Plot'), land('Spare Plot')] },
        libraries: { p1: [instant('Ahead Draw')] },
      },
      { random: () => 0.5 },
    )
    const resolved = playFromHand(server, server.state, 'Fixture Surveyor')
    expect(named(resolved, 'Ahead Draw').zone).toBe('hand')
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife)
  })

  test('ETB branch skips draw when land counts are tied', () => {
    const surveyor = cardTemplate('Fixture Surveyor', {
      types: ['Creature'],
      effects: [enters(
        branch(opponentHasMore('lands'), [draw(1)], [gainLife(1)]),
      )],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [surveyor] },
        libraries: { p1: [instant('Ahead Draw')] },
      },
      { random: () => 0.5 },
    )
    const resolved = playFromHand(server, server.state, 'Fixture Surveyor')
    expect(named(resolved, 'Ahead Draw').zone).toBe('library')
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife + 1)
  })

  test('trigger if gates ETB on opponent life lead', () => {
    const beacon = cardTemplate('Fixture Beacon', {
      types: ['Creature'],
      effects: [{
        op: 'trigger',
        on: 'enters',
        if: opponentHasMore('life'),
        do: [gainLife(4)],
      }],
    })
    const aheadServer = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [beacon] } },
      { random: () => 0.5 },
    )
    const aheadState = {
      ...aheadServer.state,
      players: {
        ...aheadServer.state.players,
        p2: { ...aheadServer.state.players.p2, life: commanderRules.startingLife + 5 },
      },
    }
    const ahead = playFromHand(aheadServer, aheadState, 'Fixture Beacon')
    expect(ahead.players.p1.life).toBe(commanderRules.startingLife + 4)

    const behindServer = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [beacon] } },
      { random: () => 0.5 },
    )
    const behindState = {
      ...behindServer.state,
      players: {
        ...behindServer.state.players,
        p2: { ...behindServer.state.players.p2, life: commanderRules.startingLife - 5 },
      },
    }
    const behind = playFromHand(behindServer, behindState, 'Fixture Beacon')
    expect(behind.players.p1.life).toBe(commanderRules.startingLife)
  })

  test('landfall branch draws when an opponent controls more creatures', () => {
    const cartographer = cardTemplate('Fixture Cartographer', {
      types: ['Creature'],
      effects: [landfall(
        branch(opponentHasMore('creatures'), [draw(1)], [gainLife(1)]),
      )],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [forest()] },
        battlefield: {
          p1: [cartographer],
          p2: [creature('Raider'), creature('Scout')],
        },
        libraries: { p1: [instant('Map Card')] },
      },
      { random: () => 0.5 },
    )
    const resolved = playFromHand(server, server.state, 'Forest')
    expect(named(resolved, 'Map Card').zone).toBe('hand')
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife)
  })

  test('ANY opponent ahead on hand size satisfies cardsInHand', () => {
    const tally = cardTemplate('Fixture Tally', {
      types: ['Creature'],
      effects: [enters(
        branch(opponentHasMore('cardsInHand'), [draw(1)]),
      )],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [tally],
          p2: [instant('p2 Hold')],
          p3: [instant('p3 A'), instant('p3 B')],
        },
        libraries: { p1: [instant('Hand Lead Draw')] },
      },
      { random: () => 0.5 },
    )
    const resolved = playFromHand(server, server.state, 'Fixture Tally')
    expect(named(resolved, 'Hand Lead Draw').zone).toBe('hand')
  })
})
