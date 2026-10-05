import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingDialog } from '../pendingDialog'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionsFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, PlayerId, ReduceResult } from '../types'
import {
  addPlusCountersInstruction,
  createTreasures,
  draw,
  enters,
  exileVoteWinners,
  forEachVotedOption,
  forEachVoter,
  gainLife,
  ifVoteLeads,
  onVotesFinished,
  putPermanentsFromHand,
  revealUntil,
  scry,
  vote as voteInstruction,
} from './effectBuilders'
import type { CardInstruction, VoteOptions } from './effectDefinitions'
import { handlerIdsFromEffects } from './effectRuntime'
import { PENDING_VOTE, pendingVote, vote } from './vote'
import { CHOOSE_VOTES, secretCouncil } from './secretCouncil'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const server = (options: Parameters<typeof createServerGame>[1]) =>
  createServerGame(
    commanderRules,
    { players: 4, ...options },
    { random: () => 0.5, cardPlugins: [vote, secretCouncil] },
  )

const bear = (name: string) => cardTemplate(name, { types: ['Creature'] })
const card = (name: string, types: string[]) => cardTemplate(name, { types })

/** Hears every vote finish: Treasures for agreeing opponents, a scry for the others, one draw. */
const erestor = () => cardTemplate('Watcher', {
  types: ['Creature'],
  effects: [onVotesFinished(
    forEachVoter('opponentsAgreeing', createTreasures(1, 'triggeringPlayer')),
    scry({ voters: 'opponentsDisagreeing' }),
    draw(1),
  )],
})

const callers = (instruction: CardInstruction) => cardTemplate('Caller', {
  types: ['Creature'],
  effects: [enters(instruction)],
})

const NAMED: VoteOptions = {
  kind: 'named',
  options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
}

/** The seat holding the vote's creature in hand puts it onto the battlefield. */
const open = (
  instruction: CardInstruction,
  options: Parameters<typeof createServerGame>[1] = {},
  seat: PlayerId = 'p1',
  prepare: (state: GameState) => void = () => {},
) => {
  const game = server({ ...options, hands: { [seat]: [callers(instruction)], ...options.hands } })
  const before = structuredClone(game.state)
  prepare(before)
  const entered = resolveStack(game.rules, ok(game.rules(before, {
    type: 'move',
    objectId: named(before, 'Caller').id,
    to: 'battlefield',
  })))
  return { game, state: entered }
}

const answer = (
  game: ReturnType<typeof server>,
  state: GameState,
  seat: PlayerId,
  optionId: string,
): ReduceResult => game.rules(state, {
  type: 'selectOption',
  seat,
  selectionId: pendingOptionSelection(state, seat)?.id ?? 'none',
  optionId,
})

/** Cast every vote in order and return the final reduce, whose trace holds the event. */
const castAll = (
  game: ReturnType<typeof server>,
  state: GameState,
  votes: Array<[PlayerId, string]>,
) => {
  let result: ReduceResult | undefined
  let current = state
  for (const [seat, optionId] of votes) {
    result = answer(game, current, seat, optionId)
    current = ok(result)
  }
  return { state: current, result: result! }
}

const finished = (result: ReduceResult) => {
  const event = result.trace.map((entry) => entry.event)
    .find((candidate) => candidate.type === 'votesFinished')
  if (event?.type !== 'votesFinished') throw new Error('no votesFinished event')
  return event
}

