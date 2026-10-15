import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { instructionSpell } from './instructionTestSupport'
import { counter, createEffect, gainLife, objects, ref, select, setColorsEffect, stackItems, target, untilCleanup } from './v1'

const counterProgram = () => ({
  decisions: { targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })] },
  instructions: [counter({ targets: target(0) })],
})

test('counter targets a creature spell and removes it exactly once after journal restore', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      cardTemplate('Counterspell', { manaCost: '{0}' }),
      cardTemplate('Target Spell', { types: ['Creature'], manaCost: '{0}', power: 2, toughness: 2 }),
    ] },
  }, { random: () => 0 })
  const counterspell = Object.values(server.state.objects).find(object => object.name === 'Counterspell')!
  const victim = Object.values(server.state.objects).find(object => object.name === 'Target Spell')!
  const stacked = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: victim.id }))
  const stackId = stacked.stack[0].id
  const command = {
    type: 'castSpell' as const, seat: 'p1' as const, objectId: counterspell.id,
    targets: [{ kind: 'stackItem' as const, stackId }],
  }
  expect(server.rules(stacked, { ...command, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false)
  const cast = ok(server.rules(stacked, command))
  const restored = restoreJournal(createJournal(cast), server.rules).current()
  expect(restored.objects[counterspell.id].ruleDefinition).toEqual(counterspell.ruleDefinition)
  const resolved = ok(server.rules(restored, { type: 'resolveTop' }))
  expect(resolved.objects[victim.id].zone).toBe('graveyard')
  expect(resolved.objects[counterspell.id].zone).toBe('graveyard')
  expect(resolved.players.p2.life).toBe(restored.players.p2.life)
  expect(resolved.stack).toHaveLength(0)
  expect(server.rules(resolved, { type: 'resolveTop' }).ok).toBe(false)
})

test('a missing stack target suppresses the entire program, including nontarget life gain', () => {
  const program = counterProgram()
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      instructionSpell({ ...program, instructions: [
        ...program.instructions, gainLife({ amount: 3, targets: ref('controller') }),
      ] }),
      cardTemplate('Target Spell', { types: ['Sorcery'], manaCost: '{0}' }),
      cardTemplate('Counterspell', { manaCost: '{0}' }),
    ] },
  }, { random: () => 0 })
  const source = Object.values(server.state.objects).find(object => object.name === 'Instruction fixture')!
  const victim = Object.values(server.state.objects).find(object => object.name === 'Target Spell')!
  const stacked = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: victim.id }))
  const stackId = stacked.stack[0].id
  const cast = ok(server.rules(stacked, {
    type: 'castSpell', seat: 'p1', objectId: source.id, targets: [{ kind: 'stackItem', stackId }],
  }))
  const response = Object.values(cast.objects).find(object => object.name === 'Counterspell')!
  const responded = ok(server.rules(cast, {
    type: 'castSpell', seat: 'p1', objectId: response.id, targets: [{ kind: 'stackItem', stackId }],
  }))
  const gone = ok(server.rules(responded, { type: 'resolveTop' }))
  expect(gone.stack.some(item => item.id === stackId)).toBe(false)
  const restored = restoreJournal(createJournal(gone), server.rules).current()
  const resolved = ok(server.rules(restored, { type: 'resolveTop' }))
  expect(resolved.players.p1.life).toBe(restored.players.p1.life)
  expect(resolved.stack).toHaveLength(0)
  expect(resolved.objects[source.id].zone).toBe('graveyard')
})


