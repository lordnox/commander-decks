import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { staticBoardPump, targetOnResolve } from './effects'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const stats = (state: GameState, name: string) => {
  const object = named(state, name)
  return [object.power, object.toughness]
}

const lieutenant = () => cardTemplate('Lieutenant Beast', {
  types: ['Creature'],
  power: 4,
  toughness: 4,
  effects: [
    staticBoardPump(2, 2, ['Creature'], { if: { kind: 'controlsCommander' }, affects: 'self' }),
    staticBoardPump(2, 2, ['Creature'], {
      if: { kind: 'controlsCommander' },
      affects: 'others',
      grantKeywords: ['trample'],
    }),
  ],
})

const commanderGame = () => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [lieutenant(), cardTemplate('Ally Bear', { types: ['Creature'], power: 2, toughness: 2 })],
        p2: [cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
      command: {
        p1: [cardTemplate('Our General', { types: ['Creature'], power: 3, toughness: 3 })],
        p2: [cardTemplate('Their General', { types: ['Creature'], power: 3, toughness: 3 })],
      },
    },
    { random: () => 0.5 },
  )
  const run = (state: GameState, ...events: GameEvent[]) =>
    events.reduce((current, event) => ok(server.rules(current, event)), state)
  return { server, run, start: server.state }
}

const move = (state: GameState, name: string, to: 'battlefield' | 'exile'): GameEvent => ({
  type: 'move',
  objectId: named(state, name).id,
  to,
})

describe('static pump with a controlsCommander condition', () => {
  test('the pump is inactive until the controller controls their commander', () => {
    const { start } = commanderGame()
    expect(stats(start, 'Lieutenant Beast')).toEqual([4, 4])
    expect(stats(start, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(start, 'Ally Bear'), 'trample', start)).toBe(false)
  })

  test('the commander arriving pumps the source and others, with trample only on others', () => {
    const { run, start } = commanderGame()
    const state = run(start, move(start, 'Our General', 'battlefield'))
    expect(stats(state, 'Lieutenant Beast')).toEqual([6, 6])
    expect(hasKeyword(named(state, 'Lieutenant Beast'), 'trample', state)).toBe(false)
    expect(stats(state, 'Ally Bear')).toEqual([4, 4])
    expect(hasKeyword(named(state, 'Ally Bear'), 'trample', state)).toBe(true)
    expect(stats(state, 'Our General')).toEqual([5, 5])
    expect(hasKeyword(named(state, 'Our General'), 'trample', state)).toBe(true)
    expect(stats(state, 'Enemy Bear')).toEqual([2, 2])
    expect(hasKeyword(named(state, 'Enemy Bear'), 'trample', state)).toBe(false)
  })

  test('the commander leaving, then returning, toggles the pump without drift', () => {
    const { run, start } = commanderGame()
    const arrived = run(start, move(start, 'Our General', 'battlefield'))
    const left = run(arrived, move(arrived, 'Our General', 'exile'))
    expect(named(left, 'Our General').zone).toBe('command')
    expect(stats(left, 'Lieutenant Beast')).toEqual([4, 4])
    expect(stats(left, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(left, 'Ally Bear'), 'trample', left)).toBe(false)
    expect(named(left, 'Ally Bear').continuousEffects).toBeUndefined()
    const again = run(left, move(left, 'Our General', 'battlefield'))
    expect(stats(again, 'Lieutenant Beast')).toEqual([6, 6])
    expect(stats(again, 'Ally Bear')).toEqual([4, 4])
  })

  test("another player's commander does not satisfy the condition", () => {
    const { run, start } = commanderGame()
    const state = run(start, move(start, 'Their General', 'battlefield'))
    expect(stats(state, 'Lieutenant Beast')).toEqual([4, 4])
    expect(stats(state, 'Ally Bear')).toEqual([2, 2])
  })

  test('the source leaving removes the pump and the keyword', () => {
    const { run, start } = commanderGame()
    const arrived = run(start, move(start, 'Our General', 'battlefield'))
    const gone = run(arrived, move(arrived, 'Lieutenant Beast', 'exile'))
    expect(stats(gone, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(gone, 'Ally Bear'), 'trample', gone)).toBe(false)
  })
})

