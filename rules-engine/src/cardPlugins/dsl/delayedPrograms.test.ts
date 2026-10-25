import { snapshotFor } from '../../cards/snapshot'
import { describe, expect, test } from 'bun:test'
import {
  capturePlayer,
  staticAbility,
  replacement,
  wouldEnter,
  redirectEvent,
  controllerOf,
  resultPlayer,
  card,
  activated,
  blinkUntil,
  chooseX,
  variable,
  move,
  select,
  stepDelayed,
  target,
  captureAmount,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createDelayed,
  eventDelayed,
  gainLife,
  objects,
  ref,
  resultAmount,
  spell,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { createJournal, restoreJournal } from '../../journal'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
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

test.each((['same', 'left', 'reexiled', 'token', 'duringEnd'] as const).flatMap(change => [0, 1].map(counters => ({ change, counters }))))('non-targeting delayed return follows only the captured exile incarnation (%j)', ({ change, counters }) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [
        blinkUntil({ targets: target(0), bindChoice: 'exiled', condition: stepDelayed({ step: 'end' }), ...(counters ? { enterCounters: { '+1/+1': counters } } : {}) }),
      ],
    })] },
    battlefield: { p2: [cardTemplate('Return fixture', { types: ['Creature'], power: 2, toughness: 2, token: change === 'token' })] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.hand[0]!
  const id = server.state.zoneOrder.p2.battlefield[0]!
  const initialIncarnation = server.state.objects[id]!.incarnation
  const starting = change === 'duringEnd' ? { ...server.state, step: 'end' as const } : server.state
  let state = resolveStack(server.rules, ok(server.rules(starting, { type: 'castSpell', seat: 'p1', objectId: source, targets: [{ kind: 'object', objectId: id }] })))
  expect(state.delayedTriggers).toHaveLength(1)
  expect(state.delayedTriggers[0]!.canonical!.definitionSnapshot.definition.abilities[0]).toMatchObject({ kind: 'triggered', decisions: { targets: [] } })
  expect(state.delayedTriggers[0]!.canonical!.inheritedTargets).toBeUndefined()
  state = ok(server.rules(state, { type: 'move', objectId: source, to: 'exile' }))
  switch (change) {
    case 'duringEnd':
      state = ok(server.rules(state, { type: 'advanceStep' }))
      expect(state.stack).toHaveLength(0)
      expect(state.delayedTriggers).toHaveLength(1)
      break
    case 'same': expect(state.objects[id]!.zone).toBe('exile'); break
    case 'left': state = ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' })); break
    case 'reexiled': state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' })); break
    case 'token': expect(state.objects[id]).toBeUndefined(); break
  }
  const restored = restoreJournal(createJournal(state), server.rules).current()
  const atEnd = ok(server.rules({ ...restored, step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(atEnd.stack).toHaveLength(1)
  expect(atEnd.delayedTriggers).toHaveLength(0)
  const resolved = resolveStack(server.rules, atEnd)
  switch (change) {
    case 'duringEnd':
    case 'same': expect(resolved.objects[id]).toMatchObject({ zone: 'battlefield', controller: 'p2', owner: 'p2', incarnation: initialIncarnation + 2, power: 2 + counters, toughness: 2 + counters, counters: counters ? { '+1/+1': counters } : {} }); break
    case 'left': expect(resolved.objects[id]!.zone).toBe('hand'); break
    case 'reexiled': expect(resolved.objects[id]!.zone).toBe('exile'); break
    case 'token': expect(resolved.objects[id]).toBeUndefined(); break
  }
  const anotherEnd = ok(server.rules({ ...resolved, turn: resolved.turn + 1, step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(anotherEnd.stack).toHaveLength(0)
})

test('non-targeting delayed callbacks reject parent target references but retain choices', () => {
  expect(() => compileCardRuleDefinition(card([spell({
    decisions: { targets: [select({ filter: objects(), count: 1 })] },
    instructions: [createDelayed({ inheritTargets: false, condition: stepDelayed({ step: 'end' }), instructions: [move({ targets: target(0), to: 'hand' })] })],
  })]))).toThrow()
})

test.each([['Flickerwisp', true], ['Guardian of Ghirapur', true], ['Guardian of Ghirapur', false]] as const)('catalog entry blink persists a delayed return for %s with selected=%s', (name, selected) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate(name)] },
    battlefield: { p1: [cardTemplate('Friendly fixture', { types: ['Artifact'] })], p2: [cardTemplate('Opponent fixture', { types: ['Artifact'] })] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.hand[0]!
  const friendly = server.state.zoneOrder.p1.battlefield[0]!
  const opponent = server.state.zoneOrder.p2.battlefield[0]!
  const targetId = name === 'Flickerwisp' ? opponent : friendly
  const entered = ok(server.rules(server.state, { type: 'move', objectId: source, to: 'battlefield' }))
  const pick = pendingSelectionFor(entered, 'p1')!
  expect(pick.candidates).not.toContain(source)
  expect(pick.candidates.includes(opponent)).toBe(name === 'Flickerwisp')
  expect(pick.min).toBe(name === 'Flickerwisp' ? 1 : 0)
  const restored = restoreJournal(createJournal(entered), server.rules).current()
  const answer = ok(server.rules(restored, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: selected ? [targetId] : [] }))
  let exiled = resolveStack(server.rules, answer)
  expect(exiled.objects[targetId]!.zone).toBe(selected ? 'exile' : 'battlefield')
  exiled = ok(server.rules(exiled, { type: 'move', objectId: source, to: 'hand' }))
  const atEnd = ok(server.rules({ ...restoreJournal(createJournal(exiled), server.rules).current(), step: 'postcombatMain' }, { type: 'advanceStep' }))
  const returned = resolveStack(server.rules, atEnd)
  expect(returned.objects[targetId]).toMatchObject({ zone: 'battlefield', controller: server.state.objects[targetId]!.owner, incarnation: server.state.objects[targetId]!.incarnation + (selected ? 2 : 0) })
  expect(returned.objects[source]!.zone).toBe('hand')
})

test('a non-targeting delayed callback retains announced variables across restore', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ decisions: { variables: [chooseX({ min: 0, max: 3 })] }, instructions: [
      createDelayed({ inheritTargets: false, condition: stepDelayed({ step: 'end' }), instructions: [gainLife({ targets: ref('controller'), amount: variable('X') })] }),
    ] })] },
  }, { random: () => 0 })
  const casted = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!, x: 3 }))
  const delayed = resolveStack(server.rules, casted)
  const restored = restoreJournal(createJournal(delayed), server.rules).current()
  const atEnd = ok(server.rules({ ...restored, step: 'postcombatMain' }, { type: 'advanceStep' }))
  expect(resolveStack(server.rules, atEnd).players.p1.life).toBe(43)
})

