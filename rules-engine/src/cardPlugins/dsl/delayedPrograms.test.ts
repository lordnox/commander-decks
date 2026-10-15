import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createDelayed,
  eventDelayed,
  gainLife,
  objects,
  ref,
  spell,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'

describe('delayedPrograms', () => {

  test('a delayed canonical draw program survives its source leaving and JSON restart', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [],
      decisions: { targets: [] },
      instructions: [createDelayed({
        condition: eventDelayed({ type: 'draw' }),
        instructions: [gainLife({ amount: 2, targets: ref('controller') })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Delayed source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      libraries: { p1: [cardTemplate('Delayed draw')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Delayed source')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.objects[source.id]?.zone).toBe('graveyard')
    expect(resolved.state.delayedTriggers).toHaveLength(1)
    const restarted = JSON.parse(JSON.stringify(resolved.state))
    const drawn = server.rules(restarted, { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    expect(drawn.state.stack).toHaveLength(1)
    const delayedResolved = server.rules(drawn.state, { type: 'resolveTop' })
    expect(delayedResolved.ok).toBe(true)
    if (delayedResolved.ok) expect(delayedResolved.state.players.p1.life).toBe(42)
  })

  test('a delayed program retains a parent card choice after JSON restart', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [],
      decisions: { targets: [] },
      instructions: [
        {
          kind: 'chooseCards',
          bindChoice: 'saved', chooser: ref('controller'),
          filter: objects({ zone: 'battlefield', type: 'Creature' }),
          min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, distinct: true, whenInsufficient: 'chooseAvailable',
        },
        createDelayed({
          condition: eventDelayed({ type: 'draw' }),
          instructions: [{ kind: 'putCounters', targets: { kind: 'choiceRef', binding: 'saved' }, counter: '+1/+1', count: { kind: 'constant', value: 1 } }],
        }),
      ],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Choice delayed source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Choice delayed target', { types: ['Creature'], power: 2, toughness: 2 })] },
      libraries: { p1: [cardTemplate('Choice delayed draw')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Choice delayed source')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const announced = server.rules(cast.state, { type: 'resolveTop' })
    expect(announced.ok).toBe(true)
    if (!announced.ok) return
    const pick = pendingSelectionFor(announced.state, 'p1')!
    const target = pick.candidates[0]!
    const chosen = server.rules(announced.state, {
      type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose',
      count: pick.count, objectIds: [target],
    })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) return
    const restarted = JSON.parse(JSON.stringify(chosen.state))
    restarted.objects[target]!.oracleText = 'Shroud'
    const drawn = server.rules(restarted, { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const resolved = server.rules(drawn.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.objects[target]?.counters['+1/+1']).toBe(1)
  })

  test('a delayed program keeps its parent target binding after the parent resolves', () => {
    const clause = {
      filter: { kind: 'players' as const, filter: {} },
      min: { kind: 'constant' as const, value: 1 },
      max: { kind: 'constant' as const, value: 1 },
      distinct: true as const,
    }
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [],
      decisions: { targets: [clause] },
      instructions: [createDelayed({
        condition: eventDelayed({ type: 'draw' }),
        instructions: [gainLife({ amount: 1, targets: { kind: 'targetRef', clauseIndex: 0 } })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Inherited delayed source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      libraries: { p1: [cardTemplate('Inherited delayed draw')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Inherited delayed source')!
    const cast = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: source.id,
      targetClauses: [[{ kind: 'player', player: 'p2' }]],
    })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const drawn = server.rules(JSON.parse(JSON.stringify(resolved.state)), { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const delayedResolved = server.rules(drawn.state, { type: 'resolveTop' })
    expect(delayedResolved.ok).toBe(true)
    if (delayedResolved.ok) expect(delayedResolved.state.players.p2.life).toBe(41)
  })

  test('a delayed callback keeps its parent trigger occurrence after JSON restart', () => {
    const triggeredAbility = {
      kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'enters', filter: { type: 'Creature' } },
      decisions: { targets: [] }, instructions: [createDelayed({
        condition: { kind: 'event', type: 'draw' },
        instructions: [{ kind: 'putCounters', targets: ref('triggering.object.after'), counter: '+1/+1', count: { kind: 'constant', value: 1 } }],
      })],
    } as never
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([triggeredAbility])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Occurrence source', { types: ['Enchantment'], ruleDefinition: definition })] },
      hands: { p1: [cardTemplate('Occurrence creature', { types: ['Creature'], power: 2, toughness: 3 })] },
      libraries: { p1: [cardTemplate('Occurrence draw')] },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const moved = server.rules(server.state, { type: 'move', objectId: get('Occurrence creature').id, to: 'battlefield' })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    const triggered = server.rules(moved.state, { type: 'resolveTop' })
    expect(triggered.ok).toBe(true)
    if (!triggered.ok) return
    const drawn = server.rules(JSON.parse(JSON.stringify(triggered.state)), { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const resolved = server.rules(drawn.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.objects[get('Occurrence creature').id]?.counters['+1/+1']).toBe(1)
  })
})
