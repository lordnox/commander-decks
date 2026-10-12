import { describe, expect, test } from 'bun:test'
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createDelayed,
  createEffect,
  chooseCards,
  distribution,
  eventDelayed,
  gainLife,
  activated,
  manaCost,
  grantAbilityEffect,
  objects,
  payOptional,
  permanentEffect,
  pumpEffect,
  ref,
  sacrificeCost,
  select,
  spell,
  target,
  players,
  putCounters,
  untilCleanup,
  untilStep,
  forTurns,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelection } from '../../rules/selectPlayers'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'
import { pendingOptionSelection } from '../../rules/selectOptions'

describe('Rule DSL Part 10 programs', () => {
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

  test('validates temporary effects, generated abilities, delayed programs, and paid outcomes', () => {
    const compiled = compileCardRuleDefinition(card([spell({
      decisions: { targets: [] },
      instructions: [
        createEffect({ targets: objects({}), effect: pumpEffect(2, 2), duration: untilCleanup() }),
        createEffect({
          targets: objects({}), duration: permanentEffect(), effect: grantAbilityEffect({
            kind: 'triggered', on: eventDelayed({ type: 'draw' }), instructions: [gainLife({ amount: 1, targets: ref('controller') })],
          }),
        }),
        createDelayed({ condition: eventDelayed({ type: 'dies' }), instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
        payOptional({ payer: ref('controller'), cost: { kind: 'sacrifice', filter: objects({ zone: 'battlefield' }), count: { kind: 'constant', value: 1 } }, bindResult: 'paid', ifPaid: [], ifDeclined: [], whenPaidDecisions: { targets: [] }, whenPaid: [gainLife({ amount: 1, targets: ref('controller') })] }),
      ],
    })]))
    expect(compiled.definition.abilities[0]).toMatchObject({ kind: 'spell' })
  })

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

  test('a granted canonical draw ability uses its recipient as source and opens typed targets', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Granted recipient' }),
        effect: grantAbilityEffect({
          kind: 'triggered',
          on: { kind: 'draw', filter: {} },
          decisions: { targets: [
            { filter: players({}), min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, distinct: true },
          ] },
          instructions: [gainLife({ amount: 1, targets: { kind: 'targetRef', clauseIndex: 0 } })],
        }),
        duration: permanentEffect(),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Grant source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Granted recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
      libraries: { p1: [cardTemplate('Grant draw')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Grant source')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const recipient = Object.values(resolved.state.objects).find((object) => object.name === 'Granted recipient')!
    expect(recipient.canonicalGrantedAbilities).toHaveLength(1)
    const drawn = server.rules(resolved.state, { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const pending = pendingPlayerSelection(drawn.state, 'p1')
    expect(pending).toBeDefined()
    if (!pending) return
    const chosen = server.rules(drawn.state, {
      type: 'selectPlayers', seat: 'p1', selectionId: pending.id, players: ['p2'],
    })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) return
    const grantResolved = server.rules(chosen.state, { type: 'resolveTop' })
    expect(grantResolved.ok).toBe(true)
    if (grantResolved.ok) expect(grantResolved.state.players.p2.life).toBe(41)
  })

  test('canonical pump durations retain their declared step and turn deadlines', () => {
    const makeDefinition = (duration: Parameters<typeof createEffect>[0]['duration']) =>
      createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
        costs: [],
        decisions: { targets: [] },
        instructions: [createEffect({
          targets: objects({ zone: 'battlefield', name: 'Duration recipient' }),
          effect: pumpEffect(1, 1),
          duration,
        })],
      })])))
    const run = (definition: ReturnType<typeof makeDefinition>) => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Duration source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
        battlefield: { p1: [cardTemplate('Duration recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
      }, { random: () => 0 })
      const source = Object.values(server.state.objects).find((object) => object.name === 'Duration source')!
      const recipient = Object.values(server.state.objects).find((object) => object.name === 'Duration recipient')!
      const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
      if (!cast.ok) throw new Error(cast.error)
      const resolved = server.rules(cast.state, { type: 'resolveTop' })
      if (!resolved.ok) throw new Error(resolved.error)
      return { server, state: resolved.state, recipient }
    }
    const until = run(makeDefinition(untilStep('beginCombat')))
    expect(until.state.objects[until.recipient.id]?.power).toBe(3)
    const advanced = until.server.rules({ ...until.state, step: 'precombatMain', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' })
    expect(advanced.ok).toBe(true)
    if (advanced.ok) expect(advanced.state.objects[until.recipient.id]?.power).toBe(2)

    const turns = run(makeDefinition(forTurns(2)))
    const nextTurn = turns.server.rules({ ...turns.state, step: 'cleanup', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' })
    expect(nextTurn.ok).toBe(true)
    if (nextTurn.ok) expect(nextTurn.state.objects[turns.recipient.id]?.power).toBe(3)
  })

  test('generated ability grants expire at their captured turn deadline', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [],
      decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Expiring recipient' }),
        effect: grantAbilityEffect({
          kind: 'triggered',
          on: { kind: 'draw', filter: {} },
          instructions: [gainLife({ amount: 1, targets: ref('controller') })],
        }),
        duration: forTurns(1),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Expiring source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Expiring recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Expiring source')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const recipient = Object.values(resolved.state.objects).find((object) => object.name === 'Expiring recipient')!
    expect(recipient.canonicalGrantedAbilities).toHaveLength(1)
    const advanced = server.rules({ ...resolved.state, step: 'cleanup', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' })
    expect(advanced.ok).toBe(true)
    if (advanced.ok) expect(advanced.state.objects[recipient.id]?.canonicalGrantedAbilities).toBeUndefined()
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

  test('a granted program captures a parent card choice as a durable target binding', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [], decisions: { targets: [] },
      instructions: [
        {
          kind: 'chooseCards', bindChoice: 'saved', chooser: ref('controller'),
          filter: objects({ zone: 'battlefield', name: 'Lexical chosen' }),
          min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 },
          distinct: true, whenInsufficient: 'chooseAvailable',
        },
        createEffect({
          targets: objects({ zone: 'battlefield', name: 'Lexical recipient' }),
          effect: grantAbilityEffect({
            kind: 'triggered', on: { kind: 'draw', filter: {} },
            instructions: [{
              kind: 'putCounters', targets: { kind: 'choiceRef', binding: 'saved' },
              counter: '+1/+1', count: { kind: 'constant', value: 1 },
            }],
          }),
          duration: permanentEffect(),
        }),
      ],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Lexical grant source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [
        cardTemplate('Lexical chosen', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Lexical recipient', { types: ['Creature'], power: 2, toughness: 2 }),
      ] },
      libraries: { p1: [cardTemplate('Lexical grant draw')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Lexical grant source')!
    const chosenObject = Object.values(server.state.objects).find((object) => object.name === 'Lexical chosen')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const announced = server.rules(cast.state, { type: 'resolveTop' })
    expect(announced.ok).toBe(true)
    if (!announced.ok) return
    const pick = pendingSelectionFor(announced.state, 'p1')!
    const chosen = server.rules(announced.state, {
      type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose',
      count: pick.count, objectIds: [chosenObject.id],
    })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) return
    const drawn = server.rules(JSON.parse(JSON.stringify(chosen.state)), { type: 'draw', seat: 'p1', count: 1 })
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const resolved = server.rules(drawn.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.objects[chosenObject.id]?.counters['+1/+1']).toBe(1)
  })

  test('an omitted untilStep active seat waits for the next matching step', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [], decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Next upkeep recipient' }),
        effect: pumpEffect(1, 1), duration: untilStep('upkeep'),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Next upkeep source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Next upkeep recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Next upkeep source')!
    const recipient = Object.values(server.state.objects).find((object) => object.name === 'Next upkeep recipient')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    let state = resolved.state
    for (let index = 0; index < 20 && !(state.active === 'p2' && state.step === 'upkeep'); index += 1) {
      const next = server.rules(state, { type: 'advanceStep' })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      state = next.state
    }
    expect(state.active).toBe('p2')
    expect(state.step).toBe('upkeep')
    expect(state.objects[recipient.id]?.power).toBe(2)
  })

  test('an explicit untilStep deadline waits through extra turns queued after creation', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [], decisions: { targets: [] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', name: 'Extra turn recipient' }),
        effect: pumpEffect(1, 1), duration: untilStep('upkeep', ref('controller')),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Extra turn source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Extra turn recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
      libraries: {
        p1: Array.from({ length: 10 }, () => cardTemplate('Extra turn draw')),
        p2: Array.from({ length: 10 }, () => cardTemplate('Extra turn draw')),
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Extra turn source')!
    const recipient = Object.values(server.state.objects).find((object) => object.name === 'Extra turn recipient')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    let state = JSON.parse(JSON.stringify(resolved.state))
    state.extraTurns = ['p2', 'p2']
    for (let index = 0; index < 50 && !(state.turn === resolved.state.turn + 2 && state.step === 'upkeep'); index += 1) {
      const next = server.rules(state, { type: 'advanceStep' })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      state = next.state
    }
    expect(state.active).toBe('p2')
    expect(state.step).toBe('upkeep')
    expect(state.objects[recipient.id]?.power).toBe(3)
    for (let index = 0; index < 25 && !(state.active === 'p1' && state.step === 'untap'); index += 1) {
      const next = server.rules(state, { type: 'advanceStep' })
      expect(next.ok).toBe(true)
      if (!next.ok) return
      state = next.state
    }
    expect(state.objects[recipient.id]?.power).toBe(3)
    const next = server.rules(state, { type: 'advanceStep' })
    expect(next.ok).toBe(true)
    if (next.ok) expect(next.state.objects[recipient.id]?.power).toBe(2)
  })

  test('an untargeted grant does not inherit unrelated parent targets', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [],
      decisions: { targets: [{ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, distinct: true }] },
      instructions: [
        {
          kind: 'chooseCards', bindChoice: 'saved', chooser: ref('controller'),
          filter: objects({ zone: 'battlefield', type: 'Creature' }),
          min: { kind: 'constant', value: 1 }, max: { kind: 'constant', value: 1 }, distinct: true, whenInsufficient: 'chooseAvailable',
        },
        createEffect({
          targets: objects({ zone: 'battlefield', type: 'Creature' }), duration: permanentEffect(),
          effect: grantAbilityEffect({
            kind: 'triggered', on: { kind: 'draw', filter: {} },
            instructions: [gainLife({ amount: 1, targets: ref('controller') })],
          }),
        }),
      ],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Grant target source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: {
        p1: [
          cardTemplate('Grant parent target', { types: ['Creature'], power: 2, toughness: 2 }),
          cardTemplate('Grant surviving recipient', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
      libraries: { p1: [cardTemplate('Grant trigger draw')] },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const reduce = (state: any, event: any) => {
      const result = server.rules(state, event)
      if (!result.ok) throw new Error(result.error)
      return result.state
    }
    let state = reduce(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Grant target source').id, targets: [{ kind: 'object', objectId: get('Grant parent target').id }] })
    state = reduce(state, { type: 'resolveTop' })
    const pick = pendingSelectionFor(state, 'p1')!
    state = reduce(state, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: pick.count, objectIds: [get('Grant surviving recipient').id] })
    state = reduce(state, { type: 'destroy', objectId: get('Grant parent target').id })
    state = reduce(JSON.parse(JSON.stringify(state)), { type: 'draw', seat: 'p1', count: 1 })
    expect(state.stack.filter((item) => item.kind === 'ability')).toHaveLength(1)
    state = reduce(state, { type: 'resolveTop' })
    expect(state.players.p1.life).toBe(41)
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

  test('a granted callback keeps its parent trigger occurrence after JSON restart', () => {
    const triggeredAbility = {
      kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'enters', filter: { type: 'Creature' } },
      decisions: { targets: [] }, instructions: [createEffect({
        targets: ref('triggering.object.after'), duration: permanentEffect(), effect: grantAbilityEffect({
          kind: 'triggered', on: { kind: 'draw', filter: {} },
          instructions: [{ kind: 'putCounters', targets: ref('triggering.object.after'), counter: '+1/+1', count: { kind: 'constant', value: 1 } }],
        }),
      })],
    } as never
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([triggeredAbility])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Grant occurrence source', { types: ['Enchantment'], ruleDefinition: definition })] },
      hands: { p1: [cardTemplate('Grant occurrence creature', { types: ['Creature'], power: 2, toughness: 3 })] },
      libraries: { p1: [cardTemplate('Grant occurrence draw')] },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const moved = server.rules(server.state, { type: 'move', objectId: get('Grant occurrence creature').id, to: 'battlefield' })
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
    if (resolved.ok) expect(resolved.state.objects[get('Grant occurrence creature').id]?.counters['+1/+1']).toBe(1)
  })

  test('a granted step callback binds the active triggering player', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [], decisions: { targets: [] }, instructions: [createEffect({
        targets: objects({ zone: 'battlefield', type: 'Creature' }), duration: permanentEffect(), effect: grantAbilityEffect({
          kind: 'triggered', on: { kind: 'step', step: 'beginCombat', active: ref('controller') },
          instructions: [gainLife({ amount: 1, targets: ref('triggering.player') })],
        }),
      })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Step grant source', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
      battlefield: { p1: [cardTemplate('Step grant recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
      libraries: { p1: [cardTemplate('Step grant draw')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Step grant source')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id })
    expect(cast.ok).toBe(true)
    if (!cast.ok) return
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const advanced = server.rules(resolved.state, { type: 'advanceStep' })
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.stack.filter((item) => item.kind === 'ability')).toHaveLength(1)
    const callback = server.rules(advanced.state, { type: 'resolveTop' })
    expect(callback.ok).toBe(true)
    if (callback.ok) expect(callback.state.players.p1.life).toBe(41)
  })
})
