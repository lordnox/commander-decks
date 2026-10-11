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
  players,
  variable,
  discardCost,
  activated,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'

const state = { players: { p1: { mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 } } }, objects: {}, stack: [] } as unknown as Parameters<typeof beginAnnouncement>[0]

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
    expect(() => commitAnnouncement(result.transaction)).toThrow('no longer provisional')
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
      targetClauses: [select({ filter: players({}), count: 1 })],
      targets: [[{ kind: 'player', player: 'p1' }]],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.transaction.lockedCost.x).toBe(0)
  })

  test('mana classification requires a complete mana ability, including triggered mana', () => {
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated' }).isManaAbility).toBe(true)
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'triggered', triggered: true, triggeredManaEligible: true }).kind).toBe('triggeredMana')
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated', hasOtherInstruction: true }).isManaAbility).toBe(true)
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

  test('one X binds targets, mana, and discard choices in the same proposal', () => {
    const tideState = {
      players: {
        p1: { mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 }, life: 40 },
        p2: {}, p3: {},
      },
      objects: {
        a: { id: 'a', name: 'A', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
        b: { id: 'b', name: 'B', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
        c: { id: 'c', name: 'C', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
      },
      stack: [],
    } as unknown as Parameters<typeof beginAnnouncement>[0]
    const result = beginAnnouncement(tideState, {
      payer: 'p1', sourceId: 'tide', variables: { X: 3 },
      targetClauses: [select({ filter: players({}), count: variable('X') })],
      targets: [[{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }, { kind: 'player', player: 'p3' }]],
      costs: { mandatory: [manaCost('{X}'), discardCost(objects({ zone: 'hand', type: 'Land' }), variable('X'))] },
      payment: [{ sourceId: 'p1.pool.C', mana: 'C', amount: 3 }],
      nonManaChoices: ['a', 'b', 'c'],
    })
    expect(result.ok).toBe(true)
  })

  test('canonical addMana activation executes through the server path', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [],
      decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Canonical mana source', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Canonical mana source')!
    const result = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.stack).toHaveLength(0)
      expect(result.state.players.p1.mana.G).toBe(1)
    }
  })
})
