import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { createJournal, restoreJournal } from '../../journal'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { activated, card, cardCycled, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, cycleFromHand, discardCost, gainLife, grantAbilityEffect, objects, players, ref, searchLibrary, self, untilCleanup, whenever } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test.each([false, true])('cycle occurrences stack above the draw and capture the cycling player (granted=%s)', granted => {
  const pattern = cardCycled({ player: players({ relation: 'you' }) })
  const instructions = [gainLife({ targets: ref('triggering.player'), amount: 2 })]
  const watcherAbility = granted
    ? activated({ costs: [], instructions: [createEffect({ targets: ref('source'), effect: grantAbilityEffect({ kind: 'triggered', on: pattern, instructions }), duration: untilCleanup() })] })
    : whenever(pattern, { instructions })
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Cycle watcher', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([watcherAbility]))) })] },
    hands: {
      p1: [cardTemplate('Own cycler', { types: ['Land'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([cycleFromHand({ mana: '{W}' })]))) })],
      p2: [cardTemplate('Their cycler', { types: ['Land'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([cycleFromHand({ mana: '{W}' })]))) })],
    },
    libraries: { p1: [cardTemplate('Own drawn')], p2: [cardTemplate('Their drawn')] },
  }, { random: () => 0 })
  let state = server.state
  const watcher = state.zoneOrder.p1.battlefield[0]
  if (granted) state = resolveStack(server.rules, ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: watcher, abilityId: '$.abilities[0]' })))
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, mana: { ...state.players.p1.mana, W: 1 } }, p2: { ...state.players.p2, mana: { ...state.players.p2.mana, W: 1 } } } }
  const stacked = ok(server.rules(state, { type: 'activateAbility', seat: 'p1', objectId: named(state, 'Own cycler').id, abilityId: '$.abilities[0]' }))
  expect(named(stacked, 'Own cycler').zone).toBe('graveyard')
  expect(named(stacked, 'Own drawn').zone).toBe('library')
  expect(stacked.stack.map(item => item.name)).toEqual(['Cycle watcher', 'Own cycler'])
  const restored = restoreJournal(createJournal(stacked), server.rules).current()
  const countered = ok(server.rules(restored, { type: 'counterStackItem', stackId: restored.stack[1]!.id }))
  expect(named(countered, 'Own drawn').zone).toBe('library')
  const resolved = resolveStack(server.rules, ok(server.rules(countered, { type: 'move', objectId: watcher, to: 'graveyard' })))
  expect(resolved.players.p1.life).toBe(42)
  expect(named(resolved, 'Own drawn').zone).toBe('library')
  const watching = ok(server.rules(resolved, { type: 'move', objectId: watcher, to: 'battlefield' }))
  const afterOpponent = resolveStack(server.rules, ok(server.rules({ ...watching, active: 'p2', priority: 'p2' }, {
    type: 'activateAbility', seat: 'p2', objectId: named(resolved, 'Their cycler').id, abilityId: '$.abilities[0]',
  })))
  expect(named(afterOpponent, 'Their drawn').zone).toBe('hand')
  expect(afterOpponent.players.p1.life).toBe(42)
  expect(afterOpponent.players.p2.life).toBe(40)
})

test('ordinary discards and battlefield activations are not cycling', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        cardTemplate('Cycle watcher', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(cardCycled(), { instructions: [gainLife({ amount: 1, targets: ref('controller') })] })]))) }),
        cardTemplate('Discard cost fixture', { types: ['Artifact'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([activated({ costs: [discardCost(objects({ zone: 'hand', owner: 'you' }), 1)], instructions: [] })]))) }),
        cardTemplate('Board cycler', { types: ['Land'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([cycleFromHand({ mana: '{W}' })]))) }),
      ],
    },
    hands: { p1: [
      cardTemplate('Discarded land', { types: ['Land'] }),
      cardTemplate('Cost discard', { types: ['Land'] }),
    ] },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const ready = { ...server.state, players: { ...server.state.players, p1: { ...server.state.players.p1, mana: { ...server.state.players.p1.mana, W: 1, C: 3 } } } }
  expect(server.rules(ready, { type: 'activateAbility', seat: 'p1', objectId: named(ready, 'Board cycler').id, abilityId: '$.abilities[0]' }).ok).toBe(false)
  const discarded = ok(server.rules(ready, { type: 'discard', seat: 'p1', objectId: named(ready, 'Discarded land').id }))
  expect(discarded.stack.filter(item => item.name === 'Cycle watcher')).toHaveLength(0)
  const paid = ok(server.rules(discarded, { type: 'activateAbility', seat: 'p1', objectId: named(discarded, 'Discard cost fixture').id, abilityId: '$.abilities[0]', choices: [named(discarded, 'Cost discard').id] }))
  expect(paid.stack.filter(item => item.name === 'Cycle watcher')).toHaveLength(0)
  expect(paid.players.p1.life).toBe(40)
})

