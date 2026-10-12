import { describe, expect, test } from 'bun:test'
import {
  card,
  amount,
  compileCardRuleDefinition,
  copySpell,
  ref,
  select,
  spell,
  stackItems,
} from './v1'
import { copyTargets, resolveCanonicalCopyTargets } from './copies'
import { createDefinitionSnapshot } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingPlayerSelectionFor } from '../../rules/selectPlayers'

describe('Rule DSL Part 09 spell copies', () => {
  test('copySpell is a stack action and keeps its explicit retargeting procedure', () => {
    const compiled = compileCardRuleDefinition(card([spell({
      decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
      instructions: [copySpell({ targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'keep' } })],
    })]))
    expect(compiled.definition.abilities[0]).toMatchObject({
      instructions: [{ kind: 'copySpell', retarget: { kind: 'keep' } }],
    })
    expect(compiled.capabilities.runtimeExecution.instructionKinds).toContain('copySpell')
  })

  test('keeping targets retains pinned identities without revalidating them', () => {
    const original = {
      id: 'spell', kind: 'spell' as const, objectId: 'card', controller: 'p1',
      name: 'Copied', targets: [{ kind: 'object' as const, objectId: 'old', incarnation: 1, zone: 'battlefield' as const }],
      x: 4,
    }
    expect(copyTargets(original)).toEqual(original.targets)
    expect(resolveCanonicalCopyTargets({} as never, original, {} as never, { kind: 'keep' })).toMatchObject({ ok: true })
  })

  test('runtime retarget answer persists the changed player binding and removes only the copy', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell', costs: [],
      decisions: { targets: [{ filter: { kind: 'players', filter: {} }, min: amount(1), max: amount(1), distinct: true }] },
      instructions: [{ kind: 'gainLife', amount: amount(3), targets: { kind: 'targetRef', clauseIndex: 0 } }],
    }])))
    const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Copyable', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] } }, { random: () => 0 })
    const original = Object.values(server.state.objects).find((object) => object.name === 'Copyable')!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: original.id, targets: [{ kind: 'player', player: 'p1' }] })
    if (!cast.ok) throw new Error(cast.error)
    const copied = server.rules(cast.state, { type: 'copySpell', stackId: cast.state.stack[0].id, controller: 'p1', targets: [{ kind: 'player', player: 'p2' }], retarget: true })
    if (!copied.ok) throw new Error(copied.error)
    expect(copied.state.stack).toHaveLength(2)
    const resolved = server.rules(copied.state, { type: 'resolveTop' })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.players.p2.life).toBe(43)
    expect(resolved.state.stack).toHaveLength(1)
  })

  test('durable copy jobs answer both target slots for both controllers after JSON restart', () => {
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [
      { filter: { kind: 'players', filter: {} }, min: amount(1), max: amount(1), distinct: true },
      { filter: { kind: 'players', filter: {} }, min: amount(1), max: amount(1), distinct: true },
    ] }, instructions: [
      { kind: 'gainLife', amount: amount(2), targets: { kind: 'targetRef', clauseIndex: 0 } },
      { kind: 'gainLife', amount: amount(3), targets: { kind: 'targetRef', clauseIndex: 1 } },
    ] }])))
    const copying = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] }, instructions: [
      { kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, controller: { kind: 'players', filter: {} }, retarget: { kind: 'chooseNewTargets' }, bindResult: 'copies' },
      { kind: 'gainLife', amount: amount(1), targets: ref('controller') },
    ] }])))
    const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Original', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: original }), cardTemplate('Copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copying })] } }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const reduce = (state: typeof server.state, event: Parameters<typeof server.rules>[1]) => { const result = server.rules(state, event); if (!result.ok) throw new Error(result.error); return result.state }
    let state = reduce(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Original').id, targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p2' }]] } as never)
    state = reduce(state, { type: 'castSpell', seat: 'p1', objectId: get('Copier').id, targets: [{ kind: 'stackItem', stackId: state.stack[0].id }] })
    state = reduce(state, { type: 'resolveTop' })
    for (const seat of ['p1', 'p1', 'p2', 'p2'] as const) {
      state = JSON.parse(JSON.stringify(state))
      const offer = state.players[seat].data['kernel.pendingOptionSelection'] as { id: string }
      expect(offer).toBeDefined()
      const wrong = server.rules(state, { type: 'selectOption', seat: seat === 'p1' ? 'p2' : 'p1', selectionId: offer.id, optionId: 'keep' })
      expect(wrong.ok).toBe(false)
      state = reduce(state, { type: 'selectOption', seat, selectionId: offer.id, optionId: 'keep' })
    }
    expect(state.resolution).toBeUndefined()
    expect(state.stack.filter((item) => item.copy)).toHaveLength(2)
    expect(state.players.p1.life).toBe(41)
  })

  test('retargeting a stack slot keeps the next slot offer open', () => {
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(2), max: amount(2), distinct: true }] }, instructions: [] }])))
    const copier = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] }, instructions: [{ kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'chooseNewTargets' } }] }])))
    const simple = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [] }, instructions: [] }])))
    const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Stack original', { types: ['Instant'], manaCost: '{0}', ruleDefinition: original }), cardTemplate('Stack copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copier }), cardTemplate('Extra one', { types: ['Instant'], manaCost: '{0}', ruleDefinition: simple }), cardTemplate('Extra two', { types: ['Instant'], manaCost: '{0}', ruleDefinition: simple })] } }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const reduce = (state: typeof server.state, event: Parameters<typeof server.rules>[1]) => { const result = server.rules(state, event); if (!result.ok) throw new Error(result.error); return result.state }
    let state = reduce(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Extra one').id })
    state = reduce(state, { type: 'castSpell', seat: 'p1', objectId: get('Extra two').id })
    state = reduce(state, { type: 'castSpell', seat: 'p1', objectId: get('Stack original').id, targets: [{ kind: 'stackItem', stackId: state.stack[0].id }, { kind: 'stackItem', stackId: state.stack[1].id }] })
    state = reduce(state, { type: 'castSpell', seat: 'p1', objectId: get('Stack copier').id, targets: [{ kind: 'stackItem', stackId: state.stack[0].id }] })
    state = reduce(state, { type: 'resolveTop' })
    const offer = state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    expect(offer).toBeDefined()
    state = reduce(state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'keep' })
    expect(state.players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
  })

  test('modal copies retarget every selected mode scope before they resolve', () => {
    const playerClause = { filter: { kind: 'players' as const, filter: {} }, min: amount(1), max: amount(1), distinct: true as const }
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell', costs: [], decisions: { targets: [], modes: { count: amount(2), repeatable: true } },
      modes: [
        { decisions: { targets: [playerClause] }, instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'targetRef', clauseIndex: 0 } }] },
        { decisions: { targets: [playerClause] }, instructions: [{ kind: 'gainLife', amount: amount(2), targets: { kind: 'targetRef', clauseIndex: 0 } }] },
      ],
    }])))
    const copying = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] },
      instructions: [{ kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, controller: { kind: 'players', filter: {} }, retarget: { kind: 'chooseNewTargets' } }],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Modal copy original', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: original }),
          cardTemplate('Modal copy copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copying }),
        ],
      },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const reduce = (state: typeof server.state, event: Parameters<typeof server.rules>[1]) => {
      const result = server.rules(state, event)
      if (!result.ok) throw new Error(result.error)
      return result.state
    }
    let state = reduce(server.state, {
      type: 'castSpell', seat: 'p1', objectId: get('Modal copy original').id,
      modeIndices: [0, 1], targetClauses: [[{ kind: 'player', player: 'p1' }], [{ kind: 'player', player: 'p1' }]],
    } as never)
    state = reduce(state, { type: 'castSpell', seat: 'p1', objectId: get('Modal copy copier').id, targets: [{ kind: 'stackItem', stackId: state.stack[0].id }] })
    state = reduce(state, { type: 'resolveTop' })
    for (const seat of ['p1', 'p1', 'p2', 'p2'] as const) {
      const offer = state.players[seat].data['kernel.pendingOptionSelection'] as { id: string }
      expect(offer).toBeDefined()
      state = reduce(state, { type: 'selectOption', seat, selectionId: offer.id, optionId: 'retarget' })
      const pick = pendingPlayerSelectionFor(state, seat)!
      expect(pick).toBeDefined()
      state = reduce(state, { type: 'selectPlayers', seat, selectionId: pick.id, players: ['p2'] })
    }
    expect(state.stack.filter((item) => item.copy)).toHaveLength(2)
    state = reduce(state, { type: 'resolveTop' })
    state = reduce(state, { type: 'resolveTop' })
    expect(state.players.p2.life).toBe(46)
  })

  test('copy retargeting keeps the original target count when the live board changes', () => {
    const clause = { filter: { kind: 'objects' as const, filter: { zone: 'battlefield' as const, type: 'Creature' } }, min: amount(2), max: amount(2), distinct: true as const }
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [clause] }, instructions: [] }])))
    const copying = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] }, instructions: [{ kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'chooseNewTargets' } }] }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Dynamic original', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: original }), cardTemplate('Dynamic copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copying }), cardTemplate('Dynamic C', { types: ['Creature'], power: 2, toughness: 2 })] },
      battlefield: { p1: [cardTemplate('Dynamic A', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Dynamic B', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Dynamic original').id, targets: [{ kind: 'object', objectId: get('Dynamic A').id }, { kind: 'object', objectId: get('Dynamic B').id }] })
    if (!cast.ok) throw new Error(cast.error)
    const changed = server.rules(cast.state, { type: 'move', objectId: get('Dynamic C').id, to: 'battlefield' })
    if (!changed.ok) throw new Error(changed.error)
    const copied = server.rules(changed.state, { type: 'copySpell', stackId: changed.state.stack[0].id, controller: 'p1', targets: changed.state.stack[0].targets, retarget: true })
    expect(copied.ok).toBe(true)
    if (copied.ok) expect(copied.state.stack).toHaveLength(2)
  })

  test('duplicate retarget candidates are filtered and a forged duplicate leaves state unchanged', () => {
    const clause = { filter: { kind: 'players' as const, filter: {} }, min: amount(2), max: amount(2), distinct: true as const }
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [clause] }, instructions: [] }])))
    const copying = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] }, instructions: [{ kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'chooseNewTargets' } }] }])))
    const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Distinct original', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: original }), cardTemplate('Distinct copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copying })] } }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    let cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Distinct original').id, targetClauses: [[{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }]] } as never)
    if (!cast.ok) throw new Error(cast.error)
    cast = server.rules(cast.state, { type: 'castSpell', seat: 'p1', objectId: get('Distinct copier').id, targets: [{ kind: 'stackItem', stackId: cast.state.stack[0].id }] })
    if (!cast.ok) throw new Error(cast.error)
    const waiting = server.rules(cast.state, { type: 'resolveTop' })
    if (!waiting.ok) throw new Error(waiting.error)
    const offer = waiting.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const retarget = server.rules(waiting.state, { type: 'selectOption', seat: 'p1', selectionId: offer.id, optionId: 'retarget' })
    if (!retarget.ok) throw new Error(retarget.error)
    const pick = pendingPlayerSelectionFor(retarget.state, 'p1')!
    expect(pick).toBeDefined()
    expect(pick.candidates).toEqual(['p1', 'p2'])
    const first = server.rules(retarget.state, { type: 'selectPlayers', seat: 'p1', selectionId: pick.id, players: ['p2'] })
    if (!first.ok) throw new Error(first.error)
    const nextOffer = first.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const nextRetarget = server.rules(first.state, { type: 'selectOption', seat: 'p1', selectionId: nextOffer.id, optionId: 'retarget' })
    if (!nextRetarget.ok) throw new Error(nextRetarget.error)
    const next = pendingPlayerSelectionFor(nextRetarget.state, 'p1')!
    expect(next.candidates).toEqual(['p1'])
    const before = JSON.stringify(nextRetarget.state)
    const forged = server.rules(nextRetarget.state, { type: 'selectPlayers', seat: 'p1', selectionId: next.id, players: ['p2'] })
    expect(forged.ok).toBe(false)
    if (!forged.ok) expect(JSON.stringify(forged.state)).toBe(before)
    const completed = server.rules(nextRetarget.state, { type: 'selectPlayers', seat: 'p1', selectionId: next.id, players: ['p1'] })
    expect(completed.ok).toBe(true)
    if (completed.ok) expect(completed.state.stack.filter((item) => item.copy)).toHaveLength(1)
  })

  test('an unchanged illegal pin is scoped to its original slot', () => {
    const creatureClause = { filter: { kind: 'objects' as const, filter: { zone: 'battlefield' as const, type: 'Creature' as const } }, min: amount(1), max: amount(1), distinct: true as const }
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [creatureClause, creatureClause] }, instructions: [] }])))
    const copying = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] }, instructions: [{ kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'chooseNewTargets' } }] }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Scoped pin original', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: original }), cardTemplate('Scoped pin copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copying })] },
      battlefield: { p1: [cardTemplate('Scoped A', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Scoped B', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    const cast = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Scoped pin original').id, targets: [{ kind: 'object', objectId: get('Scoped A').id }, { kind: 'object', objectId: get('Scoped B').id }] })
    if (!cast.ok) throw new Error(cast.error)
    cast.state.objects[get('Scoped A').id]!.phasedOut = true
    const pinnedA = cast.state.stack[0].targets[0]!
    const copied = server.rules(cast.state, { type: 'copySpell', stackId: cast.state.stack[0].id, controller: 'p1', targets: [pinnedA, pinnedA], retarget: true })
    expect(copied.ok).toBe(true)
    if (copied.ok) expect(copied.state.stack).toHaveLength(1)
  })

  test('a final KEEP that would violate distinctness is rejected without closing the offer', () => {
    const clause = { filter: { kind: 'players' as const, filter: {} }, min: amount(2), max: amount(2), distinct: true as const }
    const original = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [clause] }, instructions: [] }])))
    const copying = createDefinitionSnapshot(compileCardRuleDefinition(card([{ kind: 'spell', costs: [], decisions: { targets: [{ filter: { kind: 'stackItems', filter: { kind: 'spell' } }, min: amount(1), max: amount(1), distinct: true }] }, instructions: [{ kind: 'copySpell', targets: { kind: 'targetRef', clauseIndex: 0 }, retarget: { kind: 'chooseNewTargets' } }] }])))
    const server = createServerGame(commanderRules, { players: 2, hands: { p1: [cardTemplate('Keep original', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: original }), cardTemplate('Keep copier', { types: ['Instant'], manaCost: '{0}', ruleDefinition: copying })] } }, { random: () => 0 })
    const get = (name: string) => Object.values(server.state.objects).find((object) => object.name === name)!
    let state = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: get('Keep original').id, targetClauses: [[{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }]] } as never)
    if (!state.ok) throw new Error(state.error)
    state = server.rules(state.state, { type: 'castSpell', seat: 'p1', objectId: get('Keep copier').id, targets: [{ kind: 'stackItem', stackId: state.state.stack[0].id }] })
    if (!state.ok) throw new Error(state.error)
    state = server.rules(state.state, { type: 'resolveTop' })
    if (!state.ok) throw new Error(state.error)
    const firstOffer = state.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    state = server.rules(state.state, { type: 'selectOption', seat: 'p1', selectionId: firstOffer.id, optionId: 'retarget' })
    if (!state.ok) throw new Error(state.error)
    const firstPick = pendingPlayerSelectionFor(state.state, 'p1')!
    state = server.rules(state.state, { type: 'selectPlayers', seat: 'p1', selectionId: firstPick.id, players: ['p2'] })
    if (!state.ok) throw new Error(state.error)
    const finalOffer = state.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }
    const before = JSON.stringify(state.state)
    const rejected = server.rules(state.state, { type: 'selectOption', seat: 'p1', selectionId: finalOffer.id, optionId: 'keep' })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(JSON.stringify(rejected.state)).toBe(before)
      expect((rejected.state.players.p1.data['kernel.pendingOptionSelection'] as { id: string }).id).toBe(finalOffer.id)
    }
  })

})