test.each([false, true])('cleanup delayed source movement preserves incarnation through restore (reentered=%s)', reentered => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
    costs: [],
    instructions: [createDelayed({ condition: stepDelayed({ step: 'cleanup' }), instructions: [move({ targets: ref('source'), to: 'hand' })] })],
  })])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Delayed permanent', { types: ['Artifact'], ruleDefinition: definition })] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]!
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' })))
  expect(state.objects[source].zone).toBe('battlefield')
  expect(state.delayedTriggers).toHaveLength(1)
  if (reentered) {
    state = ok(server.rules(state, { type: 'move', objectId: source, to: 'hand' }))
    state = ok(server.rules(state, { type: 'move', objectId: source, to: 'battlefield' }))
  }
  state = JSON.parse(JSON.stringify(state))
  state = ok(server.rules({ ...state, step: 'end', priority: null }, { type: 'advanceStep' }))
  expect(state.step).toBe('cleanup')
  state = resolveStack(server.rules, state)
  expect(state.objects[source].zone).toBe(reentered ? 'battlefield' : 'hand')
  expect(state.delayedTriggers).toHaveLength(0)
})


test('a delayed callback retains captured player results after the referenced permanent leaves', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ decisions: { targets: [select({ filter: objects({ zone: 'battlefield' }), count: 1 })] }, instructions: [
      capturePlayer({ player: controllerOf(target(0)), bindResult: 'recipient' }),
      createDelayed({ inheritTargets: false, condition: stepDelayed({ step: 'end' }), instructions: [gainLife({ targets: resultPlayer('recipient'), amount: 3 })] }),
      move({ targets: target(0), to: 'exile' }),
    ] })] }, battlefield: { p2: [cardTemplate('Captured controller fixture', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets: [{ kind: 'object', objectId: server.state.zoneOrder.p2.battlefield[0] }] }))
  const delayed = resolveStack(server.rules, cast)
  const atEnd = ok(server.rules({ ...JSON.parse(JSON.stringify(delayed)), step: 'postcombatMain' }, { type: 'advanceStep' }))
  const state = resolveStack(server.rules, atEnd)
  expect(state.players.p2.life).toBe(43)
  expect(state.players.p1.life).toBe(40)
})

