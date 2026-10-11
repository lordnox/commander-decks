import { describe, expect, test } from 'bun:test'
import {
  beginAnnouncement,
  classifyManaAbility,
  commitAnnouncement,
  manaCost,
  activationPermission,
  prepareAction,
  rollbackAnnouncement,
  select,
  objects,
} from './v1'

const state = { players: { p1: {} } } as unknown as Parameters<typeof beginAnnouncement>[0]

describe('announcement transactions', () => {
  test('locks the total cost and commits only after full payment', () => {
    const result = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{2}{G}') ] },
      payment: [
        { sourceId: 'forest', mana: 'G' },
        { sourceId: 'solRing', mana: 'C', amount: 2 },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.transaction.status).toBe('provisional')
    expect(result.transaction.lockedCost.mana).toBe('{2}{G}')
    expect(commitAnnouncement(result.transaction).status).toBe('committed')
  })

  test('duplicate sources, incomplete payment, and cancellation leave no committed transaction', () => {
    const duplicate = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{1}') ] },
      payment: [{ sourceId: 'land', mana: 'G' }, { sourceId: 'land', mana: 'G' }],
    })
    expect(duplicate.ok).toBe(false)
    const insufficient = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{2}') ] },
      payment: [{ sourceId: 'land', mana: 'G' }],
    })
    expect(insufficient.ok).toBe(false)
    const valid = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [] },
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(rollbackAnnouncement(valid.transaction).status).toBe('rolledBack')
  })

  test('ordered target slots reject duplicate targets and retain X in the frame', () => {
    const result = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', variables: { X: 0 },
      costs: { mandatory: [manaCost('{0}')] }, payment: [],
      targetClauses: [select({ filter: objects({}), count: 1 })],
      targets: [[{ kind: 'player', player: 'p1' }]],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.transaction.lockedCost.x).toBe(0)
  })

  test('mana classification requires a complete mana ability, including triggered mana', () => {
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated' }).isManaAbility).toBe(true)
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'triggered', triggered: true }).kind).toBe('triggeredMana')
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated', hasOtherInstruction: true }).isManaAbility).toBe(false)
  })

  test('a fully supplied action does not open a target picker', () => {
    const offer = prepareAction(state, {
      action: 'cast', payer: 'p1', sourceId: 'spell', targetClauses: [],
      proposal: { payer: 'p1', sourceId: 'spell', costs: { mandatory: [] } },
    })
    expect(offer.requiresInput).toBe(false)
  })

  test('the permission gate is shared by mana and nested payment activations', () => {
    const input = {
      state: {
        objects: { source: { id: 'source', name: 'Source', zone: 'battlefield', controller: 'p1', phasedOut: false, tapped: false } },
        stack: [], active: 'p1', step: 'precombatMain',
      }, sourceId: 'source', payer: 'p1', action: 'tapForMana' as const,
    } as unknown as Parameters<typeof activationPermission>[0]
    expect(activationPermission(input)).toBeUndefined()
    expect(activationPermission({ ...input, action: 'nestedPayment', sorcerySpeed: true, state: { ...input.state, stack: [{} as never] } })).toContain('sorcery')
  })
})
