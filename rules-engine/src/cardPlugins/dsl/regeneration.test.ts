import type { GameState } from '../../types'
import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect,
  destroy,
  gainLife,
  ifThen,
  objects,
  ref,
  regenerate,
  result,
  staticAbility,
  staticRegeneration,
  untilStep,
} from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

const shieldThenDestroy = (cannotRegenerate?: true) => createServerGame(commanderRules, {
  battlefield: { p1: [cardTemplate('Recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
  hands: { p1: [instructionSpell({ instructions: [
    regenerate(objects({ name: 'Recipient' })),
    destroy({ targets: objects({ name: 'Recipient' }), ...(cannotRegenerate ? { cannotRegenerate } : {}), bindResult: 'destroyed' }),
    ifThen(result('destroyed', 'destroyed'), { then: [gainLife({ targets: ref('controller'), amount: 3 })] }),
  ] })] },
}, { random: () => 0 })

const cast = (server: ReturnType<typeof createServerGame>, state: GameState = server.state) =>
  resolveStack(server.rules, ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: state.zoneOrder.p1.hand[0] })))

test.each([false, true])('a shield replaces destruction once unless it cannot be regenerated, and the result reports the outcome (cannotRegenerate=%s)', forbidden => {
  const server = shieldThenDestroy(forbidden ? true : undefined)
  const state = cast(server)
  const recipient = named(state, 'Recipient')
  expect(recipient.zone).toBe(forbidden ? 'graveyard' : 'battlefield')
  expect(state.players.p1.life).toBe(forbidden ? 43 : 40)
  if (!forbidden) {
    expect(recipient).toMatchObject({ tapped: true, damageMarked: 0, attacking: null, blocking: null })
    expect((recipient.continuousEffects ?? []).some(entry => entry.effect.kind === 'regenerationShield')).toBe(false)
  }
})

test('a restored shield replaces lethal damage but cannot save zero toughness or a sacrifice, and expires at cleanup', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Recipient', { types: ['Creature'], power: 2, toughness: 2 })] },
    hands: { p1: [instructionSpell({ instructions: [regenerate(objects({ name: 'Recipient' }))] })] },
  }, { random: () => 0 })
  const shielded = restoreJournal(createJournal(cast(server)), server.rules).current()
  const id = named(shielded, 'Recipient').id
  const damaged = ok(server.rules(shielded, { type: 'dealDamage', sourceId: id, target: { kind: 'object', objectId: id }, amount: 2 }))
  expect(damaged.objects[id]).toMatchObject({ zone: 'battlefield', damageMarked: 0, tapped: true })
  expect(ok(server.rules(damaged, { type: 'dealDamage', sourceId: id, target: { kind: 'object', objectId: id }, amount: 2 })).objects[id].zone).toBe('graveyard')

  const zero = ok(server.rules(shielded, { type: 'canonicalEffect', objectId: id, effect: { kind: 'setStats', power: { kind: 'constant', value: 0 }, toughness: { kind: 'constant', value: 0 } }, duration: { kind: 'untilCleanup' } }))
  expect(zero.objects[id].zone).toBe('graveyard')
  expect(ok(server.rules(shielded, { type: 'sacrifice', objectId: id })).objects[id].zone).toBe('graveyard')

  const cleanup = ok(server.rules({ ...shielded, step: 'end', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' }))
  expect((cleanup.objects[id].continuousEffects ?? []).some(entry => entry.effect.kind === 'regenerationShield')).toBe(false)
})

test('static regeneration replaces every destruction of matching permanents without being used up', () => {
  const regenerator = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(staticRegeneration(objects({ zone: 'battlefield', controller: 'you', type: 'Creature' }))),
  ])))
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [
      cardTemplate('Regenerator', { types: ['Enchantment'], ruleDefinition: regenerator }),
      cardTemplate('Protected', { types: ['Creature'], power: 2, toughness: 2 }),
    ], p2: [cardTemplate('Unprotected', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const protectedId = named(server.state, 'Protected').id
  const once = ok(server.rules(server.state, { type: 'destroy', objectId: protectedId }))
  const twice = ok(server.rules({ ...once, objects: { ...once.objects, [protectedId]: { ...once.objects[protectedId], tapped: false } } }, { type: 'destroy', objectId: protectedId }))
  expect(twice.objects[protectedId]).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(ok(server.rules(server.state, { type: 'destroy', objectId: protectedId, cannotRegenerate: true })).objects[protectedId].zone).toBe('graveyard')
  const unprotected = named(server.state, 'Unprotected').id
  expect(ok(server.rules(server.state, { type: 'destroy', objectId: unprotected })).objects[unprotected].zone).toBe('graveyard')
})

test('in one state-based wave a shielded creature regenerates while the other lethal-damage creature dies', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [
      cardTemplate('Shielded', { types: ['Creature'], power: 2, toughness: 2 }),
      cardTemplate('Exposed', { types: ['Creature'], power: 2, toughness: 2 }),
    ] },
    hands: { p1: [instructionSpell({ instructions: [regenerate(objects({ name: 'Shielded' }))] })] },
  }, { random: () => 0 })
  const shielded = cast(server)
  const marked = structuredClone(shielded)
  for (const name of ['Shielded', 'Exposed']) named(marked, name).damageMarked = 2
  const checked = ok(server.rules(marked, { type: 'addMana', seat: 'p1', mana: {} }))
  expect(named(checked, 'Shielded')).toMatchObject({ zone: 'battlefield', damageMarked: 0, tapped: true })
  expect(named(checked, 'Exposed').zone).toBe('graveyard')
})

test('regeneration shields must last only this turn', () => {
  expect(() => instructionSpell({ instructions: [createEffect({ targets: ref('source'), effect: { kind: 'regenerationShield' }, duration: untilStep('end') })] })).toThrow()
})
