import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import {
  DIALOG_CHOSEN,
  dialogCandidates,
  pendingDialog,
} from '../pendingDialog'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, PlayerId, ReduceResult } from '../types'
import { cardDefinition, handlerIdsForNames } from './cardRules'
import { choiceEffects } from './choiceEffects'
import { eachPlayerWheel } from './eachPlayerWheel'
import { onResolve } from './onResolve'
import { SECRET_COUNCIL, secretCouncil } from './secretCouncil'
import { PENDING_VOTE, pendingVote, vote } from './vote'

type Server = ReturnType<typeof createServerGame>

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const filler = (prefix: string, count: number, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`${prefix} ${index + 1}`, extra))

const bear = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

const server = (options: Parameters<typeof createServerGame>[1]): Server =>
  createServerGame(
    commanderRules,
    { players: 4, ...options },
    {
      random: () => 0.5,
      cardPlugins: [onResolve, vote, secretCouncil, choiceEffects, eachPlayerWheel],
    },
  )

const withMana = (state: GameState, seat: PlayerId, mana: Partial<GameState['players'][string]['mana']>) => {
  const ready = structuredClone(state)
  ready.players[seat].mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana }
  return ready
}

const cast = (game: Server, state: GameState, seat: PlayerId, name: string) => {
  const onStack = ok(game.rules(state, {
    type: 'castSpell',
    seat,
    objectId: named(state, name).id,
  }))
  return ok(game.rules(onStack, { type: 'resolveTop' }))
}

const answer = (
  game: Server,
  state: GameState,
  seat: PlayerId,
  optionId: string,
): ReduceResult => game.rules(state, {
  type: 'selectOption',
  seat,
  selectionId: pendingOptionSelection(state, seat)?.id ?? 'none',
  optionId,
})

const castVotes = (game: Server, state: GameState, votes: Array<[PlayerId, string]>) => {
  let current = state
  let last: ReduceResult | undefined
  for (const [seat, optionId] of votes) {
    last = answer(game, current, seat, optionId)
    current = ok(last)
  }
  return { state: current, last: last! }
}

const finishedEvent = (result: ReduceResult) => {
  const event = result.trace.map((entry) => entry.event)
    .find((candidate) => candidate.type === 'votesFinished')
  if (event?.type !== 'votesFinished') throw new Error('no votesFinished event')
  return event
}

const toGraveyard = (game: Server, state: GameState, names: string[]) =>
  names.reduce((current, name) => ok(game.rules(current, {
    type: 'move',
    objectId: named(current, name).id,
    to: 'graveyard',
  })), state)

const on = (state: GameState, name: string) => named(state, name).zone

const sail = () => cardTemplate('Sail into the West', {
  types: ['Instant'],
  manaCost: '{2}{G}{U}',
  manaValue: 4,
})

const stampede = () => cardTemplate("Selvala's Stampede", {
  types: ['Sorcery'],
  manaCost: '{4}{G}{G}',
  manaValue: 6,
})

const portal = () => cardTemplate('Coercive Portal', { types: ['Artifact'], manaCost: '{4}', manaValue: 4 })

const atUpkeep = (game: Server, active: PlayerId = 'p1') => {
  let current = { ...structuredClone(game.state), step: 'untap' as const, active, priority: active }
  current = ok(game.rules(current, { type: 'advanceStep' }))
  expect(current.step).toBe('upkeep')
  return current
}

const erestor = () => cardTemplate('Erestor of the Council', {
  types: ['Creature'],
  supertypes: ['Legendary'],
  power: 2,
  toughness: 3,
  manaCost: '{1}{G}{U}',
  manaValue: 3,
})
const treasures = (state: GameState, seat: PlayerId) =>
  Object.values(state.objects).filter((object) =>
    object.name === 'Treasure' && object.controller === seat)

const secretVoteFrom = (game: Server, state: GameState, votes: Array<[PlayerId, PlayerId]>) => {
  let current = state
  for (const [seat, target] of votes) {
    current = ok(game.rules(current, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat,
      payload: { targets: [target] },
    }))
  }
  return current
}

