import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import { availableActions, legalActsFor, eventsForAvailableAction } from '../../actions'
import { createJournal, restoreJournal } from '../../journal'
import { describe, expect, test } from 'bun:test'
import {
  createPlayerEffect,
  PLAYER_EFFECTS,
  PLAYER_EFFECT_DURATIONS,
  ifThen,
  destroy,
  countDistinctCardTypes,
  compareAmount,
  count,
  paidCostCount,
  paidCostPlayer,
  choosePlayerCost,
  characteristic,
  chooseX,
  divide,
  gainLife,
  ROUNDING_MODES,
  beginAnnouncement,
  commitAnnouncement,
  manaCost,
  prepareAction,
  rollbackAnnouncement,
  select,
  objects,
  players,
  variable,
  activated,
  discardCost,
  draw,
  lifeCost,
  ref,
  sacrificeCost,
  spell,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  move,
  target,
} from './v1'
import { AMOUNT_DEPTH_ERROR_MESSAGE } from './compiler/constants'
import { beginActivatedAnnouncement } from './compiler/announcement'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import type { GameEvent, GameState } from '../../types'
import type { Amount } from './v1'

const state = { players: { p1: { mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 2 } } }, objects: {}, stack: [] } as unknown as Parameters<typeof beginAnnouncement>[0]

const named = (gameState: GameState, name: string) =>
  Object.values(gameState.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  gameState: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(gameState, event))

