import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { createJournal, restoreJournal } from '../../journal'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { activated, card, cardCycled, compileCardRuleDefinition, createDefinitionSnapshot, createEffect, cycleFromHand, discardCost, draw, gainLife, grantAbilityEffect, objects, players, ref, searchLibrary, self, untilCleanup, whenever } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test.each([false, true])('cycle occurrences fire after the draw and capture the cycling player (granted=%s)', granted => {
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
  expect(stacked.stack).toHaveLength(1)
  const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
  expect(named(resolved, 'Own drawn').zone).toBe('hand')
  expect(resolved.stack.filter(item => item.name === 'Cycle watcher')).toHaveLength(1)
  expect(resolved.players.p1.life).toBe(40)
  const afterOpponent = resolveStack(server.rules, ok(server.rules({ ...resolved, active: 'p2', priority: 'p2' }, {
    type: 'activateAbility', seat: 'p2', objectId: named(resolved, 'Their cycler').id, abilityId: '$.abilities[0]',
  })))
  expect(named(afterOpponent, 'Their drawn').zone).toBe('hand')
  const restored = restoreJournal(createJournal(ok(server.rules(afterOpponent, { type: 'move', objectId: watcher, to: 'graveyard' }))), server.rules).current()
  const finished = resolveStack(server.rules, restored)
  expect(finished.players.p1.life).toBe(42)
  expect(finished.players.p2.life).toBe(40)
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

test('typecycling waits to emit cycle until the search closes', () => {
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
    battlefield: { p1: [cardTemplate('Cycle watcher', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(cardCycled(), { instructions: [draw(1)] })]))) })] },
    hands: { p1: [cardTemplate('Plains cycler', { types: ['Creature'], ruleDefinition: cycler })] },
    libraries: { p1: [cardTemplate('Plains', { types: ['Land'], subtypes: ['Plains'] }), cardTemplate('Bonus card')] },
  }, { random: () => 0 })
  const ready = { ...server.state, players: { ...server.state.players, p1: { ...server.state.players.p1, mana: { ...server.state.players.p1.mana, C: 2 } } } }
  const opened = ok(server.rules(ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: named(ready, 'Plains cycler').id, abilityId: '$.abilities[0]',
  })), { type: 'resolveTop' }))
  expect(opened.stack.some(item => item.name === 'Cycle watcher')).toBe(false)
  expect(named(opened, 'Bonus card').zone).toBe('library')
  const pick = pendingSelectionFor(opened, 'p1')!
  const finished = ok(server.rules(opened, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 1, objectIds: [named(opened, 'Plains').id] }))
  expect(named(finished, 'Plains').zone).toBe('hand')
  expect(finished.stack.some(item => item.name === 'Cycle watcher')).toBe(true)
  expect(named(finished, 'Bonus card').zone).toBe('library')
})

test('cycling the source still triggers a graveyard self-cycle ability', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Self cycler', { types: ['Enchantment'], ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(self.cycles, { activeIn: ['graveyard'], instructions: [gainLife({ amount: 3, targets: ref('controller') })] }),
      cycleFromHand({ mana: '{2}{W}' }),
    ]))) })] },
    libraries: { p1: [cardTemplate('Drawn')] },
  }, { random: () => 0 })
  const ready = { ...server.state, players: { ...server.state.players, p1: { ...server.state.players.p1, mana: { ...server.state.players.p1.mana, W: 1, C: 2 } } } }
  const finished = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: named(ready, 'Self cycler').id, abilityId: '$.abilities[1]',
  })))
  expect(named(finished, 'Self cycler').zone).toBe('graveyard')
  expect(named(finished, 'Drawn').zone).toBe('hand')
  expect(finished.players.p1.life).toBe(43)
})

test('cycle player occurrences do not expose a player as an object filter', () => {
  expect(() => compileCardRuleDefinition(card([
    whenever(cardCycled({ player: ref('source') }), { instructions: [gainLife({ amount: 1, targets: ref('controller') })] }),
  ]))).toThrow()
})