describe('card table entries', () => {
  test('each council card is registered with the vote engine handlers it needs', () => {
    expect(handlerIdsForNames(['Sail into the West']).toSorted())
      .toEqual(['choiceEffects', 'eachPlayerWheel', 'onResolve', 'vote'])
    expect(handlerIdsForNames(["Selvala's Stampede"]).toSorted()).toEqual(['onResolve', 'vote'])
    expect(handlerIdsForNames(['Coercive Portal'])).toEqual(['vote'])
    expect(cardDefinition('Erestor of the Council')?.effects)
      .toMatchObject([{ op: 'trigger', on: 'votesFinished' }])
  })
})

describe('Sail into the West', () => {
  const sailGame = () => {
    const game = server({
      hands: {
        p1: [sail(), ...filler('Hand A', 2)],
        p2: filler('Hand B', 3),
        p3: filler('Hand C', 1),
        p4: [],
      },
      libraries: {
        p1: filler('Lib A', 10),
        p2: filler('Lib B', 10),
        p3: filler('Lib C', 10),
        p4: filler('Lib D', 10),
      },
    })
    const ready = toGraveyard(game, game.state, ['Hand B 1', 'Hand B 2', 'Hand B 3', 'Hand C 1'])
    const funded = withMana(ready, 'p1', { G: 1, U: 1, C: 2 })
    return { game, state: cast(game, funded, 'p1', 'Sail into the West') }
  }

  test('casting and resolving opens a public return/embark vote in turn order from the caster', () => {
    const { game, state } = sailGame()
    expect(pendingVote(state)).toMatchObject({
      source: 'Sail into the West',
      owner: 'p1',
      secret: false,
      voters: ['p1', 'p2', 'p3', 'p4'],
      options: [{ id: 'return', label: 'Return' }, { id: 'embark', label: 'Embark' }],
    })
    expect(pendingOptionSelection(state, 'p1')?.options.map((option) => option.id))
      .toEqual(['return', 'embark'])
    // Only the voter in turn is asked, and only with a legal option.
    expect(answer(game, state, 'p2', 'return').ok).toBe(false)
    expect(answer(game, state, 'p1', 'neither').ok).toBe(false)
    expect(game.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    // A public vote shows every cast vote to every seat.
    const afterOne = ok(answer(game, state, 'p1', 'return'))
    expect(pendingVote(projectForViewer(afterOne, 'p3'))?.votes).toEqual({ p1: 'return' })
  })

  test('return wins: each player returns up to two graveyard cards privately, then Sail is exiled', () => {
    const { game, state } = sailGame()
    const voted = castVotes(game, state, [
      ['p1', 'return'], ['p2', 'return'], ['p3', 'embark'], ['p4', 'return'],
    ])
    expect(finishedEvent(voted.last).result).toMatchObject({
      tallies: { return: 3, embark: 1 },
      winners: ['return'],
      tied: false,
    })
    // The resolving spell sits in the graveyard now but is never a candidate.
    expect(pendingSelectionFor(voted.state, 'p1')).toBeUndefined()
    const second = pendingSelectionFor(voted.state, 'p2')!
    expect(second).toMatchObject({ count: 2, min: 0, fromZone: 'graveyard', fromSeat: 'p2' })
    expect(second.candidates.toSorted())
      .toEqual(['Hand B 1', 'Hand B 2', 'Hand B 3'].map((name) => named(state, name).id).toSorted())
    const third = pendingSelectionFor(voted.state, 'p3')!
    expect(third).toMatchObject({ count: 1, fromSeat: 'p3' })
    expect(pendingSelectionFor(voted.state, 'p4')).toBeUndefined()
    // Each player's choice is private to that player.
    expect(pendingSelectionFor(projectForViewer(voted.state, 'p2'), 'p2')).toBeDefined()
    expect(pendingSelectionFor(projectForViewer(voted.state, 'p1'), 'p2')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(voted.state, 'p3'), 'p2')).toBeUndefined()

    const pick = (current: GameState, seat: PlayerId, names: string[], count: number) =>
      game.rules(current, {
        type: 'selectCards',
        seat,
        kind: 'choose',
        count,
        objectIds: names.map((name) => named(state, name).id),
      })
    // Too many cards, another seat's cards, and a spell's own card are all refused.
    expect(pick(voted.state, 'p2', ['Hand B 1', 'Hand B 2', 'Hand B 3'], 2).ok).toBe(false)
    expect(pick(voted.state, 'p2', ['Hand C 1'], 2).ok).toBe(false)
    expect(pick(voted.state, 'p2', ['Sail into the West'], 2).ok).toBe(false)

    // A host restart mid-resolution keeps the same open choices.
    let current = structuredClone(voted.state)
    current = ok(pick(current, 'p2', ['Hand B 1', 'Hand B 3'], 2))
    current = ok(pick(current, 'p3', ['Hand C 1'], 1))
    current = resolveStack(game.rules, current)
    expect(current.zoneOrder.p2.hand.toSorted())
      .toEqual(['Hand B 1', 'Hand B 3'].map((name) => named(state, name).id).toSorted())
    expect(current.zoneOrder.p3.hand).toEqual([named(state, 'Hand C 1').id])
    expect(on(current, 'Hand B 2')).toBe('graveyard')
    expect(on(current, 'Sail into the West')).toBe('exile')
    expect(current.zoneOrder.p1.exile).toContain(named(state, 'Sail into the West').id)
    // Nobody discarded their hand.
    expect(current.zoneOrder.p1.hand).toHaveLength(2)
    for (const seat of current.playerOrder) {
      expect(pendingSelectionFor(current, seat)).toBeUndefined()
    }
  })

  test('a tie goes to embark: each player may discard their hand and draw seven, one at a time', () => {
    const { game, state } = sailGame()
    const voted = castVotes(game, state, [
      ['p1', 'return'], ['p2', 'embark'], ['p3', 'return'], ['p4', 'embark'],
    ])
    expect(finishedEvent(voted.last).result).toMatchObject({
      tallies: { return: 2, embark: 2 },
      tied: true,
    })
    // Nobody returned a card: the question is the wheel, asked of one seat at a time.
    for (const seat of voted.state.playerOrder) {
      expect(pendingSelectionFor(voted.state, seat)).toBeUndefined()
    }
    expect(pendingOptionSelection(voted.state, 'p1')?.options.map((option) => option.id))
      .toEqual(['wheel', 'keep'])
    expect(pendingOptionSelection(voted.state, 'p2')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(voted.state, 'p2'), 'p1')).toBeUndefined()
    expect(answer(game, voted.state, 'p2', 'wheel').ok).toBe(false)

    let current = ok(answer(game, voted.state, 'p1', 'wheel'))
    expect(current.zoneOrder.p1.hand).toHaveLength(7)
    expect(['Hand A 1', 'Hand A 2'].map((name) => on(current, name)))
      .toEqual(['graveyard', 'graveyard'])
    current = ok(answer(game, current, 'p2', 'keep'))
    expect(current.zoneOrder.p2.hand).toHaveLength(0)
    current = ok(answer(game, current, 'p3', 'wheel'))
    expect(current.zoneOrder.p3.hand).toHaveLength(7)
    current = ok(answer(game, current, 'p4', 'wheel'))
    expect(current.zoneOrder.p4.hand).toHaveLength(7)
    expect(pendingOptionSelection(current)).toBeUndefined()
    // Embark does not exile Sail: it goes to the graveyard like any instant.
    expect(on(current, 'Sail into the West')).toBe('graveyard')
  })

  test('embark winning outright wheels too, and the open wheel survives a restart', () => {
    const { game, state } = sailGame()
    const voted = castVotes(game, state, [
      ['p1', 'embark'], ['p2', 'embark'], ['p3', 'embark'], ['p4', 'return'],
    ])
    const restarted = structuredClone(voted.state)
    expect(pendingOptionSelection(restarted, 'p1')?.id).toBe(pendingOptionSelection(voted.state, 'p1')!.id)
    const current = ok(answer(game, restarted, 'p1', 'keep'))
    expect(pendingOptionSelection(current, 'p2')).toBeDefined()
    expect(on(current, 'Sail into the West')).toBe('graveyard')
  })

  test('an open vote survives a host restart and still resolves', () => {
    const { game, state } = sailGame()
    const midway = ok(answer(game, state, 'p1', 'return'))
    const reloaded = structuredClone(midway)
    expect(pendingVote(reloaded)?.votes).toEqual({ p1: 'return' })
    expect(pendingOptionSelection(reloaded, 'p2')).toBeDefined()
    const done = castVotes(game, reloaded, [['p2', 'return'], ['p3', 'return'], ['p4', 'return']])
    expect(finishedEvent(done.last).result.winners).toEqual(['return'])
    expect(pendingSelectionFor(done.state, 'p2')).toBeDefined()
  })
})