describe('announcement transactions', () => {
  test('locks the total cost and commits only after full payment', () => {
    const result = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{2}{G}') ] },
      payment: [
        { sourceId: 'forest', mana: 'G' },
        { sourceId: 'solRing', mana: 'C', amount: 2 },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.transaction.status).toBe('provisional')
    expect(result.transaction.lockedCost.mana).toBe('{2}{G}')
    expect(commitAnnouncement(result.transaction).status).toBe('committed')
    expect(() => commitAnnouncement(result.transaction)).toThrow('no longer provisional')
  })

  test('duplicate sources, incomplete payment, and cancellation leave no committed transaction', () => {
    const duplicate = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{1}') ] },
      payment: [{ sourceId: 'land', mana: 'G' }, { sourceId: 'land', mana: 'G' }],
    })
    expect(duplicate.ok).toBe(false)
    const insufficient = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [manaCost('{2}') ] },
      payment: [{ sourceId: 'land', mana: 'G' }],
    })
    expect(insufficient.ok).toBe(false)
    const valid = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', costs: { mandatory: [] },
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(rollbackAnnouncement(valid.transaction).status).toBe('rolledBack')
  })

  test('ordered target slots reject duplicate targets and retain X in the frame', () => {
    const result = beginAnnouncement(state, {
      payer: 'p1', sourceId: 'spell', variables: { X: 0 },
      costs: { mandatory: [manaCost('{0}')] }, payment: [],
      targetClauses: [select({ filter: players({}), count: 1 })],
      targets: [[{ kind: 'player', player: 'p1' }]],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.transaction.lockedCost.x).toBe(0)
  })

  test('a fully supplied action does not open a target picker', () => {
    const offer = prepareAction(state, {
      action: 'cast', payer: 'p1', sourceId: 'spell', targetClauses: [],
      proposal: { payer: 'p1', sourceId: 'spell', costs: { mandatory: [] } },
    })
    expect(offer.requiresInput).toBe(false)
  })

  test('one X binds targets, mana, and discard choices in the same proposal', () => {
    const tideState = {
      players: {
        p1: { mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 }, life: 40 },
        p2: {}, p3: {},
      },
      objects: {
        tide: { id: 'tide', name: 'Tide', controller: 'p1', zone: 'hand', types: ['Sorcery'], token: false },
        a: { id: 'a', name: 'A', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
        b: { id: 'b', name: 'B', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
        c: { id: 'c', name: 'C', controller: 'p1', zone: 'hand', types: ['Land'], token: false },
      },
      stack: [],
    } as unknown as Parameters<typeof beginAnnouncement>[0]
    const result = beginAnnouncement(tideState, {
      payer: 'p1', sourceId: 'tide', variables: { X: 3 },
      targetClauses: [select({ filter: players({}), count: variable('X') })],
      targets: [[{ kind: 'player', player: 'p1' }, { kind: 'player', player: 'p2' }, { kind: 'player', player: 'p3' }]],
      costs: { mandatory: [manaCost('{X}'), discardCost(objects({ zone: 'hand', type: 'Land' }), variable('X'))] },
      payment: [{ sourceId: 'p1.pool.C', mana: 'C', amount: 3 }],
      nonManaChoices: ['a', 'b', 'c'],
    })
    expect(result.ok).toBe(true)
  })

  test('canonical announcements lock server-owned optional, alternative, and adjusted costs', () => {
    const optionalDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{1}')],
      optionalCosts: [manaCost('{2}')],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const optionalServer = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Optional canonical spell', { types: ['Sorcery'], manaCost: '{1}', ruleDefinition: optionalDefinition })] },
    }, { random: () => 0 })
    optionalServer.state.players.p1.mana.C = 3
    const optionalSpell = Object.values(optionalServer.state.objects).find((object) => object.name === 'Optional canonical spell')!
    const optionalCast = optionalServer.rules(optionalServer.state, {
      type: 'castSpell', seat: 'p1', objectId: optionalSpell.id, selectedOptionalCosts: [0],
    })
    expect(optionalCast.ok).toBe(true)
    if (optionalCast.ok) expect(optionalCast.state.players.p1.mana.C).toBe(0)

    const alternativeDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{0}')],
      alternativeCosts: [[manaCost('{1}')], [manaCost('{3}')]],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const alternativeServer = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Alternative canonical spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: alternativeDefinition })] },
    }, { random: () => 0 })
    alternativeServer.state.players.p1.mana.C = 3
    const alternativeSpell = Object.values(alternativeServer.state.objects).find((object) => object.name === 'Alternative canonical spell')!
    const invalid = alternativeServer.rules(alternativeServer.state, {
      type: 'castSpell', seat: 'p1', objectId: alternativeSpell.id, selectedAlternativeCost: 9,
    })
    expect(invalid.ok).toBe(false)
    const valid = alternativeServer.rules(alternativeServer.state, {
      type: 'castSpell', seat: 'p1', objectId: alternativeSpell.id, selectedAlternativeCost: 1,
    })
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.state.players.p1.mana.C).toBe(0)

    const adjustedDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{2}')],
      costIncreases: [{ amount: '{1}' }],
      costReductions: [{ generic: { kind: 'constant', value: 1 } }],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const adjustedServer = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Adjusted canonical spell', { types: ['Sorcery'], manaCost: '{2}', ruleDefinition: adjustedDefinition })] },
    }, { random: () => 0 })
    adjustedServer.state.players.p1.mana.C = 1
    const adjustedSpell = Object.values(adjustedServer.state.objects).find((object) => object.name === 'Adjusted canonical spell')!
    const adjusted = adjustedServer.rules(adjustedServer.state, {
      type: 'castSpell', seat: 'p1', objectId: adjustedSpell.id,
    })
    expect(adjusted.ok).toBe(false)
    expect(adjusted.state.players.p1.mana.C).toBe(1)
  })

  test('canonical announcements accept Phyrexian mana indexes on the printed cost', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [manaCost('{1}{B/P}{B/P}')],
      decisions: { targets: [] },
      instructions: [],
    })])))
    const phyrexianCases = [
      { black: 2, phyrexianLife: undefined, ok: true, expectedLife: 40, expectedBlack: 0 },
      { black: 1, phyrexianLife: [0], ok: true, expectedLife: 38, expectedBlack: 0 },
      { black: 0, phyrexianLife: [0, 1], ok: true, expectedLife: 36, expectedBlack: 0 },
      { black: 0, phyrexianLife: undefined, ok: false, expectedLife: 40, expectedBlack: 0 },
      { black: 0, phyrexianLife: [0, 0], ok: false, expectedLife: 40, expectedBlack: 0 },
      { black: 0, phyrexianLife: [0, 1], life: 3, ok: false, expectedLife: 3, expectedBlack: 0 },
    ] as const

    for (const entry of phyrexianCases) {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Phyrexian fixture spell', {
          types: ['Instant'], manaCost: '{1}{B/P}{B/P}', ruleDefinition: definition,
        })] },
      }, { random: () => 0 })
      server.state.players.p1.mana.C = 1
      server.state.players.p1.mana.B = entry.black
      if ('life' in entry) server.state.players.p1.life = entry.life
      const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Phyrexian fixture spell')!
      const cast = server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spellObject.id,
        ...(entry.phyrexianLife !== undefined ? { phyrexianLife: [...entry.phyrexianLife] } : {}),
      })
      expect(cast.ok).toBe(entry.ok)
      if (!cast.ok) continue
      expect(cast.state.players.p1.life).toBe(entry.expectedLife)
      expect(cast.state.players.p1.mana.B).toBe(entry.expectedBlack)
      expect(cast.state.players.p1.mana.C).toBe(0)
    }
  })

  test('alternative costs can mix mana and life while charging the selected amounts', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      costs: [manaCost('{1}{B}{B}')],
      alternativeCosts: [
        [manaCost('{1}{B}'), lifeCost(2)],
        [manaCost('{1}'), lifeCost(4)],
      ],
      decisions: { targets: [] },
      instructions: [],
    })])))
    const cases = [
      { alternative: undefined, black: 2, expectedLife: 40, expectedBlack: 0 },
      { alternative: 0, black: 1, expectedLife: 38, expectedBlack: 0 },
      { alternative: 1, black: 0, expectedLife: 36, expectedBlack: 0 },
    ] as const

    for (const entry of cases) {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Mixed-cost fixture spell', {
          types: ['Instant'], manaCost: '{1}{B}{B}', ruleDefinition: definition,
        })] },
      }, { random: () => 0 })
      server.state.players.p1.mana.C = 1
      server.state.players.p1.mana.B = entry.black
      const spellObject = Object.values(server.state.objects).find((object) => object.name === 'Mixed-cost fixture spell')!
      const cast = server.rules(server.state, {
        type: 'castSpell',
        seat: 'p1',
        objectId: spellObject.id,
        ...(entry.alternative !== undefined ? { selectedAlternativeCost: entry.alternative } : {}),
      })
      expect(cast.ok).toBe(true)
      if (!cast.ok) continue
      expect(cast.state.players.p1.life).toBe(entry.expectedLife)
      expect(cast.state.players.p1.mana.B).toBe(entry.expectedBlack)
      expect(cast.state.players.p1.mana.C).toBe(0)
    }
  })

  test('public serializable transaction-shaped casts cannot bypass canonical payment', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [{ kind: 'life', amount: { kind: 'constant', value: 3 } }],
      decisions: { targets: [] },
      instructions: [],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Serializable payment spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: definition })] },
    }, { random: () => 0 })
    const spell = Object.values(server.state.objects).find((object) => object.name === 'Serializable payment spell')!
    const result = server.rules(server.state, {
      type: 'castSpell', seat: 'p1', objectId: spell.id,
      canonicalTransaction: {
        id: 'forged',
        proposal: { payer: 'p1', sourceId: spell.id, costs: { mandatory: [] } },
        lockedCost: { mana: '', nonMana: [] },
        payment: [], status: 'committed',
      },
    })
    expect(result.ok).toBe(false)
    expect(result.state.players.p1.life).toBe(40)
  })

  test('activated sacrifice of the source needs no explicit cost choice', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [manaCost('{3}{G}'), sacrificeCost(ref('source'), 1)],
      instructions: [draw({ count: 1, targets: ref('controller') })],
    })])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Sac source', { types: ['Creature'], ruleDefinition: definition })] },
      libraries: { p1: [cardTemplate('Top card')] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Sac source')!
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 4, C: 0 }
    const activatedState = server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: source.id,
      abilityId: '$.abilities[0]',
    })
    expect(activatedState.ok).toBe(true)
    if (!activatedState.ok) return
    expect(activatedState.state.objects[source.id].zone).toBe('graveyard')
    expect(activatedState.state.stack).toHaveLength(1)
  })

  test('activated sacrifice of the source fails without enough mana', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [manaCost('{3}{G}'), sacrificeCost(ref('source'), 1)],
      instructions: [draw({ count: 1, targets: ref('controller') })],
    })])))
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Sac source broke', { types: ['Creature'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Sac source broke')!
    const result = server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: source.id,
      abilityId: '$.abilities[0]',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not enough mana|payment does not cover/)
  })

  test('activated sacrifice of the source rejects another creature as the cost choice', () => {
    const ability = compileCardRuleDefinition(card([activated({
      costs: [sacrificeCost(ref('source'), 1)],
      instructions: [draw({ count: 1, targets: ref('controller') })],
    })])).definition.abilities[0]!
    expect(ability.kind).toBe('activated')
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          cardTemplate('Sac source only', { types: ['Creature'] }),
          cardTemplate('Other creature', { types: ['Creature'], power: 1, toughness: 1 }),
        ],
      },
    }, { random: () => 0 })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Sac source only')!
    const other = Object.values(server.state.objects).find((object) => object.name === 'Other creature')!
    if (ability.kind !== 'activated') throw new Error('expected activated ability')
    expect(beginActivatedAnnouncement(server.state, source, 'p1', ability, [], undefined, [other.id]).ok).toBe(false)
    expect(beginActivatedAnnouncement(server.state, source, 'p1', ability, [], undefined, undefined).ok).toBe(true)
  })
})
describe('Aether Tide one-X announcement integration', () => {
  const tideFixture = () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{X}{U}'), discardCost(objects({ zone: 'hand', type: 'Creature' }), variable('X'))],
      decisions: { variables: [{ name: 'X', min: 0, max: 4 }], targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: variable('X') })] },
      instructions: [{ kind: 'move', targets: { kind: 'targetRef', clauseIndex: 0 }, to: 'hand' }],
    }])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Aether Tide', { types: ['Sorcery'], manaCost: '{X}{U}', ruleDefinition: definition }), cardTemplate('Tide discard A', { types: ['Creature'] }), cardTemplate('Tide discard B', { types: ['Creature'] })] },
      battlefield: { p2: [cardTemplate('Tide target A', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Tide target B', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0 })
    const state = structuredClone(server.state)
    state.players.p1.mana.U = 1
    state.players.p1.mana.C = 2
    const spell = Object.values(state.objects).find((object) => object.name === 'Aether Tide')!
    const discards = Object.values(state.objects).filter((object) => object.name.startsWith('Tide discard')).map((object) => object.id)
    const targets = Object.values(state.objects).filter((object) => object.name.startsWith('Tide target')).map((object) => ({ kind: 'object' as const, objectId: object.id }))
    return { server, state, spell, discards, targets }
  }

  test('X zero pays only blue and opens no picker', () => {
    const { server, state, spell } = tideFixture()
    const result = server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 0, targets: [], discard: [] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.players.p1.mana.U).toBe(0)
  })

  test('X two pays blue plus generic and discards two creatures', () => {
    const { server, state, spell, discards, targets } = tideFixture()
    const result = server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players.p1.mana.U).toBe(0)
      expect(result.state.players.p1.mana.C).toBe(0)
      expect(discards.every((id) => result.state.objects[id].zone === 'graveyard')).toBe(true)
    }
  })

  test('X two rejects insufficient creature discards atomically', () => {
    const { server, state, spell, targets } = tideFixture()
    const result = server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: [] })
    expect(result.ok).toBe(false)
    expect(result.state).toEqual(state)
  })
})

