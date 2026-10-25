import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  chooseCards,
  compareAmount,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  draw,
  draws,
  enters,
  eventAmount,
  gainedLife,
  gainLife,
  mill,
  move,
  moved,
  objects,
  players,
  ref,
  repeatOnceIf,
  spellCast,
  whenever,
} from './v1'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const land = (name: string) => cardTemplate(name, { types: ['Land'] })

const watcher = (...abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

test('grouped mill of two lands is one occurrence that captures both identities', () => {
  const definition = watcher(
    whenever(moved({ filter: { type: 'Land', owner: 'you' }, to: 'graveyard', group: true }), {
      instructions: [move({ targets: ref('triggering.object.after'), to: 'exile' })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    hands: { p1: [instructionSpell({ instructions: [mill({ count: 2, targets: ref('controller') })] })] },
    libraries: { p1: [land('First land'), land('Second land'), cardTemplate('Creature card', { types: ['Creature'] })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  }))))
  expect(named(resolved, 'First land').zone).toBe('exile')
  expect(named(resolved, 'Second land').zone).toBe('exile')
  expect(named(resolved, 'Creature card').zone).toBe('library')
})

test('a mixed mill groups only the matching land cards', () => {
  const definition = watcher(
    whenever(moved({ filter: { type: 'Land', owner: 'you' }, to: 'graveyard', group: true }), {
      instructions: [move({ targets: ref('triggering.object.after'), to: 'exile' })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    hands: { p1: [instructionSpell({ instructions: [mill({ count: 2, targets: ref('controller') })] })] },
    libraries: { p1: [land('Only land'), cardTemplate('Milled creature', { types: ['Creature'] })] },
  }, { random: () => 0 })
  const resolved = resolveStack(server.rules, resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0]!,
  }))))
  expect(named(resolved, 'Only land').zone).toBe('exile')
  expect(named(resolved, 'Milled creature').zone).toBe('graveyard')
})

test('firstMatchingEachTurn keeps a second grouped land movement from firing', () => {
  const definition = watcher(
    whenever(moved({ filter: { type: 'Land', owner: 'you' }, to: 'graveyard', group: true }), {
      frequency: { kind: 'firstMatchingEachTurn' },
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    hands: { p1: [land('First land'), land('Second land')] },
  }, { random: () => 0 })
  const [first, second] = server.state.zoneOrder.p1.hand
  const once = ok(server.rules(server.state, { type: 'move', objectId: first!, to: 'graveyard' }))
  expect(once.stack).toHaveLength(1)
  const twice = ok(server.rules(once, { type: 'move', objectId: second!, to: 'graveyard' }))
  expect(twice.stack).toHaveLength(1)
  expect(resolveStack(server.rules, twice).players.p1.life).toBe(41)
})

test('life-gain occurrences capture the player and actual amount', () => {
  const definition = watcher(
    whenever(gainedLife({ player: ref('controller') }), {
      instructions: [gainLife({ targets: players({ relation: 'opponent' }), amount: eventAmount() })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
  }, { random: () => 0 })
  expect(ok(server.rules(server.state, { type: 'gainLife', seat: 'p2', amount: 4 })).stack).toHaveLength(0)
  const yours = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 3 }))
  expect(yours.stack).toHaveLength(1)
  expect(resolveStack(server.rules, yours).players.p2.life).toBe(43)
})

test('catalog Niv-Mizzet, Ghost Counsel triggers only on its controller gaining life and captures the gained amount', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Niv-Mizzet, Ghost Counsel')] },
  }, { random: () => 0.5 })
  const opponentGain = ok(server.rules(server.state, { type: 'gainLife', seat: 'p2', amount: 5 }))
  expect(opponentGain.stack).toHaveLength(0)

  const yours = ok(server.rules(server.state, { type: 'gainLife', seat: 'p1', amount: 2 }))
  expect(yours.stack[0]).toMatchObject({
    kind: 'ability',
    name: 'Niv-Mizzet, Ghost Counsel',
    controller: 'p1',
    execution: { occurrence: { kind: 'event', eventType: 'gainLife', player: 'p1', amount: 2 } },
  })
})

