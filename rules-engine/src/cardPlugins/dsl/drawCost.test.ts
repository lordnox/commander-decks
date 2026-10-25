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
  players,
  ref,
  variable,
} from './v1'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { makeDraft, freezeDraft } from '../../draft'
import type { ReduceResult } from '../../types'
import { answerDiscard, discardThenDrawDefinition as discardThenDraw } from './dslTestSupport'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('draw costs and replacement payment', () => {
  test('draw performed as a cost is still replaced', () => {
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
          cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: discardThenDraw() }),
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

  test('a two-draw cost with discard-then-draw replacement finishes both replacement procedures through restore', () => {
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
          cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: discardThenDraw() }),
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

  test('a two-draw mana-ability cost with discard-then-draw replacement finishes both procedures through restore', () => {
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
          cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: discardThenDraw() }),
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
          cardTemplate('Replacer', { types: ['Enchantment'], ruleDefinition: discardThenDraw() }),
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


})