describe('aetherTide — integration', () => {

  describe('Aether Tide', () => {
    const tideSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([{
      kind: 'spell',
      costs: [manaCost('{X}{U}'), discardCost(objects({ zone: 'hand', type: 'Creature' }), variable('X'))],
      decisions: {
        variables: [{ name: 'X', min: 0, max: 4 }],
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: variable('X') })],
      },
      instructions: [move({ targets: target(0), to: 'hand' })],
    }])))

    const tideBoard = () => {
      const definition = tideSpell()
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Aether Tide', { types: ['Sorcery'], manaCost: '{X}{U}', ruleDefinition: definition }),
            cardTemplate('Tide discard A', { types: ['Creature'] }),
            cardTemplate('Tide discard B', { types: ['Creature'] }),
          ],
        },
        battlefield: {
          p2: [
            cardTemplate('Tide target A', { types: ['Creature'], power: 2, toughness: 2 }),
            cardTemplate('Tide target B', { types: ['Creature'], power: 2, toughness: 2 }),
          ],
        },
      }, { random: () => 0 })
      const state = structuredClone(server.state)
      state.players.p1.mana.U = 1
      state.players.p1.mana.C = 2
      return { server, state }
    }

    test('one X returns each target to its owner hand after paying discards', () => {
      const { server, state } = tideBoard()
      const spell = named(state, 'Aether Tide')
      const discards = [named(state, 'Tide discard A'), named(state, 'Tide discard B')].map((object) => object.id)
      const targets = [named(state, 'Tide target A'), named(state, 'Tide target B')].map((object) => ({
        kind: 'object' as const,
        objectId: object.id,
      }))
      let next = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards,
      })
      next = reduce(server, next, { type: 'resolveTop' })
      expect(discards.every((id) => next.objects[id].zone === 'graveyard')).toBe(true)
      expect(next.objects[targets[0].objectId].zone).toBe('hand')
      expect(next.objects[targets[1].objectId].zone).toBe('hand')
      expect(next.zoneOrder.p2.hand).toContain(targets[0].objectId)
      expect(next.zoneOrder.p2.hand).toContain(targets[1].objectId)
    })

    test('paid mana and discards are not refunded when every target is illegal at resolution', () => {
      const { server, state } = tideBoard()
      const spell = named(state, 'Aether Tide')
      const discards = [named(state, 'Tide discard A'), named(state, 'Tide discard B')].map((object) => object.id)
      const targets = [named(state, 'Tide target A'), named(state, 'Tide target B')].map((object) => ({
        kind: 'object' as const,
        objectId: object.id,
      }))
      let next = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: spell.id, x: 2, targets, discard: discards,
      })
      next = reduce(server, next, { type: 'move', objectId: targets[0].objectId, to: 'graveyard' })
      next = reduce(server, next, { type: 'move', objectId: targets[1].objectId, to: 'graveyard' })
      next = reduce(server, next, { type: 'resolveTop' })
      expect(discards.every((id) => next.objects[id].zone === 'graveyard')).toBe(true)
      expect(next.players.p1.mana.U).toBe(0)
      expect(next.players.p1.mana.C).toBe(0)
      expect(next.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
    })
  })
})

test.each([false, true])('canonical spell announcements charge printed mana once with explicitMana=%s', explicitMana => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ costs: explicitMana ? [manaCost('{1}{G}')] : [], instructions: [] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Printed cost fixture', { types: ['Instant'], manaCost: '{1}{G}', ruleDefinition: definition })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(false)
  expect(server.state.objects[objectId].zone).toBe('hand')
  const funded = structuredClone(server.state)
  funded.players.p1.mana.C = 3
  funded.players.p1.mana.G = 1
  const cast = server.rules(funded, { type: 'castSpell', seat: 'p1', objectId, additionalGeneric: 2 })
  expect(cast.ok).toBe(true)
  expect(cast.state.players.p1.mana.C).toBe(0)
  expect(cast.state.players.p1.mana.G).toBe(0)
  expect(cast.state.objects[objectId].zone).toBe('stack')
})

test('fractional life costs are evaluated and paid at announcement', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [instructionSpell({ costs: [lifeCost(divide({ value: characteristic(ref('controller'), 'life', { information: 'current' }), by: 2, rounding: ROUNDING_MODES.up }))], instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })] },
  }, { random: () => 0 })
  const initial = structuredClone(server.state)
  initial.players.p1.life = 15
  const casted = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0] }))
  expect(casted.players.p1.life).toBe(7)
  expect(resolveStack(server.rules, casted).players.p1.life).toBe(8)
})


test('context-free fractional costs lock constants and X without a source object', () => {
  const initial = { ...state, players: { p1: { ...state.players.p1, life: 20 } } }
  const result = beginAnnouncement(initial, {
    payer: 'p1', sourceId: 'missing-source', variables: { X: 7 },
    costs: { mandatory: [lifeCost(divide({ value: variable('X'), by: 2, rounding: ROUNDING_MODES.up }))] },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.transaction.lockedCost.nonMana).toContainEqual(lifeCost(4))
})


test('context-free fractional cost locking preserves the expression-depth limit', () => {
  let expression: Amount = { kind: 'constant', value: 1 }
  for (let index = 0; index < 34; index += 1) expression = divide({ value: expression, by: 2, rounding: ROUNDING_MODES.up })
  const result = beginAnnouncement({ ...state, players: { p1: { ...state.players.p1, life: 20 } } }, {
    payer: 'p1', sourceId: 'missing-source', costs: { mandatory: [lifeCost(expression)] },
  })
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected excessive expression depth to fail')
  expect(result.error).toBe(AMOUNT_DEPTH_ERROR_MESSAGE)
})


test.each([[39, true], [40, true], [41, false]] as const)('life-X costs allow payment up to the available life total (%s)', (life, expected) => {
  const result = beginAnnouncement({ ...state, players: { p1: { ...state.players.p1, life: 40 } } }, {
    payer: 'p1', sourceId: 'spell', variables: { X: life }, costs: { mandatory: [lifeCost(variable('X'))] },
  })
  expect(result.ok).toBe(expected)
  if (result.ok) expect(result.transaction.lockedCost.nonMana).toContainEqual(lifeCost(life))
})

test('catalog Hatred pays X life at announcement and pumps only power', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Hatred')] },
    battlefield: { p1: [cardTemplate('Wall fixture', { types: ['Creature'], power: 0, toughness: 2 })] },
  }, { random: () => 0.5 })
  let state = structuredClone(server.state)
  state.active = 'p1'
  state.priority = 'p1'
  state.step = 'precombatMain'
  state.players.p1.mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  const wall = named(state, 'Wall fixture')
  state = ok(server.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, 'Hatred').id,
    x: 5,
    targets: [{ kind: 'object', objectId: wall.id }],
  }))
  expect(state.players.p1.life).toBe(35)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  expect(state.objects[wall.id].power).toBe(5)
  expect(state.objects[wall.id].toughness).toBe(2)
})

test('catalog Toxic Deluge pays X life at announcement and applies negative X globally until cleanup', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Toxic Deluge')] },
    battlefield: {
      p1: [cardTemplate('Large', { types: ['Creature'], power: 5, toughness: 5 })],
      p2: [cardTemplate('Small', { types: ['Creature'], power: 2, toughness: 2 })],
    },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 }
  const spell = ready.zoneOrder.p1.hand[0]
  // CR 119.4: paying more life than the 40 available is illegal; paying all 40 is allowed.
  expect(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell, x: 41 }).ok).toBe(false)
  expect(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell, x: 40 }).ok).toBe(true)

  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell, x: 3 }))
  expect(cast.players.p1.life).toBe(37)
  const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(named(resolved, 'Large')).toMatchObject({ power: 2, toughness: 2 })
  expect(named(resolved, 'Small').zone).toBe('graveyard')
  const cleaned = ok(server.rules(
    { ...resolved, step: 'end', priority: 'p1' },
    { type: 'advanceStep' },
  ))
  expect(named(cleaned, 'Large')).toMatchObject({ power: 5, toughness: 5 })
  expect(named(cleaned, 'Small')).toMatchObject({ power: 2, toughness: 2 })
})


