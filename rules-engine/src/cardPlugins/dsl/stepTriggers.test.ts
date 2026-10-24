import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { STEP_IDS } from '../../types'
import type { StepId } from '../../types'
import { activated, card, compareAmount, compileCardRuleDefinition, count, createDefinitionSnapshot, createEffect, gainLife, grantAbilityEffect, objects, players, ref, stepBegins, untilCleanup, whenever } from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) => createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const transitions = [
  { from: 'untap', to: 'upkeep', relation: 'you', active: 'p1', matches: true, granted: false },
  { from: 'untap', to: 'upkeep', relation: 'you', active: 'p2', matches: false, granted: false },
  { from: 'draw', to: 'precombatMain', relation: 'opponent', active: 'p2', matches: true, granted: true },
  { from: 'postcombatMain', to: 'end', relation: 'any', active: 'p2', matches: true, granted: false },
  { from: 'untap', to: 'upkeep', relation: 'opponent', active: 'p1', matches: false, granted: true },
] as const

test.each([...transitions])('step occurrences use committed transitions and active-player filters (%j)', ({ from, to, relation, active, matches, granted }) => {
  const on = stepBegins({ step: to, player: players({ relation }) })
  const instructions = [gainLife({ targets: ref('triggering.player'), amount: 2 })]
  const ability = granted
    ? activated({ costs: [], instructions: [createEffect({ targets: ref('source'), effect: grantAbilityEffect({ kind: 'triggered', on, instructions }), duration: untilCleanup() })] })
    : whenever(on, { instructions })
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Step watcher', { types: ['Enchantment'], ruleDefinition: snapshot([ability]) })] },
    libraries: { p1: [cardTemplate('Later')], p2: [cardTemplate('Later')] },
  }, { random: () => 0 })
  const source = server.state.zoneOrder.p1.battlefield[0]!
  let state = granted ? resolveStack(server.rules, ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' }))) : server.state
  state = { ...state, active, priority: active, step: from }
  state = ok(server.rules(state, { type: 'passPriority', seat: active }))
  expect(state.step).toBe(from)
  expect(state.stack).toHaveLength(0)
  state = ok(server.rules(state, { type: 'passPriority', seat: active === 'p1' ? 'p2' : 'p1' }))
  expect(state.step).toBe(to)
  expect(state.stack).toHaveLength(matches ? 1 : 0)
  if (matches) {
    expect(state.stack[0]?.execution?.occurrence?.player).toBe(active)
    state = ok(server.rules(state, { type: 'move', objectId: source, to: 'graveyard' }))
    state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  }
  expect(state.players[active].life).toBe(matches ? 42 : 40)
  // Merely acting while already in the step must not trigger again.
  state = ok(server.rules(state, { type: 'gainLife', seat: active, amount: 1 }))
  expect(state.stack).toHaveLength(0)
})

test('native step triggers check intervening conditions at capture and again at resolution', () => {
  const condition = compareAmount(count(objects({ zone: 'battlefield', controller: 'you', type: 'Creature' })), 'gte', 1)
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [
      cardTemplate('Conditional watcher', { types: ['Enchantment'], ruleDefinition: snapshot([
        whenever(stepBegins({ step: 'upkeep', player: ref('controller') }), { interveningIf: condition, instructions: [gainLife({ targets: ref('controller'), amount: 3 })] }),
      ]) }),
      cardTemplate('Condition fixture', { types: ['Creature'], power: 1, toughness: 1 }),
    ] },
  }, { random: () => 0 })
  const creature = server.state.zoneOrder.p1.battlefield[1]!
  let state = ok(server.rules({ ...server.state, step: 'untap' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'move', objectId: creature, to: 'hand' }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(40)
  state = ok(server.rules({ ...state, step: 'untap' }, { type: 'advanceStep' }))
  expect(state.stack).toHaveLength(0)
})

test('step patterns validate engine step names and expose only their player occurrence', () => {
  for (const step of STEP_IDS) expect(() => snapshot([whenever(stepBegins({ step }), { instructions: [gainLife({ targets: ref('triggering.player'), amount: 1 })] })])).not.toThrow()
  expect(() => snapshot([whenever(stepBegins({ step: 'invalid' as StepId }), { instructions: [] })])).toThrow()
  expect(() => snapshot([whenever(stepBegins({ step: 'upkeep' }), { instructions: [{ kind: 'move', targets: ref('triggering.object.after'), to: 'hand' }] })])).toThrow()
})

test.each([false, true])('an unfiltered upkeep gives the active player the optional hand entry, not the trigger controller (decline=%s)', decline => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Braids, Conjurer Adept')] },
    hands: {
      p1: [cardTemplate('Other hand', { types: ['Land'] })],
      p2: [cardTemplate('Allowed hand', { types: ['Artifact'] }), cardTemplate('Wrong type', { types: ['Instant'] })],
    },
  }, { random: () => 0 })
  let state = ok(server.rules({ ...server.state, active: 'p2', priority: 'p2', step: 'untap' }, { type: 'advanceStep' }))
  expect(state.stack[0]?.controller).toBe('p1')
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const pick = pendingSelectionFor(state, 'p2')!
  const allowed = server.state.zoneOrder.p2.hand[0]!
  expect(pick.candidates).toEqual([allowed])
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), {
    type: 'selectCards', seat: 'p2', selectionId: pick.id, kind: 'choose', count: pick.count, objectIds: decline ? [] : [allowed],
  }))
  expect(state.objects[allowed]?.zone).toBe(decline ? 'hand' : 'battlefield')
  expect(state.objects[allowed]?.controller).toBe('p2')
})
