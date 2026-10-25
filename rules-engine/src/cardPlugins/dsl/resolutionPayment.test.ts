import type { GameState, Plugin } from '../../types'
import { describe, expect, test } from 'bun:test'
import {
  createPlayerEffect,
  PLAYER_EFFECTS,
  PLAYER_EFFECT_DURATIONS,
  lifeCost,
  card,
  counterUnlessPay,
  stackItems,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  gainLife,
  activated,
  manaCost,
  manaAndLifeCost,
  objects,
  payOptional,
  ref,
  sacrificeCost,
  select,
  spell,
  target,
  players,
} from './v1'
import { instructionSpell } from './instructionTestSupport'
import { ok, resolveStack } from '../../testHelpers'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'

describe('resolutionPayment', () => {
  test('resolution mana payment offers an eligible mana ability from an empty pool and resumes without priority', () => {
    const manaSource = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [], decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))
    const paymentSpell = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({ payer: ref('controller'), cost: manaCost('{G}'), bindResult: 'paid', ifPaid: [], ifDeclined: [] })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Eligible mana artifact', { types: ['Artifact'], ruleDefinition: manaSource })] },
      hands: { p1: [cardTemplate('Mana payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: paymentSpell })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Mana payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = started.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string; options: { id: string }[] }
    const activation = offer.options.find((option) => option.id.startsWith('activate:'))!
    expect(activation).toBeDefined()
    const restored = JSON.parse(JSON.stringify(started.state))
    const restoredOffer = restored.players.p1.data['kernel.pendingOptionSelection']
    const activatedState = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: restoredOffer.id, optionId: activation.id })
    expect(activatedState.ok).toBe(true)
    if (!activatedState.ok) return
    expect(activatedState.state.players.p1.mana.G).toBe(1)
    expect(activatedState.state.priority).toBeNull()
    const resumedOffer = activatedState.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const paid = server.rules(activatedState.state, { type: 'selectOption', seat: 'p1', selectionId: resumedOffer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (paid.ok) expect(paid.state.resolution).toBeUndefined()
  })

  test('resolution mana payment offers an ordinary Forest tap and resumes inline', () => {
    const paymentSpell = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({ payer: ref('controller'), cost: manaCost('{G}'), bindResult: 'paid', ifPaid: [], ifDeclined: [] })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })] },
      hands: { p1: [cardTemplate('Forest payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: paymentSpell })] },
    }, { random: () => 0 })
    const forest = Object.values(server.state.objects).find((object) => object.name === 'Forest')!
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Forest payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const tap = offer.options.find((option) => option.id.startsWith(`tap:${forest.id}:`))!
    expect(tap).toBeDefined()
    const restored = JSON.parse(JSON.stringify(started.state))
    const restoredOffer = pendingOptionSelection(restored, 'p1')!
    const tapped = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: restoredOffer.id, optionId: tap.id })
    expect(tapped.ok).toBe(true)
    if (!tapped.ok) return
    expect(tapped.state.objects[forest.id]?.tapped).toBe(true)
    expect(tapped.state.players.p1.mana.G).toBe(1)
    expect(tapped.state.priority).toBeNull()
    const resumed = pendingOptionSelection(tapped.state, 'p1')!
    const paid = server.rules(tapped.state, { type: 'selectOption', seat: 'p1', selectionId: resumed.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (paid.ok) expect(paid.state.resolution).toBeUndefined()
  })

  test('resolution mana payment expands its captured X across insufficient, paid, and zero cases', () => {
    const paymentSpell = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [], variables: [{ name: 'X', min: 0, max: 10 }] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: manaCost('{X}'),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
      })],
    })])))
    const makeServer = (pool: number, x: number) => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate(`X${x} payment spell`, { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: paymentSpell })] },
      }, { random: () => 0 })
      server.state.players.p1.mana.C = pool
      const spellObject = Object.values(server.state.objects).find((object) => object.name === `X${x} payment spell`)!
      const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id, x })
      expect(cast.ok).toBe(true)
      if (!cast.ok) throw new Error(cast.error)
      const started = server.rules(cast.state, { type: 'resolveTop' })
      expect(started.ok).toBe(true)
      if (!started.ok) throw new Error(started.error)
      return { server, state: started.state }
    }

    const insufficient = makeServer(2, 3)
    const insufficientOffer = pendingOptionSelection(insufficient.state, 'p1')!
    const rejected = insufficient.server.rules(
      JSON.parse(JSON.stringify(insufficient.state)),
      { type: 'selectOption', seat: 'p1', selectionId: insufficientOffer.id, optionId: 'pay' },
    )
    expect(rejected.ok).toBe(false)
    expect(rejected.state).toEqual(JSON.parse(JSON.stringify(insufficient.state)))

    const paid = makeServer(3, 3)
    const paidOffer = pendingOptionSelection(paid.state, 'p1')!
    const paidResult = paid.server.rules(
      JSON.parse(JSON.stringify(paid.state)),
      { type: 'selectOption', seat: 'p1', selectionId: paidOffer.id, optionId: 'pay' },
    )
    expect(paidResult.ok).toBe(true)
    if (paidResult.ok) {
      expect(paidResult.state.players.p1.mana.C).toBe(0)
      expect(paidResult.state.players.p1.life).toBe(43)
      expect(paidResult.state.resolution).toBeUndefined()
    }

    const zero = makeServer(0, 0)
    const zeroOffer = pendingOptionSelection(zero.state, 'p1')!
    const zeroResult = zero.server.rules(
      JSON.parse(JSON.stringify(zero.state)),
      { type: 'selectOption', seat: 'p1', selectionId: zeroOffer.id, optionId: 'pay' },
    )
    expect(zeroResult.ok).toBe(true)
    if (zeroResult.ok) {
      expect(zeroResult.state.players.p1.mana.C).toBe(0)
      expect(zeroResult.state.resolution).toBeUndefined()
    }
  })

  test('resolution payments do not spend cast-only restricted mana', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({ payer: ref('controller'), cost: manaCost('{G}'), bindResult: 'paid', ifPaid: [], ifDeclined: [] })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Legendary payment spell', { types: ['Sorcery'], supertypes: ['Legendary'], manaCost: '{0}', ruleDefinition: snapshot })] },
    }, { random: () => 0 })
    server.state.players.p1.restrictedMana = [{ mana: 'G', sourceId: 'cast-only', legendary: true }]
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Legendary payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = started.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const rejected = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(rejected.ok).toBe(false)
    expect(rejected.state.players.p1.restrictedMana).toEqual([{ mana: 'G', sourceId: 'cast-only', legendary: true }])
    expect(rejected.state.players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
  })

  test('declining a resolution payment records false without queuing a reflexive trigger', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: { kind: 'life', amount: { kind: 'constant', value: 1 } },
        bindResult: 'paid',
        ifPaid: [],
        ifDeclined: [],
        whenPaid: [gainLife({ amount: 1, targets: ref('controller') })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Declined payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Declined payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    if (!started.ok) return
    const offer = started.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const declined = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'decline' })
    expect(declined.ok).toBe(true)
    if (declined.ok) {
      expect(declined.state.players.p1.life).toBe(40)
      expect(declined.state.pendingTriggers).toBeUndefined()
      expect(declined.state.resolution).toBeUndefined()
    }
  })

  test('a life payment settles after loseLife before paid branches and reflexive work', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: { kind: 'life', amount: { kind: 'constant', value: 2 } },
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
        whenPaid: [gainLife({ amount: 1, targets: ref('controller') })],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Paid life spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Paid life spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (paid.ok) {
      expect(paid.state.players.p1.life).toBe(41)
      expect(paid.state.stack.some((item) => item.name.includes('Paid life spell'))).toBe(true)
    }
  })

  test('resolution payment evaluates a modal payer and candidate filter in its captured scope', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [select({ filter: players({}), count: 1 })] },
      instructions: [payOptional({
        payer: target(0),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature', controller: 'you' }), 1),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: target(0) })],
        ifDeclined: [],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Modal payer spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p2: [cardTemplate('Payer creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Modal payer spell')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Payer creature')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id, targets: [{ kind: 'player', player: 'p2' }] })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = started.state.players.p2.data['kernel.pendingOptionSelection'] as { id: string }
    expect(started.state.players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
    const wrongSeat = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(wrongSeat.ok).toBe(false)
    const paidChoice = server.rules(started.state, { type: 'selectOption', seat: 'p2', selectionId: offer.id, optionId: 'pay' })
    expect(paidChoice.ok).toBe(true)
    if (!paidChoice.ok) return
    const selection = pendingSelectionFor(paidChoice.state, 'p2')!
    expect(selection.candidates).toContain(creature.id)
    const completed = server.rules(paidChoice.state, { type: 'selectCards', seat: 'p2', selectionId: selection.id, kind: 'sacrifice', count: 1, objectIds: [creature.id] })
    expect(completed.ok).toBe(true)
    if (completed.ok) expect(completed.state.players.p2.life).toBe(43)
  })

  test('a sacrifice replacement to exile still settles the paid branch', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 1),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
      })],
    })])))
    const replacement = {
      id: 'test.sacrificeToExile',
      replace: ({ event, rule }: any) => event.type === 'move' && event.to === 'graveyard'
        ? { ...event, to: 'exile', replacedBy: [rule.instanceId] }
        : undefined,
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Replacement payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Exiled payment creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0, cardPlugins: [replacement] })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Replacement payment spell')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Exiled payment creature')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    if (!started.ok) return
    const offer = started.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    if (!paid.ok) return
    const selection = pendingSelectionFor(paid.state, 'p1')!
    const completed = server.rules(paid.state, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'sacrifice', count: 1, objectIds: [creature.id] })
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      expect(completed.state.players.p1.life).toBe(43)
      expect(completed.state.objects[creature.id]?.zone).toBe('exile')
    }
  })

  test('a prevented sacrifice reopens the payment instead of recording paid or declined', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 1),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
      })],
    })])))
    const prevent = {
      id: 'test.preventSacrifice',
      replace: ({ event }: any) => event.type === 'move' && event.to === 'graveyard' ? null : undefined,
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Prevented payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Prevented payment creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0, cardPlugins: [prevent] })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Prevented payment spell')!
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Prevented payment creature')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    if (!paid.ok) return
    const selection = pendingSelectionFor(paid.state, 'p1')!
    const retried = server.rules(paid.state, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'sacrifice', count: 1, objectIds: [creature.id] })
    expect(retried.ok).toBe(true)
    if (retried.ok) {
      expect(retried.state.players.p1.life).toBe(40)
      expect(retried.state.objects[creature.id]?.zone).toBe('battlefield')
      expect(pendingOptionSelection(retried.state, 'p1')).toBeDefined()
    }
  })

  test('a prevented member of a two-card sacrifice rolls back the whole payment atomically', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 2),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
        whenPaid: [gainLife({ amount: 1, targets: ref('controller') })],
      })],
    })])))
    const prevent = {
      id: 'test.preventOnePaymentSacrifice',
      replace: ({ event, state }: any) => event.type === 'move'
        && event.to === 'graveyard'
        && state.objects[event.objectId]?.name === 'Blocked payment creature'
        ? null
        : undefined,
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Atomic payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: {
        p1: [
          cardTemplate('Allowed payment creature', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('Blocked payment creature', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0, cardPlugins: [prevent] })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Atomic payment spell')!
    const creatures = Object.values(server.state.objects)
      .filter((object) => object.name.endsWith('payment creature'))
      .map((object) => object.id)
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const selection = pendingSelectionFor(paid.state, 'p1')!
    const completed = server.rules(paid.state, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'sacrifice', count: 2, objectIds: creatures,
    })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.players.p1.life).toBe(40)
    expect(creatures.every((objectId) => completed.state.objects[objectId]?.zone === 'battlefield')).toBe(true)
    expect(pendingOptionSelection(completed.state, 'p1')).toBeDefined()
    expect(completed.state.pendingTriggers).toBeUndefined()
  })

  test('a prevented life loss reopens the payment before its paid branches', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: { kind: 'life', amount: { kind: 'constant', value: 2 } },
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
        whenPaid: [gainLife({ amount: 1, targets: ref('controller') })],
      })],
    })])))
    const prevent = {
      id: 'test.preventPaymentLife',
      replace: ({ event }: any) => event.type === 'loseLife' && event.amount === 2 ? null : undefined,
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Life payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
    }, { random: () => 0, cardPlugins: [prevent] })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Life payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = pendingOptionSelection(started.state, 'p1')!
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (paid.ok) {
      expect(paid.state.players.p1.life).toBe(40)
      expect(pendingOptionSelection(paid.state, 'p1')).toBeDefined()
      expect(paid.state.pendingTriggers).toBeUndefined()
    }
  })

  test('runtime payment persists its typed sacrifice cursor and commits the paid branch', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [payOptional({
        payer: ref('controller'),
        cost: sacrificeCost(objects({ zone: 'battlefield', type: 'Creature' }), 1),
        bindResult: 'paid',
        ifPaid: [gainLife({ amount: 3, targets: ref('controller') })],
        ifDeclined: [],
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot })] },
      battlefield: { p1: [cardTemplate('Payment creature', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Payment spell')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const started = server.rules(cast.state, { type: 'resolveTop' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const offer = started.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const paid = server.rules(started.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.state.resolution?.kind).toBe('canonicalSpell')
    expect(paid.state.resolution?.kind === 'canonicalSpell'
      ? paid.state.resolution.pendingResolutionPayment?.resultBinding
      : undefined).toBe('paid')
    const selection = pendingSelectionFor(paid.state, 'p1')!
    const chosen = selection.candidates[0]!
    const completed = server.rules(paid.state, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'sacrifice', count: 1, objectIds: [chosen],
    })
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.players.p1.life).toBe(43)
    expect(completed.state.objects[chosen]?.zone).toBe('graveyard')
    expect(completed.state.resolution).toBeUndefined()
  })
})

