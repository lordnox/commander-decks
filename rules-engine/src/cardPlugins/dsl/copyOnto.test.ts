import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { copyEffect, createEffect, objects, select, target, untilCleanup } from './v1'

const named = (state: GameState, name: string) => Object.values(state.objects).find(object => object.name === name)!

test('createEffect copy applies until cleanup and restores copiable values', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })] },
      instructions: [createEffect({
        targets: objects({ zone: 'battlefield', type: 'Creature', not: { among: target(0) } }),
        effect: copyEffect({ of: target(0) }),
        duration: untilCleanup(),
      })],
    })] },
    battlefield: {
      p1: [
        cardTemplate('Small Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        cardTemplate('Large Bear', { types: ['Creature'], power: 7, toughness: 7 }),
      ],
    },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  const resolved = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(ready, 'Instruction fixture').id,
    targets: [{ kind: 'object', objectId: named(ready, 'Large Bear').id }],
  })))
  const small = Object.values(resolved.objects).find(object => object.printedName === 'Small Bear')!
  expect(small).toMatchObject({ name: 'Large Bear', power: 7, toughness: 7 })
  const cleanup = ok(server.rules({ ...resolved, step: 'end', priority: 'p1' }, { type: 'advanceStep' }))
  expect(named(cleanup, 'Small Bear')).toMatchObject({ name: 'Small Bear', power: 2, toughness: 2 })
})


test('permanent land copies retain a usable copy activation', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate("Thespian's Stage"), cardTemplate('Quarry', { types: ['Land'], tapProduces: { G: 1 } })] },
  }, { random: () => 0 })
  const source = named(server.state, "Thespian's Stage").id
  const quarry = named(server.state, 'Quarry').id
  let state = structuredClone(server.state)
  for (const abilityId of ['$.abilities[1]', '$.abilities[0]']) {
    state.players.p1.mana.C = 2
    state.objects[source].tapped = false
    state = resolveStack(server.rules, ok(server.rules(state, {
      type: 'activateAbility', seat: 'p1', objectId: source, abilityId,
      targets: [{ kind: 'object', objectId: quarry }],
    })))
    expect(state.objects[source]).toMatchObject({ name: 'Quarry', tapProduces: { G: 1 } })
    expect(state.objects[source].ruleDefinition?.definition.abilities.some(ability =>
      ability.kind === 'activated' && ability.instructions?.some(instruction =>
        instruction.kind === 'createEffect' && instruction.effect.kind === 'copy'))).toBe(true)
  }
})

test('catalog Mirrorweave rejects legendary targets and restores copied creatures at cleanup', () => {
  const server = createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [cardTemplate('Mirrorweave')] },
    battlefield: {
      p1: [cardTemplate('Small Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      p2: [
        cardTemplate('Large Bear', { types: ['Creature'], power: 7, toughness: 7 }),
        cardTemplate('Legend', { types: ['Creature'], supertypes: ['Legendary'], power: 2, toughness: 2 }),
      ],
    },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.step = 'precombatMain'
  ready.players.p1.mana = { W: 2, U: 2, B: 0, R: 0, G: 0, C: 2 }
  const mirror = named(ready, 'Mirrorweave')
  const rejected = server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: mirror.id,
    targets: [{ kind: 'object', objectId: named(ready, 'Legend').id }],
  })
  expect(rejected.ok).toBe(false)
  const resolved = ok(server.rules(ok(server.rules(ready, {
    type: 'castSpell',
    seat: 'p1',
    objectId: mirror.id,
    targets: [{ kind: 'object', objectId: named(ready, 'Large Bear').id }],
  })), { type: 'resolveTop' }))
  const copiedId = Object.values(resolved.objects).find((object) => object.printedName === 'Small Bear')!.id
  expect(resolved.objects[copiedId]).toMatchObject({ name: 'Large Bear', power: 7 })
  const cleanup = ok(server.rules({ ...resolved, step: 'end' }, { type: 'custom', name: 'advanceStep' }))
  expect(cleanup.objects[copiedId]).toMatchObject({ name: 'Small Bear', power: 2 })
})
