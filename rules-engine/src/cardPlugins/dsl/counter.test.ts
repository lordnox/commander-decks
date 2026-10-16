import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import { ward as wardEffect } from '../effects'
import { ward as wardPlugin } from '../ward'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, counter, createDefinitionSnapshot, createEffect, draw, gainLife, objects, ref, select, setColorsEffect, spell, stackItems, target, untilCleanup } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

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

describe('counterspellAndWard — integration', () => {

  describe('counterspell and ward', () => {
    test('a resolved counter target removes the spell and the later draw still runs', () => {
      const counterDraw = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          decisions: {
            targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
          },
          instructions: [
            counter({ targets: target(0) }),
            draw({ count: 1, targets: ref('controller') }),
          ],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Victim spell', { types: ['Instant'], manaCost: '{0}' }),
            cardTemplate('Counter draw', { types: ['Instant'], manaCost: '{0}', ruleDefinition: counterDraw }),
          ],
        },
        libraries: { p1: [cardTemplate('Counter draw card')] },
      }, { random: () => 0 })
      const victim = named(server.state, 'Victim spell')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: victim.id })
      const counterSpell = named(state, 'Counter draw')
      const stackId = state.stack.find((item) => item.objectId === victim.id)!.id
      state = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: counterSpell.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.objects[victim.id].zone).toBe('graveyard')
      expect(state.stack.some((item) => item.id === stackId)).toBe(false)
      expect(Object.values(state.objects).some((object) => object.name === 'Counter draw card' && object.zone === 'hand')).toBe(true)
    })

    test('ward payment pauses priority before the targeted spell resolves', () => {
      const snapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [gainLife({ amount: 1, targets: ref('controller') })],
          decisions: {
            targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
          },
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Ward probe spell', { types: ['Instant'], manaCost: '{0}', ruleDefinition: snapshot })],
        },
        battlefield: {
          p2: [cardTemplate('Ward probe bear', { types: ['Creature'], power: 2, toughness: 2, effects: [wardEffect({ life: 1 })] })],
        },
      }, { random: () => 0, cardPlugins: [wardPlugin] })
      const spellObject = named(server.state, 'Ward probe spell')
      const targetObject = named(server.state, 'Ward probe bear')
      const cast = reduce(server, server.state, {
        type: 'castSpell', seat: 'p1', objectId: spellObject.id,
        targets: [{ kind: 'object', objectId: targetObject.id }],
      })
      const wardWaiting = reduce(server, cast, { type: 'resolveTop' })
      expect(wardWaiting.priority).toBeNull()
      expect(pendingOptionSelection(wardWaiting, 'p1')).toBeDefined()
      expect(wardWaiting.stack.some((item) => item.kind === 'spell')).toBe(true)
    })
  })
})