for (const scenario of [
  { mana: 3, answer: 'pay', countered: false, uncounterable: false },
  { mana: 3, answer: 'decline', countered: true, uncounterable: false },
  { mana: 0, answer: 'decline', countered: true, uncounterable: false },
  { mana: 0, answer: 'decline', countered: false, uncounterable: true },
]) {
  test(`counter-unless-payment uses the target controller and continues after ${JSON.stringify(scenario)}`, () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [instructionSpell({
          decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
          instructions: [counterUnlessPay({ targets: target(0), cost: '{3}', bindResult: 'paid' }), gainLife({ targets: ref('controller'), amount: 1 })],
        })],
        p2: [cardTemplate('Target fixture', { types: ['Instant'], manaCost: '{0}' })],
      },
    }, { random: () => 0 })
    const ready = structuredClone(server.state)
    ready.players.p2.mana.C = scenario.mana
    ready.active = 'p2'
    ready.priority = 'p2'
    const targetId = ready.zoneOrder.p2.hand[0]!
    const stacked = ok(server.rules(ready, { type: 'castSpell', seat: 'p2', objectId: targetId }))
    stacked.stack[0].uncounterable = scenario.uncounterable
    const cast = ok(server.rules({ ...stacked, priority: 'p1' }, { type: 'castSpell', seat: 'p1', objectId: stacked.zoneOrder.p1.hand[0]!, targets: [{ kind: 'stackItem', stackId: stacked.stack[0].id }] }))
    const waiting = ok(server.rules(cast, { type: 'resolveTop' }))
    const offer = pendingOptionSelection(waiting, 'p2')!
    expect(offer).toBeDefined()
    expect(pendingOptionSelection(waiting, 'p1')).toBeUndefined()
    expect(waiting.priority).toBeNull()
    if (scenario.mana === 0) expect(server.rules(waiting, { type: 'selectOption', seat: 'p2', selectionId: offer.id, optionId: 'pay' }).ok).toBe(false)
    const resolved = ok(server.rules(structuredClone(waiting), { type: 'selectOption', seat: 'p2', selectionId: offer.id, optionId: scenario.answer }))
    expect(resolved.objects[targetId].zone).toBe(scenario.countered ? 'graveyard' : 'stack')
    expect(resolved.players.p2.mana.C).toBe(scenario.answer === 'pay' ? 0 : scenario.mana)
    expect(resolved.players.p1.life).toBe(41)
  })
}

