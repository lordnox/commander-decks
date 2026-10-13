import { describe, expect, test } from 'bun:test'
import {
  activated,
  amount,
  card,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  drawCost,
  gainLife,
  manaCost,
  mill,
  players,
  ref,
  replaceWith,
  replacement,
  staticAbility,
  variable,
  wouldDraw,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { enterAdditionalDrawStep } from '../../rules/drawStepHistory'
import { FAILED_DRAW_SINCE_SBA } from '../../rules/draw'
import { makeDraft, freezeDraft } from '../../draft'
import { gainLife as effectGainLife, triggerOn } from '../effects'
import type { GameState, Plugin, ReduceResult } from '../../types'
import {
  answerDiscard,
  chainsDefinition as chains,
  ownDrawStep,
  pickReplacement,
} from './dslTestSupport'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const namedZone = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)?.zone

const preventDiscard: Plugin = {
  id: 'test.preventDiscard',
  replace: ({ event }) => (event.type === 'discard' ? null : undefined),
}

const discardToGainLife: Plugin = {
  id: 'test.discardToGainLife',
  replace: ({ event }) => (
    event.type === 'discard'
      ? { type: 'gainLife' as const, seat: event.seat, amount: 1 }
      : undefined
  ),
}

const exileDiscardDestination: Plugin = {
  id: 'test.exileDiscardDestination',
  replace: ({ event }) => (
    event.type === 'move' && event.to === 'graveyard'
      ? { ...event, to: 'exile' as const }
      : undefined
  ),
}

const preventMoveToGraveyard: Plugin = {
  id: 'test.preventMoveToGraveyard',
  replace: ({ event }) => (event.type === 'move' && event.to === 'graveyard' ? null : undefined),
}

const moveDiscardToLibrary: Plugin = {
  id: 'test.moveDiscardToLibrary',
  replace: ({ event }) => (
    event.type === 'move' && event.to === 'graveyard'
      ? { ...event, to: 'library' as const }
      : undefined
  ),
}