describe('generic voting', () => {
  test('voters answer in turn order from the controller, and each answer is validated', () => {
    const sail = voteInstruction('Return or embark?', NAMED, [
      ifVoteLeads('a', [gainLife(10)], [gainLife(1)]),
    ])
    const { game, state } = open(sail, {}, 'p2')
    expect(pendingVote(state)?.voters).toEqual(['p2', 'p3', 'p4', 'p1'])
    expect(pendingOptionSelection(state, 'p2')?.action).toMatchObject({ kind: 'vote', voter: 'p2' })

    expect(answer(game, state, 'p3', 'a').ok).toBe(false)
    expect(answer(game, state, 'p2', 'c').ok).toBe(false)
    expect(game.rules(state, { type: 'passPriority', seat: 'p2' }).ok).toBe(false)
    expect(game.rules(state, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: 'stale',
      optionId: 'a',
    }).ok).toBe(false)

    const afterP2 = ok(answer(game, state, 'p2', 'a'))
    expect(pendingOptionSelection(afterP2, 'p2')).toBeUndefined()
    expect(pendingOptionSelection(afterP2, 'p3')).toBeDefined()
    expect(answer(game, afterP2, 'p2', 'a').ok).toBe(false)
  })

  test('the option with more votes wins and the outcome branches on it', () => {
    const sail = voteInstruction('Return or embark?', NAMED, [
      ifVoteLeads('a', [gainLife(10)], [gainLife(1)]),
    ])
    const { game, state } = open(sail, {}, 'p2')
    const done = castAll(game, state, [['p2', 'a'], ['p3', 'a'], ['p4', 'b'], ['p1', 'a']])
    expect(finished(done.result)).toMatchObject({
      sourceId: named(state, 'Caller').id,
      owner: 'p2',
      result: {
        votes: { p2: 'a', p3: 'a', p4: 'b', p1: 'a' },
        tallies: { a: 3, b: 1 },
        winners: ['a'],
        tied: false,
      },
    })
    expect(done.state.players.p2.life).toBe(50)
    expect(pendingVote(done.state)).toBeUndefined()
    expect(done.state.players.p2.data[PENDING_VOTE]).toBeUndefined()
    expect(done.state.priority).toBe(done.state.active)
  })

  test('a tie is explicit in the result and takes the false branch', () => {
    const sail = voteInstruction('Return or embark?', NAMED, [
      ifVoteLeads('a', [gainLife(10)], [gainLife(1)]),
    ])
    const { game, state } = open(sail, {}, 'p2')
    const done = castAll(game, state, [['p2', 'a'], ['p3', 'b'], ['p4', 'a'], ['p1', 'b']])
    expect(finished(done.result).result).toMatchObject({
      tallies: { a: 2, b: 2 },
      winners: ['a', 'b'],
      tied: true,
    })
    expect(done.state.players.p2.life).toBe(41)
  })

  test('a vote for a permanent matches the filter once, whoever votes, and tallies each permanent', () => {
    const filter = { zone: 'battlefield' as const, type: 'Creature', controller: 'opponent' as const }
    const trap = voteInstruction(
      'Vote for a creature you do not control.',
      { kind: 'objects', filter },
      [forEachVotedOption(gainLife('triggerAmount'), draw(1))],
    )
    const { game, state } = open(trap, {
      battlefield: {
        p1: [bear('Mine')],
        p2: [bear('Bear')],
        p3: [bear('Boar')],
        p4: [bear('Twin'), bear('Twin')],
      },
      libraries: { p1: [bear('Card 1'), bear('Card 2'), bear('Card 3'), bear('Card 4')] },
    })
    const options = pendingOptionSelection(state, 'p1')!.options
    expect(options.map((option) => option.label)).toEqual([
      'Bear',
      'Boar',
      expect.stringContaining('Twin ['),
      expect.stringContaining('Twin ['),
    ])
    expect(options.some((option) => option.id === named(state, 'Mine').id)).toBe(false)
    expect(answer(game, state, 'p1', named(state, 'Mine').id).ok).toBe(false)

    const bearId = named(state, 'Bear').id
    const boarId = named(state, 'Boar').id
    const [twinOne, twinTwo] = options.slice(2).map((option) => option.id)
    const done = castAll(game, state, [
      ['p1', bearId],
      ['p2', bearId],
      ['p3', boarId],
      ['p4', twinOne],
    ])
    expect(finished(done.result).result.tallies).toEqual({
      [bearId]: 2,
      [boarId]: 1,
      [twinOne]: 1,
      [twinTwo]: 0,
    })
    // One pass per voted-for permanent: three of them, four votes in all.
    expect(done.state.zoneOrder.p1.hand.length).toBe(3)
    expect(done.state.players.p1.life).toBe(44)
  })

  test("Council's Judgment style outcome exiles every tied winner", () => {
    const judgment = voteInstruction(
      'Vote for a nonland permanent you do not control.',
      {
        kind: 'objects',
        filter: { zone: 'battlefield', nonland: true, controller: 'opponent' },
      },
      [exileVoteWinners()],
    )
    const { game, state } = open(judgment, {
      battlefield: { p2: [bear('Left')], p3: [bear('Right')] },
    })
    const left = named(state, 'Left').id
    const right = named(state, 'Right').id
    const done = castAll(game, state, [
      ['p1', left], ['p2', right], ['p3', left], ['p4', right],
    ])
    expect(finished(done.result).result.tied).toBe(true)
    expect(named(done.state, 'Left').zone).toBe('exile')
    expect(named(done.state, 'Right').zone).toBe('exile')
  })

  test('a vote with nothing to vote for finishes at once with empty tallies', () => {
    const empty = voteInstruction(
      'Vote for a creature.',
      { kind: 'objects', filter: { zone: 'battlefield', type: 'Planeswalker' } },
      [gainLife(3)],
    )
    const { state } = open(empty)
    expect(pendingVote(state)).toBeUndefined()
    expect(state.players.p1.life).toBe(43)
  })

  test('players can be the options', () => {
    const council = voteInstruction('Vote for a player.', { kind: 'players' }, [
      forEachVotedOption(gainLife('triggerAmount')),
    ])
    const { game, state } = open(council)
    expect(pendingOptionSelection(state, 'p1')!.options.map((option) => option.id))
      .toEqual(['p1', 'p2', 'p3', 'p4'])
    const done = castAll(game, state, [
      ['p1', 'p2'], ['p2', 'p2'], ['p3', 'p1'], ['p4', 'p2'],
    ])
    expect(finished(done.result).result.tallies).toEqual({ p1: 1, p2: 3, p3: 0, p4: 0 })
  })

  test('a conceding voter drops out and the vote carries on without them', () => {
    const sail = voteInstruction('Return or embark?', NAMED, [
      ifVoteLeads('a', [gainLife(10)], [gainLife(1)]),
    ])
    const { game, state } = open(sail)
    const afterP1 = ok(answer(game, state, 'p1', 'a'))
    const conceded = ok(game.rules(afterP1, { type: 'concede', seat: 'p2' }))
    expect(pendingOptionSelection(conceded, 'p2')).toBeUndefined()
    expect(pendingVote(conceded)?.voters).toEqual(['p1', 'p3', 'p4'])
    expect(pendingOptionSelection(conceded, 'p3')).toBeDefined()
    const done = castAll(game, conceded, [['p3', 'a'], ['p4', 'b']])
    expect(finished(done.result).result.tallies).toEqual({ a: 2, b: 1 })
  })
})

