import { PARTICIPATION_OPTION } from './collectedChoices'
import { pendingSelectionFor } from '../../rules/selectCards'
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
  amount,
  count,
  createDefinitionSnapshot,
  forEach,
  forEachPlayer,
  modifyVotes,
  players,
  putCounters,
  tap,
  votesFinished,
  whenever,
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

test.each([
  ['return', 'return', true],
  ['return', 'embark', false],
  ['embark', 'embark', false],
] as const)('voted recovery/exile and optional discard/draw compose from the catalog (%s/%s)', (first, second, returning) => {
  const game = createServerGame(commanderRules, { players: 2,
    hands: {
      p1: [cardTemplate('Sail into the West', { manaCost: '{0}' }), cardTemplate('One hand'), cardTemplate('One recovery', { zone: 'graveyard' })],
      p2: [cardTemplate('Two hand'), cardTemplate('Two recovery', { zone: 'graveyard' })],
    },
    libraries: { p1: Array.from({ length: 8 }, (_, i) => cardTemplate(`One library ${i}`)), p2: Array.from({ length: 8 }, (_, i) => cardTemplate(`Two library ${i}`)) },
  }, { random: () => 0 })
  const spellId = named(game.state, 'Sail into the West').id
  let state = resolveStack(game.rules, ok(game.rules(game.state, { type: 'castSpell', seat: 'p1', objectId: spellId })))
  state = ok(answer(game, state, 'p1', first))
  state = ok(answer(game, state, 'p2', second))
  if (returning) {
    for (const seat of ['p1', 'p2']) {
      const pending = pendingSelectionFor(state, seat)!
      state = ok(game.rules(state, { type: 'selectCards', seat, selectionId: pending.id, kind: 'choose', count: pending.count, objectIds: seat === 'p1' ? pending.candidates : [] }))
    }
    expect(state.objects[spellId]!.zone).toBe('exile')
    expect(named(state, 'One recovery').zone).toBe('hand')
    expect(named(state, 'Two recovery').zone).toBe('graveyard')
  } else {
    state = ok(answer(game, state, 'p1', PARTICIPATION_OPTION.accept))
    expect(named(state, 'One hand').zone).toBe('hand')
    expect(state.zoneOrder.p1.hand).toHaveLength(1)
    state = ok(answer(game, state, 'p2', PARTICIPATION_OPTION.decline))
    expect(state.zoneOrder.p1.hand).toHaveLength(7)
    expect(state.zoneOrder.p2.hand).toHaveLength(1)
    expect(named(state, 'One hand').zone).toBe('graveyard')
    expect(state.objects[spellId]!.zone).toBe('graveyard')
  }
  expect(state.resolution).toBeUndefined()
})

test('secret object ballots bind every voted identity with its own tally through restore', () => {
  const game = server([
    vote({ prompt: 'Secretly choose a creature.', secret: true, options: { kind: 'objects', filter: objects({ zone: 'battlefield', type: 'Creature', not: { controller: 'you' } }) }, bindResult: 'vote', bindObjects: 'voted' }),
    forEach({ of: choice('voted'), instructions: [putCounters({ targets: ref('triggering.object.after'), counter: 'stun', count: voteTally('vote', { object: ref('triggering.object.after') }) }), tap(ref('triggering.object.after'))] }),
  ], { battlefield: { p1: [creature('Mine')], p2: [creature('Left')], p3: [creature('Right'), creature('Unvoted')] } })
  let state = begin(game)
  const left = named(state, 'Left').id, right = named(state, 'Right').id
  state = ok(answer(game, state, 'p1', left))
  expect(pendingVote(projectForViewer(state, 'p1'))!.votes.p1).toBe(left)
  expect(pendingVote(projectForViewer(state, 'p2'))!.votes.p1).toBe('*')
  expect(pendingVote(projectForViewer(state, null))!.votes.p1).toBe('*')
  state = restoreJournal(createJournal(state), game.rules).current()
  state = castAll(game, state, [['p2', right], ['p3', left], ['p4', left]]).state
  expect(named(state, 'Left')).toMatchObject({ tapped: true, counters: { stun: 3 } })
  expect(named(state, 'Right')).toMatchObject({ tapped: true, counters: { stun: 1 } })
  expect(named(state, 'Unvoted').tapped).toBe(false)
})

test('scoped vote control and additional ballots preserve secrecy, full results and cleanup duration', () => {
  const game = server([
    modifyVotes({ players: players({ relation: 'opponent' }), controller: ref('controller'), additional: amount(1), duration: 'untilEndOfTurn' }),
    vote({ prompt: 'Secret vote.', secret: true, options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }, bindResult: 'vote' }),
    gainLife({ targets: ref('controller'), amount: voteTally('vote', 'a') }),
  ])
  let state = begin(game)
  expect(answer(game, state, 'p2', 'a').ok).toBe(false)
  state = ok(answer(game, state, 'p1', 'a'))
  expect(pendingOptionSelection(state, 'p1')?.action).toMatchObject({ voter: 'p2' })
  state = ok(answer(game, state, 'p1', 'a'))
  expect(pendingOptionSelection(state, 'p1')?.action).toMatchObject({ voter: 'p2' })
  expect(pendingVote(projectForViewer(state, 'p3'))!.ballots!.p2).toEqual(['*'])
  expect(pendingVote(projectForViewer(state, null))!.ballots!.p2).toEqual(['*'])
  state = restoreJournal(createJournal(state), game.rules).current()
  for (let index = 0; index < 5; index++) state = ok(answer(game, state, 'p1', 'a'))
  expect(state.players.p1.life).toBe(47)
  expect(state.voteModifiers).toHaveLength(1)
  state = ok(game.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))
  expect(state.step).toBe('cleanup')
  expect(state.voteModifiers).toBeUndefined()
})

