import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate, forest } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { activated, card, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, gainLife, grantAbilityEffect, landPlayed, move, players, ref, untilCleanup, whenever } from './v1'

test.each([false, true])('land-play occurrences match actual plays and capture the player (granted=%s)', granted => {
  const pattern = landPlayed({ player: players({ relation: 'opponent' }) })
  const instructions = [gainLife({ targets: ref('triggering.player'), amount: 2 })]
  const ability = granted
    ? activated({ costs: [], instructions: [createEffect({ targets: ref('source'), effect: grantAbilityEffect({ kind: 'triggered', on: pattern, instructions }), duration: untilCleanup() })] })
    : whenever(pattern, { instructions })
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Play watcher', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([ability]))) })] },
    hands: { p1: [cardTemplate('Own land', { types: ['Land'] })], p2: [cardTemplate('Moved land', { types: ['Land'] }), cardTemplate('Played land', { types: ['Land'] })] },
  }, { random: () => 0 })
  let state = server.state
  const source = state.zoneOrder.p1.battlefield[0]
  if (granted) state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[0]' })))
  state = ok(server.rules(state, { type: 'playLand', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] }))
  expect(state.stack).toHaveLength(0)
  state = ok(server.rules(state, { type: 'move', objectId: state.zoneOrder.p2.hand[0], to: 'battlefield' }))
  expect(state.stack).toHaveLength(0)
  state = { ...state, active: 'p2', priority: 'p2' }
  state = ok(server.rules(state, { type: 'playLand', seat: 'p2', objectId: state.zoneOrder.p2.hand[0] }))
  expect(state.stack).toHaveLength(1)
  expect(state.players.p2.life).toBe(40)
  state = ok(server.rules(state, { type: 'move', objectId: source, to: 'graveyard' }))
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(40)
  expect(state.players.p2.life).toBe(42)
})

test('land-play occurrences expose a player without promising a post-move object binding', () => {
  expect(() => compileCardRuleDefinition(card([whenever(landPlayed(), { instructions: [move({ targets: ref('triggering.object.after'), to: 'hand' })] })]))).toThrow()
})

test('catalog Burgeoning offers a private typed land choice after an opponent land play', () => {
  const server = createServerGame(commanderRules, {
    first: 'p2',
    battlefield: { p1: [cardTemplate('Burgeoning')] },
    hands: { p1: [forest()], p2: [cardTemplate('Opponent Land', { types: ['Land'] })] },
  })
  let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p2', objectId: server.state.zoneOrder.p2.hand[0]! }))
  expect(state.stack[0]?.name).toBe('Burgeoning')
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const selection = pendingSelectionFor(state, 'p1')!
  expect(selection).toMatchObject({ kind: 'choose', count: 1, min: 0 })
  expect(pendingSelectionFor(server.project(state, 'p2'), 'p1')).toBeUndefined()
  const land = state.zoneOrder.p1.hand[0]!
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 1, objectIds: [land] }))
  expect(state.objects[land].zone).toBe('battlefield')
  expect(state.players.p1.landsPlayed).toBe(0)
})