describe("Selvala's Stampede", () => {
  const stampedeGame = (library: ReturnType<typeof cardTemplate>[], hand: ReturnType<typeof cardTemplate>[]) => {
    const game = server({
      hands: { p1: [stampede(), ...hand], p2: [bear('Their Card')] },
      libraries: { p1: library, p2: [bear('Their Library Creature')] },
    })
    const funded = withMana(game.state, 'p1', { G: 2, C: 4 })
    return { game, state: cast(game, funded, 'p1', "Selvala's Stampede") }
  }

  const library = () => [
    cardTemplate('Plains', { types: ['Land'] }),
    bear('First Creature'),
    cardTemplate('Island', { types: ['Land'] }),
    bear('Second Creature'),
    bear('Third Creature'),
    cardTemplate('Bottom Land', { types: ['Land'] }),
  ]

  test('the vote is public and starts with the caster', () => {
    const { state } = stampedeGame(library(), [])
    expect(pendingVote(state)).toMatchObject({
      owner: 'p1',
      secret: false,
      voters: ['p1', 'p2', 'p3', 'p4'],
      options: [{ id: 'wild', label: 'Wild' }, { id: 'free', label: 'Free' }],
    })
  })

  test('wild votes reveal the CASTER library to that many creatures; the rest is shuffled back', () => {
    const { game, state } = stampedeGame(library(), [])
    const done = castVotes(game, state, [
      ['p1', 'wild'], ['p2', 'wild'], ['p3', 'free'], ['p4', 'free'],
    ])
    const current = resolveStack(game.rules, done.state)
    expect(on(current, 'First Creature')).toBe('battlefield')
    expect(on(current, 'Second Creature')).toBe('battlefield')
    expect(on(current, 'Third Creature')).toBe('library')
    // Revealed noncreature cards are shuffled into the library, not lost or milled.
    expect(['Plains', 'Island', 'Bottom Land'].map((name) => on(current, name)))
      .toEqual(['library', 'library', 'library'])
    expect(current.zoneOrder.p1.library).toHaveLength(4)
    expect(named(current, 'First Creature').controller).toBe('p1')
    // The opponents' libraries and hands are untouched.
    expect(on(current, 'Their Library Creature')).toBe('library')
    expect(current.zoneOrder.p2.hand).toEqual([named(current, 'Their Card').id])
    expect(current.log.some((line) => line.includes('Selvala'))).toBe(true)
  })

  test('free votes let the CASTER put up to that many permanent cards from hand, never other types', () => {
    const hand = [
      bear('Hand Creature'),
      cardTemplate('Hand Relic', { types: ['Artifact'] }),
      cardTemplate('Hand Land', { types: ['Land'] }),
      cardTemplate('Hand Instant', { types: ['Instant'] }),
    ]
    const { game, state } = stampedeGame(library(), hand)
    const done = castVotes(game, state, [
      ['p1', 'free'], ['p2', 'wild'], ['p3', 'free'], ['p4', 'free'],
    ])
    // One wild vote reveals up to the first creature; the free votes open the dump.
    expect(on(done.state, 'First Creature')).toBe('battlefield')
    expect(on(done.state, 'Second Creature')).toBe('library')
    const dialog = pendingDialog(done.state)
    expect(dialog).toMatchObject({
      kind: 'put-permanents',
      seat: 'p1',
      optional: true,
      permanent: true,
      requirements: { battlefield: { max: 3 } },
    })
    expect(dialogCandidates(done.state, dialog!).map((object) => object.name).toSorted())
      .toEqual(['Hand Creature', 'Hand Land', 'Hand Relic'])
    // Only the caster is asked, and nobody else sees the question.
    expect(pendingDialog(projectForViewer(done.state, 'p2'))).toBeUndefined()

    let current = done.state
    for (const name of ['Hand Creature', 'Hand Relic']) {
      current = ok(game.rules(current, { type: 'move', objectId: named(current, name).id, to: 'battlefield' }))
    }
    current = ok(game.rules(current, { type: 'custom', name: DIALOG_CHOSEN, seat: 'p1' }))
    expect(pendingDialog(current)).toBeUndefined()
    expect(on(current, 'Hand Creature')).toBe('battlefield')
    expect(on(current, 'Hand Relic')).toBe('battlefield')
    expect(on(current, 'Hand Land')).toBe('hand')
    expect(on(current, 'Hand Instant')).toBe('hand')
    expect(on(current, "Selvala's Stampede")).toBe('graveyard')
  })

  test('a wild-only vote reveals more creatures than the library holds without a dump', () => {
    const { game, state } = stampedeGame([
      cardTemplate('Plains', { types: ['Land'] }),
      bear('Only Creature'),
      cardTemplate('Island', { types: ['Land'] }),
    ], [bear('Hand Creature')])
    const done = castVotes(game, state, [
      ['p1', 'wild'], ['p2', 'wild'], ['p3', 'wild'], ['p4', 'wild'],
    ])
    const current = resolveStack(game.rules, done.state)
    expect(on(current, 'Only Creature')).toBe('battlefield')
    expect(current.zoneOrder.p1.library).toHaveLength(2)
    expect(pendingDialog(current)).toBeUndefined()
    expect(on(current, 'Hand Creature')).toBe('hand')
  })

  test('all free votes reveal nothing and offer up to four permanents; restart keeps the offer', () => {
    const { game, state } = stampedeGame(library(), [bear('Hand Creature')])
    const done = castVotes(game, state, [
      ['p1', 'free'], ['p2', 'free'], ['p3', 'free'], ['p4', 'free'],
    ])
    expect(['First Creature', 'Second Creature'].map((name) => on(done.state, name)))
      .toEqual(['library', 'library'])
    expect(pendingDialog(done.state)).toMatchObject({
      kind: 'put-permanents',
      requirements: { battlefield: { max: 4 } },
    })
    const restarted = structuredClone(done.state)
    expect(pendingDialog(restarted)).toMatchObject({ seat: 'p1', kind: 'put-permanents' })
  })

  test('an open vote survives a host restart', () => {
    const { game, state } = stampedeGame(library(), [])
    const midway = ok(answer(game, state, 'p1', 'wild'))
    const reloaded = structuredClone(midway)
    const done = castVotes(game, reloaded, [['p2', 'wild'], ['p3', 'wild'], ['p4', 'wild']])
    const current = resolveStack(game.rules, done.state)
    expect(['First Creature', 'Second Creature', 'Third Creature'].map((name) => on(current, name)))
      .toEqual(['battlefield', 'battlefield', 'battlefield'])
  })
})