test.each([false, true])('typecycling triggers survive countering and precede search (countered=%s)', countered => {
  const cycler = createDefinitionSnapshot(compileCardRuleDefinition(card([cycleFromHand({
    mana: '{2}',
    instructions: [searchLibrary({
      bindChoice: 'found',
      chooser: ref('controller'),
      filter: objects({ zone: 'library', owner: 'you', subtypes: ['Plains'] }),
      min: 0,
      max: 1,
      to: 'hand',
    })],
  })])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Cycle watcher', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(cardCycled(), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] })]))) })] },
    hands: { p1: [cardTemplate('Plains cycler', { types: ['Creature'], ruleDefinition: cycler })] },
    libraries: { p1: [cardTemplate('Plains', { types: ['Land'], subtypes: ['Plains'] }), cardTemplate('Bonus card')] },
  }, { random: () => 0 })
  const ready = { ...server.state, players: { ...server.state.players, p1: { ...server.state.players.p1, mana: { ...server.state.players.p1.mana, C: 2 } } } }
  const activated = ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: named(ready, 'Plains cycler').id, abilityId: '$.abilities[0]',
  }))
  expect(activated.stack.map(item => item.name)).toEqual(['Cycle watcher', 'Plains cycler'])
  const pending = countered
    ? ok(server.rules(activated, { type: 'counterStackItem', stackId: activated.stack[1]!.id }))
    : activated
  const triggered = ok(server.rules(pending, { type: 'resolveTop' }))
  expect(named(triggered, 'Plains').zone).toBe('library')
  expect(triggered.players.p1.life).toBe(41)
  if (countered) {
    expect(triggered.stack).toHaveLength(0)
    return
  }
  const opened = ok(server.rules(triggered, { type: 'resolveTop' }))
  const pick = pendingSelectionFor(opened, 'p1')!
  const restored = restoreJournal(createJournal(opened), server.rules).current()
  const finished = ok(server.rules(restored, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(restored, 'Plains').id] }))
  expect(named(finished, 'Plains').zone).toBe('hand')
  expect(named(finished, 'Plains cycler').zone).toBe('graveyard')
  expect(finished.stack).toHaveLength(0)
  expect(named(finished, 'Bonus card').zone).toBe('library')
})

test.each([false, true])('self-cycling triggers from its discard destination (redirected=%s)', redirected => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: redirected ? [cardTemplate('Rest in Peace')] : [] },
    hands: { p1: [cardTemplate('Self cycler', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(self.cycles, { instructions: [gainLife({ amount: 3, targets: ref('controller') })] }),
      cycleFromHand({ mana: '{2}{W}' }),
    ]))) })] },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const ready = { ...server.state, players: { ...server.state.players, p1: { ...server.state.players.p1, mana: { ...server.state.players.p1.mana, W: 1, C: 2 } } } }
  const finished = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: named(ready, 'Self cycler').id, abilityId: '$.abilities[1]',
  })))
  expect(named(finished, 'Self cycler').zone).toBe(redirected ? 'exile' : 'graveyard')
  expect(named(finished, 'Drawn').zone).toBe('hand')
  expect(finished.players.p1.life).toBe(43)
})

test('cycle player occurrences do not expose a player as an object filter', () => {
  expect(() => compileCardRuleDefinition(card([
    whenever(cardCycled({ player: ref('source') }), { instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
  ]))).toThrow()
})

// Reuse the catalog program to exercise target announcement from a redirected discard.
test('Astral Drift self-cycling announces its target from exile before drawing', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Rest in Peace')], p2: [cardTemplate('Target', { types: ['Creature'], power: 2, toughness: 2 })] },
    hands: { p1: [cardTemplate('Astral Drift')] },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.W = 1
  ready.players.p1.mana.C = 2
  const activated = ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: named(ready, 'Astral Drift').id, abilityId: '$.abilities[2]',
  }))
  expect(named(activated, 'Astral Drift').zone).toBe('exile')
  expect(named(activated, 'Drawn').zone).toBe('library')
  const pick = pendingSelectionFor(activated, 'p1')!
  expect(pick).toBeDefined()
  const restored = restoreJournal(createJournal(activated), server.rules).current()
  const targeted = ok(server.rules(restored, {
    type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(restored, 'Target').id],
  }))
  expect(targeted.stack).toHaveLength(2)
  expect(targeted.stack[0]!.targets[0]).toMatchObject({ kind: 'object', objectId: named(targeted, 'Target').id })
  expect(named(targeted, 'Drawn').zone).toBe('library')
})
