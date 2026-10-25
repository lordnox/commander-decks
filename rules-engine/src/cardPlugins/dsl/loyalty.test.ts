import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { availableActions } from '../../actions'
import type { GameState } from '../../types'
import { pendingSelectionFor } from '../../rules/selectCards'
import {
  activated,
  anyTarget,
  card,
  chooseX,
  compareCharacteristic,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  damage,
  minusLoyalty,
  move,
  objects,
  plusLoyalty,
  ref,
  select,
  target,
  variable,
} from './v1'

const walker = (
  abilities: Parameters<typeof card>[0],
  loyalty = 7,
) => cardTemplate('Loyalty fixture', {
  types: ['Planeswalker'],
  printedLoyalty: loyalty,
  counters: { loyalty },
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card(abilities))),
})

const game = (abilities: Parameters<typeof card>[0], extras: Parameters<typeof createServerGame>[1] = {}, loyalty = 7) =>
  createServerGame(commanderRules, {
    battlefield: { p1: [walker(abilities, loyalty)] },
    ...extras,
  }, { random: () => 0 })

const sourceId = (state: ReturnType<typeof game>['state']) =>
  Object.values(state.objects).find(object => object.name === 'Loyalty fixture')!.id

test('plus loyalty pays counters immediately and resolves its program from the stack', () => {
  const server = game([
    activated({
      timing: 'sorcery',
      costs: [plusLoyalty(2)],
      decisions: { targets: [select({ filter: anyTarget(), count: 1 })] },
      instructions: [damage({ amount: 3, targets: target(0), source: ref('source') })],
    }),
  ])
  const id = sourceId(server.state)
  const activatedState = ok(server.rules(server.state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: id,
    abilityId: '$.abilities[0]',
    targets: [{ kind: 'player', player: 'p2' }],
  }))
  expect(activatedState.objects[id].counters.loyalty).toBe(9)
  expect(activatedState.objects[id].loyaltyActivatedTurn).toBe(1)
  expect(activatedState.stack[0]?.kind).toBe('ability')
  const resolved = resolveStack(server.rules, activatedState)
  expect(resolved.players.p2.life).toBe(37)
})

test('minus X loyalty exiles colored permanents at the chosen mana value or less', () => {
  const minusX = [
    activated({
      timing: 'sorcery',
      costs: [minusLoyalty(variable('X'))],
      decisions: { variables: [chooseX()] },
      instructions: [move({
        targets: objects({
          zone: 'battlefield',
          colored: true,
          compareCharacteristic: compareCharacteristic('manaValue', 'lte', variable('X')),
        }),
        to: 'exile',
      })],
    }),
  ]
  const server = game(minusX, {
    battlefield: {
      p1: [walker(minusX, 7)],
      p2: [
        cardTemplate('Green Permanent', { types: ['Enchantment'], manaValue: 3, colors: ['G'] }),
        cardTemplate('Colorless Permanent', { types: ['Artifact'], manaValue: 2, colors: [] }),
        cardTemplate('Expensive Permanent', { types: ['Creature'], manaValue: 5, colors: ['B'] }),
      ],
    },
  })
  const id = sourceId(server.state)
  const activatedState = ok(server.rules(server.state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: id,
    abilityId: '$.abilities[0]',
    x: 3,
  }))
  expect(activatedState.objects[id].counters.loyalty).toBe(4)
  const resolved = resolveStack(server.rules, activatedState)
  expect(Object.values(resolved.objects).find(object => object.name === 'Green Permanent')?.zone).toBe('exile')
  expect(Object.values(resolved.objects).find(object => object.name === 'Colorless Permanent')?.zone).toBe('battlefield')
  expect(Object.values(resolved.objects).find(object => object.name === 'Expensive Permanent')?.zone).toBe('battlefield')
})

test('a planeswalker put onto the battlefield by an effect enters with printed loyalty and resets on reentry', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Returned Walker', {
      types: ['Planeswalker'],
      printedLoyalty: 3,
      counters: { loyalty: 5 },
      loyaltyActivatedTurn: 1,
    })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[0]!
  const graveyard = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'graveyard' }))
  expect(graveyard.objects[id]).toMatchObject({ counters: {}, loyaltyActivatedTurn: null })

  const returned = ok(server.rules(graveyard, { type: 'move', objectId: id, to: 'battlefield' }))
  expect(returned.objects[id]).toMatchObject({
    zone: 'battlefield',
    counters: { loyalty: 3 },
  })
})

test('a walker activates a loyalty ability once per turn and cannot overpay', () => {
  const server = game([
    activated({
      timing: 'sorcery',
      costs: [minusLoyalty(10)],
      instructions: [],
    }),
    activated({
      timing: 'sorcery',
      costs: [minusLoyalty(variable('X'))],
      decisions: { variables: [chooseX()] },
      instructions: [],
    }),
  ])
  const id = sourceId(server.state)
  expect(server.rules(server.state, {
    type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]',
  }).ok).toBe(false)
  const first = ok(server.rules(server.state, {
    type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[1]', x: 0,
  }))
  const resolved = resolveStack(server.rules, first)
  expect(server.rules(resolved, {
    type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[1]', x: 0,
  }).ok).toBe(false)
})