test.each([0, 3])('colored X mana is enforced when locking spell payment (X=%s)', x => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({ decisions: { variables: [chooseX({ manaColor: 'B' })] }, instructions: [] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [cardTemplate('Colored variable fixture', { types: ['Sorcery'], manaCost: '{X}{1}{B}', ruleDefinition: definition })] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.B = 1
  ready.players.p1.mana.C = x + 1
  const event = { type: 'castSpell' as const, seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], x }
  expect(server.rules(ready, event).ok).toBe(x === 0)
  ready.players.p1.mana.B = x + 1
  ready.players.p1.mana.C = 1
  const cast = server.rules(ready, event)
  expect(cast.ok).toBe(true)
  if (cast.ok) expect(Object.values(cast.state.players.p1.mana).reduce((sum, amount) => sum + amount, 0)).toBe(0)
})


test.each([1, 3, 4, 5])('generic reductions can reduce restricted X payment (reduction=%s)', reduction => {
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [instructionSpell({
      decisions: { variables: [chooseX({ manaColor: 'B' })] },
      costReductions: [{ generic: reduction }], instructions: [],
    }, '{X}{1}{B}')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.B = Math.max(0, 3 - reduction) + 1
  ready.players.p1.mana.C = reduction > 3 ? 0 : 1
  const cast = server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0], x: 3 })
  expect(cast.ok).toBe(true)
  if (cast.ok) expect(Object.values(cast.state.players.p1.mana).reduce((sum, amount) => sum + amount, 0)).toBe(0)
})


describe('shared optional payment receipts', () => {
  test.each([0, 1, 3])('pays the complete optional cost %s times and retains the count through restore', count => {
    const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
      optionalCosts: [manaCost('{2}')], repeatableOptionalCosts: [0],
      instructions: [gainLife({ targets: ref('controller'), amount: paidCostCount('optional', 0) })],
    })] } }, { random: () => 0 })
    server.state.players.p1.mana.C = 6
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], selectedOptionalCosts: Array.from({ length: count }, () => 0) }))
    expect(cast.players.p1.mana.C).toBe(6 - count * 2)
    const restored = restoreJournal(createJournal(cast), server.rules).current()
    const resolved = resolveStack(server.rules, restored)
    expect(resolved.players.p1.life).toBe(40 + count)
    expect(resolved.objects[cast.stack[0].objectId].castCostChoices).toBeUndefined()
  })

  test('an ordinary optional cost cannot be paid twice and insufficient payment is atomic', () => {
    for (const repeatable of [false, true]) {
      const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
        optionalCosts: [manaCost('{2}')], ...(repeatable ? { repeatableOptionalCosts: [0] } : {}),
        instructions: [draw({ targets: ref('controller'), count: 1 })],
      })] } }, { random: () => 0 })
      server.state.players.p1.mana.C = 3
      const before = structuredClone(server.state)
      expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], selectedOptionalCosts: [0, 0] }).ok).toBe(false)
      expect(server.state).toEqual(before)
    }
  })

  test('alternative payments share the receipt while optional costs remain additional', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
      alternativeCosts: [[lifeCost(4)]], optionalCosts: [manaCost('{2}')],
      instructions: [gainLife({ targets: ref('controller'), amount: paidCostCount('alternative', 0) })],
    }, '{8}')] } }, { random: () => 0 })
    server.state.players.p1.mana.C = 2
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], selectedAlternativeCost: 0, selectedOptionalCosts: [0] }))
    expect(cast.players.p1.life).toBe(36)
    expect(cast.players.p1.mana.C).toBe(0)
    expect(resolveStack(server.rules, cast).players.p1.life).toBe(37)
  })
})


test('alternative payment preserves mandatory additional costs and respects its condition', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
    alternativeCosts: [[lifeCost(4)]], additionalCosts: [lifeCost(2)],
    costConditions: [{ cost: 'alternative', index: 0, when: compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Land' })), 'gte', 1) }],
    instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
  }, '{5}')] }, libraries: { p1: [cardTemplate('Land fixture', { types: ['Land'] })] } }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, selectedAlternativeCost: 0 }).ok).toBe(false)
  const ready = ok(server.rules(server.state, { type: 'move', objectId: server.state.zoneOrder.p1.library[0], to: 'battlefield' }))
  const insufficient = structuredClone(ready)
  insufficient.players.p1.life = 5
  expect(server.rules(insufficient, { type: 'castSpell', seat: 'p1', objectId, selectedAlternativeCost: 0 }).ok).toBe(false)
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId, selectedAlternativeCost: 0 }))
  expect(cast.players.p1.life).toBe(34)
})

test('action offers fund repeated optional costs through the same announcement transaction', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
    optionalCosts: [manaCost('{2}')], repeatableOptionalCosts: [0],
    instructions: [gainLife({ targets: ref('controller'), amount: paidCostCount('optional', 0) })],
  })] } }, { random: () => 0 })
  server.state.players.p1.mana.C = 5
  const options = availableActions(server.state, 'p1').filter(action => action.kind === 'castSpell')
  expect(options.map(action => action.kind === 'castSpell' ? action.selectedOptionalCosts?.length ?? 0 : -1)).toEqual([0, 1, 2])
  const events = eventsForAvailableAction(server.state, 'p1', options[2])!
  let current = server.state
  for (const event of events) current = ok(server.rules(current, event))
  expect(current.players.p1.mana.C).toBe(1)
  expect(resolveStack(server.rules, current).players.p1.life).toBe(42)
})


test('an optional payment can expand target eligibility before costs are paid', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
    optionalCosts: [manaCost('{1}')],
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', any: [
      { type: 'Artifact' }, { when: compareAmount(paidCostCount('optional', 0), 'gte', 1), not: { type: 'Land' } },
    ] }), count: 1 })] },
    instructions: [destroy({ targets: target(0) })],
  })])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Target option fixture', { types: ['Instant'], manaCost: '{1}', ruleDefinition: definition })] }, battlefield: { p2: [
    cardTemplate('Artifact fixture', { types: ['Artifact'] }), cardTemplate('Creature fixture', { types: ['Creature'], power: 2, toughness: 2 }),
  ] } }, { random: () => 0 })
  server.state.players.p1.mana.C = 2
  const spellId = server.state.zoneOrder.p1.hand[0]
  const creature = server.state.zoneOrder.p2.battlefield[1]
  const plain = legalActsFor(server.state, 'p1').find(action => action.kind === 'castSpell' && !action.selectedOptionalCosts)
  const paid = legalActsFor(server.state, 'p1').find(action => action.kind === 'castSpell' && action.selectedOptionalCosts?.length)
  expect(plain?.kind === 'castSpell' && plain.targetGroups?.[0].targets.map(candidate => candidate.objectId)).not.toContain(creature)
  expect(paid?.kind === 'castSpell' && paid.targetGroups?.[0].targets.map(candidate => candidate.objectId)).toContain(creature)
  const targets = [{ kind: 'object' as const, objectId: creature }]
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets }).ok).toBe(false)
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets, selectedOptionalCosts: [0] }))
  expect(resolveStack(server.rules, cast).objects[creature].zone).toBe('graveyard')
})


