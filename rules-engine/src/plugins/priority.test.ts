import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { freezeDraft, makeDraft } from '../draft'
import { rules } from '../kernel'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { initiateDiscard } from '../rules/discard'
import { bears, bolt, newGame } from '../testGame'
import type { GameState, ReduceResult, StackItem } from '../types'
import { discard } from '../rules/discard'
import { priority } from './priority'
import { spells } from './spells'
import { turnStructure } from './turnStructure'

const catalog = createCatalog([turnStructure, priority, spells, discard])

const builtinRules = ['turnStructure', 'priority', 'spells']

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const pass = (state: GameState) => {
  const seat = state.priority
  if (!seat) throw new Error('nobody has priority')
  return ok(rules(state, { type: 'passPriority', seat }, catalog))
}

const passRound = (state: GameState, count: number) => {
  let current = state
  for (let i = 0; i < count; i += 1) current = pass(current)
  return current
}

const stackItem = (objectId: string, name: string): StackItem => ({
  id: 's1',
  kind: 'spell',
  objectId,
  controller: 'p1',
  name,
  targets: [],
})

const idOf = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!.id

describe('priority', () => {
  test('passing without priority is illegal', () => {
    const state = newGame({ builtinRules })
    const result = rules(state, { type: 'passPriority', seat: 'p2' }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('priority')
  })

  test('a player who has lost cannot pass', () => {
    const base = newGame({ builtinRules })
    const state: GameState = {
      ...base,
      priority: 'p2',
      players: { ...base.players, p2: { ...base.players.p2, lost: true } },
    }
    const result = rules(state, { type: 'passPriority', seat: 'p2' }, catalog)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('lost')
  })

  test('priority moves clockwise and records the pass', () => {
    const state = pass(newGame({ builtinRules }))

    expect(state.priority).toBe('p2')
    expect(state.passedInRow).toEqual(['p1'])
    expect(state.step).toBe('precombatMain')
  })

  test('priority skips players who have lost', () => {
    const base = newGame({ builtinRules })
    const state: GameState = {
      ...base,
      players: { ...base.players, p2: { ...base.players.p2, lost: true } },
    }

    expect(pass(state).priority).toBe('p3')
  })

  test('a full pass round on an empty stack advances the step', () => {
    const state = passRound(newGame({ builtinRules }), 4)

    expect(state.step).toBe('beginCombat')
    expect(state.priority).toBe('p1')
    expect(state.passedInRow).toEqual([])
    expect(state.turn).toBe(1)
  })

  test('a pass round with a dead player only needs the living seats', () => {
    const base = newGame({ builtinRules })
    const state: GameState = {
      ...base,
      players: { ...base.players, p3: { ...base.players.p3, lost: true } },
    }

    expect(passRound(state, 3).step).toBe('beginCombat')
  })

  test('a full pass round resolves the top spell instead of advancing', () => {
    const base = newGame({ builtinRules, hands: { p1: [bears()] } })
    const creature = idOf(base, 'Grizzly Bears')
    base.objects[creature].zone = 'stack'
    const state: GameState = { ...base, stack: [stackItem(creature, 'Grizzly Bears')] }

    const next = passRound(state, 4)
    expect(next.stack).toEqual([])
    expect(next.objects[creature].zone).toBe('battlefield')
    expect(next.objects[creature].summoningSickness).toBe(true)
    expect(next.step).toBe('precombatMain')
    expect(next.priority).toBe('p1')
    expect(next.passedInRow).toEqual([])
  })

  test('a resolved instant goes to the graveyard', () => {
    const base = newGame({ builtinRules, hands: { p1: [bolt()] } })
    const spell = idOf(base, 'Lightning Bolt')
    base.objects[spell].zone = 'stack'
    const state: GameState = { ...base, stack: [stackItem(spell, 'Lightning Bolt')] }

    expect(passRound(state, 4).objects[spell].zone).toBe('graveyard')
  })

  test('three full pass rounds reach the untap step of the next player', () => {
    const base = newGame({ builtinRules, libraries: { p2: [bears()] } })
    let state: GameState = { ...base, step: 'end' }
    state = passRound(state, 4)
    expect(state.step).toBe('cleanup')

    state = passRound(state, 4)
    expect(state.step).toBe('untap')
    expect(state.active).toBe('p2')
    expect(state.turn).toBe(2)
    expect(state.priority).toBe('p2')
  })

  test('all-pass while a discard action is waiting does not resolve or loop', () => {
    const card = (name: string) => cardTemplate(name, { types: ['Instant'] })
    const server = createServerGame(commanderRules, {
      hands: { p2: [card('Waiting')] },
      players: 4,
    })
    const draft = makeDraft(server.state)
    initiateDiscard(draft, { seat: 'p2', count: 1 })
    let current = freezeDraft(draft)
    current = ok(rules(current, { type: 'resolveTop' }, catalog))
    const stackId = current.stack[0].id

    expect(current.stack[0].waiting).toBe('choice')

    for (let round = 0; round < 3; round += 1) {
      current = passRound(current)
    }

    expect(current.stack).toHaveLength(1)
    expect(current.stack[0].id).toBe(stackId)
    expect(current.stack[0].waiting).toBe('choice')
    expect(current.priority).toBe('p2')
  })

  test('a cleanup pass round cannot carry eight cards into the next turn', () => {
    const hand = Array.from(
      { length: 8 },
      (_, index) => ({ ...bears(), name: `Card ${index}` }),
    )
    const base = newGame({ builtinRules, hands: { p1: hand } })
    let state: GameState = { ...base, step: 'cleanup' }
    state = passRound(state, 3)
    const result = rules(
      state,
      { type: 'passPriority', seat: state.priority! },
      catalog,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('must discard 1')
    expect(result.state.step).toBe('cleanup')
    expect(result.state.active).toBe('p1')
  })
})