test('duringOwnTurn ignores an opponent drawing on another seat\'s turn', () => {
  const definition = watcher(
    whenever(draws({ player: players({ relation: 'opponent' }), duringOwnTurn: true }), {
      instructions: [draw({ targets: ref('controller'), count: 1 })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    libraries: { p1: [cardTemplate('Our card', { types: ['Instant'] })], p2: [cardTemplate('Their card', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const offTurn = structuredClone(server.state)
  offTurn.active = 'p1'
  offTurn.priority = 'p2'
  expect(ok(server.rules(offTurn, { type: 'draw', seat: 'p2', count: 1 })).stack).toHaveLength(0)
  const onTurn = structuredClone(server.state)
  onTurn.active = 'p2'
  onTurn.priority = 'p2'
  const drawn = ok(server.rules(onTurn, { type: 'draw', seat: 'p2', count: 1 }))
  expect(drawn.stack).toHaveLength(1)
  expect(named(resolveStack(server.rules, drawn), 'Our card').zone).toBe('hand')
})

test('nthThisTurn matches only the second draw by that player', () => {
  const definition = watcher(
    whenever(draws({ player: ref('controller'), nthThisTurn: 2 }), {
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    libraries: { p1: [cardTemplate('First', { types: ['Instant'] }), cardTemplate('Second', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const first = ok(server.rules(server.state, { type: 'draw', seat: 'p1', count: 1 }))
  expect(first.stack).toHaveLength(0)
  const second = ok(server.rules(first, { type: 'draw', seat: 'p1', count: 1 }))
  expect(second.stack).toHaveLength(1)
  expect(resolveStack(server.rules, second).players.p1.life).toBe(41)
})

test('nthThisTurn matches only a player\'s second spell each turn', () => {
  const definition = watcher(
    whenever(spellCast({ filter: { zone: 'stack' }, nthThisTurn: 2 }), {
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }),
  )
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Enchantment'], ruleDefinition: definition })] },
    hands: { p1: [
      instructionSpell({ instructions: [gainLife({ targets: ref('controller'), amount: 0 })] }, '{0}'),
      cardTemplate('Second spell', { types: ['Instant'], manaCost: '{0}', manaValue: 0, ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([]))) }),
    ] },
  }, { random: () => 0 })
  const firstId = server.state.zoneOrder.p1.hand[0]!
  const secondId = server.state.zoneOrder.p1.hand[1]!
  const first = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: firstId }))
  expect(first.stack.filter(item => item.kind === 'ability')).toHaveLength(0)
  const second = ok(server.rules(first, { type: 'castSpell', seat: 'p1', objectId: secondId }))
  expect(second.stack.some(item => item.kind === 'ability')).toBe(true)
})

test('fromSpell enters ignore a put-onto-battlefield move', () => {
  const definition = watcher(
    whenever(enters({ filter: ref('self'), fromSpell: true }), {
      instructions: [gainLife({ targets: ref('controller'), amount: 1 })],
    }),
  )
  const ring = cardTemplate('Cast fixture', {
    types: ['Artifact'],
    manaCost: '{0}',
    manaValue: 0,
    ruleDefinition: definition,
  })
  const movedIn = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [] },
    hands: { p1: [ring] },
  }, { random: () => 0 })
  const fromHand = ok(movedIn.rules(movedIn.state, {
    type: 'move',
    objectId: movedIn.state.zoneOrder.p1.hand[0]!,
    to: 'battlefield',
  }))
  expect(fromHand.stack).toHaveLength(0)

  const castServer = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [ring] },
  }, { random: () => 0 })
  const cast = ok(castServer.rules(castServer.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: castServer.state.zoneOrder.p1.hand[0]!,
  }))
  const resolved = ok(castServer.rules(cast, { type: 'resolveTop' }))
  const order = pendingSelectionFor(resolved, 'p1')
  const afterOrder = order?.triggerOrder
    ? ok(castServer.rules(resolved, {
      type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose', count: order.count, objectIds: order.candidates,
    }))
    : resolved
  expect(afterOrder.stack.some(item => item.kind === 'ability')).toBe(true)
  expect(resolveStack(castServer.rules, afterOrder).players.p1.life).toBe(41)
})