// Combined costs use the same optional-payment cursor as single costs.
test.each([
  { life: 4, mana: 1, pay: true, legal: true },
  { life: 3, mana: 1, pay: true, legal: true },
  { life: 2, mana: 1, pay: true, legal: false },
  { life: 4, mana: 0, pay: true, legal: false },
  { life: 4, mana: 1, pay: false, legal: true },
])('combined payment checks the entire cost before spending (%j)', ({ life, mana, pay, legal }) => {
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [instructionSpell({ instructions: [
    payOptional({ payer: ref('controller'), cost: manaAndLifeCost('{1}', 3), bindResult: 'paid', ifPaid: [gainLife({ targets: ref('controller'), amount: 5 })] }),
  ] })] } }, { random: () => 0 })
  const initial = structuredClone(server.state)
  initial.players.p1.life = life
  initial.players.p1.mana.C = mana
  const cast = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0]! }))
  const offered = ok(server.rules(cast, { type: 'resolveTop' }))
  const pending = pendingOptionSelection(offered, 'p1')!
  const event = { type: 'selectOption' as const, seat: 'p1', selectionId: pending.id, optionId: pay ? 'pay' : 'decline' }
  const direct = server.rules(offered, event)
  expect(direct.ok).toBe(legal)
  expect(server.rules(JSON.parse(JSON.stringify(offered)), event)).toEqual(direct)
  expect(direct.state.players.p1.mana.C).toBe(legal && pay ? 0 : mana)
  expect(direct.state.players.p1.life).toBe(legal && pay ? life - 3 + 5 : life)
})