test.each([false, true])('delayed callbacks can exclude the current turn without changing ordinary next-occurrence timing (%s)', notThisTurn => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [createDelayed({
      condition: stepDelayed({ step: 'upkeep' }), ...(notThisTurn ? { notThisTurn: true } : {}),
      instructions: [gainLife({ targets: ref('controller'), amount: 3 })],
    })] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'untap' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(notThisTurn ? 0 : 1)
  state = resolveStack(server.rules, state)
  expect(state.players.p1.life).toBe(notThisTurn ? 40 : 43)
  state = ok(server.rules({ ...state, step: 'cleanup' }, { type: 'advanceStep' }))
  state = ok(server.rules(state, { type: 'advanceStep' }))
  expect(state.active).toBe('p2')
  expect(state.stack).toHaveLength(notThisTurn ? 1 : 0)
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(43)
  expect(state.delayedTriggers).toHaveLength(0)
})

test('a delayed next-main program fires at the specified player\'s first matching main', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [createDelayed({
      inheritTargets: false,
      condition: stepDelayed({ step: ['precombatMain', 'postcombatMain'], active: ref('controller') }),
      instructions: [gainLife({ targets: ref('controller'), amount: 3 })],
    })] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]! })))
  expect(state.delayedTriggers).toHaveLength(1)
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), active: 'p2', priority: 'p2', step: 'draw' }, { type: 'advanceStep' }))
  expect(state.step).toBe('precombatMain')
  expect(state.stack).toHaveLength(0)
  expect(state.delayedTriggers).toHaveLength(1)
  state = ok(server.rules({ ...state, active: 'p1', priority: 'p1', step: 'draw' }, { type: 'advanceStep' }))
  expect(state.step).toBe('precombatMain')
  expect(state.stack).toHaveLength(1)
  expect(state.delayedTriggers).toHaveLength(0)
  state = resolveStack(server.rules, state)
  expect(state.players.p1.life).toBe(43)
})

test('a delayed next-main program uses postcombat when that is next', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [createDelayed({
      inheritTargets: false,
      condition: stepDelayed({ step: ['precombatMain', 'postcombatMain'], active: ref('controller') }),
      instructions: [gainLife({ targets: ref('controller'), amount: 2 })],
    })] })] },
  }, { random: () => 0 })
  let state = resolveStack(server.rules, ok(server.rules({ ...server.state, step: 'precombatMain' }, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  })))
  expect(state.delayedTriggers).toHaveLength(1)
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'endCombat' }, { type: 'advanceStep' }))
  expect(state.step).toBe('postcombatMain')
  expect(state.stack).toHaveLength(1)
  expect(state.delayedTriggers).toHaveLength(0)
  state = resolveStack(server.rules, state)
  expect(state.players.p1.life).toBe(42)
})

test('a delayed next-main program keeps a captured amount after its source leaves', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({ instructions: [
      captureAmount({ amount: 4, bindResult: 'paid' }),
      createDelayed({
        inheritTargets: false,
        condition: stepDelayed({ step: ['precombatMain', 'postcombatMain'], active: ref('controller') }),
        instructions: [{ kind: 'addMana', targets: ref('controller'), amount: { C: resultAmount('paid') } }],
      }),
    ] })] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.hand[0]!
  let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source })))
  expect(state.objects[source]?.zone).toBe('graveyard')
  expect(state.delayedTriggers).toHaveLength(1)
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), step: 'draw' }, { type: 'advanceStep' }))
  state = resolveStack(server.rules, state)
  expect(state.players.p1.mana.C).toBe(4)
  expect(state.delayedTriggers).toHaveLength(0)
})

test('delayed current-turn exclusion rejects values other than the explicit true marker', () => {
  expect(() => compileCardRuleDefinition({ ...card([]), abilities: [{
    kind: 'spell', costs: [], decisions: { targets: [] },
    instructions: [{ kind: 'createDelayed', notThisTurn: false, condition: stepDelayed({ step: 'upkeep' }), instructions: [] }],
  }] })).toThrow('notThisTurn')
})

