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
  payOptional,
  permanentEffect,
  pumpEffect,
  ref,
  reflexiveFromPayment,
  settleResolutionPayment,
  sacrificeCost,
  spell,
  untilCleanup,
  untilStep,
  forTurns,
  players,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelection } from '../../rules/selectPlayers'

describe('Rule DSL Part 10 programs', () => {
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

  test('reserves captured binding metadata for generated snapshots', () => {
    expect(() => compileCardRuleDefinition(card([{
      kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'draw', filter: {} },
      decisions: { targets: [] }, capturedBindings: { choices: ['capturedChoice_saved'] }, instructions: [],
    } as never]))).toThrow()
    expect(() => compileCardRuleDefinition(card([{
      kind: 'triggered', generated: false, activeIn: ['battlefield'], on: { kind: 'draw', filter: {} },
      decisions: { targets: [] }, instructions: [],
    } as never]))).toThrow()
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