test('repeatOnceIf runs the body once, then once more only if the condition holds', () => {
  const spell = instructionSpell({
    instructions: [
      repeatOnceIf({
        condition: compareAmount(count(objects({ zone: 'battlefield', type: 'Land', controller: 'you' })), 'gte', 8),
        instructions: [
          draw({ targets: ref('controller'), count: 1 }),
          chooseCards({
            chooser: ref('controller'),
            bindChoice: 'land',
            filter: objects({ zone: 'hand', owner: 'you', type: 'Land' }),
            min: 0,
            max: 1,
          }),
          move({ targets: { kind: 'choiceRef', binding: 'land' }, to: 'battlefield', tapped: true }),
        ],
      }),
    ],
  })
  const seven = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: Array.from({ length: 7 }, (_, index) => land(`Field ${index + 1}`)) },
    hands: { p1: [spell] },
    libraries: { p1: [cardTemplate('Drawn One', { types: ['Instant'] }), cardTemplate('Drawn Two', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const sevenResolved = resolveStack(seven.rules, ok(seven.rules(seven.state, {
    type: 'castSpell', seat: 'p1', objectId: seven.state.zoneOrder.p1.hand[0]!,
  })))
  expect(named(sevenResolved, 'Drawn One').zone).toBe('hand')
  expect(named(sevenResolved, 'Drawn Two').zone).toBe('library')

  const eight = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: Array.from({ length: 8 }, (_, index) => land(`Field ${index + 1}`)) },
    hands: { p1: [spell, land('Hand Grove'), land('Hand Thicket')] },
    libraries: { p1: [cardTemplate('Drawn One', { types: ['Instant'] }), cardTemplate('Drawn Two', { types: ['Instant'] }), cardTemplate('Drawn Three', { types: ['Instant'] })] },
  }, { random: () => 0 })
  let state = resolveStack(eight.rules, ok(eight.rules(eight.state, {
    type: 'castSpell', seat: 'p1', objectId: eight.state.zoneOrder.p1.hand[0]!,
  })))
  expect(named(state, 'Drawn One').zone).toBe('hand')
  expect(named(state, 'Drawn Two').zone).toBe('library')
  const firstChoice = pendingSelectionFor(state, 'p1')
  expect(firstChoice?.candidates.sort()).toEqual([
    named(state, 'Hand Grove').id,
    named(state, 'Hand Thicket').id,
  ].sort())
  state = ok(eight.rules(state, {
    type: 'selectCards', seat: 'p1', selectionId: firstChoice!.id, kind: 'choose', count: 1,
    objectIds: [named(state, 'Hand Grove').id],
  }))
  expect(named(state, 'Hand Grove').zone).toBe('battlefield')
  expect(named(state, 'Drawn Two').zone).toBe('hand')
  const secondChoice = pendingSelectionFor(state, 'p1')
  expect(secondChoice?.candidates).toEqual([named(state, 'Hand Thicket').id])
  state = ok(eight.rules(state, {
    type: 'selectCards', seat: 'p1', selectionId: secondChoice!.id, kind: 'choose', count: 1,
    objectIds: [named(state, 'Hand Thicket').id],
  }))
  expect(named(state, 'Hand Thicket').zone).toBe('battlefield')
  expect(named(state, 'Drawn Three').zone).toBe('library')
})
