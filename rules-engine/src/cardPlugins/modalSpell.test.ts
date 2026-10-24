import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { pendingDialog, pendingDialogLock } from '../pendingDialog'
import { choiceEffects } from './choiceEffects'
import { modalSpell } from './modalSpell'
import { onResolve } from './onResolve'
import { librarySearch } from './librarySearch'

import {pendingSelection, pendingSelectionFor} from '../rules/selectCards'
import {pendingOptionSelection} from '../rules/selectOptions'
import {resolveStack} from '../testHelpers'
const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = () =>
  card('Forest', ['Land'], { subtypes: ['Forest'], supertypes: ['Basic'], tapProduces: { G: 1 } })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (options: {
  hand?: CardTemplate[]
  library?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      hands: { p1: options.hand ?? [] },
      libraries: { p1: options.library ?? [] },
    },
    {
      random: () => 0.5,
      cardPlugins: [modalSpell, onResolve, choiceEffects, pendingDialogLock, librarySearch],
    },
  )

const run = (
  server: ReturnType<typeof game>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

describe('modalSpell', () => {
  test('Bushwhack announces its canonical mode before resolving the chosen instructions', () => {
    const server = game({
      hand: [card('Bushwhack', ['Sorcery'], { manaCost: '{G}' })],
      library: [forest(), card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'] })],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const funded = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } },
      },
    }
    const opened = run(server, funded, [
      { type: 'castSpell', seat: 'p1', objectId: spell, modeIndices: [0] },
      { type: 'resolveTop' },
    ])
    expect(pendingDialog(opened)).toBeUndefined()
    expect(pendingSelectionFor(opened, 'p1')?.candidates).toHaveLength(2)
  })


})

describe('relocated from rankle.test.ts → modalSpell.test.ts', () => {
  const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types, ...extra })

  const creature = (name: string, extra: Partial<CardTemplate> = {}) =>
    card(name, ['Creature'], { power: 1, toughness: 1, ...extra })

  const rankleCard = () => creature('Rankle, Master of Pranks', {
    supertypes: ['Legendary'],
    subtypes: ['Faerie', 'Rogue'],
    power: 3,
    toughness: 3,
  })

  const game = (extra: { caress?: boolean } = {}) => createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [rankleCard(), creature('Gravedigger'), ...(extra.caress
          ? [card("Liliana's Caress", ['Enchantment'])]
          : [])],
        p2: [creature('Lone Hydra', { power: 9, toughness: 9 })],
      },
      hands: {
        p1: [card('Swamp', ['Land'])],
        p2: [card('Island', ['Land']), card('Forest', ['Land'])],
      },
      libraries: {
        p1: [card('Mountain', ['Land'])],
        p2: [card('Plains', ['Land'])],
      },
    },
    { random: () => 0.5 },
  )

  const connect = (server: ReturnType<typeof createServerGame>, state = server.state) => {
    const source = Object.values(state.objects)
      .find((object) => object.name === 'Rankle, Master of Pranks')!
    return ok(server.rules(state, {
      type: 'combatDamage',
      sourceId: source.id,
      target: { kind: 'player', player: 'p2' },
      amount: 3,
    }))
  }

  const pickModes = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    indices: number[],
  ) => {
    let current = state
    for (const index of indices) {
      const pending = pendingOptionSelection(current, 'p1')!
      current = ok(server.rules(current, {
        type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: `mode:${index}`,
      }))
    }
    const pending = pendingOptionSelection(current, 'p1')
    if (pending?.options.some(option => option.id === 'done')) {
      current = ok(server.rules(current, {
        type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'done',
      }))
    }
    return current
  }

  const resolveChosen = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    indices: number[],
  ) => resolveStack(server.rules, pickModes(server, state, indices))

  test('combat damage chooses modes before Rankle is put on the stack', () => {
    const server = game()
    const triggered = connect(server)

    expect(triggered.stack).toHaveLength(0)
    expect(pendingOptionSelection(triggered, 'p1')?.options.map(option => option.id))
      .toEqual(['mode:0', 'mode:1', 'mode:2', 'done'])
    const stacked = pickModes(server, triggered, [1])
    expect(stacked.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Rankle, Master of Pranks',
      controller: 'p1',
      execution: { modeIndices: [1], modeCount: 1 },
    })
  })

  test('choosing no modes leaves the table alone', () => {
    const server = game()
    const settled = resolveChosen(server, connect(server), [])

    expect(pendingDialog(settled)).toBeUndefined()
    expect(settled.players.p2.life).toBe(commanderRules.startingLife - 3)
    expect(settled.players.p1.life).toBe(commanderRules.startingLife)
    expect(settled.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('the sacrifice mode asks every player with a creature', () => {
    const server = game()
    const asked = resolveChosen(server, connect(server), [2])
    expect(pendingSelectionFor(asked, 'p1')).toMatchObject({ kind: 'choose', count: 1 })
    const rankle = Object.values(asked.objects).find((object) => object.name === 'Rankle, Master of Pranks')!
    const afterP1 = ok(server.rules(asked, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [rankle.id],
    }))
    const hydra = Object.values(afterP1.objects).find((object) => object.name === 'Lone Hydra')!
    expect(pendingSelectionFor(afterP1, 'p2')).toMatchObject({ kind: 'choose', count: 1 })
    const sacrificed = ok(server.rules(afterP1, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'choose',
      count: 1,
      objectIds: [hydra.id],
    }))

    expect(sacrificed.objects[hydra.id].zone).toBe('graveyard')
    expect(sacrificed.objects[rankle.id].zone).toBe('graveyard')
    expect(pendingSelectionFor(sacrificed, 'p2')).toBeUndefined()
  })

  test('a player with no creature is not asked to sacrifice', () => {
    const server = game()
    const hydra = Object.values(server.state.objects)
      .find((object) => object.name === 'Lone Hydra')!
    const empty = ok(server.rules(server.state, {
      type: 'move',
      objectId: hydra.id,
      to: 'graveyard',
    }))
    const asked = resolveChosen(server, connect(server, empty), [2])

    expect(pendingSelectionFor(asked, 'p2')).toBeUndefined()
    expect(pendingSelectionFor(asked, 'p1')).toMatchObject({ kind: 'choose', count: 1 })
  })

  test('the drain mode costs each player a life and draws them a card', () => {
    const server = game()
    const drained = resolveChosen(server, connect(server), [1])

    expect(drained.players.p1.life).toBe(commanderRules.startingLife - 1)
    expect(drained.players.p2.life).toBe(commanderRules.startingLife - 4)
    expect(drained.zoneOrder.p2.hand.length).toBe(3)
  })

  test('choosing every mode queues discards before sacrifices', () => {
    const server = game()
    const asked = resolveChosen(server, connect(server), [2, 0, 1])

    expect(pendingSelectionFor(asked, 'p1')).toMatchObject({ kind: 'choose', count: 1 })
    expect(asked.players.p2.life).toBe(commanderRules.startingLife - 3)
  })

  test('each-player discard opens dialogs in APNAP order', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        battlefield: {
          p1: [rankleCard(), creature('Gravedigger')],
          p2: [creature('Lone Hydra', { power: 9, toughness: 9 })],
        },
        hands: {
          p1: [card('Swamp', ['Land'])],
          p2: [card('Island', ['Land']), card('Forest', ['Land'])],
          p3: [card('Mountain', ['Land'])],
          p4: [card('Plains', ['Land'])],
        },
      },
      { random: () => 0.5 },
    )
    const activeP3 = { ...server.state, active: 'p3', priority: 'p3' }
    const asked = resolveChosen(server, connect(server, activeP3), [0])

    expect(pendingSelection(asked)).toMatchObject({ kind: 'choose', seat: 'p3', count: 1 })

    const mountain = Object.values(asked.objects).find((object) => object.name === 'Mountain')!
    const afterP3 = ok(server.rules(asked, {
      type: 'selectCards',
      seat: 'p3',
      kind: 'choose',
      count: 1,
      objectIds: [mountain.id],
    }))
    expect(pendingSelection(afterP3)).toMatchObject({ kind: 'choose', seat: 'p4', count: 1 })
  })

})