test('combined payment can activate mana abilities, then decline without paying life or spending that mana', () => {
  const producer = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [], instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: { kind: 'constant', value: 1 } } }] })])))
  const server = createServerGame(commanderRules, { players: 2,
    battlefield: { p1: [cardTemplate('Producer fixture', { types: ['Artifact'], ruleDefinition: producer })] },
    hands: { p1: [instructionSpell({ instructions: [payOptional({ payer: ref('controller'), cost: manaAndLifeCost('{1}', 3), bindResult: 'paid' })] })] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! }))
  let state = ok(server.rules(cast, { type: 'resolveTop' }))
  const offer = pendingOptionSelection(state, 'p1')!
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: offer.options.find(option => option.id.startsWith('activate:'))!.id }))
  expect(state.players.p1.mana.C).toBe(1)
  expect(state.priority).toBeNull()
  state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: pendingOptionSelection(state, 'p1')!.id, optionId: 'decline' }))
  expect(state.players.p1.life).toBe(server.state.players.p1.life)
  expect(state.players.p1.mana.C).toBe(1)
  expect(state.resolution).toBeUndefined()
})


test('combined payment retains its mana when life payment cannot settle', () => {
  const prevent: Plugin = { id: 'test.preventLifeCost', replace: ({ event }) => event.type === 'loseLife' ? null : undefined }
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [instructionSpell({ instructions: [
    payOptional({ payer: ref('controller'), cost: manaAndLifeCost('{1}', 3), bindResult: 'paid', ifPaid: [gainLife({ targets: ref('controller'), amount: 5 })] }),
  ] })] } }, { random: () => 0, cardPlugins: [prevent] })
  const initial = structuredClone(server.state)
  initial.players.p1.mana.C = 1
  const cast = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0]! }))
  const offered = ok(server.rules(cast, { type: 'resolveTop' }))
  const state = ok(server.rules(offered, { type: 'selectOption', seat: 'p1', selectionId: pendingOptionSelection(offered, 'p1')!.id, optionId: 'pay' }))
  expect(state.players.p1.life).toBe(initial.players.p1.life)
  expect(state.players.p1.mana.C).toBe(1)
  expect(pendingOptionSelection(state, 'p1')).toBeDefined()
})

