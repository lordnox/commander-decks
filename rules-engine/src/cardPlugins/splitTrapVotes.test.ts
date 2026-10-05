import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, PlayerId, ReduceResult } from '../types'
import { cardDefinition, handlerIdsForNames } from './cardRules'
import { targetOnResolve } from './effectBuilders'
import { onResolve } from './onResolve'
import { stackCopy, stackCopyPending, stackCopyTargetCandidates } from './stackCopy'
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
    { random: () => 0.5, cardPlugins: [onResolve, targetedResolve, vote, stackCopy] },
  )

const split = () =>
  cardTemplate('Split Decision', { types: ['Instant'], manaCost: '{1}{U}', manaValue: 2 })
const trap = () =>
  cardTemplate('Trap the Trespassers', { types: ['Instant'], manaCost: '{2}{U}', manaValue: 3 })

const smite = () => cardTemplate('Smite', {
  types: ['Instant'],
  manaCost: '{R}',
  manaValue: 1,
  effects: [targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature' })],
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
    targets: [{ kind: 'object', objectId: named(state, 'Smite').id }],
  }))
  return { game, state: ok(game.rules(state, { type: 'resolveTop' })) }
}

describe('Split Decision', () => {
  test('is registered with targeting, vote and stack-copy handlers', () => {
    expect(handlerIdsForNames(['Split Decision'])).toEqual(
      expect.arrayContaining(['stackCopy', 'targetedResolve', 'vote']),
    )
  })

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
    const castSplit = (targetName: string) => game.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(state, 'Split Decision').id,
      targets: [{ kind: 'object', objectId: named(state, targetName).id }],
    })
    state.priority = 'p3'
    state = ok(game.rules(state, {
      type: 'castSpell',
      seat: 'p3',
      objectId: named(state, 'Grizzly').id,
    }))
    state.priority = 'p1'
    // A permanent on the battlefield, a creature spell, and the spell itself are all illegal.
    expect(castSplit('Bear').ok).toBe(false)
    expect(castSplit('Grizzly').ok).toBe(false)
    expect(castSplit('Split Decision').ok).toBe(false)
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
    const pending = stackCopyPending(done)!
    expect(pending).toMatchObject({ seat: 'p1' })
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
    expect(copy('p1', true, named(done, 'Split Decision').id).ok).toBe(false)
    expect(game.rules(done, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    let next = ok(copy('p1', true, named(done, 'Boar').id))
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
    const pending = stackCopyPending(done)!
    expect(pending).toMatchObject({ seat: 'p1' })
    const afterRestart = structuredClone(done)
    const next = ok(server({}).rules(afterRestart, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: pending.sourceId,
      stackId: pending.stackId,
      accept: true,
      targets: [{ kind: 'object', objectId: named(afterRestart, 'Boar').id }],
    }))
    expect(next.stack[0]).toMatchObject({ copy: true })
    expect(stackCopyPending(next)).toBeUndefined()
  })
})