describe('conditional cost reductions', () => {
  test('catalog Price of Fame reduces its cost only for a legendary creature target', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Price of Fame')] },
      battlefield: { p2: [
        cardTemplate('Legendary creature', { types: ['Creature'], supertypes: ['Legendary'], power: 2, toughness: 2 }),
        cardTemplate('Ordinary creature', { types: ['Creature'], power: 2, toughness: 2 }),
      ] },
    }, { random: () => 0 })
    server.state.players.p1.mana.B = 1
    server.state.players.p1.mana.C = 1
    const spellId = server.state.zoneOrder.p1.hand[0]!
    const [legend, ordinary] = server.state.zoneOrder.p2.battlefield
    const offered = legalActsFor(server.state, 'p1').filter(action => action.kind === 'castSpell')
    expect(offered).toHaveLength(1)
    expect(offered[0]?.kind === 'castSpell' && offered[0].targetGroups?.[0].targets.map(candidate => candidate.objectId)).toEqual([legend])
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: ordinary }] }).ok).toBe(false)
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: legend }] }))
    expect(cast.players.p1.mana.B + cast.players.p1.mana.C).toBe(0)
    expect(resolveStack(server.rules, cast).objects[legend]!.zone).toBe('graveyard')
  })

  test('catalog Drag to the Roots reduces its cost with four graveyard card types and excludes lands', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Drag to the Roots')] },
      libraries: { p1: [
        cardTemplate('Graveyard creature', { types: ['Creature'], zone: 'graveyard' }),
        cardTemplate('Graveyard artifact', { types: ['Artifact'], zone: 'graveyard' }),
        cardTemplate('Graveyard instant', { types: ['Instant'], zone: 'graveyard' }),
        cardTemplate('Graveyard sorcery', { types: ['Sorcery'], zone: 'graveyard' }),
      ] },
      battlefield: { p2: [
        cardTemplate('Nonland target', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Land target', { types: ['Land'] }),
      ] },
    }, { random: () => 0 })
    server.state.players.p1.mana.B = 1
    server.state.players.p1.mana.G = 1
    const spellId = server.state.zoneOrder.p1.hand[0]!
    const [creature, land] = server.state.zoneOrder.p2.battlefield
    const offered = legalActsFor(server.state, 'p1').filter(action => action.kind === 'castSpell')
    expect(offered).toHaveLength(1)
    expect(offered[0]?.kind === 'castSpell' && offered[0].targetGroups?.[0].targets.map(candidate => candidate.objectId)).toEqual([creature])
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: land }] }).ok).toBe(false)
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: creature }] }))
    expect(cast.players.p1.mana.B + cast.players.p1.mana.G).toBe(0)
    expect(resolveStack(server.rules, cast).objects[creature]!.zone).toBe('graveyard')
  })

  test('catalog Tear Asunder expands its target to nonlands only when kicker is paid', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Tear Asunder')] },
      battlefield: { p2: [
        cardTemplate('Artifact target', { types: ['Artifact'] }),
        cardTemplate('Creature target', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Land target', { types: ['Land'] }),
      ] },
    }, { random: () => 0 })
    server.state.players.p1.mana.G = 1
    server.state.players.p1.mana.C = 2
    server.state.players.p1.mana.B = 1
    const spellId = server.state.zoneOrder.p1.hand[0]!
    const [artifact, creature, land] = server.state.zoneOrder.p2.battlefield
    const offered = legalActsFor(server.state, 'p1').filter(action => action.kind === 'castSpell')
    expect(offered).toHaveLength(2)
    const unKicked = offered.find(action => action.kind === 'castSpell' && !action.selectedOptionalCosts)
    const kicked = offered.find(action => action.kind === 'castSpell' && action.selectedOptionalCosts?.includes(0))
    expect(unKicked?.kind === 'castSpell' && unKicked.targetGroups?.[0].targets.map(candidate => candidate.objectId)).toEqual([artifact])
    expect(kicked?.kind === 'castSpell' && kicked.targetGroups?.[0].targets.map(candidate => candidate.objectId)).toEqual([artifact, creature])
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: creature }] }).ok).toBe(false)
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: land }], selectedOptionalCosts: [0] }).ok).toBe(false)
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: creature }], selectedOptionalCosts: [0] }))
    expect(cast.players.p1.mana.G + cast.players.p1.mana.B + cast.players.p1.mana.C).toBe(0)
    expect(resolveStack(server.rules, cast).objects[creature]!.zone).toBe('exile')
  })

  test('a chosen target determines a generic reduction without reducing colored mana', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      costReductions: [{ generic: 2, when: compareAmount(count(objects({ among: target(0), supertypes: ['Legendary'] })), 'gte', 1) }],
      instructions: [destroy({ targets: target(0) })],
    })])))
    const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Reduced target fixture', { types: ['Instant'], manaCost: '{3}{B}', ruleDefinition: definition })] }, battlefield: { p2: [
      cardTemplate('Legend fixture', { types: ['Creature'], supertypes: ['Legendary'], power: 2, toughness: 2 }),
      cardTemplate('Other fixture', { types: ['Creature'], power: 2, toughness: 2 }),
    ] } }, { random: () => 0 })
    server.state.players.p1.mana.B = 1
    server.state.players.p1.mana.C = 1
    const objectId = server.state.zoneOrder.p1.hand[0]
    const [legend, other] = server.state.zoneOrder.p2.battlefield
    const offered = legalActsFor(server.state, 'p1').find(action => action.kind === 'castSpell')
    expect(offered?.kind === 'castSpell' && offered.targetGroups?.[0].targets.map(candidate => candidate.objectId)).toEqual([legend])
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, targets: [{ kind: 'object', objectId: other }] }).ok).toBe(false)
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, targets: [{ kind: 'object', objectId: legend }] }))
    expect(cast.players.p1.mana.B + cast.players.p1.mana.C).toBe(0)
    expect(resolveStack(server.rules, cast).objects[legend].zone).toBe('graveyard')
  })

  test('card type diversity counts multitype cards once per type, including Kindred', () => {
    const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
      costReductions: [{ generic: 2, when: compareAmount(countDistinctCardTypes(objects({ zone: 'graveyard', owner: 'you' })), 'gte', 4) }],
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }, '{4}{G}')] }, libraries: { p1: [
      cardTemplate('Artifact creature fixture', { types: ['Artifact', 'Creature'], zone: 'graveyard' }),
      cardTemplate('Kindred spell fixture', { types: ['Kindred', 'Sorcery'], zone: 'graveyard' }),
    ] } }, { random: () => 0 })
    server.state.players.p1.mana.G = 1
    server.state.players.p1.mana.C = 2
    expect(availableActions(server.state, 'p1').some(action => action.kind === 'castSpell')).toBe(true)
    const objectId = server.state.zoneOrder.p1.hand[0]
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(true)
    const reduced = structuredClone(server.state)
    reduced.objects[reduced.zoneOrder.p1.graveyard[1]].types = ['Sorcery']
    expect(server.rules(reduced, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(false)
  })

  test('one opponent with no basic lands is enough even when another controls one', () => {
    const server = createServerGame(commanderRules, { players: 3, hands: { p1: [instructionSpell({
      costReductions: [{ generic: 1, when: compareAmount(count(players({ relation: 'opponent', not: { controls: { type: 'Land', supertypes: ['Basic'] } } })), 'gte', 1) }],
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }, '{2}{B}{B}')] }, battlefield: { p2: [cardTemplate('Basic fixture', { types: ['Land'], supertypes: ['Basic'] })] } }, { random: () => 0 })
    server.state.players.p1.mana.B = 2
    server.state.players.p1.mana.C = 1
    const objectId = server.state.zoneOrder.p1.hand[0]
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(true)
    const changed = structuredClone(server.state)
    const basic = changed.objects[changed.zoneOrder.p2.battlefield[0]]
    const duplicate = { ...structuredClone(basic), id: 'other-basic', owner: 'p3', controller: 'p3' }
    changed.objects[duplicate.id] = duplicate
    changed.zoneOrder.p3.battlefield.push(duplicate.id)
    expect(server.rules(changed, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(false)
  })
})


test('reductions apply after alternative, mandatory additional, and optional costs are combined', () => {
  const server = createServerGame(commanderRules, { hands: { p1: [instructionSpell({
    alternativeCosts: [[manaCost('{1}{B}')]], additionalCosts: [manaCost('{2}')], optionalCosts: [manaCost('{1}')],
    costReductions: [{ generic: 2, when: compareAmount(count(players({ relation: 'you' })), 'gte', 1) }],
    instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
  }, '{7}{B}')] } }, { random: () => 0 })
  server.state.players.p1.mana.C = 2
  server.state.players.p1.mana.B = 1
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], selectedAlternativeCost: 0, selectedOptionalCosts: [0] }))
  expect(cast.players.p1.mana.C).toBe(0)
  expect(cast.players.p1.mana.B).toBe(0)
})