test('a payment following mill preserves the bound recovery set across both choices', () => {
  const server = createServerGame(commanderRules, { players: 2,
    battlefield: { p1: [cardTemplate('Ripples of Undeath')] },
    libraries: { p1: [cardTemplate('Recovery land', { types: ['Land'] }), cardTemplate('Recovery creature'), cardTemplate('Recovery spell'), cardTemplate('Deeper card')] },
  }, { random: () => 0 })
  const initial = structuredClone(server.state)
  initial.step = 'draw'
  initial.players.p1.mana.C = 1
  const triggered = structuredClone(ok(server.rules(initial, { type: 'advanceStep' })))
  triggered.players.p1.mana.C = 1
  const offered = ok(server.rules(triggered, { type: 'resolveTop' }))
  expect(offered.zoneOrder.p1.graveyard).toEqual(initial.zoneOrder.p1.library.slice(0, 3))
  const pay = { type: 'selectOption' as const, seat: 'p1', selectionId: pendingOptionSelection(offered, 'p1')!.id, optionId: 'pay' }
  const paid = ok(server.rules(offered, pay))
  expect(ok(server.rules(JSON.parse(JSON.stringify(offered)), pay))).toEqual(paid)
  const selection = pendingSelectionFor(paid, 'p1')!
  expect(selection.candidates).toEqual(initial.zoneOrder.p1.library.slice(0, 3))
  expect(paid.players.p1.life).toBe(initial.players.p1.life - 3)
  expect(paid.players.p1.mana.C).toBe(0)
  const pick = { type: 'selectCards' as const, seat: 'p1', selectionId: selection.id, kind: 'choose' as const, count: 1, objectIds: [selection.candidates[0]!] }
  const completed = ok(server.rules(paid, pick))
  expect(ok(server.rules(JSON.parse(JSON.stringify(paid)), pick))).toEqual(completed)
  expect(completed.zoneOrder.p1.hand).toEqual(pick.objectIds)
  expect(completed.players.p1.life).toBe(paid.players.p1.life)
})

