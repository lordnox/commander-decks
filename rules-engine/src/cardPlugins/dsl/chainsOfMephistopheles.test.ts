import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { gainLife as effectGainLife, triggerOn } from '../effects'
import type { GameState, Plugin, ReduceResult } from '../../types'
import { answerDiscard, discardThenDrawDefinition as chains, ownDrawStep } from './dslTestSupport'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const namedZone = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)?.zone

const exileDiscardDestination: Plugin = {
  id: 'test.exileDiscardDestination',
  replace: ({ event }) => (
    event.type === 'move' && event.to === 'graveyard'
      ? { ...event, to: 'exile' as const }
      : undefined
  ),
}

const moveDiscardToLibrary: Plugin = {
  id: 'test.moveDiscardToLibrary',
  replace: ({ event }) => (
    event.type === 'move' && event.to === 'graveyard'
      ? { ...event, to: 'library' as const }
      : undefined
  ),
}

// Lifecycle cases remain assigned to #403; #460 reconciles the mechanic rows.
describe('replacement continuation lifecycle', () => {
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


})