describe('Rule DSL Part 14 draw history and Chains replacement', () => {
  test('first actual draw in own draw step is exempt from Chains', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      libraries: { p1: [cardTemplate('Top')] },
    }, { random: () => 0 })
    const state = ok(server.rules(ownDrawStep(server.state, 'p1'), { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test('Chains replaces the second draw in the same draw step', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Hand Card')] },
      libraries: { p1: [cardTemplate('Lib A'), cardTemplate('Lib B')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    const pending = pendingSelectionFor(state, 'p1')
    expect(pending?.kind).toBe('discard')
    const handId = state.zoneOrder.p1.hand[0]!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pending!.id,
      kind: 'discard',
      count: 1,
      objectIds: [handId],
    }))
    expect(state.zoneOrder.p1.graveyard).toContain(handId)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p1.hand[0]).not.toBe(handId)
  })

  test('empty hand mills instead of drawing', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      libraries: { p1: [cardTemplate('Mill Me')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.graveyard).toHaveLength(1)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('draw in another player draw step is affected even as first draw that turn', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p2: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('P1 Hand')] },
      libraries: { p1: [cardTemplate('Lib')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p2')
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
  })

  test('one Chains does not apply twice to the follow-up draw', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2')] },
      libraries: { p1: [cardTemplate('L1')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    const pending = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pending.id,
      kind: 'discard',
      count: 1,
      objectIds: [state.zoneOrder.p1.hand[0]!],
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  })

  test('reconnect during mandatory discard resumes the replacement program', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Hold')] },
      libraries: { p1: [cardTemplate('Drawn')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    const pending = pendingSelectionFor(state, 'p1')!
    expect(state.eventProcessing?.id).toBeDefined()
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    const handId = restored.zoneOrder.p1.hand[0]!
    const resumed = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pending.id,
      kind: 'discard',
      count: 1,
      objectIds: [handId],
    }))
    expect(resumed.eventProcessing?.id).toBeUndefined()
    expect(resumed.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('competing replacements let the player choose', () => {
    const preventDraw: Plugin = {
      id: 'test.preventDraw',
      replace: ({ event }) => (event.type === 'draw' ? null : undefined),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('H')] },
      libraries: { p1: [cardTemplate('L')] },
    }, { random: () => 0, cardPlugins: [preventDraw] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingOptionSelection(state, 'p1')?.options.length).toBeGreaterThanOrEqual(2)
  })

  test('non-draw replacement does not consume the first-draw exemption', () => {
    const toMill = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(
        wouldDraw(),
        replaceWith(mill({ count: amount(1), targets: ref('event.player') })),
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Mill replacer', { types: ['Enchantment'], ruleDefinition: toMill() }),
          cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() }),
        ],
      },
      hands: { p1: [cardTemplate('Later hand')] },
      libraries: { p1: [cardTemplate('A'), cardTemplate('B')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.graveyard).toHaveLength(1)
    expect(state.drawStepTracking?.actualDraws?.p1 ?? 0).toBe(0)
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  })

  test('draw three completes three independent discard-then-draw procedures through restore', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2'), cardTemplate('H3')] },
      libraries: { p1: [cardTemplate('L1'), cardTemplate('L2'), cardTemplate('L3')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1', count: 3 }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.eventProcessing?.pendingEvent).toMatchObject({ type: 'draw', count: 1, remainingAfter: 2 })
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.eventProcessing).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
    expect(state.zoneOrder.p1.graveyard).toHaveLength(3)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    expect(state.zoneOrder.p1.hand.every((id) => state.objects[id].name.startsWith('L'))).toBe(true)
    expect(state.zoneOrder.p1.graveyard.every((id) => state.objects[id].name.startsWith('H'))).toBe(true)
  })

  test('a prevented discard binds failure and mills instead of drawing', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Keep')] },
      libraries: { p1: [cardTemplate('Mill Me'), cardTemplate('Later')] },
    }, { random: () => 0, cardPlugins: [preventDiscard] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(namedZone(state, 'Keep')).toBe('hand')
    expect(namedZone(state, 'Mill Me')).toBe('graveyard')
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p1.library).toHaveLength(1)
  })

  test('a discard replaced with another action binds failure and mills instead of drawing', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('H')] },
      libraries: { p1: [cardTemplate('L')] },
    }, { random: () => 0, cardPlugins: [discardToGainLife] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    const life = state.players.p1.life
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(namedZone(state, 'H')).toBe('hand')
    expect(namedZone(state, 'L')).toBe('graveyard')
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.players.p1.life).toBe(life + 1)
  })

  test('a prevented discard destination binds failure and mills instead of drawing', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Keep')] },
      libraries: { p1: [cardTemplate('Mill Me'), cardTemplate('Later')] },
    }, { random: () => 0, cardPlugins: [preventMoveToGraveyard] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(namedZone(state, 'Keep')).toBe('hand')
    expect(namedZone(state, 'Mill Me')).toBe('graveyard')
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.zoneOrder.p1.library).toHaveLength(1)
  })

  test('a discarded card still captures its discard trigger through restore', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() }),
          cardTemplate('Discard Watcher', {
            types: ['Enchantment'],
            effects: [triggerOn('discard', { do: [effectGainLife(3)] })],
          }),
        ],
      },
      hands: { p1: [cardTemplate('H')] },
      libraries: { p1: [cardTemplate('L')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(namedZone(state, 'H')).toBe('graveyard')
    expect(namedZone(state, 'L')).toBe('hand')
    const watcherAbilities = () =>
      state.stack.filter((item) => item.kind === 'ability' && item.name === 'Discard Watcher')
    expect(watcherAbilities()).toHaveLength(1)
    expect(state.pendingTriggers).toBeUndefined()
    state = JSON.parse(JSON.stringify(state)) as GameState
    expect(watcherAbilities()).toHaveLength(1)
    const life = state.players.p1.life
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(life + 3)
    expect(watcherAbilities()).toHaveLength(0)
  })

  test('a redirected discard destination still counts as discarded and draws', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Exiled')] },
      libraries: { p1: [cardTemplate('Drawn')] },
    }, { random: () => 0, cardPlugins: [exileDiscardDestination] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(namedZone(state, 'Exiled')).toBe('exile')
    expect(namedZone(state, 'Drawn')).toBe('hand')
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('a suspended discard destination binds after the choice and draws', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Exiled')] },
      libraries: { p1: [cardTemplate('Drawn')] },
    }, { random: () => 0, cardPlugins: [exileDiscardDestination, moveDiscardToLibrary] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state, true)
    const destination = pendingOptionSelection(state, 'p1')
    expect(destination?.options.length).toBeGreaterThanOrEqual(2)
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    const offer = pendingOptionSelection(restored, 'p1')!
    const exile = offer.options.find((option) => option.label === 'test.exileDiscardDestination')!
    state = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: offer.id,
      optionId: exile.id,
    }))
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
    expect(namedZone(state, 'Exiled')).toBe('exile')
    expect(namedZone(state, 'Drawn')).toBe('hand')
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('two Chains with two cards in hand discard twice then draw once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [
        cardTemplate('Chains A', { types: ['Enchantment'], ruleDefinition: chains() }),
        cardTemplate('Chains B', { types: ['Enchantment'], ruleDefinition: chains() }),
      ] },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2')] },
      libraries: { p1: [cardTemplate('L1')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    state = pickReplacement(server, state)
    state = answerDiscard(server, state)
    state = answerDiscard(server, state)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.objects[state.zoneOrder.p1.hand[0]!].name).toBe('L1')
    expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
  })

  test('two Chains with one card in hand mills the follow-up draw', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [
        cardTemplate('Chains A', { types: ['Enchantment'], ruleDefinition: chains() }),
        cardTemplate('Chains B', { types: ['Enchantment'], ruleDefinition: chains() }),
      ] },
      hands: { p1: [cardTemplate('Only Hand')] },
      libraries: { p1: [cardTemplate('Mill Me'), cardTemplate('Stay')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    state = pickReplacement(server, state)
    state = answerDiscard(server, state)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.zoneOrder.p1.graveyard.map((id) => state.objects[id].name)).toEqual(['Only Hand', 'Mill Me'])
    expect(state.zoneOrder.p1.library).toHaveLength(1)
    expect(state.objects[state.zoneOrder.p1.library[0]!].name).toBe('Stay')
  })

  test('empty library on the draw branch sets failed-draw SBA after a successful discard', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      hands: { p1: [cardTemplate('Pay')] },
      libraries: { p1: [] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    state = answerDiscard(server, state)
    expect(state.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBe(true)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('milling an empty library is not an attempted draw', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      libraries: { p1: [] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.players.p1.data[FAILED_DRAW_SINCE_SBA]).toBeUndefined()
    expect(state.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test('draw performed as a cost is still replaced by Chains', () => {
    const payDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [drawCost(1)],
        decisions: { targets: [] },
        instructions: [gainLife({ amount: amount(1), targets: ref('controller') })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() }),
          cardTemplate('Tax Rock', { types: ['Artifact'], ruleDefinition: payDraw() }),
        ],
      },
      hands: { p1: [cardTemplate('Hand Tax')] },
      libraries: { p1: [cardTemplate('Would Draw')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Tax Rock')!
    let state = server.state
    const draft = makeDraft(state)
    draft.step = 'precombatMain'
    draft.active = 'p1'
    state = freezeDraft(draft)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: rock.id,
      abilityId: '$.abilities[0]',
    }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    state = answerDiscard(server, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    expect(state.objects[state.zoneOrder.p1.hand[0]!].name).toBe('Would Draw')
    expect(state.stack).toHaveLength(1)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.life).toBe(41)
  })

  test('a dynamic draw cost locks the player count and draws that many cards', () => {
    const payDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [drawCost(count(players({ relation: 'any' })))],
        decisions: { targets: [] },
        instructions: [gainLife({ amount: amount(1), targets: ref('controller') })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Census Rock', { types: ['Artifact'], ruleDefinition: payDraw() })] },
      libraries: { p1: [cardTemplate('A'), cardTemplate('B')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Census Rock')!
    const draft = makeDraft(server.state)
    draft.step = 'precombatMain'
    draft.active = 'p1'
    let state = freezeDraft(draft)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: rock.id,
      abilityId: '$.abilities[0]',
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.stack).toHaveLength(1)
  })

  test('an unbound X draw cost is rejected', () => {
    const payDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [drawCost(variable('X'))],
        decisions: { targets: [], variables: [{ name: 'X', min: 0, max: 10 }] },
        instructions: [gainLife({ amount: amount(1), targets: ref('controller') })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('X Rock', { types: ['Artifact'], ruleDefinition: payDraw() })] },
      libraries: { p1: [cardTemplate('A'), cardTemplate('B')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'X Rock')!
    const draft = makeDraft(server.state)
    draft.step = 'precombatMain'
    draft.active = 'p1'
    const state = freezeDraft(draft)
    const result = server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: rock.id,
      abilityId: '$.abilities[0]',
    })
    expect(result.ok).toBe(false)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.stack).toHaveLength(0)
  })

  test('a two-draw cost under Chains finishes both replacement procedures through restore', () => {
    const payDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [drawCost(2)],
        decisions: { targets: [] },
        instructions: [gainLife({ amount: amount(1), targets: ref('controller') })],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() }),
          cardTemplate('Tax Rock', { types: ['Artifact'], ruleDefinition: payDraw() }),
        ],
      },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2')] },
      libraries: { p1: [cardTemplate('L1'), cardTemplate('L2')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Tax Rock')!
    const draft = makeDraft(server.state)
    draft.step = 'precombatMain'
    draft.active = 'p1'
    let state = freezeDraft(draft)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: rock.id,
      abilityId: '$.abilities[0]',
    }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.stack).toHaveLength(0)
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.stack).toHaveLength(0)
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.stack).toHaveLength(1)
  })

  test('a two-draw mana-ability cost under Chains finishes both procedures through restore', () => {
    const payDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [drawCost(2)],
        decisions: { targets: [] },
        instructions: [{ kind: 'addMana', amount: { G: amount(1) }, targets: ref('controller') }],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() }),
          cardTemplate('Tax Rock', { types: ['Artifact'], ruleDefinition: payDraw() }),
        ],
      },
      hands: { p1: [cardTemplate('H1'), cardTemplate('H2')] },
      libraries: { p1: [cardTemplate('L1'), cardTemplate('L2')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Tax Rock')!
    const draft = makeDraft(server.state)
    draft.step = 'precombatMain'
    draft.active = 'p1'
    let state = freezeDraft(draft)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: rock.id,
      abilityId: '$.abilities[0]',
    }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.stack).toHaveLength(0)
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.stack).toHaveLength(0)
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.eventProcessing).toBeUndefined()
    expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.stack).toHaveLength(0)
    expect(state.players.p1.mana.G).toBe(1)
  })

  test('a two-draw mana-ability cost during a planned cast finishes both procedures through restore', () => {
    const payDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      activated({
        costs: [drawCost(2)],
        decisions: { targets: [] },
        instructions: [{ kind: 'addMana', amount: { G: amount(1) }, targets: ref('controller') }],
      }),
    ])))
    const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{G}')],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() }),
          cardTemplate('Tax Rock', { types: ['Artifact'], ruleDefinition: payDraw() }),
        ],
      },
      hands: {
        p1: [
          cardTemplate('H1'),
          cardTemplate('H2'),
          cardTemplate('Green Spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: spellDefinition }),
        ],
      },
      libraries: { p1: [cardTemplate('L1'), cardTemplate('L2')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Tax Rock')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Green Spell')!
    const draft = makeDraft(server.state)
    draft.step = 'precombatMain'
    draft.active = 'p1'
    let state = freezeDraft(draft)
    state = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      manaActivations: [{ objectId: rock.id, abilityId: '$.abilities[0]' }],
    }))
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.stack).toHaveLength(0)
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')?.kind).toBe('discard')
    expect(state.stack).toHaveLength(0)
    state = answerDiscard(server, state, true)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    expect(state.eventProcessing).toBeUndefined()
    expect(state.provisionalAnnouncement).toBeUndefined()
    expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
    expect(state.zoneOrder.p1.library).toHaveLength(0)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0]?.name).toBe('Green Spell')
    expect(state.players.p1.mana.G).toBe(0)
  })

  test('extra draw step starts a fresh exemption', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chains() })] },
      libraries: { p1: [cardTemplate('First'), cardTemplate('Second')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    const draft = makeDraft(state)
    enterAdditionalDrawStep(draft, 'p1')
    state = freezeDraft(draft)
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
  })
})