describe('secret votes', () => {
  const secret = voteInstruction('Fellowship or aid?', NAMED, [gainLife(1)], true)

  test('no seat sees another seat vote until every vote is in', () => {
    const { game, state } = open(secret)
    const afterP1 = ok(answer(game, state, 'p1', 'a'))
    const afterP2 = ok(answer(game, afterP1, 'p2', 'b'))

    expect(pendingVote(afterP2)?.votes).toEqual({ p1: 'a', p2: 'b' })
    expect(pendingVote(projectForViewer(afterP2, 'p1'))?.votes).toEqual({ p1: 'a', p2: '*' })
    expect(pendingVote(projectForViewer(afterP2, 'p2'))?.votes).toEqual({ p1: '*', p2: 'b' })
    expect(pendingVote(projectForViewer(afterP2, 'p3'))?.votes).toEqual({ p1: '*', p2: '*' })
    expect(pendingVote(projectForViewer(afterP2, null))?.votes).toEqual({ p1: '*', p2: '*' })
    // Only the voter in turn keeps the open question.
    expect(pendingOptionSelection(projectForViewer(afterP2, 'p4'), 'p3')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(afterP2, 'p3'), 'p3')).toBeDefined()
  })

  test('the revealed votes reach the event and the public log, then the marker is gone', () => {
    const { game, state } = open(secret)
    const done = castAll(game, state, [['p1', 'a'], ['p2', 'b'], ['p3', 'b'], ['p4', 'a']])
    expect(finished(done.result).result.votes).toEqual({ p1: 'a', p2: 'b', p3: 'b', p4: 'a' })
    expect(done.state.log.some((line) => line.includes('p2 for Beta'))).toBe(true)
    expect(pendingVote(projectForViewer(done.state, 'p3'))).toBeUndefined()
  })

  test('a chooser casts every vote and sees them, other seats see only their own', () => {
    const { game, state } = open(secret, {}, 'p2', (before) => {
      before.players.p3.data[CHOOSE_VOTES] = true
    })
    expect(pendingVote(state)?.chooser).toBe('p3')
    expect(pendingOptionSelection(state, 'p3')?.action).toMatchObject({ voter: 'p2' })
    expect(pendingOptionSelection(state, 'p3')?.prompt).toContain('Vote for p2')
    expect(pendingOptionSelection(state, 'p2')).toBeUndefined()

    const afterOne = ok(answer(game, state, 'p3', 'a'))
    expect(pendingOptionSelection(afterOne, 'p3')?.action).toMatchObject({ voter: 'p3' })
    expect(pendingVote(projectForViewer(afterOne, 'p3'))?.votes).toEqual({ p2: 'a' })
    expect(pendingVote(projectForViewer(afterOne, 'p1'))?.votes).toEqual({ p2: '*' })
    // The voter whose vote was cast for them still knows their own vote.
    expect(pendingVote(projectForViewer(afterOne, 'p2'))?.votes).toEqual({ p2: 'a' })
  })
})