test.each([{ min: 1, max: 2 }, { min: 2, max: 2 }, { min: 1, max: 1 }])('optional payment bounds activate only the selected target clauses and programs (%s)', bounds => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([spell({
    optionalCosts: [manaCost('{1}'), manaCost('{2}')], optionalCostBounds: bounds,
    decisions: { targets: [
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: paidCostCount('optional', 0) }),
      select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: paidCostCount('optional', 1) }),
    ] },
    instructions: [
      ifThen(compareAmount(paidCostCount('optional', 0), 'gte', 1), { then: [move({ targets: target(0), to: 'exile' })] }),
      ifThen(compareAmount(paidCostCount('optional', 1), 'gte', 1), { then: [destroy({ targets: target(1) })] }),
    ],
  })])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Paid programs fixture', { types: ['Instant'], manaCost: '{0}', ruleDefinition: definition })] }, battlefield: { p2: [
    cardTemplate('First creature', { types: ['Creature'], power: 2, toughness: 2 }), cardTemplate('Second creature', { types: ['Creature'], power: 2, toughness: 2 }),
  ] } }, { random: () => 0 })
  server.state.players.p1.mana.C = 3
  const objectId = server.state.zoneOrder.p1.hand[0]
  const [first, second] = server.state.zoneOrder.p2.battlefield
  const targetOf = (id: string) => ({ kind: 'object' as const, objectId: id })
  expect(availableActions(server.state, 'p1').filter(action => action.kind === 'castSpell').map(action => action.kind === 'castSpell' ? action.selectedOptionalCosts?.join(',') : '').sort()).toEqual([[0], [0, 1], [1]].filter(selected => selected.length >= bounds.min && selected.length <= bounds.max).map(selected => selected.join(',')))
  for (const action of legalActsFor(server.state, 'p1')) {
    if (action.kind === 'castSpell') expect(action.targetGroups).toHaveLength(action.selectedOptionalCosts!.length)
  }
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, targetClauses: [[], []] }).ok).toBe(false)
  for (const selected of [[0], [1], [0, 1]]) {
    const result = server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, selectedOptionalCosts: selected, targetClauses: [selected.includes(0) ? [targetOf(first)] : [], selected.includes(1) ? [targetOf(second)] : []] })
    if (selected.length < bounds.min || selected.length > bounds.max) {
      expect(result.ok).toBe(false)
      continue
    }
    const cast = ok(result)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[first].zone).toBe(selected.includes(0) ? 'exile' : 'battlefield')
    expect(resolved.objects[second].zone).toBe(selected.includes(1) ? 'graveyard' : 'battlefield')
  }
})


describe('optional player choices as casting costs', () => {
  const fixture = () => createServerGame(commanderRules, { players: 3, hands: { p1: [instructionSpell({
    costs: [], optionalCosts: [choosePlayerCost(players({ relation: 'opponent' }))],
    instructions: [
      ifThen(compareAmount(paidCostCount('optional', 0), 'gte', 1), { then: [gainLife({ targets: paidCostPlayer(0), amount: 2 })] }),
      gainLife({ targets: ref('controller'), amount: paidCostCount('optional', 0) }),
    ],
  })] } }, { random: () => 0 })

  test('offers each opponent, locks the nontarget choice, and grants the benefit only on resolution after restore', () => {
    const server = fixture()
    const id = named(server.state, 'Instruction fixture').id
    const actions = legalActsFor(server.state, 'p1').filter(action => action.kind === 'castSpell' && action.objectId === id)
    expect(actions.filter(action => action.kind === 'castSpell' && action.selectedOptionalCosts?.includes(0)).map(action => action.kind === 'castSpell' ? action.costPlayers?.[0] : undefined).sort()).toEqual(['p2', 'p3'])
    const action = actions.find(action => action.kind === 'castSpell' && action.costPlayers?.[0] === 'p2')!
    let cast = server.state
    for (const event of eventsForAvailableAction(cast, 'p1', action) ?? []) cast = ok(server.rules(cast, event))
    expect(cast.players.p2.life).toBe(40)
    expect(cast.objects[id].castCostChoices).toEqual({ optional: [0], players: { 0: 'p2' } })
    const restored = restoreJournal(createJournal(cast), server.rules).current()
    const resolved = resolveStack(server.rules, restored)
    expect(resolved.players.p2.life).toBe(42)
    expect(resolved.players.p1.life).toBe(41)
  })

  test('omitting the option gives no benefit; invalid, missing, and unsolicited recipients are rejected atomically', () => {
    const server = fixture()
    const objectId = named(server.state, 'Instruction fixture').id
    const base = { type: 'castSpell' as const, seat: 'p1', objectId }
    const normal = resolveStack(server.rules, ok(server.rules(server.state, base)))
    expect(normal.players.p1.life).toBe(40)
    expect(normal.players.p2.life).toBe(40)
    const invalidOptions: Partial<Extract<GameEvent, { type: 'castSpell' }>>[] = [
      { selectedOptionalCosts: [0] },
      { selectedOptionalCosts: [0], costPlayers: { 0: 'p1' } },
      { selectedOptionalCosts: [0], costPlayers: { 0: 'missing' } },
      { costPlayers: { 0: 'p2' } },
      { selectedOptionalCosts: [0], costPlayers: { 0: 'p2', 1: 'p3' } },
    ]
    for (const options of invalidOptions) expect(server.rules(server.state, { ...base, ...options }).ok).toBe(false)
    expect(server.state.objects[objectId].zone).toBe('hand')
  })

  test('countering the spell prevents every promised benefit', () => {
    const server = fixture()
    const objectId = named(server.state, 'Instruction fixture').id
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, selectedOptionalCosts: [0], costPlayers: { 0: 'p2' } }))
    const countered = ok(server.rules(cast, { type: 'counterStackItem', stackId: cast.stack[0]!.id }))
    expect(countered.objects[objectId].zone).toBe('graveyard')
    expect(countered.players.p1.life).toBe(40)
    expect(countered.players.p2.life).toBe(40)
  })

  test('a departing chosen player does not erase the paid option', () => {
    const server = fixture()
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: named(server.state, 'Instruction fixture').id, selectedOptionalCosts: [0], costPlayers: { 0: 'p2' } }))
    const departed = structuredClone(cast)
    departed.players.p2.lost = true
    const resolved = resolveStack(server.rules, departed)
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.players.p2.life).toBe(40)
  })
})


const restrictedPaymentFixture = (playerEffect: typeof PLAYER_EFFECTS.lifeTotalCannotChange | typeof PLAYER_EFFECTS.cannotLoseLife, payment: number) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      instructionSpell({ instructions: [createPlayerEffect({ targets: ref('controller'), playerEffect, duration: PLAYER_EFFECT_DURATIONS.untilCleanup })] }),
      instructionSpell({ costs: [lifeCost(payment)], instructions: [] }),
      instructionSpell({ instructions: [] }, '{W/P}'),
    ] },
    battlefield: { p1: [cardTemplate('Life payment activation fixture', {
      types: ['Artifact'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
        activated({ costs: [lifeCost(payment)], instructions: [] }),
      ]))),
    })] },
  }, { random: () => 0 })
  const ready = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
  })))
  return { server, ready: JSON.parse(JSON.stringify(ready)) as GameState }
}

