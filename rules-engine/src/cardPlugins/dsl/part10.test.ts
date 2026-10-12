import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createDelayed,
  createEffect,
  eventDelayed,
  gainLife,
  grantAbilityEffect,
  objects,
  openResolutionPayment,
  payOptional,
  permanentEffect,
  pumpEffect,
  ref,
  reflexiveFromPayment,
  settleResolutionPayment,
  spell,
  temporaryEffect,
  delayedProgram,
  untilCleanup,
  untilStep,
  forTurns,
  players,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingPlayerSelection } from '../../rules/selectPlayers'

const context = {
  definitionRevision: 'v1-0123456789abcdef',
  source: { objectId: 'source', incarnation: 2, name: 'Source' },
  controller: 'p1',
  parentStackId: 'stack',
}

describe('Rule DSL Part 10 programs', () => {
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

  test('payment owns its payer and creates a reflexive program only after payment', () => {
    const waiting = openResolutionPayment({
      id: 'payment', payer: ref('controller'), cost: { kind: 'mana', amount: '{1}' }, resultBinding: 'paid', context,
      ifPaid: [], ifDeclined: [], whenPaid: [gainLife({ amount: 1, targets: ref('controller') })],
    })
    expect(reflexiveFromPayment(waiting)).toBeUndefined()
    const declined = settleResolutionPayment(waiting, { paid: false, actionSucceeded: false, destination: 'graveyard' })
    expect(reflexiveFromPayment(declined)).toBeUndefined()
    const paid = settleResolutionPayment(waiting, { paid: true, actionSucceeded: true, destination: 'graveyard' })
    expect(reflexiveFromPayment(paid)).toMatchObject({ payment: { binding: 'paid', paid: true }, source: context })
  })

  test('temporary and delayed programs pin independent source/version contexts', () => {
    const effect = temporaryEffect({ source: context, targets: ['target'], effect: pumpEffect(1, 1), duration: untilCleanup(), createdAt: 4 })
    const delayed = { source: { ...context, definitionRevision: 'v1-fedcba9876543210' }, condition: eventDelayed({ type: 'move' }), instructions: [], recurring: true }
    const program = delayedProgram(delayed)
    expect(effect.source.definitionRevision).toBe(context.definitionRevision)
    expect(program.source.definitionRevision).toBe('v1-fedcba9876543210')
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
})

