import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { resolveStack } from '../testHelpers'
import type { ReduceResult, TargetRef } from '../types'
import {
  activate,
  discardCards,
  gainLife,
} from './effects'
import { activated } from './activated'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import {
  card as dslCard,
  characteristic,
  compareAmount,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createDelayed,
  discard as dslDiscard,
  draw as dslDraw,
  gainLife as dslGainLife,
  ifThen,
  may,
  loseLife as dslLoseLife,
  ref,
  select,
  spell,
  stepDelayed,
  target,
  players,
} from './dsl/v1'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const canonicalSpell = (
  name: string,
  instructions: Parameters<typeof spell>[0]['instructions'],
  options: { types?: string[]; targetPlayer?: boolean } = {},
) => cardTemplate(name, {
  types: options.types ?? ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([spell({
    decisions: { targets: options.targetPlayer ? [select({ filter: players(), count: 1 })] : [] },
    instructions: instructions ?? [],
  })]))),
})

/** Cast a free instant from p1's hand and resolve it, so its delayed trigger is registered. */
const castDelaySpell = (
  name: string,
  instructions: Parameters<typeof spell>[0]['instructions'],
  options: { targets?: TargetRef[] } = {},
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [canonicalSpell(name, instructions, { targetPlayer: Boolean(options.targets) })],
      },
      libraries: {
        p1: [cardTemplate('Now'), cardTemplate('Later One'), cardTemplate('Later Two')],
        p2: [cardTemplate('Opp A'), cardTemplate('Opp B'), cardTemplate('Opp C')],
      },
    },
    { random: () => 0.5 },
  )
  const withMana = {
    ...server.state,
    players: {
      ...server.state.players,
      p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
    },
  }
  const cast = ok(server.rules(withMana, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(withMana, name).id,
    ...(options.targets ? { targets: options.targets } : {}),
  }))
  return { server, resolved: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const nextUpkeep = (
  server: ReturnType<typeof createServerGame>,
  state: ReturnType<typeof createServerGame>['state'],
) => {
  let current = state
  while (current.step !== 'upkeep') {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

describe('runInstructions', () => {
  test('gainLife goes through the life event', () => {
    const spell = canonicalSpell('Life Test', [dslGainLife({ amount: 3, targets: ref('controller') })])
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [spell] } },
      { random: () => 0.5 },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Life Test').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife + 3)
    expect(resolved.log).toContain(`p1 gains 3 life (${named(resolved, 'Life Test').id})`)
  })

  test('nested if dispatch shares the root buffer and preserves instruction order', () => {
    const spell = canonicalSpell('Nested Buffer Test', [
      ifThen(
        compareAmount(characteristic(ref('controller'), 'life', { information: 'current' }), 'gte', 1),
        { then: [dslDraw({ count: 1, targets: ref('controller') })] },
      ),
      dslGainLife({ amount: 1, targets: ref('controller') }),
      dslDiscard({ targets: ref('controller'), count: 1 }),
    ], { types: ['Sorcery'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell, cardTemplate('Before Draw')] },
        libraries: {
          p1: [cardTemplate('Nested Draw')],
          p2: [cardTemplate('Opponent Card')],
        },
      },
      { random: () => 0.5 },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(withMana, 'Nested Buffer Test').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(named(resolved, 'Nested Draw').zone).toBe('hand')
    const pending = pendingSelectionFor(resolved, 'p1')
    expect(pending?.candidates).toContain(named(resolved, 'Nested Draw').id)
    expect(resolved.stack[0]).toMatchObject({
      name: 'Nested Buffer Test',
    })
    expect(resolved.resolution).toMatchObject({ kind: 'canonicalSpell', phase: 'waiting' })
    const gainIndex = resolved.log.findIndex((line) => line.includes('gains 1 life'))
    const drawIndex = resolved.log.findIndex((line) => line === 'p1 draws a card')
    expect(gainIndex).toBeGreaterThanOrEqual(0)
    expect(drawIndex).toBeLessThan(gainIndex)

    const finished = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(resolved, 'Nested Draw').id],
    }))
    expect(named(finished, 'Nested Draw').zone).toBe('graveyard')
    expect(named(finished, 'Nested Buffer Test').zone).toBe('graveyard')
    expect(finished.resolution).toBeUndefined()
  })

  test('all-pass canonical resolution retains its spell and defers SBAs across a choice', () => {
    const spell = canonicalSpell('Suspended Resolution', [
      dslLoseLife({ amount: 41, targets: ref('controller') }),
      dslDiscard({ targets: ref('controller'), count: 1 }),
      dslGainLife({ amount: 42, targets: ref('controller') }),
    ], { types: ['Sorcery'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell, cardTemplate('Legacy Fodder')] },
      },
      { random: () => 0.5 },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Suspended Resolution').id,
    }))
    for (let index = 0; index < state.playerOrder.length; index += 1) {
      state = ok(server.rules(state, { type: 'passPriority', seat: state.priority! }))
    }

    expect(state.resolution).toMatchObject({ kind: 'canonicalSpell', phase: 'waiting' })
    expect(named(state, 'Suspended Resolution').zone).toBe('stack')
    expect(state.players.p1).toMatchObject({ life: -1, lost: false })
    expect(server.rules(state, { type: 'resolveTop' }).ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(state, 'Legacy Fodder').id],
    }))
    expect(state.players.p1).toMatchObject({ life: 41, lost: false })
    expect(named(state, 'Suspended Resolution').zone).toBe('graveyard')
    expect(state.resolution).toBeUndefined()
  })

  test('a suspended discard does not open an unrelated mana window', () => {
    const spell = canonicalSpell('Discard Gate', [dslDiscard({ targets: ref('controller'), count: 1 })], { types: ['Sorcery'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell, cardTemplate('Discard Fodder')] },
        battlefield: { p2: [cardTemplate('Mana Forest', { types: ['Land'], tapProduces: { G: 1 } })] },
      },
      { random: () => 0.5 },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Discard Gate').id,
    }))
    state = resolveStack(server.rules, state)
    const forest = named(state, 'Mana Forest')
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
    expect(server.rules(state, { type: 'addMana', seat: 'p1', mana: { G: 1 } }).ok).toBe(false)
    expect(server.rules(state, {
      type: 'tapForMana',
      seat: 'p2',
      objectId: forest.id,
    }).ok).toBe(false)
  })

  test.each([
    { label: 'left the battlefield', sacrifice: true },
    { label: 'changed controllers', sacrifice: false },
  ])('a suspended ability keeps its captured controller after its source $label', ({ sacrifice }) => {
    const source = cardTemplate('Captured Controller', {
      types: ['Artifact'],
      effects: [activate({
        id: 'captured.resolve',
        costs: sacrifice ? { sacrifice: 'self' } : {},
        do: [discardCards(1), gainLife(2)],
      })],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        battlefield: { p1: [source] },
        hands: { p1: [cardTemplate('Ability Fodder')] },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const sourceId = named(server.state, 'Captured Controller').id
    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'captured.resolve',
      seat: 'p1',
      objectId: sourceId,
    }))
    if (!sacrifice) state.objects[sourceId].controller = 'p2'
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
    expect(pendingSelectionFor(state, 'p2')).toBeUndefined()
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(state, 'Ability Fodder').id],
    }))
    expect(state.players.p1.life).toBe(42)
    expect(state.players.p2.life).toBe(40)
    expect(state.resolution).toBeUndefined()
  })

  test('a chooser concession skips its choice and resumes the independent spell', () => {
    const spell = canonicalSpell('Opponent Choice', [
      dslDiscard({ targets: target(0), count: 1 }),
      dslGainLife({ amount: 2, targets: ref('controller') }),
    ], { types: ['Sorcery'], targetPlayer: true })
    const server = createServerGame(
      commanderRules,
      { players: 3, hands: { p1: [spell], p2: [cardTemplate('Opponent Fodder')] } },
      { random: () => 0.5 },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Opponent Choice').id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingSelectionFor(state, 'p2')).toBeDefined()

    state = ok(server.rules(state, { type: 'concede', seat: 'p2' }))
    expect(state.players.p2.lost).toBe(true)
    expect(state.players.p1.life).toBe(42)
    expect(named(state, 'Opponent Choice').zone).toBe('graveyard')
    expect(state.resolution).toBeUndefined()
  })

  test('an unrelated concession leaves another chooser and the resolution intact', () => {
    const spell = canonicalSpell('Independent Choice', [
      dslDiscard({ targets: ref('controller'), count: 1 }),
      dslGainLife({ amount: 2, targets: ref('controller') }),
    ], { types: ['Sorcery'] })
    const server = createServerGame(
      commanderRules,
      { players: 3, hands: { p1: [spell, cardTemplate('Independent Fodder')] } },
      { random: () => 0.5 },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Independent Choice').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'concede', seat: 'p2' }))
    expect(state.resolution).toMatchObject({ kind: 'canonicalSpell', phase: 'waiting' })
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(state, 'Independent Fodder').id],
    }))
    expect(state.players.p1.life).toBe(42)
    expect(state.resolution).toBeUndefined()
  })

  test('the controller may concede during its suspended resolution', () => {
    const spell = canonicalSpell('Abandoned Choice', [
      dslDiscard({ targets: ref('controller'), count: 1 }),
      dslGainLife({ amount: 2, targets: ref('controller') }),
    ], { types: ['Sorcery'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [spell, cardTemplate('Abandoned Fodder')] } },
      { random: () => 0.5 },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Abandoned Choice').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'concede', seat: 'p1' }))

    expect(state.players.p1.lost).toBe(true)
    expect(state.resolution).toBeUndefined()
    expect(Object.values(state.objects).some((object) => object.owner === 'p1')).toBe(false)
  })

  test("a delayed draw resolves on the next player's upkeep", () => {
    const { server, resolved } = castDelaySpell(
      'Delay Test',
      [dslDraw({ count: 1, targets: ref('controller') }), createDelayed({
        condition: stepDelayed({ step: 'upkeep' }),
        instructions: [dslDraw({ count: 2, targets: ref('controller') })],
      })],
    )
    expect(named(resolved, 'Now').zone).toBe('hand')
    expect(resolved.delayedTriggers).toHaveLength(1)

    const upkeep = nextUpkeep(server, resolved)
    expect(upkeep.active).toBe('p2')
    expect(named(upkeep, 'Later One').zone).toBe('library')
    expect(upkeep.delayedTriggers).toHaveLength(0)

    const state = resolveStack(server.rules, upkeep)
    expect(named(state, 'Later One').zone).toBe('hand')
    expect(named(state, 'Later Two').zone).toBe('hand')
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
  })

  test('a delayed draw uses the captured target player', () => {
    const { server, resolved } = castDelaySpell(
      'Opponent Delay',
      [createDelayed({
        condition: stepDelayed({ step: 'upkeep' }),
        instructions: [dslDraw({ count: 2, targets: target(0) })],
      })],
      { targets: [{ kind: 'player', player: 'p2' }] },
    )
    const upkeep = nextUpkeep(server, resolved)

    // CR 603.7d: the creating spell's controller keeps the ability, p2 only draws.
    expect(upkeep.stack[0]).toMatchObject({ kind: 'ability', controller: 'p1' })

    const state = resolveStack(server.rules, upkeep)
    expect(named(state, 'Opp A').zone).toBe('hand')
    expect(named(state, 'Opp B').zone).toBe('hand')
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.zoneOrder.p2.hand).toHaveLength(2)
  })

  test('an optional delayed draw can be accepted at the next upkeep', () => {
    const { server, resolved } = castDelaySpell(
      'Optional Delay',
      [createDelayed({
        condition: stepDelayed({ step: 'upkeep' }),
        instructions: [may(dslDraw({ count: 1, targets: ref('controller') }))],
      })],
    )
    const state = resolveStack(server.rules, nextUpkeep(server, resolved))
    const optional = pendingOptionSelection(state, 'p1')!
    expect(optional.optionalAction).toBeDefined()
    const accepted = ok(server.rules(state, {
      type: 'selectOption', seat: 'p1', selectionId: optional.id, optionId: optional.options[0]!.id,
    }))
    expect(named(accepted, 'Now').zone).toBe('hand')
  })

  test('the targeted player chooses whether to draw at the next upkeep', () => {
    const { server, resolved } = castDelaySpell(
      'Optional Opponent Delay',
      [createDelayed({
        condition: stepDelayed({ step: 'upkeep' }),
        instructions: [may(dslDraw({ count: 1, targets: target(0) }), target(0))],
      })],
      { targets: [{ kind: 'player', player: 'p2' }] },
    )
    const state = resolveStack(server.rules, nextUpkeep(server, resolved))
    expect(pendingOptionSelection(state, 'p2')?.optionalAction).toBeDefined()
    expect(pendingOptionSelection(state, 'p1')).toBeUndefined()
    expect(state.stack[0]).toMatchObject({ name: 'Optional Opponent Delay', controller: 'p1' })
  })

})
