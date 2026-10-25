import { resolveStack } from '../../testHelpers'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  gainLife,
  payOptional,
  ref,
  replaceWith,
  replacement,
  sacrificeCost,
  spell,
  staticAbility,
  suppressEvent,
  wouldDraw,
  wouldEnter,
  chooseColor,
  objects,
  amount,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import type { GameState, Plugin, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const millTop: Plugin = {
  id: 'test.millTop',
  replace: ({ state, event }) => {
    if (event.type !== 'draw') return
    const top = state.zoneOrder[event.seat]?.library[0]
    if (!top) return null
    return { type: 'mill', seat: event.seat, objectId: top }
  },
}

const preventDraw: Plugin = {
  id: 'test.preventDraw',
  replace: ({ event }) => (event.type === 'draw' ? null : undefined),
}

describe('replacements', () => {
  test('competing modifiers expose legal player choices', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Top Card')] },
    }, { random: () => 0, cardPlugins: [millTop, preventDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.eventProcessing).toBeDefined()
    expect(pendingOptionSelection(state, 'p1')?.options.length).toBeGreaterThanOrEqual(2)
    const pending = pendingOptionSelection(state, 'p1')!
    const millOption = pending.options.find((option) => option.label === 'test.millTop')!
    const afterChoice = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: millOption.id,
    }))
    expect(afterChoice.eventProcessing).toBeUndefined()
    expect(afterChoice.zoneOrder.p1.graveyard).toHaveLength(1)
    expect(afterChoice.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('replaced draws do not create draw occurrences', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Card')] },
    }, { random: () => 0, cardPlugins: [preventDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.log.some((line) => line.startsWith('p1 draws'))).toBe(false)
  })

  test('used-instance ledgers prevent recursion without disabling other copies', () => {
    let passes = 0
    const loopDraw: Plugin = {
      id: 'test.loopDraw',
      replace: ({ event }) => {
        if (event.type !== 'draw') return
        passes += 1
        return { type: 'draw', seat: event.seat, count: 1 }
      },
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('A'), cardTemplate('B')] },
    }, { random: () => 0, cardPlugins: [loopDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(passes).toBe(1)
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
  })

  test('replacement of a cost component works inside the announcement transaction', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 1),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: amount(3), targets: ref('controller') })],
        ifDeclined: [],
      })],
    })])))
    const toExile: Plugin = {
      id: 'test.sacrificeToExile',
      replace: ({ event }) => (event.type === 'move' && event.to === 'graveyard'
        ? { ...event, to: 'exile' as const }
        : undefined),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Payment creature', { types: ['Creature'] })] },
    }, { random: () => 0, cardPlugins: [toExile] })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Payment spell')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Payment creature')!
    let state = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const offer = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' }))
    const selection = pendingSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: selection.id,
      kind: 'sacrifice',
      count: 1,
      objectIds: [creature.id],
    }))
    expect(state.objects[creature.id]?.zone).toBe('exile')
    expect(state.players.p1.life).toBe(43)
  })

  test('reconnect during a replacement resumes the same event and program', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Top Card')] },
    }, { random: () => 0, cardPlugins: [millTop, preventDraw] })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const frameId = state.eventProcessing!.id
    const lineageId = state.eventProcessing!.lineage.id
    const pending = pendingOptionSelection(state, 'p1')!
    const restored = JSON.parse(JSON.stringify(state)) as GameState
    expect(restored.eventProcessing?.id).toBe(frameId)
    expect(restored.eventProcessing?.lineage.id).toBe(lineageId)
    const millOption = pending.options.find((option) => option.label === 'test.millTop')!
    const resumed = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: millOption.id,
    }))
    expect(resumed.eventProcessing).toBeUndefined()
    expect(resumed.zoneOrder.p1.graveyard).toHaveLength(1)
  })

  test('canonical replacements apply from static definitions', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldDraw(), suppressEvent())),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: definition })] },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0 })
    const state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('optional replacement stays choosable next to a mandatory prevent', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(
        wouldDraw(),
        replaceWith(gainLife({ amount: amount(1), targets: ref('controller') })),
        { optional: true },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Optional life', { types: ['Enchantment'], ruleDefinition: definition })],
      },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0, cardPlugins: [preventDraw] })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const pending = pendingOptionSelection(state, 'p1')
    expect(pending).toBeDefined()
    const lifeOption = pending!.options.find((option) => option.label === 'Optional life')
    expect(lifeOption).toBeDefined()
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending!.id,
      optionId: lifeOption!.id,
    }))
    expect(state.players.p1.life).toBe(41)
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('a second waiting replacement defers without overwriting the first frame', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: {
        p1: [cardTemplate('P1 Card')],
        p2: [cardTemplate('P2 Card')],
      },
    }, { random: () => 0, cardPlugins: [millTop, preventDraw] })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
    const firstId = state.eventProcessing!.id
    const firstSelection = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'draw', seat: 'p2' }))
    expect(state.eventProcessing?.id).toBe(firstId)
    expect(state.deferredEventProcessing).toHaveLength(1)
    expect(pendingOptionSelection(state, 'p1')?.id).toBe(firstSelection.id)
    expect(pendingOptionSelection(state, 'p2')).toBeDefined()

    const chooseMill = (active: GameState, seat: 'p1' | 'p2') => {
      const pending = pendingOptionSelection(active, seat)!
      const mill = pending.options.find((option) => option.label === 'test.millTop')!
      return ok(server.rules(active, {
        type: 'selectOption',
        seat,
        selectionId: pending.id,
        optionId: mill.id,
      }))
    }

    const p1First = chooseMill(JSON.parse(JSON.stringify(state)) as GameState, 'p1')
    expect(p1First.zoneOrder.p1.graveyard).toHaveLength(1)
    expect(p1First.eventProcessing?.id).toBe(state.deferredEventProcessing![0]!.id)
    expect(pendingOptionSelection(p1First, 'p2')).toBeDefined()
    const p1ThenP2 = chooseMill(p1First, 'p2')
    expect(p1ThenP2.eventProcessing).toBeUndefined()
    expect(p1ThenP2.zoneOrder.p2.graveyard).toHaveLength(1)

    const p2First = chooseMill(JSON.parse(JSON.stringify(state)) as GameState, 'p2')
    expect(p2First.zoneOrder.p2.graveyard).toHaveLength(1)
    expect(p2First.eventProcessing?.id).toBe(firstId)
    expect(pendingOptionSelection(p2First, 'p1')?.id).toBe(firstSelection.id)
    const p2ThenP1 = chooseMill(p2First, 'p1')
    expect(p2ThenP1.eventProcessing).toBeUndefined()
    expect(p2ThenP1.zoneOrder.p1.graveyard).toHaveLength(1)
  })

  test('post-choice replaceWith instructions run instead of the original event', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(
        wouldEnter(),
        replaceWith(gainLife({ amount: amount(3), targets: ref('controller') })),
        { program: [chooseColor()] },
      )),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Color chooser', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const artifact = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: artifact.id, to: 'battlefield' }))
    expect(paused.objects[artifact.id].zone).toBe('hand')
    const restored = JSON.parse(JSON.stringify(paused)) as GameState
    const pending = pendingOptionSelection(restored, 'p1')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    const finished = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'G',
    }))
    expect(finished.players.p1.life).toBe(43)
    expect(finished.objects[artifact.id].zone).toBe('hand')
    expect(finished.eventProcessing).toBeUndefined()
  })
})

