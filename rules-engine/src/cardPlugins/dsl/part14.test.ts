import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  discard,
  draw,
  ifThen,
  mill,
  players,
  ref,
  replaceWith,
  replacement,
  result,
  staticAbility,
  wouldDraw,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { beginDrawStepInstance, enterAdditionalDrawStep } from '../../rules/drawStepHistory'
import { makeDraft, freezeDraft } from '../../draft'
import type { GameState, Plugin, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const chains = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({
      player: players({ relation: 'any' }),
      firstDrawInOwnDrawStep: false,
    }),
    replaceWith(
      discard({ count: amount(1), targets: ref('event.player'), bindResult: 'discard' }),
      ifThen(result('discard', 'discarded'), {
        then: [draw({ count: amount(1), targets: ref('event.player') })],
        otherwise: [mill({ count: amount(1), targets: ref('event.player') })],
      }),
    ),
  )),
])))

const namedZone = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)?.zone

const ownDrawStep = (state: GameState, seat: 'p1' | 'p2') => {
  const draft = makeDraft(state)
  draft.step = 'draw'
  draft.active = seat
  beginDrawStepInstance(draft, seat)
  return freezeDraft(draft)
}

const preventDiscard: Plugin = {
  id: 'test.preventDiscard',
  replace: ({ event }) => (event.type === 'discard' ? null : undefined),
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

const answerDiscard = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  restore = false,
) => {
  const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
  const pending = pendingSelectionFor(working, 'p1')!
  const handId = working.zoneOrder.p1.hand[0]!
  return ok(server.rules(working, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: pending.id,
    kind: 'discard',
    count: 1,
    objectIds: [handId],
  }))
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
