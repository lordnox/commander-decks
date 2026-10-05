import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameState, PlayerId } from '../types'
import {
  copyTargetSpell,
  counterTargetSpell,
  ifVoteLeads,
  targetOnResolve,
  vote as voteInstruction,
} from './effectBuilders'
import { handlerIdsFromEffects } from './effectRuntime'
import { stackCopy, stackCopyPending, stackCopyTargetCandidates } from './stackCopy'
import { targetedResolve } from './targetedResolve'
import { pendingVote, vote } from './vote'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const OPTIONS = {
  kind: 'named' as const,
  options: [{ id: 'denial', label: 'Denial' }, { id: 'duplication', label: 'Duplication' }],
}

/** Denial counters the targeted spell; duplication or a tie copies it. */
const splitEffect = targetOnResolve(
  'select',
  { zone: 'stack', types: ['Instant', 'Sorcery'] },
  voteInstruction('Denial or duplication?', OPTIONS, [
    ifVoteLeads('denial', [counterTargetSpell(true)], [copyTargetSpell()]),
  ]),
)

const server = () => createServerGame(
  commanderRules,
  {
    players: 4,
    hands: {
      p1: [cardTemplate('Split', { types: ['Instant'], manaCost: '{1}{U}', effects: [splitEffect] })],
      p2: [cardTemplate('Smite', {
        types: ['Instant'],
        manaCost: '{R}',
        effects: [targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' })],
      })],
    },
    battlefield: {
      p3: [
        cardTemplate('Bear', { types: ['Creature'] }),
        cardTemplate('Boar', { types: ['Creature'] }),
      ],
    },
  },
  { random: () => 0.5, cardPlugins: [targetedResolve, vote, stackCopy] },
)

/** p2 smites the Bear, p1 answers with Split and it resolves into the open vote. */
const voting = () => {
  const game = server()
  let state = structuredClone(game.state)
  state.step = 'precombatMain'
  for (const seat of ['p1', 'p2']) state.players[seat].mana = { W: 0, U: 2, B: 0, R: 2, G: 0, C: 2 }
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
    objectId: named(state, 'Split').id,
    targets: [{ kind: 'object', objectId: named(state, 'Smite').id }],
  }))
  state = ok(game.rules(state, { type: 'resolveTop' }))
  return { game, state }
}

type Ballot = Record<PlayerId, 'denial' | 'duplication'>

const castVotes = (game: ReturnType<typeof server>, state: GameState, votes: Ballot) => {
  let current = state
  for (const seat of ['p1', 'p2', 'p3', 'p4']) {
    current = ok(game.rules(current, {
      type: 'selectOption',
      seat,
      selectionId: pendingOptionSelection(current, seat)!.id,
      optionId: votes[seat],
    }))
  }
  return current
}

const DENY: Ballot = { p1: 'denial', p2: 'denial', p3: 'duplication', p4: 'denial' }
const TIE: Ballot = { p1: 'denial', p2: 'denial', p3: 'duplication', p4: 'duplication' }
const COPY: Ballot = { p1: 'duplication', p2: 'duplication', p3: 'duplication', p4: 'denial' }

describe('acting on the spell a vote spell targeted', () => {
  test('denial with more votes counters the targeted spell, which never resolves', () => {
    const { game, state } = voting()
    expect(pendingVote(state)).toBeDefined()
    const done = castVotes(game, state, DENY)
    expect(done.stack).toHaveLength(0)
    expect(named(done, 'Smite').zone).toBe('graveyard')
    expect(named(done, 'Bear').zone).toBe('battlefield')
    expect(stackCopyPending(done)).toBeUndefined()
  })

  test('a spell that left the stack during the vote is not countered or copied', () => {
    for (const votes of [DENY, TIE]) {
      const { game, state } = voting()
      const gone = structuredClone(state)
      gone.stack = gone.stack.filter((item) => item.name !== 'Smite')
      gone.objects[named(gone, 'Smite').id].zone = 'exile'
      const done = castVotes(game, gone, votes)
      expect(named(done, 'Smite').zone).toBe('exile')
      expect(done.stack).toHaveLength(0)
      expect(stackCopyPending(done)).toBeUndefined()
    }
  })

  test('a tie copies the spell and only the controller may keep or change its targets', () => {
    const { game, state } = voting()
    const done = castVotes(game, state, TIE)
    const pending = stackCopyPending(done)!
    expect(pending).toMatchObject({ seat: 'p1', optional: false, cost: '{0}' })
    expect(done.priority).toBe('p1')
    expect(stackCopyTargetCandidates(done, pending).map((object) => object.name).sort())
      .toEqual(['Bear', 'Boar'])

    const copy = (seat: PlayerId, accept: boolean, objectId?: string) =>
      game.rules(done, {
        type: 'copyStackItem',
        seat,
        sourceId: pending.sourceId,
        stackId: pending.stackId,
        accept,
        ...(objectId ? { targets: [{ kind: 'object' as const, objectId }] } : {}),
      })
    expect(copy('p2', true).ok).toBe(false)
    expect(copy('p1', false).ok).toBe(false)
    expect(copy('p1', true, named(done, 'Split').id).ok).toBe(false)
    expect(game.rules(done, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    let next = ok(copy('p1', true, named(done, 'Boar').id))
    expect(stackCopyPending(next)).toBeUndefined()
    expect(next.stack.map((item) => [item.name, item.copy ?? false, item.controller])).toEqual([
      ['Smite', true, 'p1'],
      ['Smite', false, 'p2'],
    ])
    next = ok(game.rules(next, { type: 'resolveTop' }))
    next = ok(game.rules(next, { type: 'resolveTop' }))
    expect(named(next, 'Boar').zone).toBe('graveyard')
    expect(named(next, 'Bear').zone).toBe('graveyard')
  })

  test('the copy may keep the original targets', () => {
    const { game, state } = voting()
    const done = castVotes(game, state, COPY)
    const pending = stackCopyPending(done)!
    const next = ok(game.rules(done, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
    }))
    expect(next.stack[0]).toMatchObject({
      copy: true,
      targets: [{ kind: 'object', objectId: named(next, 'Bear').id }],
    })
  })

  test('an open copy choice survives a host restart', () => {
    const { state } = voting()
    const done = castVotes(server(), state, TIE)
    const reloaded = structuredClone(done)
    const pending = stackCopyPending(reloaded)!
    expect(pending).toMatchObject({ seat: 'p1' })
    const next = ok(server().rules(reloaded, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
      targets: [{ kind: 'object', objectId: named(reloaded, 'Boar').id }],
    }))
    expect(next.stack[0]).toMatchObject({ copy: true })
    expect(stackCopyPending(next)).toBeUndefined()
  })

  test('copying the targeted spell loads the stack-copy handler', () => {
    expect(handlerIdsFromEffects([splitEffect])).toEqual(
      expect.arrayContaining(['targetedResolve', 'vote', 'stackCopy']),
    )
  })
})