const archetype = () => cardTemplate('Hexproof Boar', {
  types: ['Creature'],
  power: 4,
  toughness: 4,
  effects: [
    staticBoardPump(0, 0, ['Creature'], { grantKeywords: ['hexproof'] }),
    staticBoardPump(0, 0, ['Creature'], {
      controller: 'opponent',
      suppressKeywords: ['hexproof'],
    }),
  ],
})

const probe = (name: string) => cardTemplate(name, {
  types: ['Instant'],
  effects: [targetOnResolve('select', { zone: 'battlefield', type: 'Creature' })],
})

describe('static hexproof layer', () => {
  const hexproofGame = () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [probe('Probe One')], p2: [probe('Probe Two')] },
        battlefield: {
          p1: [archetype(), cardTemplate('Ally Bear', { types: ['Creature'] })],
          p2: [
            cardTemplate('Shrouded Elf', { types: ['Creature'], oracleText: 'Hexproof' }),
            cardTemplate('Enemy Bear', { types: ['Creature'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const state = ok(server.rules(server.state, { type: 'custom', name: 'staticBoardPump.sync' }))
    const casts = (from: 'p1' | 'p2', probeName: string, target: string, at = state) => server.rules(
      { ...at, priority: from },
      {
        type: 'castSpell',
        seat: from,
        objectId: named(at, probeName).id,
        targets: [{ kind: 'object', objectId: named(at, target).id }],
      },
    ).ok
    return { server, state, casts }
  }

  test('your creatures have hexproof and opposing creatures lose a printed hexproof', () => {
    const { state } = hexproofGame()
    expect(hasKeyword(named(state, 'Ally Bear'), 'hexproof', state)).toBe(true)
    expect(hasKeyword(named(state, 'Hexproof Boar'), 'hexproof', state)).toBe(true)
    expect(hasKeyword(named(state, 'Shrouded Elf'), 'hexproof', state)).toBe(false)
    expect(hasKeyword(named(state, 'Enemy Bear'), 'hexproof', state)).toBe(false)
  })

  test('targeting honors the granted and suppressed hexproof', () => {
    const { casts } = hexproofGame()
    expect(casts('p2', 'Probe Two', 'Ally Bear')).toBe(false)
    expect(casts('p2', 'Probe Two', 'Hexproof Boar')).toBe(false)
    expect(casts('p1', 'Probe One', 'Shrouded Elf')).toBe(true)
    expect(casts('p1', 'Probe One', 'Enemy Bear')).toBe(true)
    expect(casts('p1', 'Probe One', 'Ally Bear')).toBe(true)
  })

  test('removing the source restores printed hexproof and drops the granted hexproof', () => {
    const { server, state, casts } = hexproofGame()
    const after = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Hexproof Boar').id,
      to: 'graveyard',
    }))
    expect(hasKeyword(named(after, 'Shrouded Elf'), 'hexproof', after)).toBe(true)
    expect(hasKeyword(named(after, 'Ally Bear'), 'hexproof', after)).toBe(false)
    expect(casts('p1', 'Probe One', 'Shrouded Elf', after)).toBe(false)
    expect(casts('p2', 'Probe Two', 'Ally Bear', after)).toBe(true)
  })

  test('a creature arriving later is covered by the same layer', () => {
    const { server, state } = hexproofGame()
    const lateBear = (at: GameState) => named(at, 'Late Bear')
    const withHand = structuredClone(state)
    const late = createServerGame(
      commanderRules,
      { hands: { p1: [cardTemplate('Late Bear', { types: ['Creature'] })] } },
      { random: () => 0.5 },
    ).state
    const template = Object.values(late.objects)[0]
    withHand.objects.late = { ...template, id: 'late', zone: 'hand' }
    withHand.zoneOrder.p1.hand.push('late')
    withHand.zoneCounts.p1.hand += 1
    expect(hasKeyword(lateBear(withHand), 'hexproof', withHand)).toBe(false)
    const entered = ok(server.rules(withHand, { type: 'move', objectId: 'late', to: 'battlefield' }))
    expect(hasKeyword(lateBear(entered), 'hexproof', entered)).toBe(true)
  })
})