test('combined payment validates its mana and life fields', () => {
  for (const cost of [manaAndLifeCost('invalid', 3), manaAndLifeCost('{1}', -1)]) {
    expect(() => compileCardRuleDefinition(card([spell({ instructions: [payOptional({ payer: ref('controller'), cost, bindResult: 'paid' })] })]))).toThrow()
  }
})

test('combined payment survives restore while a life-loss replacement choice is pending', () => {
  const plugins: Plugin[] = ['test.firstLifeReplacement', 'test.secondLifeReplacement'].map(id => ({
    id, replace: ({ event }) => event.type === 'loseLife' ? { ...event } : undefined,
  }))
  const server = createServerGame(commanderRules, { players: 2, hands: { p1: [instructionSpell({ instructions: [
    payOptional({ payer: ref('controller'), cost: manaAndLifeCost('{1}', 3), bindResult: 'paid' }),
  ] })] } }, { random: () => 0, cardPlugins: plugins })
  const initial = structuredClone(server.state)
  initial.players.p1.mana.C = 1
  const cast = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0]! }))
  const offered = ok(server.rules(cast, { type: 'resolveTop' }))
  const waiting = ok(server.rules(offered, { type: 'selectOption', seat: 'p1', selectionId: pendingOptionSelection(offered, 'p1')!.id, optionId: 'pay' }))
  const replacement = pendingOptionSelection(waiting, 'p1')!
  expect(waiting.eventProcessing).toBeDefined()
  const event = { type: 'selectOption' as const, seat: 'p1', selectionId: replacement.id, optionId: replacement.options[0]!.id }
  const completed = ok(server.rules(waiting, event))
  expect(ok(server.rules(JSON.parse(JSON.stringify(waiting)), event))).toEqual(completed)
  expect(completed.players.p1.life).toBe(initial.players.p1.life - 3)
  expect(completed.players.p1.mana.C).toBe(0)
  expect(completed.resolution).toBeUndefined()
})


test.each([PLAYER_EFFECTS.lifeTotalCannotChange, PLAYER_EFFECTS.cannotLoseLife].flatMap(effect => [0, 4].map(payment => ({ effect, payment }))))('optional resolution life payments respect player restrictions (%j)', ({ effect, payment }) => {
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [instructionSpell({ instructions: [
      createPlayerEffect({ targets: ref('controller'), playerEffect: effect, duration: PLAYER_EFFECT_DURATIONS.untilCleanup }),
      payOptional({ payer: ref('controller'), cost: lifeCost(payment), bindResult: 'paid', ifPaid: [], ifDeclined: [] }),
    ] })] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
  const started = ok(server.rules(cast, { type: 'resolveTop' }))
  const offer = pendingOptionSelection(started, 'p1')!
  const restored = JSON.parse(JSON.stringify(started))
  const result = server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'pay' })
  expect(result.ok).toBe(payment === 0)
  expect(result.state.players.p1.life).toBe(40)
  if (payment === 0) {
    expect(pendingOptionSelection(result.state, 'p1')).toBeUndefined()
    expect(result.state.resolution).toBeUndefined()
  }
})

