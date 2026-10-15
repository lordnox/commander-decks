import { describe, expect, test } from 'bun:test'
import { ref, card, compileCardRuleDefinition, createDefinitionSnapshot } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'

describe('proliferateScopes', () => {

  test('server keeps separate proliferate instruction choices and results', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [],
      decisions: { targets: [] },
      instructions: [
        { kind: 'proliferate', targets: ref('controller') },
        { kind: 'proliferate', targets: ref('controller') },
      ],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Two proliferations', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: {
        p1: [
          cardTemplate('First counter creature', { types: ['Creature'], power: 2, toughness: 2, counters: { '+1/+1': 1 } }),
          cardTemplate('Second counter creature', { types: ['Creature'], power: 2, toughness: 2, counters: { '+1/+1': 1 } }),
        ],
      },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Two proliferations')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const first = pendingSelectionFor(started.state, 'p1')
    expect(first).toBeDefined()
    if (!first) return
    const firstTarget = Object.values(started.state.objects).find((object) => object.name === 'First counter creature')!
    const secondTarget = Object.values(started.state.objects).find((object) => object.name === 'Second counter creature')!
    const firstAnswer = server.rules(started.state, { type: 'selectCards', seat: 'p1', selectionId: first.id, kind: 'choose', count: first.count, objectIds: [firstTarget.id, secondTarget.id] })
    expect(firstAnswer.ok).toBe(true)
    if (!firstAnswer.ok) return
    const second = pendingSelectionFor(firstAnswer.state, 'p1')
    expect(second).toBeDefined()
    if (!second) return
    expect(second.id).not.toBe(first.id)
    const completed = server.rules(firstAnswer.state, { type: 'selectCards', seat: 'p1', selectionId: second.id, kind: 'choose', count: second.count, objectIds: [firstTarget.id, secondTarget.id] })
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      expect(completed.state.objects[firstTarget.id]?.counters['+1/+1']).toBe(3)
      expect(completed.state.objects[secondTarget.id]?.counters['+1/+1']).toBe(3)
    }
  })
})