test('finished-vote observers compare all ballots and retain the result after leaving', () => {
  const observer = createDefinitionSnapshot(compileCardRuleDefinition(card([whenever(votesFinished('vote'), { instructions: [
    gainLife({ targets: ref('controller'), amount: count(players({ relation: 'opponent', voted: { binding: 'vote', with: ref('controller'), agreement: 'same' } })) }),
    gainLife({ targets: ref('controller'), amount: count(players({ relation: 'opponent', voted: { binding: 'vote', with: ref('controller'), agreement: 'different' } })) }),
  ] })])))
  const game = server([
    modifyVotes({ players: players({ relation: 'opponent' }), additional: amount(1), duration: 'permanent' }),
    vote({ prompt: 'Vote.', options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }, bindResult: 'vote' }),
  ], { battlefield: { p1: [cardTemplate('Observer fixture', { types: ['Creature'], ruleDefinition: observer })] } })
  let state = castAll(game, begin(game), [['p1', 'a'], ['p2', 'a'], ['p2', 'b'], ['p3', 'b'], ['p3', 'b'], ['p4', 'a'], ['p4', 'a']]).state
  expect(state.stack).toHaveLength(1)
  expect(state.players.p1.life).toBe(40)
  const source = named(state, 'Observer fixture').id
  state = ok(game.rules(state, { type: 'move', objectId: source, to: 'graveyard' }))
  state = resolveStack(game.rules, restoreJournal(createJournal(state), game.rules).current())
  // p2 and p4 agree; p2 and p3 disagree. A multi-vote opponent can be both.
  expect(state.players.p1.life).toBe(44)
})


test('the catalog player-ballot program completes all APNAP draws before sequential optional placements', () => {
  const game = createServerGame(commanderRules, { players: 4, hands: {
    p1: [creature('One placement')], p2: [cardTemplate('Círdan the Shipwright')],
    p3: [cardTemplate('Three placement', { types: ['Artifact'] })], p4: [cardTemplate('Four placement', { types: ['Enchantment'] })],
  }, libraries: { p2: Array.from({ length: 5 }, (_, i) => cardTemplate(`Draw fixture ${i}`)) } }, { random: () => 0 })
  let state = structuredClone(game.state)
  state.active = 'p3'
  state.priority = 'p3'
  state = resolveStack(game.rules, ok(game.rules(state, { type: 'move', objectId: named(state, 'Círdan the Shipwright').id, to: 'battlefield' })))
  state = castAll(game, state, [['p2', 'p2'], ['p3', 'p2'], ['p4', 'p2'], ['p1', 'p2']]).state
  expect(state.zoneOrder.p2.hand).toHaveLength(4)
  expect(state.priority).toBeNull()
  for (const [seat, name] of [['p3', 'Three placement'], ['p4', 'Four placement'], ['p1', 'One placement']]) {
    const pick = pendingSelectionFor(state, seat!)!
    expect(pick).toBeDefined()
    state = ok(game.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: seat!, selectionId: pick.id, kind: 'choose', count: pick.count, objectIds: [named(state, name!).id] }))
    expect(named(state, name!).zone).toBe('battlefield')
  }
  expect(state.resolution).toBeUndefined()
})

test('the catalog finished-vote program creates Treasures for matching opponents before scry and draw', () => {
  const game = server([vote({ prompt: 'Vote.', options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }, bindResult: 'vote' })], { battlefield: { p2: [cardTemplate('Erestor of the Council')] }, libraries: { p2: [cardTemplate('First draw'), cardTemplate('Second draw')] } })
  let state = castAll(game, begin(game), [['p1', 'a'], ['p2', 'a'], ['p3', 'b'], ['p4', 'a']]).state
  expect(state.stack).toHaveLength(1)
  state = ok(game.rules(state, { type: 'resolveTop' }))
  expect(Object.values(state.objects).filter(object => object.name === 'Treasure').map(object => object.controller).sort()).toEqual(['p1', 'p4'])
  const pick = pendingSelectionFor(state, 'p2')!
  expect(pick).toMatchObject({ kind: 'scry', count: 1 })
  expect(state.zoneOrder.p2.hand).toHaveLength(0)
  state = ok(game.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p2', selectionId: pick.id, kind: 'scry', count: 1, choices: [{ objectId: pick.candidates[0]!, destination: 'top' }] }))
  expect(named(state, 'First draw').zone).toBe('hand')
})

test('the most recently resolved vote controller wins, including after restoring a permanent effect', () => {
  const game = server([
    forEachPlayer({ of: players({ relation: 'opponent' }), instructions: [modifyVotes({ players: players(), controller: ref('event.player'), duration: 'permanent' })] }),
    vote({ prompt: 'Vote.', options: { kind: 'named', options: [{ id: 'a', label: 'Alpha' }] }, bindResult: 'vote' }),
  ])
  let state = begin(game)
  expect(pendingOptionSelection(state, 'p4')?.action).toMatchObject({ voter: 'p1' })
  expect(answer(game, state, 'p2', 'a').ok).toBe(false)
  state = restoreJournal(createJournal(state), game.rules).current()
  for (let index = 0; index < 4; index++) state = ok(answer(game, state, 'p4', 'a'))
  state = ok(game.rules({ ...state, step: 'end' }, { type: 'advanceStep' }))
  expect(state.voteModifiers).toHaveLength(3)
})
