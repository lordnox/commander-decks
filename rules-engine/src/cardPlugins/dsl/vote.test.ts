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

// Catalog vote integrations: each case reuses a canonical card definition from
// the catalog and owns the end-to-end ballot, outcome, privacy, and restore checks
// that the generic instruction fixtures above cannot express.

const filler = (prefix: string, length: number, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  Array.from({ length }, (_, index) => cardTemplate(`${prefix} ${index + 1}`, extra))

const catalogGame = (extra: Parameters<typeof createServerGame>[1]) =>
  createServerGame(commanderRules, { players: 4, ...extra }, { random: () => 0.5 })

type CatalogGame = ReturnType<typeof catalogGame>

const castCatalog = (game: CatalogGame, state: GameState, name: string) =>
  resolveStack(game.rules, ok(game.rules(state, { type: 'castSpell', seat: 'p1', objectId: named(state, name).id })))

const restart = (game: CatalogGame, state: GameState) => restoreJournal(createJournal(state), game.rules).current()

const finishedVote = (result: ReturnType<typeof answer>) => {
  const event = result.trace.map((entry) => entry.event).find((candidate) => candidate.type === 'votesFinished')
  if (event?.type !== 'votesFinished') throw new Error('no votesFinished event')
  return event.result
}

const zoneOf = (state: GameState, name: string) => named(state, name).zone

const treasures = (state: GameState, seat: PlayerId) =>
  Object.values(state.objects).filter((object) => object.name === 'Treasure' && object.controller === seat)

const sailGame = (extra: Parameters<typeof createServerGame>[1] = {}) => {
  const game = catalogGame({
    hands: {
      p1: [cardTemplate('Sail into the West', { manaCost: '{0}' }), ...filler('Hand A', 2)],
      p2: filler('Hand B', 3, { zone: 'graveyard' }),
      p3: filler('Hand C', 1, { zone: 'graveyard' }),
    },
    libraries: { p1: filler('Lib A', 10), p2: filler('Lib B', 10), p3: filler('Lib C', 10), p4: filler('Lib D', 10) },
    ...extra,
  })
  return { game, state: castCatalog(game, game.state, 'Sail into the West') }
}

test('catalog Sail into the West opens a public return/embark vote in turn order from the caster', () => {
  const { game, state } = sailGame()
  expect(pendingVote(state)).toMatchObject({
    source: 'Sail into the West',
    owner: 'p1',
    secret: false,
    voters: ['p1', 'p2', 'p3', 'p4'],
    options: [{ id: 'return', label: 'Return' }, { id: 'embark', label: 'Embark' }],
  })
  expect(pendingOptionSelection(state, 'p1')?.options.map((option) => option.id)).toEqual(['return', 'embark'])
  expect(answer(game, state, 'p2', 'return').ok).toBe(false)
  expect(answer(game, state, 'p1', 'neither').ok).toBe(false)
  expect(game.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
  const afterOne = ok(answer(game, state, 'p1', 'return'))
  expect(pendingVote(projectForViewer(afterOne, 'p3'))?.votes).toEqual({ p1: 'return' })
})

test('catalog Sail into the West return lets each player privately return up to two graveyard cards, then exiles it', () => {
  const { game, state } = sailGame()
  const spellId = named(state, 'Sail into the West').id
  const voted = castAll(game, state, [['p1', 'return'], ['p2', 'return'], ['p3', 'embark'], ['p4', 'return']])
  expect(finishedVote(voted.result)).toMatchObject({ tallies: { return: 3, embark: 1 }, winners: ['return'], tied: false })
  // Nobody can pick for the caster's empty graveyard, and the resolving spell is never a candidate.
  expect(pendingSelectionFor(voted.state, 'p1')).toBeUndefined()
  const second = pendingSelectionFor(voted.state, 'p2')!
  expect(second).toMatchObject({ kind: 'choose', count: 2, min: 0, source: 'Sail into the West' })
  expect(second.candidates.toSorted()).toEqual(['Hand B 1', 'Hand B 2', 'Hand B 3'].map((name) => named(state, name).id).toSorted())
  expect(pendingSelectionFor(projectForViewer(voted.state, 'p2'), 'p2')).toBeDefined()
  expect(pendingSelectionFor(projectForViewer(voted.state, 'p1'), 'p2')).toBeUndefined()
  expect(pendingSelectionFor(projectForViewer(voted.state, 'p3'), 'p2')).toBeUndefined()

  const pick = (current: GameState, seat: PlayerId, names: string[]) => {
    const pending = pendingSelectionFor(current, seat)!
    return game.rules(current, {
      type: 'selectCards', seat, selectionId: pending.id, kind: 'choose', count: pending.count,
      objectIds: names.map((name) => named(state, name).id),
    })
  }
  // Too many cards, another seat's cards, and the spell's own card are all refused.
  expect(pick(voted.state, 'p2', ['Hand B 1', 'Hand B 2', 'Hand B 3']).ok).toBe(false)
  expect(pick(voted.state, 'p2', ['Hand C 1']).ok).toBe(false)
  expect(pick(voted.state, 'p2', ['Sail into the West']).ok).toBe(false)

  let current = ok(pick(restart(game, voted.state), 'p2', ['Hand B 1', 'Hand B 3']))
  expect(pendingSelectionFor(current, 'p3')).toMatchObject({ kind: 'choose', min: 0, candidates: [named(state, 'Hand C 1').id] })
  current = ok(pick(restart(game, current), 'p3', ['Hand C 1']))
  current = resolveStack(game.rules, current)
  expect(current.zoneOrder.p2.hand.toSorted()).toEqual(['Hand B 1', 'Hand B 3'].map((name) => named(state, name).id).toSorted())
  expect(current.zoneOrder.p3.hand).toEqual([named(state, 'Hand C 1').id])
  expect(zoneOf(current, 'Hand B 2')).toBe('graveyard')
  expect(current.zoneOrder.p1.exile).toContain(spellId)
  expect(current.zoneOrder.p1.hand).toHaveLength(2)
  for (const seat of current.playerOrder) expect(pendingSelectionFor(current, seat)).toBeUndefined()
  expect(current.resolution).toBeUndefined()
})

test('catalog Sail into the West embarks on a tie: each player privately chooses, then the chosen discard and draw seven', () => {
  const { game, state } = sailGame()
  const voted = castAll(game, state, [['p1', 'return'], ['p2', 'embark'], ['p3', 'return'], ['p4', 'embark']])
  expect(finishedVote(voted.result)).toMatchObject({ tallies: { return: 2, embark: 2 }, tied: true })
  for (const seat of voted.state.playerOrder) expect(pendingSelectionFor(voted.state, seat)).toBeUndefined()
  expect(pendingOptionSelection(voted.state, 'p1')?.options.map((option) => option.id))
    .toEqual([PARTICIPATION_OPTION.accept, PARTICIPATION_OPTION.decline])
  expect(pendingOptionSelection(voted.state, 'p2')).toBeUndefined()
  expect(pendingOptionSelection(projectForViewer(voted.state, 'p2'), 'p1')).toBeUndefined()
  expect(answer(game, voted.state, 'p2', PARTICIPATION_OPTION.accept).ok).toBe(false)

  let current = voted.state
  for (const [seat, optionId] of [
    ['p1', PARTICIPATION_OPTION.accept], ['p2', PARTICIPATION_OPTION.decline],
    ['p3', PARTICIPATION_OPTION.accept], ['p4', PARTICIPATION_OPTION.accept],
  ] as const) {
    expect(current.zoneOrder.p1.hand).toHaveLength(2)
    current = ok(answer(game, current, seat, optionId))
  }
  expect(current.zoneOrder.p1.hand).toHaveLength(7)
  expect(['Hand A 1', 'Hand A 2'].map((name) => zoneOf(current, name))).toEqual(['graveyard', 'graveyard'])
  expect(current.zoneOrder.p2.hand).toHaveLength(0)
  expect(current.zoneOrder.p3.hand).toHaveLength(7)
  expect(current.zoneOrder.p4.hand).toHaveLength(7)
  expect(pendingOptionSelection(current)).toBeUndefined()
  // Embark does not exile the spell: it goes to the graveyard like any instant.
  expect(zoneOf(current, 'Sail into the West')).toBe('graveyard')
})

test('catalog Sail into the West keeps an outright embark question and an open vote through restore', () => {
  const embark = sailGame()
  const voted = castAll(embark.game, embark.state, [['p1', 'embark'], ['p2', 'embark'], ['p3', 'embark'], ['p4', 'return']])
  const restarted = restart(embark.game, voted.state)
  expect(pendingOptionSelection(restarted, 'p1')?.id).toBe(pendingOptionSelection(voted.state, 'p1')!.id)
  const declined = ok(answer(embark.game, restarted, 'p1', PARTICIPATION_OPTION.decline))
  expect(pendingOptionSelection(declined, 'p2')).toBeDefined()
  expect(zoneOf(declined, 'Sail into the West')).toBe('stack')

  const open = sailGame()
  const reloaded = restart(open.game, ok(answer(open.game, open.state, 'p1', 'return')))
  expect(pendingVote(reloaded)?.votes).toEqual({ p1: 'return' })
  expect(pendingOptionSelection(reloaded, 'p2')).toBeDefined()
  const done = castAll(open.game, reloaded, [['p2', 'return'], ['p3', 'return'], ['p4', 'return']])
  expect(finishedVote(done.result).winners).toEqual(['return'])
  expect(pendingSelectionFor(done.state, 'p2')).toBeDefined()
})

const erestorLibraries = { p1: filler('Lib A', 6), p2: filler('Erestor Lib', 6), p3: filler('Lib C', 6), p4: filler('Lib D', 6) }

const scryAllToTop = (game: CatalogGame, state: GameState, seat: PlayerId) => {
  const scry = pendingSelectionFor(state, seat)!
  return ok(game.rules(state, {
    type: 'selectCards', seat, selectionId: scry.id, kind: 'scry', count: scry.count,
    choices: scry.candidates.map((objectId) => ({ objectId, destination: 'top' as const })),
  }))
}

test('catalog Erestor hears a Sail vote only after the spell finishes, then Treasures, scry, and draw follow', () => {
  const { game, state } = sailGame({ battlefield: { p2: [cardTemplate('Erestor of the Council')] }, libraries: erestorLibraries })
  // Erestor's controller (p2) votes embark; p1 and p4 agree, p3 disagrees.
  const done = castAll(game, state, [['p1', 'embark'], ['p2', 'embark'], ['p3', 'return'], ['p4', 'embark']])
  // The trigger waits while Sail asks its embark questions and is placed once the spell finishes.
  expect(done.state.pendingTriggers?.[0]).toMatchObject({
    source: { name: 'Erestor of the Council', controller: 'p2' },
    execution: { occurrence: { vote: { tallies: { return: 1, embark: 3 } } } },
  })
  expect(done.state.stack.map((item) => item.name)).toEqual(['Sail into the West'])
  let afterSail = done.state
  for (const seat of afterSail.playerOrder) afterSail = ok(answer(game, afterSail, seat, PARTICIPATION_OPTION.decline))
  expect(afterSail.stack[0]).toMatchObject({ name: 'Erestor of the Council', controller: 'p2' })
  expect(zoneOf(afterSail, 'Sail into the West')).toBe('graveyard')
  const handBefore = afterSail.zoneOrder.p2.hand.length
  const resolved = ok(game.rules(afterSail, { type: 'resolveTop' }))
  expect(['p1', 'p2', 'p3', 'p4'].map((seat) => treasures(resolved, seat).length)).toEqual([1, 0, 0, 1])
  expect(pendingSelectionFor(resolved, 'p2')).toMatchObject({ kind: 'scry', count: 1 })
  expect(resolved.zoneOrder.p2.hand).toHaveLength(handBefore)
  expect(scryAllToTop(game, resolved, 'p2').zoneOrder.p2.hand).toHaveLength(handBefore + 1)
})

test("catalog Erestor hears Círdan's secret player vote after Círdan's draws and placements", () => {
  const game = catalogGame({
    battlefield: { p2: [cardTemplate('Erestor of the Council')] },
    hands: {
      p1: [cardTemplate('Círdan the Shipwright'), cardTemplate('One placement', { types: ['Artifact'] })],
      p2: [cardTemplate('Two placement', { types: ['Artifact'] })],
    },
    libraries: erestorLibraries,
  })
  const entered = resolveStack(game.rules, ok(game.rules(game.state, {
    type: 'move', objectId: named(game.state, 'Círdan the Shipwright').id, to: 'battlefield',
  })))
  expect(pendingVote(entered)).toMatchObject({ source: 'Círdan the Shipwright', secret: true })
  // Erestor's controller (p2) votes for p3; p1 and p4 agree, p3 disagrees.
  const voted = castAll(game, entered, [['p1', 'p3'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p3']]).state
  expect(pendingVote(voted)).toBeUndefined()
  expect(voted.pendingTriggers?.[0]).toMatchObject({
    source: { name: 'Erestor of the Council', controller: 'p2' },
    execution: { occurrence: { vote: { votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3' } } } },
  })
  // Círdan's own placements for the players without votes (p1, p2) come first.
  let current = voted
  for (const seat of ['p1', 'p2'] as const) {
    const placement = pendingSelectionFor(current, seat)!
    expect(placement).toMatchObject({ kind: 'choose', min: 0, source: 'Círdan the Shipwright' })
    current = ok(game.rules(current, { type: 'selectCards', seat, selectionId: placement.id, kind: 'choose', count: placement.count, objectIds: [] }))
  }
  expect(current.stack[0]).toMatchObject({ name: 'Erestor of the Council', controller: 'p2' })
  const handBefore = current.zoneOrder.p2.hand.length
  current = ok(game.rules(current, { type: 'resolveTop' }))
  expect(['p1', 'p2', 'p3', 'p4'].map((seat) => treasures(current, seat).length)).toEqual([1, 0, 0, 1])
  expect(pendingSelectionFor(current, 'p2')).toMatchObject({ kind: 'scry', count: 1 })
  expect(current.zoneOrder.p2.hand).toHaveLength(handBefore)
  expect(scryAllToTop(game, current, 'p2').zoneOrder.p2.hand).toHaveLength(handBefore + 1)
})

test("catalog Erestor gives every agreeing opponent a Treasure and skips scry after a unanimous Council's Judgment", () => {
  const game = catalogGame({
    hands: { p1: [cardTemplate("Council's Judgment", { manaCost: '{0}' })] },
    battlefield: { p2: [cardTemplate('Erestor of the Council'), creature('Target')], p3: [creature('Other')] },
    libraries: erestorLibraries,
  })
  const voting = castCatalog(game, game.state, "Council's Judgment")
  const target = named(voting, 'Target').id
  const done = castAll(game, voting, [['p1', target], ['p2', target], ['p3', target], ['p4', target]])
  expect(zoneOf(done.state, 'Target')).toBe('exile')
  const current = resolveStack(game.rules, done.state)
  expect(['p1', 'p2', 'p3', 'p4'].map((seat) => treasures(current, seat).length)).toEqual([1, 0, 1, 1])
  expect(pendingSelectionFor(current, 'p2')).toBeUndefined()
  expect(current.zoneOrder.p2.hand).toHaveLength(1)
})

test('catalog Erestor scries once per disagreeing opponent and makes no Treasure when every opponent disagrees', () => {
  const { game, state } = sailGame({
    hands: { p1: [cardTemplate('Sail into the West', { manaCost: '{0}' })] },
    battlefield: { p2: [cardTemplate('Erestor of the Council')] },
    libraries: erestorLibraries,
  })
  const done = castAll(game, state, [['p1', 'return'], ['p2', 'embark'], ['p3', 'return'], ['p4', 'return']])
  // Return finds no graveyard cards, so Sail finishes and places Erestor.
  expect(done.state.stack.map((item) => item.name)).toEqual(['Erestor of the Council'])
  const current = ok(game.rules(done.state, { type: 'resolveTop' }))
  expect(Object.values(current.objects).some((object) => object.name === 'Treasure')).toBe(false)
  expect(pendingSelectionFor(current, 'p2')).toMatchObject({ kind: 'scry', count: 3 })
})

const stampedeLibrary = () => [
  cardTemplate('Plains', { types: ['Land'] }),
  creature('First Creature'),
  cardTemplate('Island', { types: ['Land'] }),
  creature('Second Creature'),
  creature('Third Creature'),
  cardTemplate('Bottom Land', { types: ['Land'] }),
]

const stampedeGame = (library = stampedeLibrary(), hand: ReturnType<typeof cardTemplate>[] = []) => {
  const game = catalogGame({
    hands: { p1: [cardTemplate("Selvala's Stampede", { manaCost: '{0}' }), ...hand], p2: [creature('Their Card')] },
    libraries: { p1: library, p2: [creature('Their Library Creature')] },
  })
  return { game, state: castCatalog(game, game.state, "Selvala's Stampede") }
}

test("catalog Selvala's Stampede opens a public wild/free vote starting with the caster", () => {
  expect(pendingVote(stampedeGame().state)).toMatchObject({
    owner: 'p1',
    secret: false,
    voters: ['p1', 'p2', 'p3', 'p4'],
    options: [{ id: 'wild', label: 'Wild' }, { id: 'free', label: 'Free' }],
  })
})

test("catalog Selvala's Stampede reveals the caster's library to one creature per wild vote and returns the rest", () => {
  const { game, state } = stampedeGame()
  const done = castAll(game, state, [['p1', 'wild'], ['p2', 'wild'], ['p3', 'free'], ['p4', 'free']])
  const current = resolveStack(game.rules, done.state)
  expect(['First Creature', 'Second Creature', 'Third Creature'].map((name) => zoneOf(current, name)))
    .toEqual(['battlefield', 'battlefield', 'library'])
  // Revealed noncreature cards return to the library, not lost or milled.
  expect(['Plains', 'Island', 'Bottom Land'].map((name) => zoneOf(current, name))).toEqual(['library', 'library', 'library'])
  expect(current.zoneOrder.p1.library).toHaveLength(4)
  expect(named(current, 'First Creature').controller).toBe('p1')
  // The opponents' libraries and hands are untouched.
  expect(zoneOf(current, 'Their Library Creature')).toBe('library')
  expect(current.zoneOrder.p2.hand).toEqual([named(current, 'Their Card').id])
  expect(current.log.some((line) => line.includes('Selvala'))).toBe(true)
})

test("catalog Selvala's Stampede lets the caster privately put one permanent card from hand per free vote", () => {
  const { game, state } = stampedeGame(stampedeLibrary(), [
    creature('Hand Creature'),
    cardTemplate('Hand Relic', { types: ['Artifact'] }),
    cardTemplate('Hand Land', { types: ['Land'] }),
    cardTemplate('Hand Instant', { types: ['Instant'] }),
  ])
  const done = castAll(game, state, [['p1', 'free'], ['p2', 'wild'], ['p3', 'free'], ['p4', 'free']])
  // One wild vote reveals up to the first creature before the free votes open the placement.
  expect(zoneOf(done.state, 'First Creature')).toBe('battlefield')
  expect(zoneOf(done.state, 'Second Creature')).toBe('library')
  const placement = pendingSelectionFor(done.state, 'p1')!
  expect(placement).toMatchObject({ kind: 'choose', seat: 'p1', min: 0, count: 3 })
  expect(placement.candidates.map((id) => done.state.objects[id].name).toSorted()).toEqual(['Hand Creature', 'Hand Land', 'Hand Relic'])
  expect(pendingSelectionFor(projectForViewer(done.state, 'p2'), 'p1')).toBeUndefined()

  const current = ok(game.rules(done.state, {
    type: 'selectCards', seat: 'p1', selectionId: placement.id, kind: 'choose', count: 3,
    objectIds: [named(done.state, 'Hand Creature').id, named(done.state, 'Hand Relic').id],
  }))
  expect(pendingSelectionFor(current, 'p1')).toBeUndefined()
  expect(['Hand Creature', 'Hand Relic', 'Hand Land', 'Hand Instant'].map((name) => zoneOf(current, name)))
    .toEqual(['battlefield', 'battlefield', 'hand', 'hand'])
  expect(zoneOf(current, "Selvala's Stampede")).toBe('graveyard')
})

test("catalog Selvala's Stampede stops at the library end and skips an empty free placement", () => {
  const { game, state } = stampedeGame([
    cardTemplate('Plains', { types: ['Land'] }),
    creature('Only Creature'),
    cardTemplate('Island', { types: ['Land'] }),
  ], [creature('Hand Creature')])
  const done = castAll(game, state, [['p1', 'wild'], ['p2', 'wild'], ['p3', 'wild'], ['p4', 'wild']])
  const current = resolveStack(game.rules, done.state)
  expect(zoneOf(current, 'Only Creature')).toBe('battlefield')
  expect(current.zoneOrder.p1.library).toHaveLength(2)
  expect(pendingSelectionFor(current, 'p1')).toBeUndefined()
  expect(zoneOf(current, 'Hand Creature')).toBe('hand')
})

test("catalog Selvala's Stampede keeps an open vote and an all-free placement through restore", () => {
  const free = stampedeGame(stampedeLibrary(), [
    creature('Hand Creature'),
    creature('Hand Beast'),
    cardTemplate('Hand Relic', { types: ['Artifact'] }),
    cardTemplate('Hand Land', { types: ['Land'] }),
  ])
  const placed = castAll(free.game, free.state, [['p1', 'free'], ['p2', 'free'], ['p3', 'free'], ['p4', 'free']]).state
  expect(['First Creature', 'Second Creature'].map((name) => zoneOf(placed, name))).toEqual(['library', 'library'])
  expect(pendingSelectionFor(placed, 'p1')).toMatchObject({ kind: 'choose', count: 4, min: 0 })
  const restored = restart(free.game, placed)
  expect(pendingSelectionFor(restored, 'p1')).toMatchObject({ seat: 'p1', kind: 'choose', id: pendingSelectionFor(placed, 'p1')!.id })

  const wild = stampedeGame()
  const reloaded = restart(wild.game, ok(answer(wild.game, wild.state, 'p1', 'wild')))
  const done = castAll(wild.game, reloaded, [['p2', 'wild'], ['p3', 'wild'], ['p4', 'wild']])
  const current = resolveStack(wild.game.rules, done.state)
  expect(['First Creature', 'Second Creature', 'Third Creature'].map((name) => zoneOf(current, name)))
    .toEqual(['battlefield', 'battlefield', 'battlefield'])
})

const portalGame = () => catalogGame({
  battlefield: {
    p1: [cardTemplate('Coercive Portal'), creature('Mine'), cardTemplate('Home Forest', { types: ['Land'] })],
    p2: [
      creature('Theirs'),
      cardTemplate('Their Relic', { types: ['Artifact'] }),
      cardTemplate('Their Aura', { types: ['Enchantment'] }),
      cardTemplate('Eternal', { types: ['Creature'], power: 2, toughness: 2, oracleText: 'Indestructible' }),
      cardTemplate('Away Forest', { types: ['Land'] }),
    ],
  },
  libraries: { p1: filler('Lib A', 5), p2: filler('Lib B', 5) },
})

const atUpkeep = (game: CatalogGame, active: PlayerId = 'p1') => {
  const current = ok(game.rules({ ...structuredClone(game.state), step: 'untap', active, priority: active }, { type: 'advanceStep' }))
  expect(current.step).toBe('upkeep')
  return current
}

const openPortalVote = (game: CatalogGame) => ok(game.rules(atUpkeep(game), { type: 'resolveTop' }))

test('catalog Coercive Portal triggers only at its controller upkeep and asks a public carnage/homage vote', () => {
  const game = portalGame()
  const mine = atUpkeep(game)
  expect(mine.stack[0]).toMatchObject({ name: 'Coercive Portal', controller: 'p1' })
  expect(pendingVote(ok(game.rules(mine, { type: 'resolveTop' })))).toMatchObject({
    source: 'Coercive Portal',
    owner: 'p1',
    secret: false,
    voters: ['p1', 'p2', 'p3', 'p4'],
    options: [{ id: 'carnage', label: 'Carnage' }, { id: 'homage', label: 'Homage' }],
  })
  expect(atUpkeep(game, 'p2').stack).toHaveLength(0)
})

test('catalog Coercive Portal draws for its controller on homage or a tie and keeps every permanent', () => {
  const game = portalGame()
  const opened = openPortalVote(game)
  const tie = castAll(game, opened, [['p1', 'homage'], ['p2', 'carnage'], ['p3', 'homage'], ['p4', 'carnage']])
  expect(finishedVote(tie.result)).toMatchObject({ tied: true })
  expect(tie.state.zoneOrder.p1.hand).toHaveLength(1)
  expect(['Coercive Portal', 'Theirs'].map((name) => zoneOf(tie.state, name))).toEqual(['battlefield', 'battlefield'])

  const homage = castAll(game, opened, [['p1', 'homage'], ['p2', 'homage'], ['p3', 'carnage'], ['p4', 'homage']]).state
  expect(homage.zoneOrder.p1.hand).toHaveLength(1)
  expect(homage.zoneOrder.p2.hand).toHaveLength(0)
  expect(['Coercive Portal', 'Mine'].map((name) => zoneOf(homage, name))).toEqual(['battlefield', 'battlefield'])
})

test('catalog Coercive Portal carnage sacrifices itself and destroys every nonland permanent', () => {
  const game = portalGame()
  const done = castAll(game, openPortalVote(game), [['p1', 'homage'], ['p2', 'carnage'], ['p3', 'carnage'], ['p4', 'carnage']])
  const current = resolveStack(game.rules, done.state)
  expect(['Coercive Portal', 'Mine', 'Theirs', 'Their Relic', 'Their Aura'].map((name) => zoneOf(current, name)))
    .toEqual(['graveyard', 'graveyard', 'graveyard', 'graveyard', 'graveyard'])
  expect(['Eternal', 'Home Forest', 'Away Forest'].map((name) => zoneOf(current, name)))
    .toEqual(['battlefield', 'battlefield', 'battlefield'])
  // Carnage is not homage: nobody draws.
  expect(current.zoneOrder.p1.hand).toHaveLength(0)
})

test('catalog Coercive Portal keeps an open vote through restore and a tie still draws', () => {
  const game = portalGame()
  const reloaded = restart(game, ok(answer(game, openPortalVote(game), 'p1', 'carnage')))
  expect(pendingVote(reloaded)?.votes).toEqual({ p1: 'carnage' })
  const done = castAll(game, reloaded, [['p2', 'carnage'], ['p3', 'homage'], ['p4', 'homage']])
  expect(finishedVote(done.result).tied).toBe(true)
  expect(done.state.zoneOrder.p1.hand).toHaveLength(1)
  expect(pendingVote(done.state)).toBeUndefined()
})
