import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  chooseCards,
  distribution,
  gainLife,
  objects,
  payOptional,
  ref,
  sacrificeCost,
  select,
  spell,
  target,
  players,
  putCounters,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { pendingOptionSelection } from '../../rules/selectOptions'

describe('reflexivePayment', () => {

  test('paid reflexive targets are announced after the parent finishes and survive restart', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 1),
        bindResult: 'paid',
        ifPaid: [],
        ifDeclined: [],
        whenPaidDecisions: { targets: [select({ filter: players({}), count: 1 })] },
        whenPaid: [gainLife({ amount: 1, targets: target(0) })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Reflexive payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Reflexive payment creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Reflexive payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    if (!started.ok) return
    const offer = started.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    if (!paid.ok) return
    const selection = pendingSelectionFor(paid.state, 'p1')!
    const restored = JSON.parse(JSON.stringify(paid.state))
    const restoredSelection = pendingSelectionFor(restored, 'p1')!
    const completed = server.rules(restored, { type: 'selectCards', seat: 'p1', selectionId: restoredSelection.id, kind: 'sacrifice', count: 1, objectIds: [selection.candidates[0]!] })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    const targetOffer = pendingPlayerSelectionFor(completed.state, 'p1')
    expect(targetOffer?.candidates).toEqual(['p1', 'p2'])
    expect(completed.state.resolution).toBeUndefined()
  })

  test('paid callback preserves chosen cards, paid result, and X across shroud and JSON restart', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [], variables: [{ name: 'X', min: 1, max: 4 }] },
      instructions: [
        chooseCards({
          bindChoice: 'saved', chooser: ref('controller'),
          filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1,
        }),
        payOptional({
          payer: ref('controller'),
          cost: { kind: 'life', amount: { kind: 'constant', value: 1 } },
          bindResult: 'paid', ifPaid: [], ifDeclined: [],
          whenPaidDecisions: { targets: [] },
          whenPaid: [{
            kind: 'if',
            condition: { kind: 'resultIsTrue', value: { kind: 'resultRef', binding: 'paid', field: 'paid' } },
            then: [putCounters({
              targets: { kind: 'choiceRef', binding: 'saved' },
              counter: '+1/+1', count: { kind: 'variable', name: 'X',
              },
            })],
            otherwise: [],
          }],
        }),
      ],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Captured callback spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Captured callback target', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Captured callback spell')!
    const targetObject = Object.values(server.state.objects).find((object) => object.name === 'Captured callback target')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id, x: 2 })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const choice = pendingSelectionFor(started.state, 'p1')!
    const picked = server.rules(started.state, {
      type: 'selectCards', seat: 'p1', selectionId: choice.id, kind: 'choose', count: 1, objectIds: [targetObject.id],
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    const offer = pendingOptionSelection(picked.state, 'p1')!
    const paid = server.rules(picked.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const restarted = JSON.parse(JSON.stringify(paid.state))
    restarted.objects[targetObject.id]!.oracleText = 'Shroud'
    const resumed = server.rules(restarted, { type: 'resolveTop' })
    expect(resumed.ok).toBe(true)
    if (resumed.ok) expect(resumed.state.objects[targetObject.id]?.counters['+1/+1']).toBe(2)
  })

  test('paid callback does not reuse the parent allocation for its fresh target', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: {
        targets: [select({ filter: players({}), count: 1 })],
        distributions: [distribution({ targetClauseIndex: 0, total: 5, minEach: 1 })],
      },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: { kind: 'life', amount: amount(1) },
        bindResult: 'paid', ifPaid: [], ifDeclined: [],
        whenPaidDecisions: { targets: [select({ filter: players({}), count: 1 })] },
        whenPaid: [gainLife({ amount: 3, targets: target(0) })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Fresh allocation callback', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Fresh allocation callback')!
    const cast = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spellObject.id,
      targetClauses: [[{ kind: 'player', player: 'p2' }]],
      distributionBindings: [{ scopeId: '$.abilities[0]', clauseIndex: 0, amounts: [5] }],
    } as any)
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const targetOffer = pendingPlayerSelectionFor(paid.state, 'p1')!
    const completed = server.rules(paid.state, {
      type: 'selectPlayers', seat: 'p1', selectionId: targetOffer.id, players: ['p2'],
    })
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      const resolved = server.rules(completed.state, { type: 'resolveTop' })
      expect(resolved.ok).toBe(true)
      if (resolved.ok) expect(resolved.state.players.p2.life).toBe(43)
    }
  })

  test('paid callback announces and consumes its own fresh distribution', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [], variables: [{ name: 'X', min: 1, max: 2 }] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: { kind: 'life', amount: amount(1) },
        bindResult: 'paid', ifPaid: [], ifDeclined: [],
        whenPaidDecisions: {
          targets: [select({ filter: players({}), count: { kind: 'variable', name: 'X' } })],
          distributions: [distribution({ targetClauseIndex: 0, total: { kind: 'variable', name: 'X' }, minEach: 1 })],
        },
        whenPaid: [gainLife({ amount: { kind: 'variable', name: 'X' }, targets: target(0) })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Fresh callback distribution', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Fresh callback distribution')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id, x: 2 })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const targetOffer = pendingPlayerSelectionFor(paid.state, 'p1')!
    const selected = server.rules(paid.state, {
      type: 'selectPlayers', seat: 'p1', selectionId: targetOffer.id, players: ['p1', 'p2'],
    })
    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    const allocation = pendingOptionSelection(selected.state, 'p1')!
    const first = server.rules(selected.state, {
      type: 'selectOption', seat: 'p1', selectionId: allocation.id, optionId: 'allocation:0:1',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = pendingOptionSelection(first.state, 'p1')!
    const completed = server.rules(first.state, {
      type: 'selectOption', seat: 'p1', selectionId: second.id, optionId: 'allocation:1:1',
    })
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      const resolved = server.rules(completed.state, { type: 'resolveTop' })
      expect(resolved.ok).toBe(true)
      if (resolved.ok) {
        expect(resolved.state.players.p1.life).toBe(40)
        expect(resolved.state.players.p2.life).toBe(41)
      }
    }
  })

  test('paid callback keeps an entering parent occurrence through JSON restart', () => {
    const triggeredAbility = {
      kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'enters', filter: { type: 'Creature' } },
      decisions: { targets: [] }, instructions: [payOptional({
        payer: ref('controller'),
        cost: { kind: 'life', amount: amount(1) },
        bindResult: 'paid', ifPaid: [], ifDeclined: [],
        whenPaid: [putCounters({
          targets: ref('triggering.object.after'), counter: '+1/+1', count: amount(1),
        })],
      })],
    } as never
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([triggeredAbility])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Paid occurrence source', { types: ['Enchantment'], ruleDefinition: definition })] },
      hands: { p1: [cardTemplate('Paid occurrence creature', { types: ['Creature'], power: 2, toughness: 3 })] },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const moved = server.rules(server.state, { type: 'move', objectId: get('Paid occurrence creature').id, to: 'battlefield' })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    const started = server.rules(moved.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const restarted = JSON.parse(JSON.stringify(paid.state))
    const resolved = server.rules(restarted, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.objects[get('Paid occurrence creature').id]?.counters['+1/+1']).toBe(1)
  })
})