describe('Trap the Trespassers', () => {
  const board = {
    battlefield: {
      p1: [bear('Ally')],
      p2: [bear('Bear')],
      p3: [bear('Boar')],
      p4: [bear('Elk')],
    },
  }

  const open = (battlefield: Record<PlayerId, ReturnType<typeof bear>[]> = board.battlefield) => {
    const game = server({ battlefield, hands: { p1: [trap()] } })
    const ready = withMana(game.state, ['p1'])
    ready.step = 'precombatMain'
    const cast = ok(game.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Trap the Trespassers').id,
    }))
    return { game, state: ok(game.rules(cast, { type: 'resolveTop' })) }
  }

  test('is registered as a vote resolved from the spell', () => {
    expect(handlerIdsForNames(['Trap the Trespassers'])).toEqual(
      expect.arrayContaining(['onResolve', 'vote']),
    )
    expect(cardDefinition('Trap the Trespassers')?.effects).toBeDefined()
  })

  test('the options are only creatures the caster does not control, voting starts with the caster', () => {
    const { game, state } = open()
    const pending = pendingVote(state)!
    expect(pending).toMatchObject({ owner: 'p1', secret: true, voters: ['p1', 'p2', 'p3', 'p4'] })
    expect(pending.options.map((option) => option.label).sort()).toEqual(['Bear', 'Boar', 'Elk'])
    expect(pending.options.some((option) => option.id === named(state, 'Ally').id)).toBe(false)
    expect(answer(game, state, 'p1', named(state, 'Ally').id).ok).toBe(false)
    expect(answer(game, state, 'p2', named(state, 'Bear').id).ok).toBe(false)
    expect(answer(game, state, 'p1', 'nonsense').ok).toBe(false)
  })

  test('each seat sees only its own vote until all votes are in', () => {
    const { game, state } = open()
    const [bearId, boarId] = ['Bear', 'Boar'].map((name) => named(state, name).id)
    const afterTwo = castVotes(game, state, [['p1', bearId], ['p2', boarId]])
    expect(pendingVote(projectForViewer(afterTwo, 'p1'))?.votes).toEqual({ p1: bearId, p2: '*' })
    expect(pendingVote(projectForViewer(afterTwo, 'p2'))?.votes).toEqual({ p1: '*', p2: boarId })
    expect(pendingVote(projectForViewer(afterTwo, 'p3'))?.votes).toEqual({ p1: '*', p2: '*' })
    expect(pendingVote(projectForViewer(afterTwo, null))?.votes).toEqual({ p1: '*', p2: '*' })
    expect(named(afterTwo, 'Bear').counters.stun).toBeUndefined()
    expect(named(afterTwo, 'Bear').tapped).toBe(false)
  })

  test('stun counters equal the votes, then the creature taps; unvoted creatures are untouched', () => {
    const { game, state } = open()
    const [bearId, boarId] = ['Bear', 'Boar'].map((name) => named(state, name).id)
    // The caster votes too, and every vote is for an opponent's creature.
    const done = castVotes(game, state, [
      ['p1', bearId], ['p2', bearId], ['p3', bearId], ['p4', boarId],
    ])
    expect(named(done, 'Bear')).toMatchObject({ counters: { stun: 3 }, tapped: true })
    expect(named(done, 'Boar')).toMatchObject({ counters: { stun: 1 }, tapped: true })
    expect(named(done, 'Elk')).toMatchObject({ counters: {}, tapped: false })
    expect(named(done, 'Ally')).toMatchObject({ counters: {}, tapped: false })
    expect(pendingVote(done)).toBeUndefined()
    expect(named(done, 'Trap the Trespassers').zone).toBe('graveyard')
    // The votes are revealed once they are all in.
    expect(done.log.some((line) => line.includes('p4 for Boar'))).toBe(true)
  })

  test('an already tapped creature still gains the counters, and votes may all differ', () => {
    const { game, state } = open()
    const [bearId, boarId, elkId] = ['Bear', 'Boar', 'Elk'].map((name) => named(state, name).id)
    const tapped = structuredClone(state)
    tapped.objects[bearId].tapped = true
    const done = castVotes(game, tapped, [
      ['p1', bearId], ['p2', boarId], ['p3', elkId], ['p4', bearId],
    ])
    expect(named(done, 'Bear')).toMatchObject({ counters: { stun: 2 }, tapped: true })
    expect(named(done, 'Boar')).toMatchObject({ counters: { stun: 1 }, tapped: true })
    expect(named(done, 'Elk')).toMatchObject({ counters: { stun: 1 }, tapped: true })
  })

  test('stun counters replace the next untaps one at a time', () => {
    const { game, state } = open()
    const bearId = named(state, 'Bear').id
    const stunned = castVotes(game, state, [
      ['p1', bearId], ['p2', bearId], ['p3', bearId], ['p4', bearId],
    ])
    expect(named(stunned, 'Bear').counters.stun).toBe(4)
    let next = stunned
    for (let remaining = 3; remaining >= 0; remaining -= 1) {
      next = ok(game.rules(next, { type: 'untap', objectId: bearId }))
      expect(named(next, 'Bear').tapped).toBe(true)
      expect(named(next, 'Bear').counters.stun ?? 0).toBe(remaining)
    }
    expect(named(ok(game.rules(next, { type: 'untap', objectId: bearId })), 'Bear').tapped)
      .toBe(false)
  })

  test('a voted creature that left the battlefield is skipped', () => {
    const { game, state } = open()
    const bearId = named(state, 'Bear').id
    const boarId = named(state, 'Boar').id
    const voted = castVotes(game, state, [['p1', bearId], ['p2', boarId], ['p3', bearId]])
    const gone = ok(game.rules(voted, { type: 'move', objectId: bearId, to: 'graveyard' }))
    const done = castVotes(game, gone, [['p4', boarId]])
    expect(named(done, 'Bear')).toMatchObject({ zone: 'graveyard', counters: {}, tapped: false })
    expect(named(done, 'Boar')).toMatchObject({ counters: { stun: 2 }, tapped: true })
  })

  test('with no creature the caster does not control there is nothing to vote on', () => {
    const { state } = open({ p1: [bear('Ally')] })
    expect(pendingVote(state)).toBeUndefined()
    for (const seat of ['p1', 'p2', 'p3', 'p4']) {
      expect(pendingOptionSelection(state, seat)).toBeUndefined()
    }
    expect(named(state, 'Ally')).toMatchObject({ counters: {}, tapped: false })
    expect(named(state, 'Trap the Trespassers').zone).toBe('graveyard')
    expect(state.stack).toHaveLength(0)
  })

  test('an open secret vote survives a host restart and keeps hiding votes', () => {
    const { game, state } = open()
    const bearId = named(state, 'Bear').id
    const midway = castVotes(game, state, [['p1', bearId]])
    const reloaded = structuredClone(midway)
    expect(pendingVote(reloaded)?.votes).toEqual({ p1: bearId })
    expect(pendingVote(projectForViewer(reloaded, 'p2'))?.votes).toEqual({ p1: '*' })
    const done = castVotes(server({}), reloaded, [['p2', bearId], ['p3', bearId], ['p4', bearId]])
    expect(named(done, 'Bear')).toMatchObject({ counters: { stun: 4 }, tapped: true })
  })
})