describe('vote results', () => {
  test('counts read from the vote parameterize later instructions', () => {
    const stampede = voteInstruction('Wild or free?', {
      kind: 'named',
      options: [{ id: 'wild', label: 'Wild' }, { id: 'free', label: 'Free' }],
    }, [
      revealUntil({ voters: { votedFor: 'wild' } }, { type: 'Creature' }, 'battlefield', 'shuffle'),
      putPermanentsFromHand({ voters: { votedFor: 'free' } }),
    ])
    const library = [
      card('Plains', ['Land']),
      card('First', ['Creature']),
      card('Island', ['Land']),
      card('Second', ['Creature']),
      card('Third', ['Creature']),
    ]
    const { game, state } = open(stampede, { libraries: { p1: library } })
    const done = castAll(game, state, [
      ['p1', 'wild'], ['p2', 'wild'], ['p3', 'free'], ['p4', 'free'],
    ])
    const onBattlefield = (name: string) => named(done.state, name).zone === 'battlefield'
    expect(onBattlefield('First')).toBe(true)
    expect(onBattlefield('Second')).toBe(true)
    expect(onBattlefield('Third')).toBe(false)
    expect(pendingDialog(done.state)).toMatchObject({
      kind: 'put-permanents',
      seat: 'p1',
      requirements: { battlefield: { max: 2 } },
    })

    const allWild = castAll(game, state, [
      ['p1', 'wild'], ['p2', 'wild'], ['p3', 'wild'], ['p4', 'wild'],
    ])
    expect(pendingDialog(allWild.state)).toBeUndefined()
    const none = castAll(game, state, [
      ['p1', 'free'], ['p2', 'free'], ['p3', 'free'], ['p4', 'free'],
    ])
    expect(Object.values(none.state.objects)
      .filter((object) => object.zone === 'battlefield' && object.types.includes('Creature'))
      .map((object) => object.name)).toEqual(['Caller'])
  })

  test('a vote count can size a counter instruction', () => {
    const pumped = voteInstruction('Fellowship or aid?', NAMED, [
      addPlusCountersInstruction({ voters: { votedFor: 'b' } }),
    ])
    const { game, state } = open(pumped)
    const done = castAll(game, state, [['p1', 'b'], ['p2', 'a'], ['p3', 'b'], ['p4', 'b']])
    expect(named(done.state, 'Caller').counters['+1/+1']).toBe(3)
  })

  test('any vote, even by another seat, triggers permanents that hear votes finish', () => {
    const council = voteInstruction('Fellowship or aid?', NAMED, [], true)
    const { game, state } = open(council, {
      players: 4,
      battlefield: { p1: [erestor()] },
      libraries: { p1: ['One', 'Two', 'Three'].map((name) => cardTemplate(name)) },
    }, 'p3')
    const done = castAll(game, state, [
      ['p3', 'a'], ['p4', 'b'], ['p1', 'a'], ['p2', 'a'],
    ])
    expect(done.state.stack).toHaveLength(1)
    expect(done.state.stack[0]).toMatchObject({
      name: 'Watcher',
      controller: 'p1',
      payload: { vote: { tallies: { a: 3, b: 1 } } },
    })

    const resolved = ok(game.rules(done.state, { type: 'resolveTop' }))
    const treasures = (seat: PlayerId) => Object.values(resolved.objects)
      .filter((object) => object.name === 'Treasure' && object.controller === seat)
    expect(treasures('p3')).toHaveLength(1)
    expect(treasures('p2')).toHaveLength(1)
    expect(treasures('p4')).toHaveLength(0)
    expect(treasures('p1')).toHaveLength(0)
    // One opponent voted against p1, so the scry is for one card.
    expect(pendingSelectionsFor(resolved, 'p1')[0]).toMatchObject({ kind: 'scry', count: 1 })
  })

  test('nobody agreeing and everybody disagreeing reduces to the opposite counts', () => {
    const council = voteInstruction('Fellowship or aid?', NAMED, [])
    const { game, state } = open(council, {
      battlefield: { p1: [erestor()] },
      libraries: { p1: ['One', 'Two', 'Three'].map((name) => cardTemplate(name)) },
    })
    const done = castAll(game, state, [
      ['p1', 'a'], ['p2', 'b'], ['p3', 'b'], ['p4', 'b'],
    ])
    const resolved = ok(game.rules(done.state, { type: 'resolveTop' }))
    expect(Object.values(resolved.objects).filter((object) => object.name === 'Treasure'))
      .toHaveLength(0)
    expect(pendingSelectionsFor(resolved, 'p1')[0]).toMatchObject({ kind: 'scry', count: 3 })
  })
})