/** Catalog Niv-Mizzet with a neutral library large enough for every draw below. */
const nivGame = () => createServerGame(commanderRules, {
  battlefield: { p1: [cardTemplate('Niv-Mizzet, Ghost Counsel')] },
  libraries: { p1: Array.from({ length: 4 }, (_, index) => cardTemplate(`Library fixture ${index}`)) },
}, { random: () => 0.5 })

type NivGame = ReturnType<typeof nivGame>

const gainAndOffer = (server: NivGame, amount: number) =>
  resolveStack(server.rules, ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount })))

const answerNiv = (server: NivGame, state: GameState, optionId: 'pay' | 'decline') => ok(server.rules(state, {
  type: 'selectOption', seat: 'p1', selectionId: pendingOptionSelection(state, 'p1')!.id, optionId,
}))

/** The open life payment and the gained amount captured by the waiting trigger it belongs to. */
const nivOffer = (state: GameState) => {
  const pending = pendingOptionSelection(state, 'p1')!
  const stackId = pending.action.kind === 'canonicalResolutionPayment' ? pending.action.stackId : undefined
  return { pending, captured: state.stack.find((item) => item.id === stackId)?.execution?.occurrence }
}

test('catalog Niv-Mizzet accepting pays life and draws using the captured gain amount', () => {
  const server = nivGame()
  const offered = gainAndOffer(server, 3)
  const restored = JSON.parse(JSON.stringify(offered)) as GameState
  const { pending, captured } = nivOffer(restored)
  expect(pending).toMatchObject({
    seat: 'p1',
    source: 'Niv-Mizzet, Ghost Counsel',
    action: { kind: 'canonicalResolutionPayment', cost: { kind: 'life' } },
  })
  expect(captured).toMatchObject({ eventType: 'gainLife', player: 'p1', amount: 3 })
  const beforeHand = restored.zoneCounts.p1.hand
  const accepted = answerNiv(server, restored, 'pay')
  expect(accepted.players.p1.life).toBe(40)
  expect(accepted.zoneCounts.p1.hand).toBe(beforeHand + 3)
  expect(pendingOptionSelection(accepted, 'p1')).toBeUndefined()
})

test('catalog Niv-Mizzet declining leaves life and hand unchanged', () => {
  const server = nivGame()
  const offered = gainAndOffer(server, 2)
  const beforeHand = offered.zoneCounts.p1.hand
  const declined = answerNiv(server, offered, 'decline')
  expect(declined.players.p1.life).toBe(42)
  expect(declined.zoneCounts.p1.hand).toBe(beforeHand)
})

test('catalog Niv-Mizzet cannot accept when life is below the captured trigger amount', () => {
  const server = nivGame()
  const state = gainAndOffer(server, 5)
  state.players.p1.life = 3
  expect(server.rules(state, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: pendingOptionSelection(state, 'p1')!.id,
    optionId: 'pay',
  }).ok).toBe(false)
})

test('catalog Niv-Mizzet tap drains opponents, gains one life, then offers pay-one-draw-one without looping', () => {
  const server = nivGame()
  const objectId = server.state.zoneOrder.p1.battlefield[0]!
  const tapped = ok(server.rules(server.state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId,
    abilityId: '$.abilities[2]',
  }))
  const drained = resolveStack(server.rules, tapped)
  expect(drained.players.p2.life).toBe(39)
  expect(drained.players.p1.life).toBe(41)
  const { pending, captured } = nivOffer(drained)
  expect(pending).toMatchObject({ seat: 'p1', action: { kind: 'canonicalResolutionPayment', cost: { kind: 'life' } } })
  expect(captured).toMatchObject({ eventType: 'gainLife', player: 'p1', amount: 1 })

  const paid = answerNiv(server, drained, 'pay')
  expect(paid.players.p1.life).toBe(40)
  expect(paid.stack).toHaveLength(0)
  expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
})