test.each([PLAYER_EFFECTS.lifeTotalCannotChange, PLAYER_EFFECTS.cannotLoseLife].flatMap(effect => [0, 4].map(payment => ({ effect, payment }))))('life payment restrictions govern casting and activation previews (%j)', ({ effect, payment }) => {
  const { server, ready } = restrictedPaymentFixture(effect, payment)
  const objectId = ready.zoneOrder.p1.hand[0]
  const sourceId = ready.zoneOrder.p1.battlefield[0]
  const payable = payment === 0
  expect(legalActsFor(ready, 'p1').some(action => action.kind === 'castSpell' && action.objectId === objectId)).toBe(payable)
  expect(legalActsFor(ready, 'p1').some(action => action.kind === 'activateAbility' && action.objectId === sourceId)).toBe(payable)
  expect(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(payable)
  expect(server.rules(ready, { type: 'activateAbility', seat: 'p1', objectId: sourceId, abilityId: '$.abilities[0]' }).ok).toBe(payable)
  expect(server.rules(ready, { type: 'payLife', seat: 'p1', amount: payment }).ok).toBe(payable)
})

test.each([PLAYER_EFFECTS.lifeTotalCannotChange, PLAYER_EFFECTS.cannotLoseLife])('Phyrexian mana can use mana but cannot pay locked life (%s)', effect => {
  const { server, ready } = restrictedPaymentFixture(effect, 4)
  const objectId = ready.zoneOrder.p1.hand[1]
  expect(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId, phyrexianLife: [0] }).ok).toBe(false)
  ready.players.p1.mana.W = 1
  expect(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId }).ok).toBe(true)
})

test('a zero life cost is payable even with a negative life total', () => {
  expect(beginAnnouncement({ ...state, players: { p1: { ...state.players.p1, life: -1 } } }, {
    payer: 'p1', sourceId: 'spell', costs: { mandatory: [lifeCost(0)] },
  }).ok).toBe(true)
})

test.each([0, 1, 2, 3])('a fixed discard cost requires all three cards before offering or committing an activation (%s held)', held => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    activated({ costs: [discardCost(objects({ zone: 'hand', owner: 'you' }), 3)], instructions: [] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Discard fixture', { types: ['Artifact'], ruleDefinition: definition })] },
    hands: { p1: Array.from({ length: held }, (_, index) => cardTemplate(`Held ${index}`)) },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.battlefield[0]
  expect(legalActsFor(server.state, 'p1').some(action => action.kind === 'activateAbility' && action.objectId === objectId)).toBe(held === 3)
  const result = server.rules(server.state, {
    type: 'activateAbility', seat: 'p1', objectId, abilityId: '$.abilities[0]', choices: server.state.zoneOrder.p1.hand,
  })
  expect(result.ok).toBe(held === 3)
  if (result.ok) {
    expect(result.state.zoneOrder.p1.hand).toHaveLength(0)
    expect(result.state.zoneOrder.p1.graveyard).toHaveLength(3)
    expect(result.state.stack).toHaveLength(1)
  }
})

test('catalog spell announcements require both colored and generic printed mana', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate("Night's Whisper", { types: ['Sorcery'], manaCost: '{1}{B}' })] },
    libraries: {
      p1: ['Whisper One', 'Whisper Two'].map((name) => cardTemplate(name)),
    },
  }, { random: () => 0 })
  const whisper = named(server.state, "Night's Whisper")
  expect(whisper.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor("Night's Whisper"))
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }).ok).toBe(false)
  server.state.players.p1.mana.B = 1
  expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }).ok).toBe(false)
  server.state.players.p1.mana.C = 1
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }))
  expect(cast.players.p1.mana.B).toBe(0)
  expect(cast.players.p1.mana.C).toBe(0)
})

test('a catalog alternative cost validates ordered discards before countering the target spell', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [
        cardTemplate('Foil', { types: ['Instant'], manaCost: '{2}{U}{U}' }),
        cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] }),
        cardTemplate('Extra Card'),
        cardTemplate('Target Spell', { types: ['Sorcery'], manaCost: '{0}' }),
      ],
    },
  }, { random: () => 0 })
  const foil = named(server.state, 'Foil')
  const island = named(server.state, 'Island')
  const extra = named(server.state, 'Extra Card')
  const targetSpell = named(server.state, 'Target Spell')
  expect(foil.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Foil'))
  expect(foil.effects).toEqual([])
  const stacked = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: targetSpell.id,
  }))
  const stackId = stacked.stack.find((item) => item.objectId === targetSpell.id)!.id
  expect(server.rules(stacked, {
    type: 'castSpell',
    seat: 'p1',
    objectId: foil.id,
    selectedAlternativeCost: 0,
    discard: [extra.id, island.id],
    targets: [{ kind: 'stackItem', stackId }],
  }).ok).toBe(false)
  const cast = ok(server.rules(stacked, {
    type: 'castSpell',
    seat: 'p1',
    objectId: foil.id,
    selectedAlternativeCost: 0,
    discard: [island.id, extra.id],
    targets: [{ kind: 'stackItem', stackId }],
  }))
  expect(cast.objects[island.id].zone).toBe('graveyard')
  expect(cast.objects[extra.id].zone).toBe('graveyard')
  expect(cast.stack).toHaveLength(2)
  const resolved = resolveStack(server.rules, cast)
  expect(resolved.objects[targetSpell.id].zone).toBe('graveyard')
  expect(resolved.objects[foil.id].zone).toBe('graveyard')
  expect(resolved.stack).toHaveLength(0)
})

describe('catalog spree and gift announcements', () => {
  /** p1 holds a catalog spell with ample mana against p2's creature. */
  const catalogSpell = (spellName: string, creatureName: string, size: number) => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate(spellName)] },
      battlefield: { p2: [cardTemplate(creatureName, { types: ['Creature'], power: size, toughness: size })] },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
    return { server, ready, spellId: named(ready, spellName).id, creatureId: named(ready, creatureName).id }
  }

  const advanceToEndStep = (server: ReturnType<typeof createServerGame>, gameState: GameState) => {
    let current = gameState
    while (current.step !== 'end') current = reduce(server, current, { type: 'advanceStep' })
    return current
  }

  test('catalog Getaway Glamer spree blink mode exiles until the next end step', () => {
    const { server, ready, spellId, creatureId } = catalogSpell('Getaway Glamer', 'Glamer Prey', 3)
    const cast = reduce(server, ready, {
      type: 'castSpell', seat: 'p1', objectId: spellId,
      selectedOptionalCosts: [0], targetClauses: [[{ kind: 'object', objectId: creatureId }], []],
    })
    const resolved = reduce(server, cast, { type: 'resolveTop' })
    expect(resolved.objects[creatureId].zone).toBe('exile')
    const returned = resolveStack(server.rules, advanceToEndStep(server, resolved))
    expect(returned.objects[creatureId].zone).toBe('battlefield')
  })

  test('catalog Getaway Glamer spree kill mode removes the chosen creature', () => {
    const { server, ready, spellId, creatureId } = catalogSpell('Getaway Glamer', 'Solo Beast', 4)
    const cast = reduce(server, ready, {
      type: 'castSpell', seat: 'p1', objectId: spellId,
      selectedOptionalCosts: [1], targetClauses: [[], [{ kind: 'object', objectId: creatureId }]],
    })
    const resolved = reduce(server, cast, { type: 'resolveTop' })
    expect(resolved.objects[creatureId].zone).toBe('graveyard')
  })

  test('catalog Parting Gust without the gift blinks with a counter at the next end step', () => {
    const { server, ready, spellId, creatureId } = catalogSpell('Parting Gust', 'Gusty Fox', 2)
    const cast = reduce(server, ready, {
      type: 'castSpell', seat: 'p1', objectId: spellId, targets: [{ kind: 'object', objectId: creatureId }],
    })
    const resolved = reduce(server, cast, { type: 'resolveTop' })
    expect(resolved.objects[creatureId].zone).toBe('exile')
    const returned = resolveStack(server.rules, advanceToEndStep(server, resolved))
    expect(returned.objects[creatureId].counters['+1/+1']).toBe(1)
  })

  test('catalog Parting Gust with the gift exiles permanently and creates a tapped Fish', () => {
    const { server, ready, spellId, creatureId } = catalogSpell('Parting Gust', 'Gift Target', 2)
    const gifted = legalActsFor(ready, 'p1').filter((action) => action.kind === 'castSpell').find((action) =>
      action.objectId === spellId
      && action.selectedOptionalCosts?.includes(0)
      && action.costPlayers?.[0] === 'p2')!
    const castEvents = eventsForAvailableAction(ready, 'p1', { ...gifted, targetObjectIds: [creatureId] })!
    const cast = castEvents.reduce((current, event) => reduce(server, current, event), ready)
    const resolved = reduce(server, cast, { type: 'resolveTop' })
    expect(resolved.objects[creatureId].zone).toBe('exile')
    const fish = Object.values(resolved.objects).find((object) =>
      object.name === 'Fish' && object.controller === 'p2')
    expect(fish?.tapped).toBe(true)
    const afterEnd = resolveStack(server.rules, advanceToEndStep(server, resolved))
    expect(afterEnd.objects[creatureId].zone).toBe('exile')
  })
})

