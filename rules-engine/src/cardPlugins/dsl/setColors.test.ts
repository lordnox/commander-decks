import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { copyUntilEndOfTurn } from '../continuousEffects'
import { copyCharacteristics } from '../effectRuntime'
import { instructionSpell } from './instructionTestSupport'
import { card, compileCardRuleDefinition, createEffect, objects, permanentEffect, setColorsEffect, spell, stackItems, select, counter, target, untilCleanup, untilStep } from './v1'
import type { CardColor } from './v1'

const compileColorFilter = (color: unknown) => compileCardRuleDefinition(card([spell({
  decisions: { targets: [select({ filter: stackItems({ kind: 'spell', color: color as CardColor }), count: 1 })] },
  instructions: [counter({ targets: target(0) })],
})]))

const recipientName = 'Color recipient fixture'
const colorResponse = (colors: readonly CardColor[], duration = untilCleanup()) => instructionSpell({
  instructions: [createEffect({ targets: objects({ name: recipientName }), effect: setColorsEffect(colors), duration })],
})

test('setColors preserves timestamp order across cleanup, restore, and later expiration', () => {
  const first = colorResponse(['B'])
  first.name = 'First color fixture'
  const second = colorResponse(['R'], untilStep('untap'))
  second.name = 'Second color fixture'
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [first, second] },
    battlefield: { p1: [cardTemplate(recipientName, { types: ['Creature'], colors: ['U'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const find = (name: string) => Object.values(server.state.objects).find(object => object.name === name)!
  const recipient = find(recipientName)
  let current = server.state
  for (const name of [first.name, second.name]) {
    const cast = ok(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: find(name).id }))
    current = ok(server.rules(cast, { type: 'resolveTop' }))
  }
  expect(current.objects[recipient.id].colors).toEqual(['R'])
  current = restoreJournal(createJournal(current), server.rules).current()
  const cleanup = ok(server.rules({ ...current, step: 'end', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' }))
  expect(cleanup.step).toBe('cleanup')
  expect(cleanup.objects[recipient.id].colors).toEqual(['R'])
  expect(cleanup.objects[recipient.id].continuousEffects).toHaveLength(1)
  const restored = restoreJournal(createJournal(cleanup), server.rules).current()
  const untap = ok(server.rules(restored, { type: 'advanceStep' }))
  expect(untap.step).toBe('untap')
  expect(untap.objects[recipient.id].colors).toEqual(['U'])
  expect(untap.objects[recipient.id].continuousEffects).toBeUndefined()
})

test('setColors follows a permanent spell onto the battlefield but expires when it leaves', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [colorResponse(['B'], permanentEffect()), cardTemplate(recipientName, {
      types: ['Creature'], colors: ['U'], manaCost: '{0}', power: 2, toughness: 2,
    })] },
  }, { random: () => 0 })
  const source = Object.values(server.state.objects).find(object => object.name === 'Instruction fixture')!
  const recipient = Object.values(server.state.objects).find(object => object.name === recipientName)!
  const stacked = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: recipient.id }))
  const responded = ok(server.rules(stacked, { type: 'castSpell', seat: 'p1', objectId: source.id }))
  const changed = ok(server.rules(responded, { type: 'resolveTop' }))
  expect(changed.objects[recipient.id].colors).toEqual(['B'])
  const restored = restoreJournal(createJournal(changed), server.rules).current()
  const permanent = ok(server.rules(restored, { type: 'resolveTop' }))
  expect(permanent.objects[recipient.id].zone).toBe('battlefield')
  expect(permanent.objects[recipient.id].colors).toEqual(['B'])
  const died = ok(server.rules(permanent, { type: 'move', objectId: recipient.id, to: 'graveyard' }))
  expect(died.objects[recipient.id].colors).toEqual(['U'])
  expect(died.objects[recipient.id].continuousEffects).toBeUndefined()
  const returned = ok(server.rules(died, { type: 'move', objectId: recipient.id, to: 'battlefield' }))
  expect(returned.objects[recipient.id].colors).toEqual(['U'])
})

