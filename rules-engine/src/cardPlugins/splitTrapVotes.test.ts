import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, PlayerId, ReduceResult } from '../types'
import { snapshotFor } from '../cards/snapshot'
import { destroy, objects, select, spell, target } from './dsl/v1'
import { onResolve } from './onResolve'
import { stackCopyPending } from './stackCopy'
import { targetedResolve } from './targetedResolve'
import { pendingVote, vote } from './vote'

/*
 * Split Decision: Will of the council — Choose target instant or sorcery spell.
 * Starting with you, each player votes for denial or duplication. If denial gets
 * more votes, counter the spell. If duplication gets more votes or the vote is
 * tied, copy the spell. You may choose new targets for the copy.
 *
 * Trap the Trespassers: Secret council — Each player secretly votes for a
 * creature you don't control, then those votes are revealed. For each creature
 * with one or more votes, put that many stun counters on it, then tap it.
 */

type Server = ReturnType<typeof createServerGame>

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const bear = (name: string) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2 })

const server = (options: Parameters<typeof createServerGame>[1]): Server =>
  createServerGame(
    commanderRules,
    { players: 4, ...options },
    { random: () => 0.5, cardPlugins: [onResolve, targetedResolve, vote] },
  )

const split = () =>
  cardTemplate('Split Decision', { types: ['Instant'], manaCost: '{1}{U}', manaValue: 2 })

const smite = () => cardTemplate('Smite', {
  types: ['Instant'],
  manaCost: '{R}',
  manaValue: 1,
  ruleDefinition: snapshotFor([
    spell({
      decisions: {
        targets: [select({
          filter: objects({ zone: 'battlefield', type: 'Creature' }),
          count: 1,
        })],
      },
      instructions: [destroy({ targets: target(0) })],
    }),
  ]),
})

const withMana = (state: GameState, seats: PlayerId[]) => {
  const ready = structuredClone(state)
  for (const seat of seats) ready.players[seat].mana = { W: 0, U: 3, B: 0, R: 3, G: 0, C: 3 }
  return ready
}

const answer = (game: Server, state: GameState, seat: PlayerId, optionId: string): ReduceResult =>
  game.rules(state, {
    type: 'selectOption',
    seat,
    selectionId: pendingOptionSelection(state, seat)?.id ?? 'none',
    optionId,
  })

type Votes = Array<[PlayerId, string]>

const castVotes = (game: Server, state: GameState, votes: Votes) => {
  let current = state
  for (const [seat, optionId] of votes) current = ok(answer(game, current, seat, optionId))
  return current
}

type Ballot = Record<PlayerId, 'denial' | 'duplication'>
const ballot = (votes: Ballot): Votes =>
  ['p1', 'p2', 'p3', 'p4'].map((seat) => [seat, votes[seat]])

const DENY: Ballot = { p1: 'denial', p2: 'duplication', p3: 'denial', p4: 'denial' }
const TIE: Ballot = { p1: 'denial', p2: 'denial', p3: 'duplication', p4: 'duplication' }
const COPY: Ballot = { p1: 'duplication', p2: 'duplication', p3: 'duplication', p4: 'denial' }

/** p2 smites the Bear; p1 answers with Split Decision and it resolves into the open vote. */
const splitVote = () => {
  const game = server({
    hands: { p1: [split()], p2: [smite()] },
    battlefield: { p3: [bear('Bear'), bear('Boar')] },
  })
  let state = withMana(game.state, ['p1', 'p2'])
  state.step = 'precombatMain'
  state.active = 'p2'
  state.priority = 'p2'
  state = ok(game.rules(state, {
    type: 'castSpell',
    seat: 'p2',
    objectId: named(state, 'Smite').id,
    targets: [{ kind: 'object', objectId: named(state, 'Bear').id }],
  }))
  state.priority = 'p1'
  state = ok(game.rules(state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, 'Split Decision').id,
    targets: [{ kind: 'stackItem', stackId: state.stack[0].id }],
  }))
  return { game, state: ok(game.rules(state, { type: 'resolveTop' })) }
}