describe('open votes survive a host restart', () => {
  test('the question, voters, and hidden votes come back and the vote completes', () => {
    const secret = voteInstruction('Fellowship or aid?', NAMED, [gainLife(5)], true)
    const { game, state } = open(secret)
    const midway = ok(answer(game, state, 'p1', 'a'))

    const restored = server({})
    const reloaded = structuredClone(midway)
    expect(pendingVote(reloaded)?.votes).toEqual({ p1: 'a' })
    expect(pendingOptionSelection(reloaded, 'p2')).toBeDefined()
    expect(pendingVote(projectForViewer(reloaded, 'p2'))?.votes).toEqual({ p1: '*' })

    const done = castAll(restored, reloaded, [['p2', 'b'], ['p3', 'a'], ['p4', 'a']])
    expect(finished(done.result).result.tallies).toEqual({ a: 3, b: 1 })
    expect(done.state.players.p1.life).toBe(45)
  })
})

describe('vote handler ids', () => {
  test('nested vote instructions are found wherever the vote hides', () => {
    const effects = [onVotesFinished(forEachVoter('all', createTreasures(1, 'triggeringPlayer')))]
    expect(handlerIdsFromEffects(effects)).not.toContain('vote')
    expect(handlerIdsFromEffects([
      enters(ifVoteLeads('a', [voteInstruction('Again?', NAMED, [])])),
    ])).toContain('vote')
  })
})