test('counter restricted to instant spells rejects a creature spell at announcement but accepts an instant', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [
      instructionSpell({
        decisions: { targets: [select({ filter: stackItems({ kind: 'spell', type: 'Instant' }), count: 1 })] },
        instructions: [counter({ targets: target(0) })],
      }),
      cardTemplate('Creature fixture', { types: ['Creature'], power: 2, toughness: 2, manaCost: '{0}' }),
      cardTemplate('Instant fixture', { types: ['Instant'], manaCost: '{0}' }),
    ] },
  }, { random: () => 0 })
  const find = (name: string) => Object.values(server.state.objects).find(object => object.name === name)!
  const source = find('Instruction fixture')
  const creature = find('Creature fixture')
  const instant = find('Instant fixture')
  const stacked = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id }))
  const creatureStackId = stacked.stack[0].id
  const rejected = server.rules(stacked, {
    type: 'castSpell', seat: 'p1', objectId: source.id, targets: [{ kind: 'stackItem', stackId: creatureStackId }],
  })
  expect(rejected.ok).toBe(false)
  expect(stacked.objects[source.id].zone).toBe('hand')
  expect(stacked.stack.map(item => item.id)).toEqual([creatureStackId])
  const response = ok(server.rules(stacked, { type: 'castSpell', seat: 'p1', objectId: instant.id }))
  const instantStackId = response.stack[0].id
  const cast = ok(server.rules(response, {
    type: 'castSpell', seat: 'p1', objectId: source.id, targets: [{ kind: 'stackItem', stackId: instantStackId }],
  }))
  const restored = restoreJournal(createJournal(cast), server.rules).current()
  const resolved = ok(server.rules(restored, { type: 'resolveTop' }))
  expect(resolved.objects[instant.id].zone).toBe('graveyard')
  expect(resolved.objects[creature.id].zone).toBe('stack')
  expect(resolved.stack.map(item => item.id)).toEqual([creatureStackId])
})

for (const changeColor of [false, true]) {
  test(`counter checks current spell color at resolution (${changeColor ? 'response makes blue spell black' : 'blue spell stays blue'})`, () => {
    const colorChange = instructionSpell({
      decisions: { targets: [select({ filter: objects({ zone: 'stack', type: 'Instant' }), count: 1 })] },
      instructions: [createEffect({ targets: target(0), effect: setColorsEffect(['B']), duration: untilCleanup() })],
    })
    colorChange.name = 'Color response fixture'
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [
        instructionSpell({
          decisions: { targets: [select({ filter: stackItems({ kind: 'spell', color: 'U' }), count: 1 })] },
          instructions: [counter({ targets: target(0) }), gainLife({ amount: 3, targets: ref('controller') })],
        }),
        colorChange,
        cardTemplate('Blue instant fixture', { types: ['Instant'], colors: ['U'], manaCost: '{0}' }),
      ] },
    }, { random: () => 0 })
    const find = (name: string) => Object.values(server.state.objects).find(object => object.name === name)!
    const source = find('Instruction fixture')
    const victim = find('Blue instant fixture')
    const response = find('Color response fixture')
    const stacked = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: victim.id }))
    const victimStackId = stacked.stack[0].id
    const cast = ok(server.rules(stacked, {
      type: 'castSpell', seat: 'p1', objectId: source.id, targets: [{ kind: 'stackItem', stackId: victimStackId }],
    }))
    let current = restoreJournal(createJournal(cast), server.rules).current()
    if (changeColor) {
      const responded = ok(server.rules(current, {
        type: 'castSpell', seat: 'p1', objectId: response.id, targets: [{ kind: 'object', objectId: victim.id }],
      }))
      expect(responded.stack.map(item => item.objectId)).toEqual([response.id, source.id, victim.id])
      const restoredResponse = restoreJournal(createJournal(responded), server.rules).current()
      const changed = ok(server.rules(restoredResponse, { type: 'resolveTop' }))
      expect(changed.objects[victim.id].colors).toEqual(['B'])
      expect(changed.objects[response.id].zone).toBe('graveyard')
      expect(changed.stack.map(item => item.objectId)).toEqual([source.id, victim.id])
      current = restoreJournal(createJournal(changed), server.rules).current()
      expect(current.objects[victim.id].colors).toEqual(['B'])
    }
    const lifeBefore = current.players.p1.life
    const resolved = ok(server.rules(current, { type: 'resolveTop' }))
    expect(resolved.objects[source.id].zone).toBe('graveyard')
    if (changeColor) {
      // CR 608.2b: the only target became illegal; none of the instructions execute.
      expect(resolved.objects[victim.id].zone).toBe('stack')
      expect(resolved.stack.map(item => item.id)).toEqual([victimStackId])
      expect(resolved.players.p1.life).toBe(lifeBefore)
      const victimResolved = ok(server.rules(resolved, { type: 'resolveTop' }))
      expect(victimResolved.objects[victim.id].zone).toBe('graveyard')
      expect(victimResolved.objects[victim.id].colors).toEqual(['U'])
      expect(victimResolved.objects[victim.id].continuousEffects).toBeUndefined()
    } else {
      expect(resolved.objects[victim.id].zone).toBe('graveyard')
      expect(resolved.stack).toHaveLength(0)
      expect(resolved.players.p1.life).toBe(lifeBefore + 3)
    }
  })
}
