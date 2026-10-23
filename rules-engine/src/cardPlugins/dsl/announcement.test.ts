import { availableActions, legalActsFor, eventsForAvailableAction } from '../../actions'
import { createJournal, restoreJournal } from '../../journal'
import { describe, expect, test } from 'bun:test'
import {
  destroy,
  compareAmount,
  count,
  paidCostCount,
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
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import type { GameState } from '../../types'
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
