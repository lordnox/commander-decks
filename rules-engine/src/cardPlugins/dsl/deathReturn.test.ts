import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { createEffect, grantAbilityEffect, move, objects, ref, select, self, target, untilCleanup } from './v1'

const setup = () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: {
      p1: [
        cardTemplate('Recipient', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Other Creature', { types: ['Creature'], power: 2, toughness: 2 }),
      ],
    },
    hands: { p1: [{
      ...instructionSpell({
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
        instructions: [createEffect({ targets: target(0), effect: grantAbilityEffect({ kind: 'triggered', on: self.dies, instructions: [move({ targets: ref('triggering.object.after'), to: 'battlefield', tapped: true })] }), duration: untilCleanup() })],
      }, '{0}'),
      name: 'Temporary death-return spell',
    }] },
  }, { random: () => 0 })
  const recipient = server.state.zoneOrder.p1.battlefield[0]
  const initial = structuredClone(server.state)
  initial.objects[recipient].controller = 'p2'
  const spell = initial.zoneOrder.p1.hand[0]!
  const granted = resolveStack(server.rules, ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: spell, targets: [{ kind: 'object', objectId: recipient }] })))
  return { server, granted, recipient, spell }
}

test('a granted dies ability finds the graveyard incarnation and returns tapped under its owner after restore', () => {
  const { server, granted, recipient, spell } = setup()
  expect(granted.objects[spell]!.zone).toBe('graveyard')
  const other = Object.values(granted.objects).find(object => object.name === 'Other Creature')!.id
  const unrelatedDied = ok(server.rules(granted, { type: 'move', objectId: other, to: 'graveyard' }))
  expect(unrelatedDied.stack).toHaveLength(0)
  expect(unrelatedDied.objects[recipient]!.zone).toBe('battlefield')
  const died = ok(server.rules(unrelatedDied, { type: 'move', objectId: recipient, to: 'graveyard' }))
  expect(died.stack).toHaveLength(1)
  expect(died.stack[0].controller).toBe('p2')
  const returned = resolveStack(server.rules, JSON.parse(JSON.stringify(died)))
  expect(returned.objects[recipient]).toMatchObject({ zone: 'battlefield', controller: 'p1', owner: 'p1', tapped: true })
  expect(returned.objects[recipient].canonicalGrantedAbilities ?? []).toHaveLength(0)
  const diedAgain = ok(server.rules(returned, { type: 'move', objectId: recipient, to: 'graveyard' }))
  expect(diedAgain.stack).toHaveLength(0)
  expect(diedAgain.objects[recipient].zone).toBe('graveyard')
})

test.each(['exile', 'reenter'] as const)('a death return cannot move a replacement incarnation after %s', change => {
  const { server, granted, recipient } = setup()
  let state = ok(server.rules(granted, { type: 'move', objectId: recipient, to: 'graveyard' }))
  state = ok(server.rules(state, { type: 'move', objectId: recipient, to: 'exile' }))
  if (change === 'reenter') state = ok(server.rules(state, { type: 'move', objectId: recipient, to: 'graveyard' }))
  const incarnation = state.objects[recipient].incarnation
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.objects[recipient]).toMatchObject({ zone: change === 'exile' ? 'exile' : 'graveyard', incarnation })
})

test('the death return is counterable and the temporary grant expires at cleanup', () => {
  const { server, granted, recipient } = setup()
  const died = ok(server.rules(granted, { type: 'move', objectId: recipient, to: 'graveyard' }))
  const countered = ok(server.rules(died, { type: 'counterStackItem', stackId: died.stack[0].id }))
  expect(countered.objects[recipient].zone).toBe('graveyard')
  const cleanup = ok(server.rules({ ...granted, step: 'end', priority: null }, { type: 'advanceStep' }))
  const laterDeath = ok(server.rules(cleanup, { type: 'move', objectId: recipient, to: 'graveyard' }))
  expect(laterDeath.stack).toHaveLength(0)
})
