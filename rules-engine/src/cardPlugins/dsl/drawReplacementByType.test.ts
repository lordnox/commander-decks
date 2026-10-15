import { describe, expect, test } from 'bun:test'
import {
  card,
  chooseInstructions,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  draw,
  objects,
  players,
  ref,
  replaceWith,
  replacement,
  revealUntil,
  staticAbility,
  wouldDraw,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'

const cardTypes = (name: string, types: string[]) => cardTemplate(name, { types })

const drawByTypeReplacement = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({ player: players({ relation: 'you' }) }),
    replaceWith(chooseInstructions({
      chooser: ref('event.player'),
      prompt: 'Draw normally, or name land or nonland for this draw.',
      options: [
        { label: 'Draw normally', instructions: [draw({ count: 1, targets: ref('event.player') })] },
        { label: 'Land', instructions: [revealUntil({
          targets: ref('event.player'),
          match: objects({ zone: 'library', type: 'Land' }),
          foundTo: 'hand',
          rest: 'orderBottom',
        })] },
        { label: 'Nonland', instructions: [revealUntil({
          targets: ref('event.player'),
          match: objects({ zone: 'library', not: { type: 'Land' } }),
          foundTo: 'hand',
          rest: 'orderBottom',
        })] },
      ],
    })),
  )),
])))

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('drawReplacementByType', () => {
  test('optional draw-by-type replacement keeps choices private and sequences multi-draw decisions', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacement source', { types: ['Enchantment'], ruleDefinition: drawByTypeReplacement() })],
      },
      libraries: {
        p1: [
          cardTypes('First Spell', ['Instant']),
          cardTypes('Wanted Land', ['Land']),
          cardTypes('Next Spell', ['Sorcery']),
        ],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    const choice = pendingOptionSelection(state, 'p1')!
    expect(choice.options.map(({ label }) => label)).toEqual(['Draw normally', 'Land', 'Nonland'])
    expect(server.project(state, 'p1').players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
    expect(server.project(state, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
    expect(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'creature',
    }).ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'instruction:1',
    }))
    expect(named(state, 'Wanted Land').zone).toBe('hand')
    const order = pendingSelectionFor(state, 'p1')!
    expect(order.candidates.map((id) => state.objects[id].name)).toEqual(['First Spell'])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'scry',
      count: 1,
      choices: [{ objectId: order.candidates[0], destination: 'bottom' }],
    }))
    const second = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: second.id,
      optionId: 'instruction:0',
    }))
    expect(named(state, 'Next Spell').zone).toBe('hand')
    expect(named(state, 'First Spell').zone).toBe('library')
    expect(pendingOptionSelection(state)).toBeUndefined()
  })

  test('multi-draw continues after the first draw is taken normally', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacement source', { types: ['Enchantment'], ruleDefinition: drawByTypeReplacement() })],
      },
      libraries: {
        p1: [
          cardTypes('Top Spell', ['Instant']),
          cardTypes('Second Spell', ['Sorcery']),
        ],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    const first = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: first.id,
      optionId: 'instruction:0',
    }))
    expect(named(state, 'Top Spell').zone).toBe('hand')
    const second = pendingOptionSelection(state, 'p1')!
    expect(second.options.map(({ label }) => label)).toEqual(['Draw normally', 'Land', 'Nonland'])
  })

  test('multi-draw continues after a top-of-library land reveal with no scry pause', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacement source', { types: ['Enchantment'], ruleDefinition: drawByTypeReplacement() })],
      },
      libraries: {
        p1: [
          cardTypes('Top Land', ['Land']),
          cardTypes('Second Spell', ['Sorcery']),
        ],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 2 }))
    const first = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: first.id,
      optionId: 'instruction:1',
    }))
    expect(named(state, 'Top Land').zone).toBe('hand')
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    const second = pendingOptionSelection(state, 'p1')!
    expect(second.options.map(({ label }) => label)).toEqual(['Draw normally', 'Land', 'Nonland'])
  })

  test('fail-to-find puts no card in hand and still orders the rest on the bottom', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Replacement source', { types: ['Enchantment'], ruleDefinition: drawByTypeReplacement() })],
      },
      libraries: {
        p1: [
          cardTypes('Only Spell', ['Instant']),
          cardTypes('Another Spell', ['Sorcery']),
        ],
      },
    }, { random: () => 0.5 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const choice = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: choice.id,
      optionId: 'instruction:1',
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    const order = pendingSelectionFor(state, 'p1')!
    expect(order.candidates.map((id) => state.objects[id].name).sort())
      .toEqual(['Another Spell', 'Only Spell'])
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'scry',
      count: 2,
      choices: order.candidates.map((objectId) => ({ objectId, destination: 'bottom' as const })),
    }))
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.zoneOrder.p1.library.map((id) => state.objects[id].name).sort())
      .toEqual(['Another Spell', 'Only Spell'])
  })
})
