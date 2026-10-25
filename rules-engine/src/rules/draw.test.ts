import { createJournal, restoreJournal } from '../journal'
import { instructionSpell } from '../cardPlugins/dsl/instructionTestSupport'
import { chooseCards, createPlayerEffect, draw as drawInstruction, objects, PLAYER_EFFECT_DURATIONS, PLAYER_EFFECTS, ref } from '../cardPlugins/dsl/v1'
import { resolveStack } from '../testHelpers'
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
import type { GameState, Plugin, ReduceResult } from '../types'
import { initiateDiscard } from './discard'
import { FAILED_DRAW_SINCE_SBA, cardsDrawnThisTurn, draw as drawPlugin, initiateDraw } from './draw'
import { pendingSelectionFor } from './selectCards'

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
    expect(drawn.log).toContain('p1 draws from an empty library')
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

  test('CR 121.2 / 603: draw-3 during spell resolution applies three draw events without priority between cards', () => {
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
    const priorityBefore = server.state.priority

    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
    }))
    const resolvedSpell = passAll(server, cast)

    expect(resolvedSpell.objects[spellId].zone).toBe('stack')
    expect(resolvedSpell.zoneCounts.p1.hand).toBe(4)
    expect(resolvedSpell.players.p1.life).toBe(commanderRules.startingLife)
    expect(resolvedSpell.stack.some((item) => item.actionId === 'draw')).toBe(false)
    expect(resolvedSpell.stack.filter((item) => item.name === 'Queza-like')).toHaveLength(0)
    expect(resolvedSpell.pendingTriggers).toHaveLength(3)
    const selection = pendingSelectionFor(resolvedSpell, 'p1')!
    expect(selection.candidates).toContain(discardId)

    const discarded = ok(server.rules(resolvedSpell, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [discardId],
    }))
    expect(discarded.objects[spellId].zone).toBe('graveyard')
    expect(discarded.objects[discardId].zone).toBe('graveyard')
    expect(discarded.stack.filter((item) => item.name === 'Queza-like')).toHaveLength(3)
    expect(discarded.priority).toBe(priorityBefore)

    const afterFirstQueza = ok(server.rules(discarded, { type: 'resolveTop' }))
    expect(afterFirstQueza.players.p1.life).toBe(commanderRules.startingLife - 1)

    let current = afterFirstQueza
    for (let life = 2; life <= 3; life += 1) {
      current = ok(server.rules(current, { type: 'resolveTop' }))
      expect(current.players.p1.life).toBe(commanderRules.startingLife - life)
    }

    expect(current.stack).toHaveLength(0)
    expect(current.players.p1.life).toBe(commanderRules.startingLife - 3)
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

  test('eachPlayerDraw enqueues draw events that finish during spell resolution', () => {
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

    expect(resolvedSpell.stack.some((item) => item.actionId === 'draw')).toBe(false)
    expect(resolvedSpell.zoneCounts.p1.hand).toBe(2)
    expect(resolvedSpell.zoneCounts.p2.hand).toBe(2)
    expect(resolvedSpell.objects[spellId].zone).toBe('graveyard')
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

  test('successful draws increment cards drawn this turn and empty-library draws do not', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [card('First'), card('Second')] },
      players: 2,
    })

    const first = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(cardsDrawnThisTurn(first.players.p1)).toBe(1)
    const second = ok(server.rules(first, { type: 'draw', seat: 'p1' }))
    expect(cardsDrawnThisTurn(second.players.p1)).toBe(2)

    const empty = createServerGame(commanderRules, { players: 2 })
    const lost = ok(empty.rules(empty.state, { type: 'draw', seat: 'p1' }))
    expect(lost.players.p1.lost).toBe(true)
    expect(cardsDrawnThisTurn(lost.players.p1)).toBe(0)
  })

  test('cards drawn this turn clear when a player untaps', () => {
    const server = createServerGame(commanderRules, {
      libraries: { p1: [card('Drawn')] },
      players: 2,
    })
    const drawn = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(cardsDrawnThisTurn(drawn.players.p1)).toBe(1)

    const nextTurn = ok(server.rules({ ...drawn, step: 'cleanup' }, { type: 'advanceStep' }))
    expect(nextTurn.step).toBe('untap')
    expect(cardsDrawnThisTurn(nextTurn.players.p1)).toBe(0)
  })
})


const lossProtectionFixture = (cardPlugins: Plugin[] = []) => {
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [instructionSpell({ instructions: [createPlayerEffect({
      targets: ref('controller'), playerEffect: PLAYER_EFFECTS.cannotLoseGame,
      duration: PLAYER_EFFECT_DURATIONS.untilCleanup,
    })] })] },
  }, { random: () => 0, cardPlugins })
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
  })))
  return { server, state }
}

test('a protected failed draw is consumed at its checkpoint, not deferred until protection expires', () => {
  const { server, state } = lossProtectionFixture()
  const protectedDraw = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
  expect(protectedDraw.players.p1.lost).toBe(false)
  expect(protectedDraw.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBeUndefined()
  const restored = restoreJournal(createJournal(protectedDraw), server.rules).current()
  const cleanup = ok(server.rules({ ...restored, step: 'end', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' }))
  expect(cleanup.players.p1.lost).toBe(false)
  const nextDraw = ok(server.rules(cleanup, { type: 'draw', seat: 'p1' }))
  expect(nextDraw.players.p1.lost).toBe(true)
  expect(nextDraw.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBeUndefined()
})

test('failed draws survive a suspended resolution and restore until the first actual SBA check', () => {
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [instructionSpell({ instructions: [
      drawInstruction({ targets: ref('controller'), count: 1 }),
      chooseCards({ chooser: ref('controller'), filter: objects({ zone: 'hand', owner: 'you' }), count: 1, bindChoice: 'chosen' }),
    ] }), card('Selection fixture')] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  const paused = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(paused.players.p1.lost).toBe(false)
  expect(paused.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBe(true)
  const restored = restoreJournal(createJournal(paused), server.rules).current()
  const pick = pendingSelectionFor(restored, 'p1')!
  const completed = ok(server.rules(restored, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1,
    objectIds: [restored.zoneOrder.p1.hand[0]],
  }))
  expect(completed.players.p1.lost).toBe(true)
  expect(completed.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBeUndefined()
})

test('a fresh failed draw during an SBA wave is evaluated by the next check', () => {
  const drawDuringSba: Plugin = {
    id: 'fixture.drawDuringSba',
    sba: ({ state }) => state.players.p1.data[FAILED_DRAW_SINCE_SBA] === true
      ? [{ type: 'draw', seat: 'p2' }]
      : [],
  }
  const { server, state } = lossProtectionFixture([drawDuringSba])
  const checked = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
  expect(checked.players.p1.lost).toBe(false)
  expect(checked.players.p2.lost).toBe(true)
  expect(checked.players.p2.data[FAILED_DRAW_SINCE_SBA]).toBeUndefined()
})