describe('Coercive Portal', () => {
  const portalGame = (extra: Parameters<typeof createServerGame>[1] = {}) => {
    const game = server({
      battlefield: {
        p1: [portal(), bear('Mine'), cardTemplate('Home Forest', { types: ['Land'] })],
        p2: [
          bear('Theirs'),
          cardTemplate('Their Relic', { types: ['Artifact'] }),
          cardTemplate('Their Aura', { types: ['Enchantment'] }),
          bear('Eternal', { oracleText: 'Indestructible' }),
          cardTemplate('Away Forest', { types: ['Land'] }),
        ],
      },
      libraries: { p1: filler('Lib A', 5), p2: filler('Lib B', 5) },
      ...extra,
    })
    return game
  }

  test('triggers only at its controller upkeep and asks a public carnage/homage vote', () => {
    const game = portalGame()
    const mine = atUpkeep(game)
    expect(mine.stack[0]).toMatchObject({ name: 'Coercive Portal', controller: 'p1' })
    const opened = ok(game.rules(mine, { type: 'resolveTop' }))
    expect(pendingVote(opened)).toMatchObject({
      source: 'Coercive Portal',
      owner: 'p1',
      secret: false,
      voters: ['p1', 'p2', 'p3', 'p4'],
      options: [{ id: 'carnage', label: 'Carnage' }, { id: 'homage', label: 'Homage' }],
    })
    // An opponent's upkeep does not ask anything.
    const theirs = atUpkeep(game, 'p2')
    expect(theirs.stack).toHaveLength(0)
  })

  test('homage winning draws a card for the controller and keeps every permanent', () => {
    const game = portalGame()
    const opened = ok(game.rules(atUpkeep(game), { type: 'resolveTop' }))
    const done = castVotes(game, opened, [
      ['p1', 'homage'], ['p2', 'carnage'], ['p3', 'homage'], ['p4', 'carnage'],
    ])
    expect(finishedEvent(done.last).result).toMatchObject({ tied: true })
    // A tie counts as homage.
    expect(done.state.zoneOrder.p1.hand).toHaveLength(1)
    expect(on(done.state, 'Coercive Portal')).toBe('battlefield')
    expect(on(done.state, 'Theirs')).toBe('battlefield')

    const clear = castVotes(game, opened, [
      ['p1', 'homage'], ['p2', 'homage'], ['p3', 'carnage'], ['p4', 'homage'],
    ])
    expect(clear.state.zoneOrder.p1.hand).toHaveLength(1)
    expect(clear.state.zoneOrder.p2.hand).toHaveLength(0)
    expect(on(clear.state, 'Coercive Portal')).toBe('battlefield')
    expect(on(clear.state, 'Mine')).toBe('battlefield')
  })

  test('carnage winning sacrifices the Portal and destroys every nonland permanent', () => {
    const game = portalGame()
    const opened = ok(game.rules(atUpkeep(game), { type: 'resolveTop' }))
    const done = castVotes(game, opened, [
      ['p1', 'homage'], ['p2', 'carnage'], ['p3', 'carnage'], ['p4', 'carnage'],
    ])
    const current = resolveStack(game.rules, done.state)
    expect(on(current, 'Coercive Portal')).toBe('graveyard')
    expect(['Mine', 'Theirs', 'Their Relic', 'Their Aura'].map((name) => on(current, name)))
      .toEqual(['graveyard', 'graveyard', 'graveyard', 'graveyard'])
    expect(on(current, 'Eternal')).toBe('battlefield')
    expect(on(current, 'Home Forest')).toBe('battlefield')
    expect(on(current, 'Away Forest')).toBe('battlefield')
    // Carnage is not "homage": nobody draws.
    expect(current.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('an open vote survives a host restart and a tie still draws', () => {
    const game = portalGame()
    const opened = ok(game.rules(atUpkeep(game), { type: 'resolveTop' }))
    const midway = ok(answer(game, opened, 'p1', 'carnage'))
    const reloaded = structuredClone(midway)
    expect(pendingVote(reloaded)?.votes).toEqual({ p1: 'carnage' })
    const done = castVotes(game, reloaded, [['p2', 'carnage'], ['p3', 'homage'], ['p4', 'homage']])
    expect(finishedEvent(done.last).result.tied).toBe(true)
    expect(done.state.zoneOrder.p1.hand).toHaveLength(1)
    expect(done.state.players.p1.data[PENDING_VOTE]).toBeUndefined()
  })
})

describe('Erestor of the Council', () => {
  const withErestor = (extra: Parameters<typeof createServerGame>[1]) => server({
    battlefield: { p2: [erestor()] },
    libraries: { p2: filler('Erestor Lib', 6), p1: filler('Lib A', 6), p3: filler('Lib C', 6), p4: filler('Lib D', 6) },
    ...extra,
  })

  test('a Sail vote: agreeing opponents get Treasures, disagreeing ones size the scry, then the controller draws', () => {
    const game = withErestor({
      hands: { p1: [cardTemplate('Sail into the West', { types: ['Instant'], manaCost: '{2}{G}{U}', manaValue: 4 })] },
    })
    const funded = withMana(game.state, 'p1', { G: 1, U: 1, C: 2 })
    const voting = cast(game, funded, 'p1', 'Sail into the West')
    // Erestor (p2) votes embark; p1 and p4 agree, p3 disagrees.
    const done = castVotes(game, voting, [
      ['p1', 'embark'], ['p2', 'embark'], ['p3', 'return'], ['p4', 'embark'],
    ])
    // The trigger waits on the stack while the wheel question is open.
    const trigger = done.state.stack.find((item) => item.name === 'Erestor of the Council')!
    expect(trigger).toMatchObject({ controller: 'p2' })
    expect(trigger.payload).toMatchObject({ vote: { tallies: { return: 1, embark: 3 } } })
    const handBefore = done.state.zoneOrder.p2.hand.length

    const resolved = ok(game.rules(done.state, { type: 'resolveTop' }))
    expect(treasures(resolved, 'p1')).toHaveLength(1)
    expect(treasures(resolved, 'p4')).toHaveLength(1)
    expect(treasures(resolved, 'p3')).toHaveLength(0)
    expect(treasures(resolved, 'p2')).toHaveLength(0)
    expect(pendingSelectionFor(resolved, 'p2')).toMatchObject({ kind: 'scry', count: 1 })
    expect(resolved.zoneOrder.p2.hand).toHaveLength(handBefore)
    const scry = pendingSelectionFor(resolved, 'p2')!
    const scried = ok(game.rules(resolved, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'scry',
      count: 1,
      choices: scry.candidates.map((objectId) => ({ objectId, destination: 'top' as const })),
    }))
    expect(scried.zoneOrder.p2.hand).toHaveLength(handBefore + 1)
    // Sail's own wheel question is still the caster's to answer.
    expect(pendingOptionSelection(scried, 'p1')?.options.map((option) => option.id))
      .toEqual(['wheel', 'keep'])
  })

  test("Círdan's secret vote: Erestor hears it, with Treasures, a scry sized by disagreeing opponents, and a draw", () => {
    const cirdan = cardTemplate('Círdan the Shipwright', {
      types: ['Creature'],
      supertypes: ['Legendary'],
      power: 3,
      toughness: 4,
      manaCost: '{3}{G}{U}',
      manaValue: 5,
    })
    const game = withErestor({ hands: { p1: [cirdan] } })
    const entered = resolveStack(game.rules, ok(game.rules(game.state, {
      type: 'move',
      objectId: named(game.state, 'Círdan the Shipwright').id,
      to: 'battlefield',
    })))
    expect(pendingDialog(entered)).toMatchObject({ kind: 'secret-vote', seat: 'p1' })
    // Erestor's controller (p2) votes for p3. p1 and p4 agree, p3 disagrees.
    const afterVotes = secretVoteFrom(game, entered, [
      ['p1', 'p3'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p3'],
    ])
    expect(afterVotes.players.p1.data[SECRET_COUNCIL]).toBeUndefined()
    const trigger = afterVotes.stack.find((item) => item.name === 'Erestor of the Council')
    expect(trigger).toMatchObject({
      controller: 'p2',
      payload: { vote: { votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3' } } },
    })
    // Círdan's own dumps for p1 and p2 (no votes received) come first.
    let current = afterVotes
    for (const seat of ['p1', 'p2'] as const) {
      expect(pendingDialog(current)).toMatchObject({ kind: 'put-permanents', seat })
      current = ok(game.rules(current, { type: 'custom', name: DIALOG_CHOSEN, seat }))
    }
    const handBefore = current.zoneOrder.p2.hand.length
    current = ok(game.rules(current, { type: 'resolveTop' }))
    // Voting for p3: p1 and p4 voted for p3 as well and each gets a Treasure.
    expect(treasures(current, 'p1')).toHaveLength(1)
    expect(treasures(current, 'p4')).toHaveLength(1)
    expect(treasures(current, 'p3')).toHaveLength(0)
    expect(treasures(current, 'p2')).toHaveLength(0)
    // p3 voted differently: scry 1, and only then does Erestor's controller draw.
    expect(pendingSelectionFor(current, 'p2')).toMatchObject({ kind: 'scry', count: 1 })
    expect(current.zoneOrder.p2.hand).toHaveLength(handBefore)
    const scry = pendingSelectionFor(current, 'p2')!
    current = ok(game.rules(current, {
      type: 'selectCards',
      seat: 'p2',
      kind: 'scry',
      count: 1,
      choices: scry.candidates.map((objectId) => ({ objectId, destination: 'top' as const })),
    }))
    expect(current.zoneOrder.p2.hand).toHaveLength(handBefore + 1)
  })

  test("Council's Judgment: everybody voting alike gives every opponent a Treasure and no scry", () => {
    const game = withErestor({
      hands: { p1: [cardTemplate("Council's Judgment", { types: ['Sorcery'], manaCost: '{1}{W}{W}', manaValue: 3 })] },
      battlefield: {
        p2: [erestor(), bear('Target')],
        p3: [bear('Other')],
      },
    })
    const funded = withMana(game.state, 'p1', { W: 2, C: 1 })
    const voting = cast(game, funded, 'p1', "Council's Judgment")
    const target = named(voting, 'Target').id
    // p1 can't vote for its own permanents; the options are the opponents' nonland permanents.
    const done = castVotes(game, voting, [
      ['p1', target], ['p2', target], ['p3', target], ['p4', target],
    ])
    expect(on(done.state, 'Target')).toBe('exile')
    const current = resolveStack(game.rules, done.state)
    expect(treasures(current, 'p1')).toHaveLength(1)
    expect(treasures(current, 'p3')).toHaveLength(1)
    expect(treasures(current, 'p4')).toHaveLength(1)
    expect(treasures(current, 'p2')).toHaveLength(0)
    expect(pendingSelectionFor(current, 'p2')).toBeUndefined()
    expect(current.zoneOrder.p2.hand).toHaveLength(1)
  })

  test('every opponent voting differently scries for each of them and makes no Treasure', () => {
    const game = withErestor({
      hands: { p1: [cardTemplate('Sail into the West', { types: ['Instant'], manaCost: '{2}{G}{U}', manaValue: 4 })] },
    })
    const funded = withMana(game.state, 'p1', { G: 1, U: 1, C: 2 })
    const voting = cast(game, funded, 'p1', 'Sail into the West')
    const done = castVotes(game, voting, [
      ['p1', 'return'], ['p2', 'embark'], ['p3', 'return'], ['p4', 'return'],
    ])
    let current = done.state
    // Resolve the Erestor trigger on top of the wheel question.
    current = ok(game.rules(current, { type: 'resolveTop' }))
    expect(Object.values(current.objects).some((object) => object.name === 'Treasure')).toBe(false)
    expect(pendingSelectionFor(current, 'p2')).toMatchObject({ kind: 'scry', count: 3 })
  })
})
