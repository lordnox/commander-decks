import { describe, expect, test } from 'bun:test'
import { freezeDraft, makeDraft } from '../draft'
import { onResolve } from '../cardPlugins/onResolve'
import {
  discardCards,
  draw,
  eachPlayerDraw,
  loseLife,
  onResolve as onResolveEffect,
  triggerOn,
} from '../cardPlugins/effects'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { initiateDiscard } from './discard'
import { draw as drawPlugin, initiateDraw } from './draw'

const card = (name: string, types: string[] = ['Instant']) =>
  cardTemplate(name, { types })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const pushDraw = (
  state: GameState,
  args: Parameters<typeof initiateDraw>[1],
) => {
  const draft = makeDraft(state)
  const item = initiateDraw(draft, args)
  return { state: freezeDraft(draft), item }
}

const passAll = (server: ReturnType<typeof createServerGame>, state: GameState) => {
  let current = state
  for (const seat of current.playerOrder) {
    current = ok(server.rules(current, { type: 'passPriority', seat }))
  }
  return current
}

describe('draw game rule', () => {
  test('CR 121.2 draw event moves one library card to hand', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [card('Top Card')] },
      players: 2,
    })
    const top = server.state.zoneOrder.p1.library[0]

    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))

    expect(drawn.objects[top].zone).toBe('hand')
    expect(drawn.zoneCounts.p1.library).toBe(0)
    expect(drawn.zoneCounts.p1.hand).toBe(1)
    expect(drawn.log.at(-1)).toBe('p1 draws a card')
  })

  test('empty library draw loses the player', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
    })

    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))

    expect(drawn.players.p1.lost).toBe(true)
    expect(drawn.log.at(-1)).toBe('p1 draws from an empty library')
  })

  test('draw action with remaining 1 resolves to one card and an empty stack', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [card('Drawn')] },
      players: 2,
    })
    const top = server.state.zoneOrder.p1.library[0]
    const { state: stacked, item } = pushDraw(server.state, { seat: 'p1', remaining: 1 })

    expect(stacked.stack).toHaveLength(1)
    expect(stacked.stack[0].id).toBe(item.id)

    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))

    expect(resolved.stack).toHaveLength(0)
    expect(resolved.objects[top].zone).toBe('hand')
  })

  test('CR 121.2 / 603 scenario B: draw triggers interleave before the next draw and discard', () => {
    const quezaLike = cardTemplate('Queza-like', {
      types: ['Creature'],
      effects: [
        triggerOn('draw', {
          do: [loseLife(1, 'controller')],
        }),
      ],
    })
    const ancestral = cardTemplate('Ancestral Test', {
      types: ['Sorcery'],
      effects: [onResolveEffect(draw(3), discardCards(1))],
    })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [quezaLike] },
        hands: { p1: [ancestral, card('To Discard')] },
        libraries: {
          p1: [card('Card One'), card('Card Two'), card('Card Three')],
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const spellId = server.state.zoneOrder.p1.hand.find(
      (id) => server.state.objects[id].name === 'Ancestral Test',
    )!
    const discardId = server.state.zoneOrder.p1.hand.find(
      (id) => server.state.objects[id].name === 'To Discard',
    )!

    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
    }))
    const resolvedSpell = passAll(server, cast)

    expect(resolvedSpell.stack).toHaveLength(2)
    expect(resolvedSpell.stack[0]).toMatchObject({ actionId: 'draw', payload: { remaining: 3 } })
    expect(resolvedSpell.stack[1]).toMatchObject({ actionId: 'discard' })
    expect(resolvedSpell.players.p1.life).toBe(commanderRules.startingLife)
    expect(resolvedSpell.zoneCounts.p1.hand).toBe(1)

    const afterFirstDraw = ok(server.rules(resolvedSpell, { type: 'resolveTop' }))

    expect(afterFirstDraw.zoneCounts.p1.hand).toBe(2)
    expect(afterFirstDraw.players.p1.life).toBe(commanderRules.startingLife)
    expect(afterFirstDraw.stack[0]).toMatchObject({ kind: 'ability', name: 'Queza-like' })
    expect(afterFirstDraw.stack[1]).toMatchObject({
      actionId: 'draw',
      payload: { remaining: 2 },
    })

    const afterFirstQueza = ok(server.rules(afterFirstDraw, { type: 'resolveTop' }))
    expect(afterFirstQueza.players.p1.life).toBe(commanderRules.startingLife - 1)

    let current = afterFirstQueza
    for (let cardsDrawn = 2; cardsDrawn <= 3; cardsDrawn += 1) {
      current = ok(server.rules(current, { type: 'resolveTop' }))
      expect(current.players.p1.life).toBe(commanderRules.startingLife - (cardsDrawn - 1))
      current = ok(server.rules(current, { type: 'resolveTop' }))
      expect(current.players.p1.life).toBe(commanderRules.startingLife - cardsDrawn)
    }

    expect(current.zoneCounts.p1.hand).toBe(4)
    expect(current.stack).toHaveLength(1)
    expect(current.stack[0]).toMatchObject({ actionId: 'discard' })

    const waiting = ok(server.rules(current, { type: 'resolveTop' }))
    expect(waiting.stack[0].waiting).toBe('choice')

    const finished = ok(server.rules(waiting, {
      type: 'continueAction',
      stackId: waiting.stack[0].id,
      seat: 'p1',
      payload: { objectIds: [discardId] },
    }))

    expect(finished.stack).toHaveLength(0)
    expect(finished.objects[discardId].zone).toBe('graveyard')
    expect(finished.players.p1.life).toBe(commanderRules.startingLife - 3)
  })

  test('manual stack assembly interleaves Queza between draw actions', () => {
    const quezaLike = cardTemplate('Queza-like', {
      types: ['Creature'],
      effects: [
        triggerOn('draw', {
          do: [loseLife(1, 'controller')],
        }),
      ],
    })
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [quezaLike] },
      libraries: {
        p1: [card('One'), card('Two'), card('Three')],
      },
      hands: { p1: [card('Discard Me')] },
      players: 2,
    })
    const discardId = server.state.zoneOrder.p1.hand[0]

    const draft = makeDraft(server.state)
    initiateDiscard(draft, {
      seat: 'p1',
      count: 1,
      objectIds: [discardId],
    })
    initiateDraw(draft, { seat: 'p1', remaining: 3 })
    let current = freezeDraft(draft)

    current = ok(server.rules(current, { type: 'resolveTop' }))
    expect(current.zoneCounts.p1.hand).toBe(2)
    expect(current.players.p1.life).toBe(commanderRules.startingLife)
    expect(current.stack[0].kind).toBe('ability')

    current = ok(server.rules(current, { type: 'resolveTop' }))
    expect(current.players.p1.life).toBe(commanderRules.startingLife - 1)
    expect(current.stack[0]).toMatchObject({ actionId: 'draw', payload: { remaining: 2 } })

    for (let life = 2; life <= 3; life += 1) {
      current = ok(server.rules(current, { type: 'resolveTop' }))
      current = ok(server.rules(current, { type: 'resolveTop' }))
      expect(current.players.p1.life).toBe(commanderRules.startingLife - life)
    }

    expect(current.zoneCounts.p1.hand).toBe(4)
    expect(current.stack[0]).toMatchObject({ actionId: 'discard' })
  })

  test('eachPlayerDraw routes through initiateDraw stack actions', () => {
    const wheel = cardTemplate('Wheel Test', {
      types: ['Sorcery'],
      effects: [onResolveEffect(eachPlayerDraw(2))],
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [wheel] },
        libraries: {
          p1: [card('P1 One'), card('P1 Two')],
          p2: [card('P2 One'), card('P2 Two')],
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [onResolve] },
    )
    const spellId = server.state.zoneOrder.p1.hand[0]
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
    }))
    const resolvedSpell = passAll(server, cast)

    const drawActions = resolvedSpell.stack.filter((item) => item.actionId === 'draw')
    expect(drawActions).toHaveLength(2)
    expect(drawActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: { seat: 'p1', remaining: 2 } }),
      expect.objectContaining({ payload: { seat: 'p2', remaining: 2 } }),
    ]))
  })

  test('replica draw event does not move cards or lose', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [card('Hidden')] },
      players: 2,
    })
    const view = server.project(server.state, 'p1')
    view.knowledge = { mode: 'replica', viewer: 'p1' }

    const draft = makeDraft(view)
    draft.pending = []
    drawPlugin.apply?.({
      state: view,
      event: { type: 'draw', seat: 'p1' },
      draft,
      rule: {
        instanceId: 'rule1',
        pluginId: 'draw',
        sourceId: null,
        timestamp: 0,
        params: {},
      },
      catalog: {} as never,
    })

    expect(draft.zoneCounts.p1.hand).toBe(0)
    expect(draft.players.p1.lost).toBe(false)
  })
})
