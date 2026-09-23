import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import {
  drawHandDifference,
  enters,
} from './effects'

const handCard = (name: string) => cardTemplate(name, { types: ['Instant'] })

const tallyGolem = () => cardTemplate('Tally Golem', {
  types: ['Artifact', 'Creature'],
  power: 0,
  toughness: 4,
  effects: [enters(drawHandDifference())],
})

const enterBattlefield = (
  server: ReturnType<typeof createServerGame>,
  state: ReturnType<typeof createServerGame>['state'],
  name: string,
) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'move',
  objectId: objectId(state, name),
  to: 'battlefield',
})))

describe('drawHandDifference', () => {
  test('drawHandDifference() is clone-safe', () => {
    expect(structuredClone(drawHandDifference())).toEqual({ kind: 'drawHandDifference' })
  })

  test('choosing an opponent with a larger hand draws the difference', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: {
          p1: [tallyGolem()],
          p2: [handCard('A'), handCard('B'), handCard('C'), handCard('D'), handCard('E')],
          p3: [handCard('F')],
        },
        libraries: {
          p1: Array.from({ length: 6 }, (_, index) => handCard(`Deck ${index + 1}`)),
        },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Tally Golem')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice).toMatchObject({
      min: 1,
      max: 1,
      candidates: ['p2', 'p3', 'p4'],
      action: { kind: 'drawHandDifference' },
    })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(5)
    expect(state.zoneOrder.p2.hand).toHaveLength(5)
  })

  test('choosing an opponent who does not have more cards draws nothing', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: {
          p1: [tallyGolem(), handCard('Held One'), handCard('Held Two')],
          p2: [handCard('Opp One')],
        },
        libraries: { p1: [handCard('Library Top')] },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Tally Golem')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.zoneOrder.p2.hand).toHaveLength(1)
  })

  test('opponents see hand counts but not hidden card identities', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: {
          p1: [tallyGolem()],
          p2: [handCard('Secret A'), handCard('Secret B'), handCard('Secret C')],
        },
      },
      { random: () => 0.5 },
    )
    const entered = enterBattlefield(server, server.state, 'Tally Golem')
    const view = server.project(entered, 'p1')
    expect(view.zoneCounts.p2.hand).toBe(3)
    expect(view.zoneOrder.p2.hand).toEqual([])
    expect(Object.values(view.objects).every((object) => object.owner !== 'p2')).toBe(true)
  })

  test('a host restart preserves an open opponent choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: {
          p1: [tallyGolem()],
          p2: [handCard('A'), handCard('B'), handCard('C')],
        },
        libraries: {
          p1: Array.from({ length: 4 }, (_, index) => handCard(`Deck ${index + 1}`)),
        },
      },
      { random: () => 0.5 },
    )
    const entered = enterBattlefield(server, server.state, 'Tally Golem')
    const choice = pendingPlayerSelectionFor(entered, 'p1')!
    const restarted = createServerGame(commanderRules, {}, { random: () => 0.5 })
    restarted.state = structuredClone(entered)
    expect(pendingPlayerSelectionFor(restarted.state, 'p1')?.id).toBe(choice.id)
    const finished = ok(server.rules(restarted.state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    expect(resolveStack(server.rules, finished).zoneOrder.p1.hand).toHaveLength(3)
  })
})

const objectId = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!.id
