import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import {
  anyTarget,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  damage,
  keyword,
  ref,
  select,
  spell,
  target,
} from './v1'

const infect = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.infect])))

const attack = (server: ReturnType<typeof createServerGame>, attacker: string, defender = 'p2') => {
  const state = structuredClone(server.state)
  state.step = 'declareAttackers'
  state.objects[attacker]!.summoningSickness = false
  return ok(server.rules(state, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId: attacker, defender }],
  }))
}

test.each(['player', 'creature'] as const)('canonical infect damage results use actual damage with a %s recipient', kind => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Infect spell fixture', {
      types: ['Instant'],
      manaCost: '{0}',
      ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
        keyword.infect,
        spell({
          decisions: { targets: [select({ filter: anyTarget(), count: 1 })] },
          instructions: [damage({ source: ref('source'), targets: target(0), amount: 3 })],
        }),
      ]))),
    })] },
    battlefield: { p2: [cardTemplate('Damage fixture', { types: ['Creature'], power: 5, toughness: 5 })] },
  }, { random: () => 0 })
  const targetRef = kind === 'player'
    ? { kind: 'player' as const, player: 'p2' }
    : { kind: 'object' as const, objectId: server.state.zoneOrder.p2.battlefield[0]! }
  const state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: server.state.zoneOrder.p1.hand[0]!,
    targets: [targetRef],
  })))
  expect(state.players.p2.life).toBe(40)
  expect(state.players.p2.poison).toBe(kind === 'player' ? 3 : 0)
  if (kind === 'creature') {
    const blocker = state.objects[server.state.zoneOrder.p2.battlefield[0]!]
    expect(blocker.damageMarked).toBe(0)
    expect(blocker.counters['-1/-1']).toBe(3)
  }
})

test('canonical infect combat damage poisons a player and does not lose life', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [cardTemplate('Infect attacker', {
        types: ['Creature'],
        power: 3,
        toughness: 3,
        ruleDefinition: infect,
      })],
    },
  }, { random: () => 0 })
  const attacker = server.state.zoneOrder.p1.battlefield[0]!
  const blocked = ok(server.rules({ ...attack(server, attacker), step: 'declareBlockers', priority: 'p2' }, {
    type: 'declareBlockers',
    seat: 'p2',
    blockers: [],
  }))
  const damageStep = ok(server.rules({ ...blocked, priority: null }, { type: 'advanceStep' }))
  expect(damageStep.players.p2.poison).toBe(3)
  expect(damageStep.players.p2.life).toBe(40)
})
