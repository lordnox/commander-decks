import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { landfall } from './landfall'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') => card(name, ['Land'], { subtypes: ['Forest'] })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
  library?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      hands: { p1: options.hand ?? [] },
      battlefield: { p1: options.battlefield ?? [] },
      libraries: { p1: options.library ?? [] },
    },
    { random: () => 0.5, cardPlugins: [landfall] },
  )

const battlefieldNames = (state: GameState, seat = 'p1') =>
  state.zoneOrder[seat].battlefield.map((id) => state.objects[id].name)

const playTopLand = (server: ReturnType<typeof game>) => {
  const objectId = server.state.zoneOrder.p1.hand[0]
  return ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
}

describe('landfall', () => {
  test('Mole Man creates one Moloid for each land entry', () => {
    const server = game({
      hand: [forest()],
      battlefield: [
        card('Mole Man, Moloid Master', ['Creature'], {
          power: 2,
          toughness: 4,
        }),
      ],
    })
    const next = playTopLand(server)
    const moloid = Object.values(next.objects).find(
      (object) => object.name === 'Moloid',
    )

    expect(moloid).toMatchObject({
      zone: 'battlefield',
      token: true,
      power: 1,
      toughness: 1,
      subtypes: ['Minion'],
    })
  })

  test('Scute Swarm makes an Insect while its controller has few lands', () => {
    const server = game({
      hand: [forest()],
      battlefield: [card('Scute Swarm', ['Creature'], { power: 1, toughness: 1 })],
    })
    const next = playTopLand(server)
    expect(battlefieldNames(next).filter((name) => name === 'Insect')).toHaveLength(1)
    expect(battlefieldNames(next).filter((name) => name === 'Scute Swarm')).toHaveLength(1)
  })

  test('Scute Swarm copies itself once the land that entered is the sixth', () => {
    const server = game({
      hand: [forest()],
      battlefield: [
        card('Scute Swarm', ['Creature'], { power: 1, toughness: 1 }),
        ...[1, 2, 3, 4, 5].map((index) => forest(`Land ${index}`)),
      ],
    })
    const next = playTopLand(server)
    expect(battlefieldNames(next).filter((name) => name === 'Scute Swarm')).toHaveLength(2)
    expect(battlefieldNames(next)).not.toContain('Insect')
  })

  test('Mossborn Hydra doubles its counters on each land', () => {
    const server = game({
      hand: [forest('First'), forest('Second')],
      battlefield: [
        card('Mossborn Hydra', ['Creature'], {
          power: 1,
          toughness: 1,
          counters: { '+1/+1': 1 },
        }),
      ],
    })
    const first = playTopLand(server)
    const hydra = Object.values(first.objects).find((object) => object.name === 'Mossborn Hydra')!
    expect(hydra.counters['+1/+1']).toBe(2)
    expect([hydra.power, hydra.toughness]).toEqual([2, 2])

    const second = ok(server.rules(
      { ...first, players: { ...first.players, p1: { ...first.players.p1, landPlaysAllowed: 2 } } },
      { type: 'playLand', seat: 'p1', objectId: first.zoneOrder.p1.hand[0] },
    ))
    const doubled = Object.values(second.objects).find((object) => object.name === 'Mossborn Hydra')!
    expect(doubled.counters['+1/+1']).toBe(4)
    expect([doubled.power, doubled.toughness]).toEqual([4, 4])
  })

  test('a 0/0 hydra survives its counters because printed values move with them', () => {
    const server = game({
      hand: [forest()],
      battlefield: [
        card('Mossborn Hydra', ['Creature'], {
          power: 1,
          toughness: 1,
          counters: { '+1/+1': 1 },
        }),
      ],
    })
    const next = playTopLand(server)
    expect(battlefieldNames(next)).toContain('Mossborn Hydra')
    expect(next.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test('Icetill Explorer mills the top card of its controller\'s library', () => {
    const server = game({
      hand: [forest()],
      battlefield: [card('Icetill Explorer', ['Creature'], { power: 2, toughness: 3 })],
      library: [card('Milled', ['Instant']), card('Kept', ['Instant'])],
    })
    const next = playTopLand(server)
    expect(next.zoneOrder.p1.graveyard.map((id) => next.objects[id].name)).toEqual(['Milled'])
    expect(next.zoneOrder.p1.library.map((id) => next.objects[id].name)).toEqual(['Kept'])
  })

  test('Field of the Dead counts itself and needs seven differently named lands', () => {
    const six = game({
      hand: [card('Field of the Dead', ['Land'])],
      battlefield: [1, 2, 3, 4, 5].map((index) => forest(`Land ${index}`)),
    })
    expect(battlefieldNames(playTopLand(six))).not.toContain('Zombie')

    const seven = game({
      hand: [card('Field of the Dead', ['Land'])],
      battlefield: [1, 2, 3, 4, 5, 6].map((index) => forest(`Land ${index}`)),
    })
    expect(battlefieldNames(playTopLand(seven)).filter((name) => name === 'Zombie'))
      .toHaveLength(1)
  })

  test('duplicate land names do not reach Field of the Dead\'s threshold', () => {
    const server = game({
      hand: [card('Field of the Dead', ['Land'])],
      battlefield: [1, 2, 3, 4, 5, 6].map(() => forest()),
    })
    expect(battlefieldNames(playTopLand(server))).not.toContain('Zombie')
  })

  test('a land entering under another seat does not trigger landfall', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p2: [forest()] },
        battlefield: { p1: [card('Scute Swarm', ['Creature'], { power: 1, toughness: 1 })] },
      },
      { random: () => 0.5, cardPlugins: [landfall] },
    )
    const objectId = server.state.zoneOrder.p2.hand[0]
    const next = ok(server.rules(
      { ...server.state, active: 'p2', priority: 'p2' },
      { type: 'playLand', seat: 'p2', objectId },
    ))
    expect(battlefieldNames(next)).not.toContain('Insect')
  })

  test('a nonland permanent entering does not trigger landfall', () => {
    const server = game({
      hand: [card('Grizzly Bears', ['Creature'], { power: 2, toughness: 2 })],
      battlefield: [card('Scute Swarm', ['Creature'], { power: 1, toughness: 1 })],
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
    expect(battlefieldNames(next)).not.toContain('Insect')
  })
})