describe('Split Decision', () => {
  test('only an instant or sorcery spell is a legal target', () => {
    const game = server({
      hands: {
        p1: [split()],
        p3: [cardTemplate('Grizzly', { types: ['Creature'], manaCost: '{R}', manaValue: 1 })],
      },
      battlefield: { p3: [bear('Bear')] },
    })
    let state = withMana(game.state, ['p1', 'p3'])
    state.step = 'precombatMain'
    state.active = 'p3'
    state.priority = 'p3'
    state = ok(game.rules(state, {
      type: 'castSpell',
      seat: 'p3',
      objectId: named(state, 'Grizzly').id,
    }))
    state.priority = 'p1'
    const castSplit = (targets: GameState['stack'][number]['targets']) => game.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Split Decision').id,
      targets,
    })
    // A permanent on the battlefield, a creature spell, and the spell itself are all illegal.
    expect(castSplit([{ kind: 'object', objectId: named(state, 'Bear').id }]).ok).toBe(false)
    expect(castSplit([{ kind: 'stackItem', stackId: state.stack[0].id }]).ok).toBe(false)
    expect(castSplit([{ kind: 'object', objectId: named(state, 'Split Decision').id }]).ok).toBe(false)
  })

  test('the vote starts with the caster, and every ballot is public', () => {
    const { game, state } = splitVote()
    expect(pendingVote(state)).toMatchObject({
      owner: 'p1',
      secret: false,
      voters: ['p1', 'p2', 'p3', 'p4'],
      options: [{ id: 'denial' }, { id: 'duplication' }],
    })
    expect(pendingOptionSelection(state, 'p1')).toBeDefined()
    expect(pendingOptionSelection(state, 'p2')).toBeUndefined()
    // Out-of-turn, invalid, and priority-passing answers are rejected.
    expect(answer(game, state, 'p2', 'denial').ok).toBe(false)
    expect(answer(game, state, 'p1', 'maybe').ok).toBe(false)
    expect(game.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const afterTwo = castVotes(game, state, [['p1', 'denial'], ['p2', 'duplication']])
    const open = { p1: 'denial', p2: 'duplication' }
    expect(pendingVote(projectForViewer(afterTwo, 'p4'))?.votes).toEqual(open)
    expect(pendingVote(projectForViewer(afterTwo, null))?.votes).toEqual(open)
    // Only the voter in turn holds the open question.
    expect(pendingOptionSelection(projectForViewer(afterTwo, 'p4'), 'p3')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(afterTwo, 'p3'), 'p3')).toBeDefined()
  })

  test('denial with more votes counters the targeted spell, which never resolves', () => {
    const { game, state } = splitVote()
    const done = castVotes(game, state, ballot(DENY))
    expect(pendingVote(done)).toBeUndefined()
    expect(done.stack).toHaveLength(0)
    expect(named(done, 'Smite').zone).toBe('graveyard')
    expect(named(done, 'Bear').zone).toBe('battlefield')
    expect(named(done, 'Split Decision').zone).toBe('graveyard')
    expect(stackCopyPending(done)).toBeUndefined()
  })

  test('a tie copies the spell, and only the caster may choose new targets for the copy', () => {
    const { game, state } = splitVote()
    const done = castVotes(game, state, ballot(TIE))
    const offer = pendingOptionSelection(done, 'p1')!
    expect(offer.options.map((option) => option.id)).toEqual(['keep', 'retarget'])
    expect(pendingOptionSelection(done, 'p2')).toBeUndefined()
    expect(answer(game, done, 'p2', 'keep').ok).toBe(false)
    expect(game.rules(done, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    let next = ok(answer(game, done, 'p1', 'retarget'))
    const pick = pendingSelectionFor(next, 'p1')!
    expect(pick.candidates.map((id) => next.objects[id].name).toSorted()).toEqual(['Bear', 'Boar'])
    expect(game.rules(next, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 1,
      objectIds: [named(next, 'Split Decision').id],
    }).ok).toBe(false)

    next = ok(game.rules(next, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 1,
      objectIds: [named(next, 'Boar').id],
    }))
    expect(stackCopyPending(next)).toBeUndefined()
    expect(next.stack.map((item) => [item.name, item.copy ?? false, item.controller])).toEqual([
      ['Smite', true, 'p1'],
      ['Smite', false, 'p2'],
    ])
    next = resolveStack(game.rules, next)
    expect(named(next, 'Boar').zone).toBe('graveyard')
    expect(named(next, 'Bear').zone).toBe('graveyard')
    expect(next.stack).toHaveLength(0)
  })

  test('duplication with more votes copies the spell, and the copy may keep its targets', () => {
    const { game, state } = splitVote()
    const done = castVotes(game, state, ballot(COPY))
    const next = ok(answer(game, done, 'p1', 'keep'))
    expect(next.stack[0]).toMatchObject({
      copy: true,
      controller: 'p1',
      targets: [{ kind: 'object', objectId: named(next, 'Bear').id }],
    })
    const resolved = resolveStack(game.rules, next)
    expect(named(resolved, 'Bear').zone).toBe('graveyard')
    expect(named(resolved, 'Boar').zone).toBe('battlefield')
  })

  test('a targeted spell that left the stack during the vote is neither countered nor copied', () => {
    for (const votes of [DENY, TIE]) {
      const { game, state } = splitVote()
      const gone = structuredClone(state)
      gone.stack = gone.stack.filter((item) => item.name !== 'Smite')
      gone.objects[named(gone, 'Smite').id].zone = 'exile'
      const done = castVotes(game, gone, ballot(votes))
      expect(named(done, 'Smite').zone).toBe('exile')
      expect(done.stack).toHaveLength(0)
      expect(stackCopyPending(done)).toBeUndefined()
    }
  })

  test('an open vote and an open copy choice both survive a host restart', () => {
    const { game, state } = splitVote()
    const midway = castVotes(game, state, [['p1', 'duplication'], ['p2', 'denial']])
    const reloaded = structuredClone(midway)
    expect(pendingVote(reloaded)?.votes).toEqual({ p1: 'duplication', p2: 'denial' })
    expect(pendingOptionSelection(reloaded, 'p3')).toBeDefined()

    const done = castVotes(server({}), reloaded, [['p3', 'denial'], ['p4', 'duplication']])
    expect(pendingOptionSelection(done, 'p1')?.options.map((option) => option.id))
      .toEqual(['keep', 'retarget'])
    const afterRestart = structuredClone(done)
    let next = ok(server({}).rules(afterRestart, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pendingOptionSelection(afterRestart, 'p1')!.id,
      optionId: 'retarget',
    }))
    const pick = pendingSelectionFor(next, 'p1')!
    next = ok(server({}).rules(next, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 1,
      objectIds: [named(next, 'Boar').id],
    }))
    expect(next.stack[0]).toMatchObject({ copy: true })
    expect(stackCopyPending(next)).toBeUndefined()
  })
})
