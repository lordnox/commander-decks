import { pendingOptionSelection } from '../rules/selectOptions'
import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {createServerGame as createRuntimeGame} from '../runtime'
import {choiceEffects} from './choiceEffects'
import {librarySearch} from './librarySearch'
import {onResolve} from './onResolve'
import {targetedResolve} from './targetedResolve'
import {activated} from './activated'
import {pendingPlayerSelection} from '../rules/selectPlayers'
const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') => card(name, ['Land'], { subtypes: ['Forest'] })

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
    { random: () => 0.5 },
  )

const battlefieldNames = (state: GameState, seat = 'p1') =>
  state.zoneOrder[seat].battlefield.map((id) => state.objects[id].name)

const playTopLand = (server: ReturnType<typeof game>) => {
  const objectId = server.state.zoneOrder.p1.hand[0]
  const played = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
  return resolveStack(server.rules, played)
}

describe('landfall', () => {
  test('CR 603.3: landfall triggers sit on the stack before resolution', () => {
    const server = game({
      hand: [forest()],
      battlefield: [card('Scute Swarm', ['Creature'], { power: 1, toughness: 1 })],
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const triggered = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
    expect(triggered.stack[0]).toMatchObject({ kind: 'ability', name: 'Scute Swarm' })
    expect(battlefieldNames(triggered).filter((name) => name === 'Insect')).toHaveLength(0)
  })

  test('Aesi draws through the shared instruction runner', () => {
    const server = game({
      hand: [forest()],
      battlefield: [card('Aesi, Tyrant of Gyre Strait', ['Creature'])],
      library: [card('Drawn', ['Instant'])],
    })
    const waiting = playTopLand(server)
    const choice = pendingOptionSelection(waiting, 'p1')!
    const next = ok(server.rules(waiting, { type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options[0].id }))
    expect(next.zoneOrder.p1.hand.map((id) => next.objects[id].name)).toEqual(['Drawn'])
  })

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
      { random: () => 0.5 },
    )
    const objectId = server.state.zoneOrder.p2.hand[0]
    const next = ok(server.rules(
      { ...server.state, active: 'p2', priority: 'p2' },
      { type: 'playLand', seat: 'p2', objectId },
    ))
    expect(next.stack).toHaveLength(0)
    expect(battlefieldNames(next)).not.toContain('Insect')
  })

  test('a nonland permanent entering does not trigger landfall', () => {
    const server = game({
      hand: [card('Grizzly Bears', ['Creature'], { power: 2, toughness: 2 })],
      battlefield: [card('Scute Swarm', ['Creature'], { power: 1, toughness: 1 })],
    })
    const objectId = server.state.zoneOrder.p1.hand[0]
    const next = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
    expect(next.stack).toHaveLength(0)
    expect(battlefieldNames(next)).not.toContain('Insect')
  })
})

describe('relocated from homerRest.test.ts → landfall.test.ts', () => {
  const createServerGame: typeof createRuntimeGame = (format, options) =>
    createRuntimeGame(format, options, {
      random: () => 0.5,
      cardPlugins: [
        choiceEffects,
        librarySearch,
        onResolve,
        targetedResolve,
        activated,
      ],
    })

  const named = (state: import('../types').GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Yarok makes landfall happen an extra time for Aesi', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Forest', { types: ['Land'] })] },
          battlefield: {
            p1: [
              cardTemplate('Aesi, Tyrant of Gyre Strait', { types: ['Creature'] }),
              cardTemplate('Yarok, the Desecrated', { types: ['Creature'] }),
            ],
          },
          libraries: {
            p1: [
              cardTemplate('First', { types: ['Instant'] }),
              cardTemplate('Second', { types: ['Instant'] }),
            ],
          },
        },
      )
      let next = resolveStack(server.rules, ok(server.rules(server.state, {
        type: 'playLand',
        seat: 'p1',
        objectId: named(server.state, 'Forest').id,
      })))
      for (let index = 0; index < 2; index += 1) {
        const choice = pendingOptionSelection(next, 'p1')!
        next = resolveStack(server.rules, ok(server.rules(next, { type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options[0].id })))
      }
      expect(next.zoneOrder.p1.hand.map((id) => next.objects[id].name)).toEqual(['First', 'Second'])
    })

})

describe('relocated from sinFallGaps.test.ts → landfall.test.ts', () => {
  const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types, ...extra })

  const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Hedron Crab mills a chosen player on landfall', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: { p1: [card('Hedron Crab', ['Creature'])] },
          hands: { p1: [forest()] },
          libraries: {
            p2: [card('A', ['Instant']), card('B', ['Instant']), card('C', ['Instant'])],
          },
        },
      )
      const played = ok(server.rules(server.state, {
        type: 'playLand',
        seat: 'p1',
        objectId: named(server.state, 'Forest').id,
      }))
      const pending = pendingPlayerSelection(played)!
      const chosen = ok(server.rules(played, {
        type: 'selectPlayers',
        seat: 'p1',
        selectionId: pending.id,
        players: ['p2'],
      }))
      const milled = ok(server.rules(chosen, { type: 'resolveTop' }))
      expect(milled.zoneOrder.p2.graveyard).toHaveLength(3)
    })


})