test('setColors supports colorless objects and nonbattlefield recipients without changing costs', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [colorResponse([]), cardTemplate(recipientName, { colors: ['U'], manaCost: '{U}' })] },
  }, { random: () => 0 })
  const source = Object.values(server.state.objects).find(object => object.name === 'Instruction fixture')!
  const recipient = Object.values(server.state.objects).find(object => object.name === recipientName)!
  const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: source.id }))
  const changed = ok(server.rules(cast, { type: 'resolveTop' }))
  expect(changed.objects[recipient.id].zone).toBe('hand')
  expect(changed.objects[recipient.id].colors).toEqual([])
  expect(changed.objects[recipient.id].manaCost).toBe('{U}')
})

test('color filters compose and validate only Magic colors, and setColors rejects invalid colors', () => {
  for (const color of ['W', 'U', 'B', 'R', 'G']) expect(() => compileColorFilter(color)).not.toThrow()
  for (const color of ['C', 'blue', '', 1]) {
    expect(() => compileColorFilter(color)).toThrow()
    expect(() => colorResponse([color as CardColor])).toThrow()
  }
  expect(() => compileCardRuleDefinition(card([spell({
    decisions: { targets: [select({ filter: stackItems({ all: [{ kind: 'spell' }, { any: [{ color: 'U' }, { color: 'R' }] }], not: { color: 'B' } }), count: 1 })] },
    instructions: [counter({ targets: target(0) })],
  })]))).not.toThrow()
})


for (const colorAppliedFirst of [false, true]) {
  for (const colorExpiresFirst of [false, true]) {
    test(`setColors layer 5 follows copy layer 1 (color applied first: ${colorAppliedFirst}, color expires first: ${colorExpiresFirst})`, () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [colorResponse(['B'], untilStep(colorExpiresFirst ? 'end' : 'untap'))] },
        battlefield: { p1: [
          cardTemplate(recipientName, { types: ['Creature'], colors: ['U'], power: 2, toughness: 2 }),
          cardTemplate('Copy model fixture', { types: ['Creature'], colors: ['R'], power: 3, toughness: 3 }),
        ] },
      }, { random: () => 0 })
      const source = Object.values(server.state.objects).find(object => object.name === 'Instruction fixture')!
      const recipient = Object.values(server.state.objects).find(object => object.name === recipientName)!
      const model = Object.values(server.state.objects).find(object => object.name === 'Copy model fixture')!
      let current = structuredClone(server.state)
      // Give the model the same name so the generic selector keeps the recipient in scope after copying.
      const copyModel = { ...model, name: recipientName }
      if (!colorAppliedFirst) copyUntilEndOfTurn(current.objects[recipient.id], copyModel)
      const cast = ok(server.rules(current, { type: 'castSpell', seat: 'p1', objectId: source.id }))
      current = ok(server.rules(cast, { type: 'resolveTop' }))
      if (colorAppliedFirst) copyUntilEndOfTurn(current.objects[recipient.id], copyModel)
      expect(current.objects[recipient.id].colors).toEqual(['B'])
      expect(copyCharacteristics(current.objects[recipient.id]).colors).toEqual(['R'])
      current = restoreJournal(createJournal(current), server.rules).current()
      const end = ok(server.rules({ ...current, step: 'postcombatMain', priority: 'p1', passedInRow: [] }, { type: 'advanceStep' }))
      expect(end.step).toBe('end')
      expect(end.objects[recipient.id].colors).toEqual(colorExpiresFirst ? ['R'] : ['B'])
      const cleanup = ok(server.rules(end, { type: 'advanceStep' }))
      expect(cleanup.objects[recipient.id].colors).toEqual(colorExpiresFirst ? ['U'] : ['B'])
      const restored = restoreJournal(createJournal(cleanup), server.rules).current()
      const untap = ok(server.rules(restored, { type: 'advanceStep' }))
      expect(untap.objects[recipient.id].colors).toEqual(['U'])
      expect(untap.objects[recipient.id].continuousEffects).toBeUndefined()
    })
  }
}