test('catalog Vanish into Memory draws by last-known power, returns at the next upkeep, then discards by toughness', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Vanish into Memory')] },
    libraries: { p1: Array.from({ length: 4 }, (_, i) => cardTemplate(`Draw fixture ${i}`)) },
    battlefield: { p2: [cardTemplate('Uneven Body', { types: ['Creature'], power: 3, toughness: 2 })] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  const body = ready.zoneOrder.p2.battlefield[0]!
  const vanish = ready.zoneOrder.p1.hand[0]!
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: vanish, targets: [{ kind: 'object', objectId: body }] }))
  let state = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(state.objects[body]!.zone).toBe('exile')
  expect(state.zoneOrder.p1.hand).toHaveLength(3)

  state = structuredClone(state)
  state.active = 'p1'
  state.priority = 'p1'
  state.step = 'untap'
  state.turn += 1
  state = ok(server.rules(state, { type: 'advanceStep' }))
  // The upkeep trigger is Vanish's delayed return; the exiled card waits for it to resolve.
  expect(state.stack).toHaveLength(1)
  expect(state.stack[0]).toMatchObject({ kind: 'ability', objectId: vanish, name: 'Vanish into Memory', controller: 'p1' })
  expect(state.objects[body]!.zone).toBe('exile')
  state = resolveStack(server.rules, state)
  expect(state.objects[body]).toMatchObject({ zone: 'battlefield', controller: 'p2' })
  expect(pendingSelectionFor(state, 'p1')).toMatchObject({ kind: 'discard', count: 2, source: 'Vanish into Memory' })
})


test.each(['creature', 'token', 'noncreature', 'prevented', 'reentered'] as const)('a catalog delayed return discards only for the actual returned incarnation (%s)', change => {
  const redirect = snapshotFor([staticAbility(replacement(wouldEnter(), redirectEvent('graveyard')))])
  const server = createServerGame(commanderRules, { players: 2,
    hands: { p1: [cardTemplate('Vanish into Memory', { manaCost: '{0}' })] },
    libraries: { p1: Array.from({ length: 8 }, (_, i) => cardTemplate(`Draw fixture ${i}`)) },
    battlefield: { p2: [cardTemplate('Return fixture', { types: ['Creature'], power: 2, toughness: 2, token: change === 'token' })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p2.battlefield[0]!
  let state = ok(server.rules(server.state, { type: 'putCounters', objectId: id, counter: '+1/+1', count: 2 }))
  state = resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0]!, targets: [{ kind: 'object', objectId: id }] })))
  expect(state.zoneOrder.p1.hand).toHaveLength(4)
  if (change === 'noncreature') { state.objects[id]!.types = ['Artifact']; state.objects[id]!.power = null; state.objects[id]!.toughness = null }
  if (change === 'prevented') state.objects[id]!.ruleDefinition = redirect
  if (change === 'reentered') {
    state = ok(server.rules(state, { type: 'move', objectId: id, to: 'hand' }))
    state = ok(server.rules(state, { type: 'move', objectId: id, to: 'exile' }))
  }
  // Another player's upkeep must not consume this controller's delayed trigger.
  state = ok(server.rules({ ...JSON.parse(JSON.stringify(state)), active: 'p2', step: 'untap' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(0)
  state = ok(server.rules({ ...state, active: 'p1', step: 'untap', turn: state.turn + 1 }, { type: 'advanceStep' }))
  state = resolveStack(server.rules, state)
  const pick = pendingSelectionFor(state, 'p1')
  if (change === 'creature') {
    expect(state.objects[id]!).toMatchObject({ zone: 'battlefield', controller: 'p2' })
    expect(pick).toMatchObject({ kind: 'discard', count: 2 })
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: pick!.id, kind: 'discard', count: 2, objectIds: pick!.candidates.slice(0, 2) }))
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
  } else {
    expect(pick).toBeUndefined()
    switch (change) {
      case 'token': expect(state.objects[id]).toBeUndefined(); break
      case 'noncreature': expect(state.objects[id]!).toMatchObject({ zone: 'battlefield', types: ['Artifact'] }); break
      case 'prevented': expect(state.objects[id]!.zone).toBe('graveyard'); break
      case 'reentered': expect(state.objects[id]!.zone).toBe('exile'); break
    }
  }
})
