import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { legalActsFor } from '../../actions'
import { pendingSelectionFor } from '../../rules/selectCards'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { LEGENDARY_COMBAT_DAMAGE_FROM } from '../../plugins/combatLegendaryDamage'
import {
  activated,
  card,
  choice,
  chooseCards,
  combatDamageThisTurn,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  damageDealtThisTurn,
  dealtDamage,
  draw,
  eventAmount,
  fight,
  forEachPlayer,
  gainLife,
  grantAbilityTo,
  loseLife,
  objects,
  playerAttacks,
  players,
  ref,
  sacrificeCost,
  self,
  somePlayerHasLess,
  staticAbility,
  tapCost,
  whenever,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const snapshot = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const creature = (name: string, extras: { power?: number; toughness?: number; ruleDefinition?: ReturnType<typeof snapshot> } = {}) =>
  cardTemplate(name, {
    types: ['Creature'],
    power: extras.power ?? 2,
    toughness: extras.toughness ?? 4,
    summoningSickness: false,
    ...(extras.ruleDefinition ? { ruleDefinition: extras.ruleDefinition } : {}),
  })

test('dealt-damage occurrences fire once per actual damage event and honor combat filters', () => {
  const anyDamage = snapshot([whenever(self.dealtDamage, {
    instructions: [gainLife({ amount: eventAmount(), targets: ref('controller') })],
  })])
  const combatOnly = snapshot([whenever(dealtDamage({ recipient: ref('self'), combat: true }), {
    instructions: [loseLife({ amount: eventAmount(), targets: ref('triggering.player') })],
  })])
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [creature('Enrage watcher', { toughness: 10, ruleDefinition: anyDamage })],
      p2: [creature('Combat wall', { toughness: 10, ruleDefinition: combatOnly }), creature('Biter', { power: 3 })],
    },
  }, { random: () => 0 })
  const watcher = named(server.state, 'Enrage watcher').id
  const wall = named(server.state, 'Combat wall').id
  const biter = named(server.state, 'Biter').id
  let state = ok(server.rules(server.state, {
    type: 'dealDamage', sourceId: biter, target: { kind: 'object', objectId: watcher }, amount: 2,
  }))
  state = ok(server.rules(state, {
    type: 'dealDamage', sourceId: biter, target: { kind: 'object', objectId: watcher }, amount: 1,
  }))
  expect(state.stack).toHaveLength(2)
  state = resolveStack(server.rules, state)
  expect(state.players.p1.life).toBe(43)

  const combatHit = ok(server.rules(state, {
    type: 'dealDamage', sourceId: biter, target: { kind: 'object', objectId: wall }, amount: 3, combat: true,
  }))
  expect(combatHit.stack).toHaveLength(1)
  const afterCombat = resolveStack(server.rules, combatHit)
  expect(afterCombat.players.p2.life).toBe(37)

  const noncombat = ok(server.rules(afterCombat, {
    type: 'dealDamage', sourceId: biter, target: { kind: 'object', objectId: wall }, amount: 4,
  }))
  expect(noncombat.stack).toHaveLength(0)
  expect(noncombat.players.p2.life).toBe(37)
})

test('dealt-damage player filters match combat damage to a player and ignore object recipients', () => {
  const definition = snapshot([whenever(dealtDamage({ source: ref('self'), combat: true, player: true }), {
    instructions: [gainLife({ amount: eventAmount(), targets: ref('controller') })],
  })])
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [creature('Prankster', { power: 3, ruleDefinition: definition })],
      p2: [creature('Wall', { toughness: 10 })],
    },
  }, { random: () => 0 })
  const source = named(server.state, 'Prankster').id
  const wall = named(server.state, 'Wall').id
  const toPlayer = ok(server.rules(server.state, {
    type: 'combatDamage', sourceId: source, target: { kind: 'player', player: 'p2' }, amount: 3,
  }))
  expect(toPlayer.stack).toHaveLength(1)
  expect(resolveStack(server.rules, toPlayer).players.p1.life).toBe(43)

  const toCreature = ok(server.rules(server.state, {
    type: 'combatDamage', sourceId: source, target: { kind: 'object', objectId: wall }, amount: 3,
  }))
  expect(toCreature.stack).toHaveLength(0)

  const noncombat = ok(server.rules(server.state, {
    type: 'dealDamage', sourceId: source, target: { kind: 'player', player: 'p2' }, amount: 3,
  }))
  expect(noncombat.stack).toHaveLength(0)
})

test('player-attack occurrences fire once per defender and compare that defender against other opponents', () => {
  const definition = snapshot([whenever(playerAttacks({ defender: players({ relation: 'opponent' }) }), {
    interveningIf: somePlayerHasLess({
      players: players({ relation: 'opponent' }),
      than: ref('triggering.defender'),
      metric: 'life',
    }),
    instructions: [draw({ count: 1, targets: ref('triggering.player') })],
  })])
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [creature('Attack watcher', { ruleDefinition: definition })],
      p2: [creature('First striker'), creature('Second striker'), creature('Third striker')],
    },
    libraries: { p2: [cardTemplate('Drawn one'), cardTemplate('Drawn two')] },
  }, { random: () => 0 })
  let state = structuredClone(server.state)
  state.players.p3.life = 50
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'
  const first = named(state, 'First striker').id
  const second = named(state, 'Second striker').id
  const third = named(state, 'Third striker').id
  state = ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [
      { objectId: first, defender: 'p3' },
      { objectId: second, defender: 'p3' },
    ],
  }))
  expect(state.stack).toHaveLength(1)
  state = resolveStack(server.rules, state)
  expect(state.zoneOrder.p2.hand).toHaveLength(1)

  // A second attack declaration needs a new combat, not another request in the same step.
  state = ok(server.rules({ ...state, step: 'endCombat' }, { type: 'advanceStep' }))
  state = ok(server.rules({ ...state, step: 'beginCombat' }, { type: 'advanceStep' }))
  state = ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: third, defender: 'p1' }],
  }))
  expect(state.stack).toHaveLength(0)
})

