import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createJournal, restoreJournal } from '../../journal'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState, PlayerId } from '../../types'
import { pendingVote } from '../vote'
import { instructionSpell } from './instructionTestSupport'
import type { Instruction } from './schema/v1'
import {
  choice,
  compileCardRuleDefinition,
  card,
  destroy,
  draw,
  ifThen,
  move,
  objects,
  ref,
  spell,
  vote,
  voteLeads,
  voteTally,
  captureAmount,
  compareAmount,
  gainLife,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const creature = (name: string) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2 })

const server = (instructions: readonly Instruction[], extra: Parameters<typeof createServerGame>[1] = {}) =>
  createServerGame(commanderRules, {
    players: 4,
    hands: { p1: [instructionSpell({ instructions })] },
    ...extra,
  }, { random: () => 0.5 })

const begin = (game: ReturnType<typeof server>) => resolveStack(game.rules, ok(game.rules(game.state, {
  type: 'castSpell', seat: 'p1', objectId: named(game.state, 'Instruction fixture').id,
})))

const answer = (
  game: ReturnType<typeof server>,
  state: GameState,
  seat: PlayerId,
  optionId: string,
) => game.rules(state, {
  type: 'selectOption',
  seat,
  selectionId: pendingOptionSelection(state, seat)?.id ?? 'none',
  optionId,
})

const castAll = (
  game: ReturnType<typeof server>,
  state: GameState,
  votes: Array<[PlayerId, string]>,
) => {
  let current = state
  let result = undefined as ReturnType<typeof answer> | undefined
  for (const [seat, optionId] of votes) {
    result = answer(game, current, seat, optionId)
    current = ok(result)
  }
  return { state: current, result: result! }
}

test('voters answer in APNAP order from the controller and each ballot is validated', () => {
  const game = server([
    vote({
      prompt: 'Vote for alpha or beta.',
      options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] },
      bindResult: 'vote',
    }),
    ifThen(voteLeads('vote', 'a'), { then: [gainLife({ targets: ref('controller'), amount: 10 })] }),
  ])
  const state = begin(game)
  expect(pendingVote(state)?.voters).toEqual(['p1', 'p2', 'p3', 'p4'])
  expect(pendingVote(state)?.secret).toBe(false)
  expect(pendingOptionSelection(state, 'p1')?.action).toMatchObject({ kind: 'vote', voter: 'p1' })
  expect(answer(game, state, 'p2', 'a').ok).toBe(false)
  expect(answer(game, state, 'p1', 'c').ok).toBe(false)
  expect(game.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

  const afterP1 = ok(answer(game, state, 'p1', 'a'))
  expect(pendingOptionSelection(afterP1, 'p1')).toBeUndefined()
  expect(pendingOptionSelection(afterP1, 'p2')?.action).toMatchObject({ kind: 'vote', voter: 'p2' })
  const privateCard = cardTemplate('Hidden Instant', { types: ['Instant'] })
  const withSecret = createServerGame(commanderRules, {
    players: 4,
    hands: {
      p1: [instructionSpell({ instructions: [
        vote({
          prompt: 'Vote for alpha or beta.',
          options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] },
          bindResult: 'vote',
        }),
      ] }), privateCard],
    },
  }, { random: () => 0.5 })
  const voting = begin(withSecret)
  expect(projectForViewer(voting, 'p2').objects[named(voting, 'Hidden Instant').id]).toBeUndefined()
  expect(pendingVote(projectForViewer(voting, 'p2'))).toBeDefined()
})

test('the leading option continues the then branch and a tie takes otherwise', () => {
  const instructions = [
    vote({
      prompt: 'Vote for alpha or beta.',
      options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] },
      bindResult: 'vote',
    }),
    ifThen(voteLeads('vote', 'a'), {
      then: [gainLife({ targets: ref('controller'), amount: 10 })],
      otherwise: [gainLife({ targets: ref('controller'), amount: 1 })],
    }),
  ]
  const win = server(instructions)
  const won = castAll(win, begin(win), [['p1', 'a'], ['p2', 'a'], ['p3', 'b'], ['p4', 'a']])
  expect(won.result.trace.some(({ event }) => event.type === 'votesFinished')).toBe(true)
  expect(won.state.players.p1.life).toBe(50)
  expect(pendingVote(won.state)).toBeUndefined()

  const tie = server(instructions)
  let tying = begin(tie)
  tying = ok(answer(tie, tying, 'p1', 'a'))
  const restored = restoreJournal(createJournal(tying), tie.rules).current()
  const tied = castAll(tie, restored, [['p2', 'b'], ['p3', 'a'], ['p4', 'b']])
  expect(tied.state.players.p1.life).toBe(41)
})

test('object ballots tally identities, disambiguate duplicate names, and bind every tied winner', () => {
  const game = server([
    vote({
      prompt: 'Vote for a nonland permanent you do not control.',
      options: { kind: 'objects', filter: objects({ zone: 'battlefield', not: { type: 'Land' }, controller: 'opponent' }) },
      bindResult: 'vote',
      bindWinners: 'winners',
    }),
    move({ targets: choice('winners'), to: 'exile' }),
  ], {
    battlefield: {
      p1: [creature('Mine')],
      p2: [creature('Left')],
      p3: [creature('Right')],
      p4: [creature('Twin'), creature('Twin')],
    },
  })
  const state = begin(game)
  const options = pendingOptionSelection(state, 'p1')!.options
  expect(options.map((option) => option.label)).toEqual([
    'Left',
    'Right',
    expect.stringContaining('Twin ['),
    expect.stringContaining('Twin ['),
  ])
  expect(options.some((option) => option.id === named(state, 'Mine').id)).toBe(false)
  expect(answer(game, state, 'p1', named(state, 'Mine').id).ok).toBe(false)

  const left = named(state, 'Left').id
  const right = named(state, 'Right').id
  const done = castAll(game, state, [['p1', left], ['p2', right], ['p3', left], ['p4', right]])
  expect(named(done.state, 'Left').zone).toBe('exile')
  expect(named(done.state, 'Right').zone).toBe('exile')
  expect(named(done.state, 'Mine').zone).toBe('battlefield')
})

test('a vote with no options finishes immediately and vote tallies stay at zero', () => {
  const game = server([
    vote({
      prompt: 'Vote for a planeswalker.',
      options: { kind: 'objects', filter: objects({ zone: 'battlefield', type: 'Planeswalker' }) },
      bindResult: 'vote',
      bindWinners: 'winners',
    }),
    captureAmount({ amount: voteTally('vote', 'missing'), bindResult: 'tally' }),
    ifThen(compareAmount({ kind: 'resultRef', binding: 'tally', field: 'amount' }, 'eq', 0), {
      then: [gainLife({ targets: ref('controller'), amount: 3 })],
    }),
    destroy({ targets: choice('winners') }),
  ])
  const state = begin(game)
  expect(pendingVote(state)).toBeUndefined()
  expect(state.players.p1.life).toBe(43)
  expect(state.resolution).toBeUndefined()
})

test('vote programs reject unknown option ids at compile time', () => {
  expect(() => compileCardRuleDefinition(card([spell({ instructions: [
    vote({
      prompt: 'Vote.',
      options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }] },
      bindResult: 'vote',
    }),
    ifThen(voteLeads('missing', 'a'), { then: [draw(1)] }),
  ] })]))).toThrow()
})
