import { describe, expect, test } from 'bun:test'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot, players, select, spell, whenever } from '../cardPlugins/dsl/v1'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { pendingSelectionFor } from './selectCards'
import { pendingPlayerSelectionFor } from './selectPlayers'
import { pendingOptionSelection } from './selectOptions'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const canonicalDeathGain = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(
    { kind: 'dies', filter: { type: 'Creature' } },
    {
      instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
    },
  ),
])))

describe('canonical triggered abilities', () => {
  test('captures each actual death and executes the pinned definition after source departure', () => {
    const snapshot = canonicalDeathGain()
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Blood Artist DSL', { types: ['Creature'], power: 1, toughness: 1, ruleDefinition: snapshot }),
          cardTemplate('Victim A', { types: ['Creature'], power: 1, toughness: 1 }),
        ],
      },
    }, { random: () => 0 })
    const source = named(server.state, 'Blood Artist DSL')
    const victim = named(server.state, 'Victim A')
    let state = ok(server.rules(server.state, { type: 'move', objectId: victim.id, to: 'graveyard' }))
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].execution?.definitionSnapshot).toEqual(snapshot)
    state = ok(server.rules(state, { type: 'move', objectId: source.id, to: 'graveyard' }))
    state = resolveStack(server.rules, state)
    expect(state.players.p1.life).toBe(42)
  })

  test('puts a canonical target choice on the stack before priority', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'dies', filter: { type: 'Creature' } },
        {
          decisions: { targets: [select({ filter: players(), count: 1 })] },
          instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Targeting Artist', { types: ['Creature'], ruleDefinition: snapshot }), cardTemplate('Victim', { types: ['Creature'] })],
      },
    }, { random: () => 0 })
    const victim = named(server.state, 'Victim')
    const state = ok(server.rules(server.state, { type: 'move', objectId: victim.id, to: 'graveyard' }))
    const pending = state.players.p1.data['kernel.pendingPlayerSelection'] as { candidates: string[] }[]
    expect(pending[0].candidates).toEqual(['p1', 'p2'])
    expect(state.stack).toHaveLength(0)
  })

  test('captures a simultaneous three-creature death as three independent instances', () => {
    const snapshot = canonicalDeathGain()
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Blood Artist Three', { types: ['Creature'], power: 1, toughness: 0, ruleDefinition: snapshot }),
          cardTemplate('Victim One', { types: ['Creature'], power: 1, toughness: 0 }),
          cardTemplate('Victim Two', { types: ['Creature'], power: 1, toughness: 0 }),
        ],
      },
    }, { random: () => 0 })
    const waiting = ok(server.rules(server.state, { type: 'passPriority', seat: 'p1' }))
    expect(waiting.pendingTriggers).toHaveLength(3)
    expect(new Set(waiting.pendingTriggers?.map((trigger) => trigger.id)).size).toBe(3)
    expect(waiting.pendingTriggers?.every((trigger) => trigger.execution.source.snapshot.name === 'Blood Artist Three')).toBe(true)
    const order = pendingSelectionFor(waiting, 'p1')!
    const placed = ok(server.rules(waiting, {
      type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
    }))
    expect(placed.pendingTriggers).toBeUndefined()
    expect(placed.stack).toHaveLength(3)
  })

  test('announces modal triggered modes before the ability receives priority', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: { modes: { count: amount(1), repeatable: false } },
          modes: [
            { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
            { instructions: [{ kind: 'gainLife', amount: amount(2), targets: { kind: 'contextRef', name: 'controller' } }] },
          ],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Modal Draw Artist', { types: ['Creature'], ruleDefinition: snapshot })] },
      libraries: { p1: [cardTemplate('Draw One')] },
    }, { random: () => 0 })
    const waiting = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const choice = pendingOptionSelection(waiting, 'p1')!
    expect(choice.options).toHaveLength(2)
    const chosen = ok(server.rules(waiting, {
      type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: 'mode:1',
    }))
    expect(chosen.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, chosen)
    expect(resolved.players.p1.life).toBe(42)
  })

  test('binds heterogeneous target clauses one scope at a time before priority', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'dies', filter: { type: 'Creature' } },
        {
          decisions: { targets: [
            select({ filter: players(), count: 1 }),
            select({ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } }, count: 1 }),
          ] },
          instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [
        cardTemplate('Heterogeneous Watcher', { types: ['Creature'], ruleDefinition: snapshot }),
        cardTemplate('Target Creature', { types: ['Creature'] }),
        cardTemplate('Victim', { types: ['Creature'] }),
      ] },
    }, { random: () => 0 })
    const victim = named(server.state, 'Victim')
    let state = ok(server.rules(server.state, { type: 'move', objectId: victim.id, to: 'graveyard' }))
    const playerChoice = pendingOptionSelection(state, 'p1')
    expect(playerChoice).toBeUndefined()
    const playersChoice = state.players.p1.data['kernel.pendingPlayerSelection'] as { id: string }[]
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: playersChoice[0].id, players: ['p2'] }))
    const objectChoice = pendingSelectionFor(state, 'p1')!
    const target = named(state, 'Target Creature')
    state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: objectChoice.id, kind: 'choose', count: 1, objectIds: [target.id] }))
    expect(state.stack[0].execution?.targetBindings).toHaveLength(2)
    expect(resolveStack(server.rules, state).players.p1.life).toBe(41)
  })

  test('requires every declared modal choice before stacking', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: { modes: { count: amount(2), repeatable: false } },
          modes: [
            { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
            { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
          ],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, { players: 2, battlefield: { p1: [cardTemplate('Two Mode Watcher', { types: ['Creature'], ruleDefinition: snapshot })] }, libraries: { p1: [cardTemplate('Draw')] } }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const first = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: first.id, optionId: 'mode:0' }))
    expect(state.stack).toHaveLength(0)
    const second = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: second.id, optionId: 'mode:1' }))
    expect(state.stack[0].execution?.modeIndices).toEqual([0, 1])
  })

  test('binds targets declared by the selected mode before priority', () => {
    const targetModeSnapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: { modes: { count: amount(1), repeatable: false } },
          modes: [
            {
              decisions: { targets: [select({ filter: players(), count: 1 })] },
              instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
            },
            {
              decisions: { targets: [select({ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Creature' } }, count: 1 })] },
              instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
            },
            {
              decisions: { targets: [select({ filter: { kind: 'objects', filter: { zone: 'battlefield', type: 'Artifact' } }, count: 1 })] },
              instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }],
            },
          ],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Mode Target Watcher', { types: ['Creature'], ruleDefinition: targetModeSnapshot }), cardTemplate('Mode Target Creature', { types: ['Creature'] })],
      },
      libraries: { p1: [cardTemplate('Mode Draw')] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const mode = pendingOptionSelection(state, 'p1')!
    expect(mode.options.map((option) => option.id)).toEqual(['mode:0', 'mode:1'])
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: mode.id, optionId: 'mode:1' }))
    const cardChoice = pendingSelectionFor(state, 'p1')!
    const target = named(state, 'Mode Target Creature')
    state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: cardChoice.id, kind: 'choose', count: 1, objectIds: [target.id] }))
    expect(state.stack[0].execution?.modeIndices).toEqual([1])
    expect(state.stack[0].execution?.targetBindings).toHaveLength(1)
    expect(resolveStack(server.rules, state).players.p1.life).toBe(41)

    const playerModeState = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const playerMode = pendingOptionSelection(playerModeState, 'p1')!
    const selectedPlayerMode = ok(server.rules(playerModeState, { type: 'selectOption', seat: 'p1', selectionId: playerMode.id, optionId: 'mode:0' }))
    expect(pendingPlayerSelectionFor(selectedPlayerMode, 'p1')).toBeDefined()
  })

  test('keeps repeated selected mode target scopes independent through resolution', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: { modes: { count: amount(2), repeatable: true } },
          modes: [{
            decisions: { targets: [select({ filter: players(), count: 1 })] },
            instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'targetRef', clauseIndex: 0 } }],
          }],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Repeated Mode Watcher', { types: ['Creature'], ruleDefinition: snapshot })] },
      libraries: { p1: [cardTemplate('Repeated Mode Draw')] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const firstMode = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: firstMode.id, optionId: 'mode:0' }))
    const secondMode = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: secondMode.id, optionId: 'mode:0' }))
    const firstTarget = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: firstTarget.id, players: ['p1'] }))
    const secondTarget = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: secondTarget.id, players: ['p2'] }))
    expect(state.stack[0].execution?.targetBindings?.map((binding) => binding.scopeId)).toEqual([
      '$.abilities[0].modes[0]#0',
      '$.abilities[0].modes[0]#1',
    ])
    const resolved = resolveStack(server.rules, state)
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.players.p2.life).toBe(41)
  })

  test('enforces distinctness within each selected mode scope', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: { modes: { count: amount(1), repeatable: false } },
          modes: [{
            decisions: {
              targets: [
                select({ filter: players(), count: 1 }),
                select({ filter: players(), count: 1 }),
              ],
              constraints: [{ kind: 'different', clauseIndices: [0, 1] }],
            },
            instructions: [
              { kind: 'gainLife', amount: amount(1), targets: { kind: 'targetRef', clauseIndex: 0 } },
              { kind: 'gainLife', amount: amount(2), targets: { kind: 'targetRef', clauseIndex: 1 } },
            ],
          }],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Scoped Constraint Watcher', { types: ['Creature'], ruleDefinition: snapshot })] },
      libraries: { p1: [cardTemplate('Scoped Constraint Draw')] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const mode = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: mode.id, optionId: 'mode:0' }))
    const firstTarget = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: firstTarget.id, players: ['p1'] }))
    const secondTarget = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: secondTarget.id, players: ['p2'] }))
    const resolved = resolveStack(server.rules, state)
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.players.p2.life).toBe(42)
  })

  test('preserves base ability targets beside selected mode targets', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        {
          decisions: {
            targets: [select({ filter: players(), count: 1 })],
            modes: { count: amount(1), repeatable: false },
          },
          modes: [{
            decisions: { targets: [select({ filter: players(), count: 1 })] },
            instructions: [{ kind: 'gainLife', amount: amount(2), targets: { kind: 'targetRef', clauseIndex: 0 } }],
          }],
        },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Base and Mode Watcher', { types: ['Creature'], ruleDefinition: snapshot })] },
      libraries: { p1: [cardTemplate('Base and Mode Draw')] },
    }, { random: () => 0 })
    let state = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
    const baseTarget = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: baseTarget.id, players: ['p1'] }))
    const mode = pendingOptionSelection(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: mode.id, optionId: 'mode:0' }))
    const modeTarget = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, { type: 'selectPlayers', seat: 'p1', selectionId: modeTarget.id, players: ['p2'] }))
    expect(state.stack[0].execution?.targetBindings?.map((binding) => [binding.scopeId, binding.clauseIndex])).toEqual([
      ['$.abilities[0]', 0],
      ['$.abilities[0].modes[0]#0', 0],
    ])
    const resolved = resolveStack(server.rules, state)
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.players.p2.life).toBe(42)
  })

  test('deduplicates one OR occurrence and collects draw-three triggers before placement', () => {
    const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'dies', filter: { any: [{ type: 'Creature' }, { name: 'Victim' }] } },
        { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('OR Artist', { types: ['Creature'], ruleDefinition: snapshot }), cardTemplate('Victim', { types: ['Creature'] })] },
    }, { random: () => 0 })
    const victim = named(server.state, 'Victim')
    const died = ok(server.rules(server.state, { type: 'move', objectId: victim.id, to: 'graveyard' }))
    expect(died.stack).toHaveLength(1)

    const drawSnapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
      ),
    ])))
    const drawServer = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Draw Artist', { types: ['Creature'], ruleDefinition: drawSnapshot })] },
      libraries: { p1: [cardTemplate('Draw One'), cardTemplate('Draw Two'), cardTemplate('Draw Three')] },
    }, { random: () => 0 })
    const drawn = ok(drawServer.rules(drawServer.state, { type: 'draw', seat: 'p1', count: 3 }))
    expect(drawn.pendingTriggers).toHaveLength(3)
  })

  test('resolves a canonical draw-three program before placing all draw triggers', () => {
    const watcherSnapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'draw', filter: {} },
        { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
      ),
    ])))
    const spellSnapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        instructions: [
          { kind: 'draw', count: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
          { kind: 'draw', count: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
          { kind: 'draw', count: amount(1), targets: { kind: 'contextRef', name: 'controller' } },
        ],
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Draw Three Watcher', { types: ['Creature'], ruleDefinition: watcherSnapshot })] },
      hands: { p1: [cardTemplate('Canonical Draw Three', { types: ['Sorcery'], manaCost: '{0}', manaValue: 0, ruleDefinition: spellSnapshot })] },
      libraries: { p1: [cardTemplate('Draw Three One'), cardTemplate('Draw Three Two'), cardTemplate('Draw Three Three')] },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'Canonical Draw Three')
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id }))
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.pendingTriggers).toHaveLength(3)
    expect(resolved.objects[spellObject.id].zone).toBe('graveyard')
    expect(resolved.players.p1.life).toBe(40)
  })

  test('captures a canonical enters trigger from permanent spell resolution', () => {
    const watcherSnapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(
        { kind: 'enters', filter: { type: 'Creature' } },
        { instructions: [{ kind: 'gainLife', amount: amount(1), targets: { kind: 'contextRef', name: 'controller' } }] },
      ),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Spell Entry Watcher', { types: ['Creature'], ruleDefinition: watcherSnapshot })] },
      hands: { p1: [cardTemplate('Spell Entry Creature', { types: ['Creature'], manaCost: '{0}', manaValue: 0 })] },
    }, { random: () => 0 })
    const entrant = named(server.state, 'Spell Entry Creature')
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: entrant.id }))
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[entrant.id].zone).toBe('battlefield')
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.log.some((line) => line.includes('p1 gains 1 life'))).toBe(true)
  })
})
