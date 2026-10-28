import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  gainLife,
  grantAbilityEffect,
  grantAbilityTo,
  objects,
  permanentEffect,
  ref,
  spell,
  players,
  forTurns,
  self,
  staticAbility,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingPlayerSelection } from '../../rules/selectPlayers'
import { ok, resolveStack } from '../../testHelpers'

const staticSliverGrant = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(grantAbilityTo({
    targets: objects({
      zone: 'battlefield',
      type: 'Creature',
      subtypes: ['Fixture Sliver'],
      controller: 'you',
    }),
    ability: {
      kind: 'triggered',
      on: self.enters,
      instructions: [gainLife({ amount: 1, targets: ref('controller') })],
    },
  })),
])))

const sliver = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  subtypes: ['Fixture Sliver'],
  power: 2,
  toughness: 2,
})

describe('grantedAbilities', () => {

  test('a printed static grant reaches only matching creatures its controller controls', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Sliver source', {
          types: ['Creature'], subtypes: ['Fixture Sliver'], power: 2, toughness: 2,
          ruleDefinition: staticSliverGrant,
        })],
        p2: [sliver('Opponent Sliver')],
      },
      hands: { p1: [sliver('Matching Sliver')] },
    }, { random: () => 0 })
    const sourceLife = server.state.players.p1.life
    const opponentLife = server.state.players.p2.life
    const entered = ok(server.rules(server.state, {
      type: 'move', objectId: server.state.zoneOrder.p1.hand[0]!, to: 'battlefield',
    }))
    expect(entered.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, entered)
    expect(resolved.players.p1.life).toBe(sourceLife + 1)
    expect(resolved.players.p2.life).toBe(opponentLife)
    expect(Object.values(resolved.objects).find(object => object.name === 'Opponent Sliver')?.canonicalGrantedAbilities ?? []).toHaveLength(0)
  })

  test('a matching source grants its trigger to itself as it enters', () => {
    const source = cardTemplate('Self-granting Sliver', {
      types: ['Creature'], subtypes: ['Fixture Sliver'], power: 2, toughness: 2,
      ruleDefinition: staticSliverGrant,
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [source] },
    }, { random: () => 0 })
    const entered = ok(server.rules(server.state, {
      type: 'move', objectId: server.state.zoneOrder.p1.hand[0]!, to: 'battlefield',
    }))
    expect(entered.stack).toHaveLength(1)
    expect(resolveStack(server.rules, entered).players.p1.life).toBe(41)
  })

  test('a printed static grant expires before later matching creatures enter', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Sliver source', {
        types: ['Creature'], subtypes: ['Fixture Sliver'], power: 2, toughness: 2,
        ruleDefinition: staticSliverGrant,
      })] },
      hands: { p1: [sliver('Later Sliver')] },
    }, { random: () => 0 })
    const sourceId = server.state.zoneOrder.p1.battlefield[0]!
    const left = ok(server.rules(server.state, { type: 'move', objectId: sourceId, to: 'graveyard' }))
    const entered = ok(server.rules(left, {
      type: 'move', objectId: left.zoneOrder.p1.hand[0]!, to: 'battlefield',
    }))
    expect(entered.stack).toHaveLength(0)
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
