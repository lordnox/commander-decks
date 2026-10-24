import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { snapshotFor } from '../../cards/snapshot'
import { ATTACK_REQUIREMENT_ERROR } from '../../rules/attackRequirementConstants'
import { instructionSpell } from './instructionTestSupport'
import { attackTax, createEffect, objects, players, select, staticAbility, target, untilCleanup } from './v1'

const fixture = (taxed = false) => {
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: {
      p1: [cardTemplate('Attacker', { types: ['Creature'], power: 2, toughness: 2, summoningSickness: false })],
      p2: [cardTemplate('Walker', { types: ['Planeswalker'], printedLoyalty: 3 }),
        ...(taxed ? [cardTemplate('Tax fixture', { types: ['Artifact'], ruleDefinition: snapshotFor([staticAbility(attackTax(1))]) })] : [])],
    },
    hands: { p1: [instructionSpell({ decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
      instructions: [createEffect({ targets: objects({ name: 'Attacker' }), duration: untilCleanup(), effect: { kind: 'mustAttackPlayer', player: target(0) } })],
    })] },
  })
  const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0], targets: [{ kind: 'player', player: 'p2' }] })))
  return { server, state: { ...state, step: 'declareAttackers' as const }, id: state.zoneOrder.p1.battlefield[0] }
}

test('a player attack requirement requires that player, excludes their planeswalker, and expires at cleanup', () => {
  const { server, state, id } = fixture()
  expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [] })).toMatchObject({ ok: false, error: ATTACK_REQUIREMENT_ERROR.unsatisfied })
  expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender: 'p3' }] }).ok).toBe(false)
  const walker = state.zoneOrder.p2.battlefield[0]
  expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender: { kind: 'object', objectId: walker } }] }).ok).toBe(false)
  expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender: 'p2' }] }).ok).toBe(true)
  const expired = ok(server.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))
  expect(server.rules({ ...expired, step: 'declareAttackers', priority: 'p1' }, { type: 'declareAttackers', seat: 'p1', attackers: [] }).ok).toBe(true)
})

test.each(['tapped', 'phased', 'defender', 'lost', 'self'] as const)('an impossible player requirement does not force an illegal attack (%s)', reason => {
  const { server, state, id } = fixture()
  switch (reason) {
    case 'tapped': state.objects[id].tapped = true; break
    case 'phased': state.objects[id].phasedOut = true; break
    case 'defender': state.objects[id].oracleText = 'Defender'; break
    case 'lost': state.players.p2.lost = true; break
    case 'self': state.objects[id].controller = 'p2'; state.active = 'p2'; state.priority = 'p2'; break
  }
  expect(server.rules(state, { type: 'declareAttackers', seat: state.active, attackers: [] }).ok).toBe(true)
})

test('attack requirements do not force payment even with mana available', () => {
  const { server, state } = fixture(true)
  state.players.p1.mana.C = 10
  expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [] }).ok).toBe(true)
})

test('conflicting goad and player requirements maximize the number obeyed rather than imposing incompatible restrictions', () => {
  const { server, state, id } = fixture()
  state.objects[id].continuousEffects!.push({ effect: { kind: 'goad', sourceController: 'p2' }, duration: { kind: 'untilCleanup' } })
  // Attacking p2 obeys the designated-player and must-attack requirements;
  // attacking p3 obeys goad's two requirements. Both declarations are legal.
  for (const defender of ['p2', 'p3']) expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [{ objectId: id, defender }] }).ok).toBe(true)
  expect(server.rules(state, { type: 'declareAttackers', seat: 'p1', attackers: [] }).ok).toBe(false)
})