test('deferred replacement choices for the same player reopen after the first answer', () => {
  const server = createServerGame(commanderRules, { players: 2, libraries: { p1: [cardTemplate('First'), cardTemplate('Second')] } }, { random: () => 0, cardPlugins: [millTop, preventDraw] })
  let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1' }))
  state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
  expect(state.deferredEventProcessing).toHaveLength(1)
  for (let i = 0; i < 2; i++) {
    const choice = pendingOptionSelection(state, 'p1')!
    expect(choice).toBeDefined()
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options.find(option => option.label === 'test.millTop')!.id }))
  }
  expect(state.eventProcessing).toBeUndefined()
  expect(state.zoneOrder.p1.graveyard).toHaveLength(2)
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

test('an entry exile program composes with a static graveyard destination replacement', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Doomed Bear', { types: ['Creature'], power: 2, toughness: 2 })],
    },
    hands: {
      p1: [cardTemplate('Rest in Peace', { types: ['Enchantment'] }), cardTemplate('Your Gy Card'), cardTemplate('Discarded Thought')],
      p2: [cardTemplate('Their Gy Card')],
    },
  }, { random: () => 0 })
  const rest = named(server.state, 'Rest in Peace')
  const yours = named(server.state, 'Your Gy Card')
  const theirs = named(server.state, 'Their Gy Card')
  const bear = named(server.state, 'Doomed Bear')
  const thought = named(server.state, 'Discarded Thought')
  expect(rest.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Rest in Peace'))
  expect(rest.effects).toEqual([])
  const yoursBuried = ok(server.rules(server.state, { type: 'move', objectId: yours.id, to: 'graveyard' }))
  const theirsBuried = ok(server.rules(yoursBuried, { type: 'move', objectId: theirs.id, to: 'graveyard' }))
  expect(theirsBuried.objects[yours.id].zone).toBe('graveyard')
  expect(theirsBuried.objects[theirs.id].zone).toBe('graveyard')
  const entered = ok(server.rules(theirsBuried, { type: 'move', objectId: rest.id, to: 'battlefield' }))
  expect(entered.stack).toHaveLength(1)
  const afterEtb = resolveStack(server.rules, entered)
  expect(afterEtb.objects[yours.id].zone).toBe('exile')
  expect(afterEtb.objects[theirs.id].zone).toBe('exile')
  expect(afterEtb.zoneOrder.p1.graveyard).toHaveLength(0)
  expect(afterEtb.zoneOrder.p2.graveyard).toHaveLength(0)
  const destroyed = ok(server.rules(afterEtb, { type: 'destroy', objectId: bear.id }))
  expect(destroyed.objects[bear.id].zone).toBe('exile')
  const discarded = ok(server.rules(destroyed, { type: 'move', objectId: thought.id, to: 'graveyard' }))
  expect(discarded.objects[thought.id].zone).toBe('exile')
  expect(discarded.zoneOrder.p1.graveyard).toHaveLength(0)
})