// Characterization of current runtime behavior (not a rules-conformance claim); it currently matches the Oracle text.
test('catalog Mulldrifter offers and pays evoke, draws two, then sacrifices from its trigger', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Mulldrifter')] },
    libraries: { p1: [cardTemplate('First card'), cardTemplate('Second card')] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
  const mulldrifter = named(ready, 'Mulldrifter')
  const actions = legalActsFor(ready, 'p1').filter(
    (action) => action.kind === 'castSpell' && action.objectId === mulldrifter.id,
  )
  expect(actions).toContainEqual(expect.objectContaining({
    selectedAlternativeCost: 0,
    castLabel: 'Evoke {2}{U}',
  }))
  // Three mana cannot pay the printed {4}{U}, so only the evoke payment is offered.
  expect(actions.some((action) => action.kind === 'castSpell' && action.selectedAlternativeCost === undefined)).toBe(false)

  const cast = reduce(server, ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: mulldrifter.id,
    selectedAlternativeCost: 0,
  })
  expect(cast.objects[mulldrifter.id].castCostChoices).toMatchObject({ alternative: 0 })
  const enteredUnordered = reduce(server, cast, { type: 'resolveTop' })
  const order = pendingSelectionFor(enteredUnordered, 'p1')!
  const entered = reduce(server, enteredUnordered, {
    type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose',
    count: order.count, objectIds: order.candidates,
  })
  expect(entered.objects[mulldrifter.id].zone).toBe('battlefield')
  expect(entered.stack.map((item) => item.name)).toEqual(['Mulldrifter', 'Mulldrifter'])

  const resolved = resolveStack(server.rules, entered)
  expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name).sort())
    .toEqual(['First card', 'Second card'])
  expect(resolved.objects[mulldrifter.id].zone).toBe('graveyard')
})

test('catalog discard-cost activation pays one creature card before pumping its source', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Vampire Hounds', { types: ['Creature'], power: 2, toughness: 2 })] },
    hands: {
      p1: [
        cardTemplate('Fodder', { types: ['Creature'], power: 1, toughness: 1 }),
        cardTemplate('Not a Creature', { types: ['Instant'] }),
      ],
    },
  }, { random: () => 0 })
  const hounds = named(server.state, 'Vampire Hounds')
  const fodder = named(server.state, 'Fodder')
  const instant = named(server.state, 'Not a Creature')
  expect(hounds.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Vampire Hounds'))
  expect(hounds.effects).toEqual([])
  expect(server.rules(server.state, {
    type: 'activateAbility', seat: 'p1', objectId: hounds.id, abilityId: '$.abilities[0]',
  }).ok).toBe(false)
  expect(server.rules(server.state, {
    type: 'activateAbility', seat: 'p1', objectId: hounds.id,
    abilityId: '$.abilities[0]', choices: [instant.id],
  }).ok).toBe(false)
  const activated = reduce(server, server.state, {
    type: 'activateAbility', seat: 'p1', objectId: hounds.id,
    abilityId: '$.abilities[0]', choices: [fodder.id],
  })
  expect(activated.objects[fodder.id].zone).toBe('graveyard')
  expect(activated.stack).toHaveLength(1)
  expect(activated.objects[hounds.id].power).toBe(2)
  const resolved = resolveStack(server.rules, activated)
  expect(resolved.objects[hounds.id].power).toBe(4)
  expect(resolved.objects[hounds.id].toughness).toBe(4)
  expect(resolved.stack).toHaveLength(0)
})

// Characterization of current runtime behavior (not a rules-conformance claim); it currently matches the Oracle text.
test('catalog Snuff Out validates the Swamp and four-life alternative cost', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Snuff Out')] },
    battlefield: {
      p1: [cardTemplate('Swamp', { types: ['Land'], subtypes: ['Swamp'] })],
      p2: [cardTemplate('White Bear', { types: ['Creature'], colors: 'W', power: 2, toughness: 2 })],
    },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.life = 5
  const spell = named(ready, 'Snuff Out')
  const bear = named(ready, 'White Bear')
  const payLife: GameEvent = {
    type: 'castSpell',
    seat: 'p1',
    objectId: spell.id,
    selectedAlternativeCost: 0,
    targets: [{ kind: 'object', objectId: bear.id }],
  }
  const cast = reduce(server, ready, payLife)
  expect(cast.players.p1.life).toBe(1)
  expect(reduce(server, cast, { type: 'resolveTop' }).objects[bear.id].zone).toBe('graveyard')

  const noSwamp = structuredClone(ready)
  noSwamp.objects[named(noSwamp, 'Swamp').id].subtypes = []
  expect(server.rules(noSwamp, payLife).ok).toBe(false)

  noSwamp.rules.push({
    instanceId: 'urborg-overlay',
    pluginId: 'swampOverlay',
    sourceId: null,
    timestamp: noSwamp.nextTimestamp++,
    params: {},
  })
  expect(server.rules(noSwamp, payLife).ok).toBe(true)

  const lowLife = structuredClone(ready)
  lowLife.players.p1.life = 3
  expect(server.rules(lowLife, payLife).ok).toBe(false)
})

test.each([{ selectedOptionalCosts: [1] }, { selectedOptionalCosts: [0, 1] }])('paid optional programs charge their selected costs once (%j)', ({ selectedOptionalCosts }) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      optionalCosts: [manaCost('{1}'), manaCost('{2}')], optionalCostBounds: { min: 1 },
      instructions: [
        ifThen(compareAmount(paidCostCount('optional', 0), 'gte', 1), { then: [draw(1)] }),
        ifThen(compareAmount(paidCostCount('optional', 1), 'gte', 1), { then: [draw(2)] }),
      ],
    }, '{1}{U}')] },
    libraries: { p1: Array.from({ length: 4 }, (_, index) => cardTemplate(`Library ${index}`)) },
  }, { random: () => 0.5 })
  server.state.players.p1.mana.U = 1
  server.state.players.p1.mana.C = 4
  const before = structuredClone(server.state)
  const objectId = before.zoneOrder.p1.hand[0]
  const offered = availableActions(server.state, 'p1').filter(action => action.kind === 'castSpell')
  expect(offered.map(action => action.selectedOptionalCosts?.join(',')).sort()).toEqual(['0', '0,1', '1'])
  expect(server.state).toEqual(before)
  for (const invalid of [[], [2], [0, 0]]) {
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId, selectedOptionalCosts: invalid }).ok).toBe(false)
    expect(server.state).toEqual(before)
  }
  const action = offered.find(action => action.selectedOptionalCosts?.join(',') === selectedOptionalCosts.join(','))!
  const cast = eventsForAvailableAction(server.state, 'p1', action)!
    .reduce((current, event) => ok(server.rules(current, event)), server.state)
  const both = selectedOptionalCosts.length === 2
  expect(cast.players.p1.mana.U).toBe(0)
  expect(cast.players.p1.mana.C).toBe(both ? 0 : 1)
  const resolved = resolveStack(server.rules, restoreJournal(createJournal(cast), server.rules).current())
  expect(resolved.zoneOrder.p1.hand).toHaveLength(both ? 3 : 2)
  expect(resolved.objects[objectId].zone).toBe('graveyard')
  expect(resolved.stack).toHaveLength(0)
})
