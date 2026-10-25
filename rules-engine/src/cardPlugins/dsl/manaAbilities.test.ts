import type { ManaId } from '../../types'
import { describe, expect, test } from 'bun:test'
import {
  classifyManaAbility,
  activationPermission,
  activated,
  amount,
  tapCost,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
  manaAdded,
  whenever,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingOptionSelection } from '../../rules/selectOptions'

describe('announcement transactions', () => {

  test('mana classification requires a complete mana ability, including triggered mana', () => {
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated' }).isManaAbility).toBe(true)
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'triggered', triggered: true, triggeredManaEligible: true }).kind).toBe('triggeredMana')
    expect(classifyManaAbility({ addsMana: true, abilityKind: 'activated', hasOtherInstruction: true }).isManaAbility).toBe(true)
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

  test('canonical mana choices resume the remaining program after JSON restore', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [],
      decisions: { targets: [] },
      instructions: [
        {
          kind: 'chooseInstructions',
          chooser: ref('controller'),
          count: { kind: 'constant', value: 1 },
          whenInsufficient: 'chooseAvailable',
          options: [{ instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }] }],
        },
        { kind: 'addMana', amount: { R: { kind: 'constant', value: 1 } }, targets: ref('controller') },
      ],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Canonical choosing source', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Canonical choosing source')!
    const started = server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source.id, abilityId: '$.abilities[0]' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    const pending = pendingOptionSelection(restored, 'p1')
    expect(pending).toBeDefined()
    if (!pending) return
    const answered = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(answered.ok).toBe(true)
    if (answered.ok) {
      expect(answered.state.stack).toHaveLength(0)
      expect(answered.state.players.p1.mana.G).toBe(1)
      expect(answered.state.players.p1.mana.R).toBe(1)
    }
  })

  test('eligible canonical mana-added triggers resolve immediately without a stack', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(manaAdded(), {
      decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Mana trigger source', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const result = server.rules(server.state, { type: 'addMana', seat: 'p1', mana: { G: 1 }, sourceId: 'producer' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.stack).toHaveLength(0)
      expect(result.state.players.p1.mana.G).toBe(2)
    }
  })
})

test.each([['C', 'C'], ['B', 'B'], ['G', 'G'], [undefined, 'B']] as const)('raw canonical tap mana pays once and chooses its declared mode (%s -> %s)', (chosen, expected) => {
  const add = (color: ManaId) => ({ kind: 'addMana' as const, targets: ref('controller'), amount: { [color]: amount(1) } })
  const ability = chosen === 'C'
    ? activated({ costs: [tapCost()], instructions: [add('C')] })
    : activated({ costs: [tapCost()], decisions: { modes: { count: amount(1), repeatable: false } }, modes: [{ instructions: [add('B')] }, { instructions: [add('G')] }] })
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Canonical tap fixture', { types: ['Artifact'], oracleText: chosen === 'C' ? '{T}: Add {C}.' : '{T}: Add {B} or {G}.', tapProduces: chosen === 'C' ? { C: 1 } : { B: 1 }, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([ability]))) })] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]
  expect(server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source, mana: 'U' }).ok).toBe(false)
  const result = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: source, ...(chosen ? { mana: chosen } : {}) })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.objects[source].tapped).toBe(true)
  expect(result.state.players.p1.mana[expected]).toBe(1)
  expect(Object.values(result.state.players.p1.mana).reduce((sum, value) => sum + value, 0)).toBe(1)
  expect(result.state.stack).toHaveLength(0)
  expect(pendingOptionSelection(result.state, 'p1')).toBeUndefined()
})


test.each(['W', 'U', 'B', 'R', 'G'] as const)('chosen monochromatic production adds three %s immediately', color => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Gilded Lotus')] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]!
  const announced = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]', manaAbility: true }))
  const pending = pendingOptionSelection(announced, 'p1')!
  const selected = ok(server.rules(announced, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: `instruction:${['W', 'U', 'B', 'R', 'G'].indexOf(color)}` }))
  expect(selected.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, [color]: 3 })
  expect(selected.objects[source].tapped).toBe(true)
  expect(selected.stack).toHaveLength(0)
})