test('loyalty abilities are sorcery-speed and are offered as legal acts', () => {
  const server = game([
    activated({
      timing: 'sorcery',
      costs: [minusLoyalty(2)],
      instructions: [],
    }),
  ], {}, 4)
  const id = sourceId(server.state)
  expect(availableActions(server.state, 'p1').some(action =>
    action.kind === 'activateAbility' && action.abilityId === '$.abilities[0]')).toBe(true)
  expect(server.rules({ ...server.state, step: 'end' }, {
    type: 'activateAbility', seat: 'p1', objectId: id, abilityId: '$.abilities[0]',
  }).ok).toBe(false)
})

test('minus X loyalty is offered for each payable X', () => {
  const server = game([
    activated({
      timing: 'sorcery',
      costs: [minusLoyalty(variable('X'))],
      decisions: { variables: [chooseX()] },
      instructions: [],
    }),
  ], {}, 2)
  const xs = availableActions(server.state, 'p1')
    .filter(action => action.kind === 'activateAbility' && action.abilityId === '$.abilities[0]')
    .map(action => action.kind === 'activateAbility' ? action.x : undefined)
  expect(xs).toEqual([0, 1, 2])
})

test('catalog Jace, Multiverse Architect cannot target itself with its −3', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Jace, Multiverse Architect', { counters: { loyalty: 4 } })] },
  }, { random: () => 0 })
  const id = Object.values(server.state.objects).find((object) => object.name === 'Jace, Multiverse Architect')!.id
  const state: GameState = { ...server.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
  const result = server.rules(state, {
    type: 'activateAbility',
    abilityId: '$.abilities[2]',
    seat: 'p1',
    objectId: id,
    targets: [{ kind: 'object', objectId: id }],
  })
  expect(result.ok).toBe(false)
})

test('catalog Jace, Multiverse Architect +1 draws two then prompts to put a hand card on the bottom', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Jace, Multiverse Architect', { counters: { loyalty: 4 } })] },
    libraries: { p1: ['A', 'B', 'C'].map((name) => cardTemplate(name)) },
  }, { random: () => 0 })
  const id = Object.values(server.state.objects).find((object) => object.name === 'Jace, Multiverse Architect')!.id
  const state: GameState = { ...server.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
  let resolved = ok(server.rules(state, {
    type: 'activateAbility',
    abilityId: '$.abilities[1]',
    seat: 'p1',
    objectId: id,
  }))
  resolved = resolveStack(server.rules, resolved)
  expect(resolved.zoneOrder.p1.hand.length).toBeGreaterThanOrEqual(2)
  const selection = pendingSelectionFor(resolved, 'p1')
  expect(selection).toBeDefined()
  if (!selection) throw new Error('Jace must offer a hand card choice')
  const handCard = resolved.zoneOrder.p1.hand[0]
  resolved = ok(server.rules(resolved, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: selection.id,
    kind: 'choose',
    count: 1,
    objectIds: [handCard],
  }))
  expect(resolved.zoneOrder.p1.library.at(-1)).toBe(handCard)
})

test('catalog Jace, Multiverse Architect −3 exiles another target you control then reveals onto the battlefield', () => {
  const sacrifice = cardTemplate('Sacrifice Me', { types: ['Creature'], power: 1, toughness: 1 })
  const revealed = cardTemplate('Revealed Walker', {
    types: ['Planeswalker'],
    subtypes: ['Jace'],
    printedLoyalty: 3,
  })
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Jace, Multiverse Architect', { counters: { loyalty: 4 } }), sacrifice],
    },
    libraries: { p1: [cardTemplate('Noise', { types: ['Land'] }), revealed] },
  }, { random: () => 0 })
  const id = Object.values(server.state.objects).find((object) => object.name === 'Jace, Multiverse Architect')!.id
  const sacrificeId = Object.values(server.state.objects).find((object) => object.name === 'Sacrifice Me')!.id
  const state: GameState = { ...server.state, active: 'p1', step: 'precombatMain' as const, priority: 'p1' }
  let resolved = ok(server.rules(state, {
    type: 'activateAbility',
    abilityId: '$.abilities[2]',
    seat: 'p1',
    objectId: id,
    targets: [{ kind: 'object', objectId: sacrificeId }],
  }))
  resolved = resolveStack(server.rules, resolved)
  expect(resolved.objects[sacrificeId].zone).toBe('exile')
  expect(resolved.zoneOrder.p1.battlefield).toContain(
    Object.values(resolved.objects).find((object) => object.name === 'Revealed Walker')!.id,
  )
  expect(Object.values(resolved.objects).find((object) => object.name === 'Revealed Walker')!.counters.loyalty).toBe(3)
})
