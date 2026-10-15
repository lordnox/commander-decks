import { describe, expect, test } from 'bun:test'
import {
  manaCost,
  objects,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  ref,
  amount,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'

describe('persisted planned payment workflow', () => {
  const fixture = (choice = false) => {
    const sourceDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'activated', availableFrom: ['battlefield'], timing: 'anyTime', costs: [], decisions: { targets: [] },
      instructions: choice ? [{ kind: 'chooseInstructions', chooser: ref('controller'), count: { kind: 'constant', value: 1 as const }, whenInsufficient: 'chooseAvailable', options: [{ instructions: [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }] }] : [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }],
    }])))
    const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [manaCost('{G}')], decisions: { targets: [] }, instructions: [] }])))
    const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Planned source', { types: ['Artifact'], ruleDefinition: sourceDefinition })] }, hands: { p1: [cardTemplate('Planned spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: spellDefinition })] } }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Planned source')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Planned spell')!
    return { server, source, spell, event: { type: 'castSpell' as const, seat: 'p1', objectId: spell.id, manaActivations: [{ objectId: source.id, abilityId: '$.abilities[0]' }] } }
  }

  const deathFixture = (choice = false) => {
    const watcher = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'dies', filter: { name: 'Payment death watcher' } }, decisions: { targets: [] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: ref('controller') }] }])))
    const sourceDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'activated', availableFrom: ['battlefield'], timing: 'anyTime', costs: [{ kind: 'sacrifice', filter: objects({ zone: 'battlefield', type: 'Creature' }), count: amount(1) }], decisions: { targets: [] }, instructions: choice ? [{ kind: 'chooseInstructions', chooser: ref('controller'), count: { kind: 'constant', value: 1 as const }, whenInsufficient: 'chooseAvailable', options: [{ instructions: [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }] }] : [{ kind: 'addMana', amount: { G: amount(2) }, targets: ref('controller') }] }])))
    const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [manaCost('{G}')], decisions: { targets: [] }, instructions: [] }])))
    const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Cost mana producer', { types: ['Artifact'], ruleDefinition: sourceDefinition }), cardTemplate('Payment death watcher', { types: ['Creature'], power: 2, toughness: 2, ruleDefinition: watcher })] }, hands: { p1: [cardTemplate('Atomic payment spell', { types: ['Sorcery'], manaCost: '{G}', ruleDefinition: spellDefinition })] } }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Cost mana producer')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Payment death watcher')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Atomic payment spell')!
    return { server, event: { type: 'castSpell' as const, seat: 'p1' as const, objectId: spell.id, manaActivations: [{ objectId: source.id, abilityId: '$.abilities[0]', choices: [creature.id] }] } }
  }

  test('commits a no-choice plan from an empty pool', () => {
    const { server, event } = fixture()
    const result = server.rules(server.state, event)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.stack).toHaveLength(1)
      expect(result.state.players.p1.mana.G).toBe(1)
      expect(result.state.provisionalAnnouncement).toBeUndefined()
    }
  })

  test('persists a choice and resumes after JSON restart', () => {
    const { server, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    const pending = pendingOptionSelection(restored, 'p1')
    expect(pending).toBeDefined()
    if (!pending) return
    const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.provisionalAnnouncement).toBeUndefined()
  })

  test('a host restart preserves a planned payment frame before cancellation', () => {
    const { server, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok || !started.state.provisionalAnnouncement) return
    const restarted = JSON.parse(JSON.stringify(started.state))
    const cancelled = server.rules(restarted, { type: 'cancelAnnouncement', seat: 'p1', announcementId: restarted.provisionalAnnouncement.id })
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) expect(cancelled.state).toEqual(server.state)
  })

  test('wrong-seat cancellation and invalid plans preserve the baseline', () => {
    const { server, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok || !started.state.provisionalAnnouncement) return
    const wrong = server.rules(started.state, { type: 'cancelAnnouncement', seat: 'p2', announcementId: started.state.provisionalAnnouncement.id })
    expect(wrong.ok).toBe(false)
    const cancelled = server.rules(started.state, { type: 'cancelAnnouncement', seat: 'p1', announcementId: started.state.provisionalAnnouncement.id })
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) expect(cancelled.state).toEqual(server.state)
  })

  test('rejects a planned source outside its declared zone before opening a chooser', () => {
    const { server, source, event } = fixture(true)
    const moved = structuredClone(server.state)
    moved.objects[source.id].zone = 'hand'
    const result = server.rules(moved, event)
    expect(result.ok).toBe(false)
    expect(result.state.players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
  })

  test('rejects a public planned cast carrying a canonical transaction', () => {
    const { server, spell, event } = fixture()
    const result = server.rules(server.state, {
      ...event,
      canonicalTransaction: {
        id: 'forged', proposal: { payer: 'p1', sourceId: spell.id, costs: { mandatory: [] } },
        lockedCost: { nonMana: [] }, payment: [], status: 'committed',
      },
    } as never)
    expect(result.ok).toBe(false)
    expect(result.state.stack).toHaveLength(0)
  })

  test('records the actual mana spent on the committed announcement', () => {
    const { server, event } = fixture()
    const result = server.rules(server.state, event)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.stack[0]?.execution?.announcement?.payment).toEqual([{ sourceId: 'p1.pool.G', mana: 'G', amount: 1 }])
  })

  test('rejects a changed canonical definition while a payment choice is open', () => {
    const { server, spell, source, event } = fixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    restored.objects[spell.id].ruleDefinition = structuredClone(restored.objects[source.id].ruleDefinition)
    const pending = pendingOptionSelection(restored, 'p1')
    if (!pending) return
    const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(result.ok).toBe(false)
    expect(result.state).toEqual(server.state)
  })

  test('defers death triggers until a no-choice planned cast commits', () => {
    const { server, event } = deathFixture()
    const result = server.rules(server.state, event)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.stack.filter((item) => item.kind === 'ability')).toHaveLength(1)
  })

  test('a planned mana sacrifice cannot change the spell total locked before payment', () => {
    const sourceDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'activated', availableFrom: ['battlefield'], timing: 'anyTime',
      costs: [{ kind: 'sacrifice', filter: objects({ zone: 'battlefield', type: 'Creature' }), count: amount(1) }],
      decisions: { targets: [] }, instructions: [{ kind: 'addMana', amount: { C: amount(2) }, targets: ref('controller') }],
    }])))
    const spellDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [manaCost('{2}')], decisions: { targets: [] }, instructions: [] }])))
    const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [
      cardTemplate('Cost-changing mana source', { types: ['Artifact'], ruleDefinition: sourceDefinition }),
      cardTemplate('Cost-reducing creature', { types: ['Creature'], power: 2, toughness: 2 }),
    ] }, hands: { p1: [cardTemplate('Reduced locked spell', { types: ['Sorcery'], manaCost: '{2}', ruleDefinition: spellDefinition, effects: [{ op: 'castCost', reduceGeneric: { amount: 1, if: { kind: 'controlledCreaturePower', min: 1 } } }] })] } }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Cost-changing mana source')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Cost-reducing creature')!
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Reduced locked spell')!
    const result = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell.id, manaActivations: [{ objectId: source.id, abilityId: '$.abilities[0]', choices: [creature.id] }] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players.p1.mana.C).toBe(1)
      expect(result.state.objects[creature.id].zone).toBe('graveyard')
      expect(result.state.stack).toHaveLength(1)
    }
  })

  test('defers death triggers across a restarted planned choice', () => {
    const { server, event } = deathFixture(true)
    const started = server.rules(server.state, event)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const restored = JSON.parse(JSON.stringify(started.state))
    const pending = pendingOptionSelection(restored, 'p1')
    if (!pending) return
    const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId: 'instruction:0' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.stack.filter((item) => item.kind === 'ability')).toHaveLength(1)
  })
})
