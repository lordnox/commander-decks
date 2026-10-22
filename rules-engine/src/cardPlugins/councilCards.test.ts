import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import {
  DIALOG_CHOSEN,
  pendingDialog,
} from '../pendingDialog'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, PlayerId, ReduceResult } from '../types'
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

const on = (state: GameState, name: string) => named(state, name).zone

const stampede = () => cardTemplate("Selvala's Stampede", {
  types: ['Sorcery'],
  manaCost: '{4}{G}{G}',
  manaValue: 6,
})

const portal = () => cardTemplate('Coercive Portal', { types: ['Artifact'], manaCost: '{4}', manaValue: 4 })

const atUpkeep = (game: Server, active: PlayerId = 'p1') => {
  let current: GameState = { ...structuredClone(game.state), step: 'untap' as const, active, priority: active }
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
    const dump = pendingSelectionFor(done.state, 'p1')!
    expect(dump).toMatchObject({ kind: 'choose', seat: 'p1', min: 0, count: 3 })
    expect(dump.candidates.map((id) => done.state.objects[id].name).toSorted())
      .toEqual(['Hand Creature', 'Hand Land', 'Hand Relic'])
    expect(pendingSelectionFor(projectForViewer(done.state, 'p2'), 'p1')).toBeUndefined()

    let current = ok(game.rules(done.state, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: dump.id,
      kind: 'choose',
      count: 3,
      objectIds: [named(done.state, 'Hand Creature').id, named(done.state, 'Hand Relic').id],
    }))
    expect(pendingSelectionFor(current, 'p1')).toBeUndefined()
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
    expect(pendingSelectionFor(current, 'p1')).toBeUndefined()
    expect(on(current, 'Hand Creature')).toBe('hand')
  })

  test('all free votes reveal nothing and offer up to four permanents; restart keeps the offer', () => {
    const { game, state } = stampedeGame(library(), [
      bear('Hand Creature'),
      bear('Hand Beast'),
      cardTemplate('Hand Relic', { types: ['Artifact'] }),
      cardTemplate('Hand Land', { types: ['Land'] }),
    ])
    const done = castVotes(game, state, [
      ['p1', 'free'], ['p2', 'free'], ['p3', 'free'], ['p4', 'free'],
    ])
    expect(['First Creature', 'Second Creature'].map((name) => on(done.state, name)))
      .toEqual(['library', 'library'])
    expect(pendingSelectionFor(done.state, 'p1')).toMatchObject({ kind: 'choose', count: 4, min: 0 })
    const restarted = structuredClone(done.state)
    expect(pendingSelectionFor(restarted, 'p1')).toMatchObject({ seat: 'p1', kind: 'choose' })
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
    // The trigger is captured while Sail finishes its wheel questions, then is
    // placed only after that resolving spell reaches its checkpoint.
    expect(done.state.pendingTriggers?.[0]).toMatchObject({
      source: { name: 'Erestor of the Council', controller: 'p2' },
      payload: { vote: { tallies: { return: 1, embark: 3 } } },
    })
    let afterSail = done.state
    for (const seat of afterSail.playerOrder) {
      afterSail = ok(answer(game, afterSail, seat, 'decline'))
    }
    expect(afterSail.stack[0]).toMatchObject({ name: 'Erestor of the Council', controller: 'p2' })
    const handBefore = afterSail.zoneOrder.p2.hand.length

    const resolved = ok(game.rules(afterSail, { type: 'resolveTop' }))
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
    expect(on(scried, 'Sail into the West')).toBe('graveyard')
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
    expect(afterVotes.pendingTriggers?.[0]).toMatchObject({
      source: { name: 'Erestor of the Council', controller: 'p2' },
      payload: { vote: { votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3' } } },
    })
    // Círdan's own dumps for p1 and p2 (no votes received) come first.
    let current = afterVotes
    for (const seat of ['p1', 'p2'] as const) {
      expect(pendingDialog(current)).toMatchObject({ kind: 'put-permanents', seat })
      current = ok(game.rules(current, { type: 'custom', name: DIALOG_CHOSEN, seat }))
    }
    expect(current.stack[0]).toMatchObject({ name: 'Erestor of the Council', controller: 'p2' })
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
    // Return found no graveyard cards, so Sail finishes and places Erestor.
    current = ok(game.rules(current, { type: 'resolveTop' }))
    expect(Object.values(current.objects).some((object) => object.name === 'Treasure')).toBe(false)
    expect(pendingSelectionFor(current, 'p2')).toMatchObject({ kind: 'scry', count: 3 })
  })
})