test('leave draws read source-attributed damage this turn, including last-known ledgers', () => {
  const definition = snapshot([whenever(self.leaves, {
    instructions: [forEachPlayer({
      of: players(),
      instructions: [draw({
        count: damageDealtThisTurn({ to: ref('source'), by: ref('event.player') }),
        targets: ref('event.player'),
      })],
    })],
  })])
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [creature('Ledger wurm', { toughness: 20, ruleDefinition: definition })],
      p2: [creature('P2 hitter', { power: 4 })],
      p3: [creature('P3 hitter', { power: 2 })],
    },
    libraries: {
      p2: [cardTemplate('P2 a'), cardTemplate('P2 b'), cardTemplate('P2 c'), cardTemplate('P2 d')],
      p3: [cardTemplate('P3 a'), cardTemplate('P3 b')],
    },
  }, { random: () => 0 })
  const wurm = named(server.state, 'Ledger wurm').id
  let state = ok(server.rules(server.state, {
    type: 'dealDamage',
    sourceId: named(server.state, 'P2 hitter').id,
    target: { kind: 'object', objectId: wurm },
    amount: 4,
  }))
  state = ok(server.rules(state, {
    type: 'dealDamage',
    sourceId: named(state, 'P3 hitter').id,
    target: { kind: 'object', objectId: wurm },
    amount: 2,
  }))
  expect(named(state, 'Ledger wurm').damageDealtBy).toEqual({ p2: 4, p3: 2 })
  state = ok(server.rules(state, { type: 'move', objectId: wurm, to: 'exile' }))
  state = resolveStack(server.rules, state)
  expect(state.zoneOrder.p2.hand).toHaveLength(4)
  expect(state.zoneOrder.p3.hand).toHaveLength(2)
  expect(state.zoneOrder.p1.hand).toHaveLength(0)
})

test('legendary combat damage this turn gates an activated sacrifice', () => {
  const definition = snapshot([activated({
    when: combatDamageThisTurn({ recipient: 'opponent', legendary: true }),
    costs: [tapCost(), sacrificeCost(ref('source'), 1)],
    instructions: [draw(2)],
  })])
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('Goal ball', { types: ['Artifact'], ruleDefinition: definition })] },
    libraries: { p1: [cardTemplate('Goal one'), cardTemplate('Goal two')] },
  }, { random: () => 0 })
  const ball = named(server.state, 'Goal ball').id
  expect(legalActsFor(server.state, 'p1').some(action =>
    action.kind === 'activateAbility' && action.objectId === ball)).toBe(false)
  const ready = structuredClone(server.state)
  ready.players.p2.data[LEGENDARY_COMBAT_DAMAGE_FROM] = { p3: true }
  expect(legalActsFor(ready, 'p1').some(action =>
    action.kind === 'activateAbility' && action.objectId === ball)).toBe(true)
  const resolved = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: ball, abilityId: '$.abilities[0]',
  })))
  expect(resolved.zoneOrder.p1.hand).toHaveLength(2)
  expect(resolved.objects[ball]?.zone).toBe('graveyard')
})

test('a static grant gives other creatures an optional fight against the granter while it remains', () => {
  const definition = snapshot([staticAbility(grantAbilityTo({
    targets: objects({ zone: 'battlefield', type: 'Creature', other: true }),
    ability: {
      kind: 'triggered',
      on: self.attacks,
      instructions: [
        chooseCards({
          chooser: ref('controller'),
          bindChoice: 'granter',
          filter: objects({ among: ref('grant.source') }),
          min: 0,
          max: 1,
        }),
        fight({ left: ref('source'), right: choice('granter') }),
      ],
    },
  }))])
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [creature('Granter', { power: 10, toughness: 10, ruleDefinition: definition })],
      p2: [creature('Raider', { power: 3, toughness: 3 })],
    },
  }, { random: () => 0 })
  expect(named(server.state, 'Raider').canonicalGrantedAbilities).toHaveLength(1)
  expect(named(server.state, 'Granter').canonicalGrantedAbilities ?? []).toHaveLength(0)
  let state = structuredClone(server.state)
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'
  state = ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: named(state, 'Raider').id, defender: 'p1' }],
  }))
  expect(state.stack).toHaveLength(1)
  state = ok(server.rules(state, { type: 'resolveTop' }))
  const pick = pendingSelectionFor(state, 'p2')!
  expect(pick.candidates).toEqual([named(state, 'Granter').id])
  state = ok(server.rules(state, {
    type: 'selectCards', seat: 'p2', selectionId: pick.id, kind: 'choose', count: 1,
    objectIds: [named(state, 'Granter').id],
  }))
  expect(named(state, 'Raider').zone).toBe('graveyard')
  expect(named(state, 'Granter').damageDealtBy).toEqual({ p2: 3 })

  const gone = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move', objectId: named(server.state, 'Granter').id, to: 'graveyard',
  })))
  expect(named(gone, 'Raider').canonicalGrantedAbilities ?? []).toHaveLength(0)
})
