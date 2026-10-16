import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { allNamed, deckCard, fixtureCreature } from './cirdanCreatureCards'
import { activate, staticBoardPump, targetOnResolve } from './effects'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const stats = (state: GameState, name: string) => {
  const object = named(state, name)
  return [object.power, object.toughness]
}

const lieutenant = () => cardTemplate('Lieutenant Beast', {
  types: ['Creature'],
  power: 4,
  toughness: 4,
  effects: [
    staticBoardPump(2, 2, ['Creature'], { if: { kind: 'controlsCommander' }, affects: 'self' }),
    staticBoardPump(2, 2, ['Creature'], {
      if: { kind: 'controlsCommander' },
      affects: 'others',
      grantKeywords: ['trample'],
    }),
  ],
})

const commanderGame = () => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: {
        p1: [lieutenant(), cardTemplate('Ally Bear', { types: ['Creature'], power: 2, toughness: 2 })],
        p2: [cardTemplate('Enemy Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
      command: {
        p1: [cardTemplate('Our General', { types: ['Creature'], power: 3, toughness: 3 })],
        p2: [cardTemplate('Their General', { types: ['Creature'], power: 3, toughness: 3 })],
      },
    },
    { random: () => 0.5 },
  )
  const run = (state: GameState, ...events: GameEvent[]) =>
    events.reduce((current, event) => ok(server.rules(current, event)), state)
  return { server, run, start: server.state }
}

const move = (state: GameState, name: string, to: 'battlefield' | 'exile'): GameEvent => ({
  type: 'move',
  objectId: named(state, name).id,
  to,
})

describe('static pump with a controlsCommander condition', () => {
  test('the pump is inactive until the controller controls their commander', () => {
    const { start } = commanderGame()
    expect(stats(start, 'Lieutenant Beast')).toEqual([4, 4])
    expect(stats(start, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(start, 'Ally Bear'), 'trample', start)).toBe(false)
  })

  test('the commander arriving pumps the source and others, with trample only on others', () => {
    const { run, start } = commanderGame()
    const state = run(start, move(start, 'Our General', 'battlefield'))
    expect(stats(state, 'Lieutenant Beast')).toEqual([6, 6])
    expect(hasKeyword(named(state, 'Lieutenant Beast'), 'trample', state)).toBe(false)
    expect(stats(state, 'Ally Bear')).toEqual([4, 4])
    expect(hasKeyword(named(state, 'Ally Bear'), 'trample', state)).toBe(true)
    expect(stats(state, 'Our General')).toEqual([5, 5])
    expect(hasKeyword(named(state, 'Our General'), 'trample', state)).toBe(true)
    expect(stats(state, 'Enemy Bear')).toEqual([2, 2])
    expect(hasKeyword(named(state, 'Enemy Bear'), 'trample', state)).toBe(false)
  })

  test('the commander leaving, then returning, toggles the pump without drift', () => {
    const { run, start } = commanderGame()
    const arrived = run(start, move(start, 'Our General', 'battlefield'))
    const left = run(arrived, move(arrived, 'Our General', 'exile'))
    expect(named(left, 'Our General').zone).toBe('command')
    expect(stats(left, 'Lieutenant Beast')).toEqual([4, 4])
    expect(stats(left, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(left, 'Ally Bear'), 'trample', left)).toBe(false)
    expect(named(left, 'Ally Bear').continuousEffects).toBeUndefined()
    const again = run(left, move(left, 'Our General', 'battlefield'))
    expect(stats(again, 'Lieutenant Beast')).toEqual([6, 6])
    expect(stats(again, 'Ally Bear')).toEqual([4, 4])
  })

  test("another player's commander does not satisfy the condition", () => {
    const { run, start } = commanderGame()
    const state = run(start, move(start, 'Their General', 'battlefield'))
    expect(stats(state, 'Lieutenant Beast')).toEqual([4, 4])
    expect(stats(state, 'Ally Bear')).toEqual([2, 2])
  })

  test('the source leaving removes the pump and the keyword', () => {
    const { run, start } = commanderGame()
    const arrived = run(start, move(start, 'Our General', 'battlefield'))
    const gone = run(arrived, move(arrived, 'Lieutenant Beast', 'exile'))
    expect(stats(gone, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(gone, 'Ally Bear'), 'trample', gone)).toBe(false)
  })
})

const archetype = () => cardTemplate('Hexproof Boar', {
  types: ['Creature'],
  power: 4,
  toughness: 4,
  effects: [
    staticBoardPump(0, 0, ['Creature'], { grantKeywords: ['hexproof'] }),
    staticBoardPump(0, 0, ['Creature'], {
      controller: 'opponent',
      suppressKeywords: ['hexproof'],
    }),
  ],
})

const probe = (name: string) => cardTemplate(name, {
  types: ['Instant'],
  effects: [targetOnResolve('select', { zone: 'battlefield', type: 'Creature' })],
})

describe('static hexproof layer', () => {
  const hexproofGame = () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [probe('Probe One')], p2: [probe('Probe Two')] },
        battlefield: {
          p1: [archetype(), cardTemplate('Ally Bear', { types: ['Creature'] })],
          p2: [
            cardTemplate('Shrouded Elf', { types: ['Creature'], oracleText: 'Hexproof' }),
            cardTemplate('Enemy Bear', { types: ['Creature'] }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve] },
    )
    const state = ok(server.rules(server.state, { type: 'custom', name: 'staticBoardPump.sync' }))
    const casts = (from: 'p1' | 'p2', probeName: string, target: string, at = state) => server.rules(
      { ...at, priority: from },
      {
        type: 'castSpell',
        seat: from,
        objectId: named(at, probeName).id,
        targets: [{ kind: 'object', objectId: named(at, target).id }],
      },
    ).ok
    return { server, state, casts }
  }

  test('your creatures have hexproof and opposing creatures lose a printed hexproof', () => {
    const { state } = hexproofGame()
    expect(hasKeyword(named(state, 'Ally Bear'), 'hexproof', state)).toBe(true)
    expect(hasKeyword(named(state, 'Hexproof Boar'), 'hexproof', state)).toBe(true)
    expect(hasKeyword(named(state, 'Shrouded Elf'), 'hexproof', state)).toBe(false)
    expect(hasKeyword(named(state, 'Enemy Bear'), 'hexproof', state)).toBe(false)
  })

  test('targeting honors the granted and suppressed hexproof', () => {
    const { casts } = hexproofGame()
    expect(casts('p2', 'Probe Two', 'Ally Bear')).toBe(false)
    expect(casts('p2', 'Probe Two', 'Hexproof Boar')).toBe(false)
    expect(casts('p1', 'Probe One', 'Shrouded Elf')).toBe(true)
    expect(casts('p1', 'Probe One', 'Enemy Bear')).toBe(true)
    expect(casts('p1', 'Probe One', 'Ally Bear')).toBe(true)
  })

  test('removing the source restores printed hexproof and drops the granted hexproof', () => {
    const { server, state, casts } = hexproofGame()
    const after = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Hexproof Boar').id,
      to: 'graveyard',
    }))
    expect(hasKeyword(named(after, 'Shrouded Elf'), 'hexproof', after)).toBe(true)
    expect(hasKeyword(named(after, 'Ally Bear'), 'hexproof', after)).toBe(false)
    expect(casts('p1', 'Probe One', 'Shrouded Elf', after)).toBe(false)
    expect(casts('p2', 'Probe Two', 'Ally Bear', after)).toBe(true)
  })

  test('a creature arriving later is covered by the same layer', () => {
    const { server, state } = hexproofGame()
    const lateBear = (at: GameState) => named(at, 'Late Bear')
    const withHand = structuredClone(state)
    const late = createServerGame(
      commanderRules,
      { hands: { p1: [cardTemplate('Late Bear', { types: ['Creature'] })] } },
      { random: () => 0.5 },
    ).state
    const template = Object.values(late.objects)[0]
    withHand.objects.late = { ...template, id: 'late', zone: 'hand' }
    withHand.zoneOrder.p1.hand.push('late')
    withHand.zoneCounts.p1.hand += 1
    expect(hasKeyword(lateBear(withHand), 'hexproof', withHand)).toBe(false)
    const entered = ok(server.rules(withHand, { type: 'move', objectId: 'late', to: 'battlefield' }))
    expect(hasKeyword(lateBear(entered), 'hexproof', entered)).toBe(true)
  })
})

const applyMove = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
  to: 'battlefield' | 'graveyard' | 'exile' = 'battlefield',
) => ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to }))

/** An activated ability that targets a creature, to prove hexproof applies to abilities too. */
const poker = () => cardTemplate('Fixture Poker', {
  types: ['Creature'],
  effects: [activate({
    id: 'poker.poke',
    costs: {},
    targets: { filter: { zone: 'battlefield', type: 'Creature' } },
    do: [{ kind: 'gainLife', count: 1 }],
  })],
})

describe('Archetype of Endurance', () => {
  const archetypeGame = (extra: { p2?: CardTemplate[]; hands?: Record<string, CardTemplate[]> } = {}) => {
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [deckCard('Archetype of Endurance'), probe('Probe One')],
          p2: [probe('Probe Two')],
          p3: [probe('Probe Three')],
          ...extra.hands,
        },
        battlefield: {
          p1: [fixtureCreature('Ally Bear'), cardTemplate('Ally Relic', { types: ['Artifact'] }), poker()],
          p2: extra.p2 ?? [
            fixtureCreature('Shrouded Elf', { oracleText: 'Hexproof' }),
            fixtureCreature('Enemy Bear'),
          ],
          p3: [fixtureCreature('Third Bear')],
        },
      },
      { random: () => 0.5, cardPlugins: [targetedResolve, activated] },
    )
    const cast = (state: GameState, seat: 'p1' | 'p2' | 'p3', probeName: string, target: string) =>
      server.rules({ ...state, priority: seat }, {
        type: 'castSpell',
        seat,
        objectId: named(state, probeName).id,
        targets: [{ kind: 'object', objectId: named(state, target).id }],
      }).ok
    return { server, cast, start: server.state }
  }

  test('before it enters nothing has hexproof beyond what is printed', () => {
    const { start, cast } = archetypeGame()
    expect(hasKeyword(named(start, 'Ally Bear'), 'hexproof', start)).toBe(false)
    expect(hasKeyword(named(start, 'Shrouded Elf'), 'hexproof', start)).toBe(true)
    expect(cast(start, 'p2', 'Probe Two', 'Ally Bear')).toBe(true)
    expect(cast(start, 'p1', 'Probe One', 'Shrouded Elf')).toBe(false)
  })

  test('entering gives your creatures (itself too) hexproof and takes printed hexproof from opponents', () => {
    const { server, start } = archetypeGame()
    const state = applyMove(server, start, 'Archetype of Endurance')
    for (const name of ['Ally Bear', 'Archetype of Endurance', 'Fixture Poker']) {
      expect(hasKeyword(named(state, name), 'hexproof', state)).toBe(true)
    }
    for (const name of ['Shrouded Elf', 'Enemy Bear', 'Third Bear']) {
      expect(hasKeyword(named(state, name), 'hexproof', state)).toBe(false)
    }
    // It is only about creatures: the Relic does not gain hexproof.
    expect(hasKeyword(named(state, 'Ally Relic'), 'hexproof', state)).toBe(false)
    // The Archetype is a 6/5 and the layer adds nothing to stats.
    expect(stats(state, 'Archetype of Endurance')).toEqual([6, 5])
    expect(stats(state, 'Ally Bear')).toEqual([2, 2])
  })

  test('opponents cannot target your creatures with spells, but you and your noncreature permanents are open', () => {
    const { server, start, cast } = archetypeGame()
    const state = applyMove(server, start, 'Archetype of Endurance')
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(false)
    expect(cast(state, 'p3', 'Probe Three', 'Archetype of Endurance')).toBe(false)
    expect(cast(state, 'p1', 'Probe One', 'Ally Bear')).toBe(true)
    expect(cast(state, 'p1', 'Probe One', 'Archetype of Endurance')).toBe(true)
  })

  test('you can target an opposing creature that printed hexproof, and opponents among themselves still can', () => {
    const { server, start, cast } = archetypeGame()
    const state = applyMove(server, start, 'Archetype of Endurance')
    expect(cast(state, 'p1', 'Probe One', 'Shrouded Elf')).toBe(true)
    expect(cast(state, 'p3', 'Probe Three', 'Shrouded Elf')).toBe(true)
    expect(cast(state, 'p2', 'Probe Two', 'Third Bear')).toBe(true)
  })

  test('hexproof gained until end of turn is suppressed as well: an opponent cannot have or gain it', () => {
    const { server, start, cast } = archetypeGame({
      hands: {
        p2: [
          cardTemplate("Tamiyo's Safekeeping", { types: ['Instant'], manaCost: '{G}' }),
          probe('Probe Two'),
        ],
      },
    })
    let state = applyMove(server, start, 'Archetype of Endurance')
    state = structuredClone(state)
    state.players.p2.mana.G = 1
    state = ok(server.rules({ ...state, priority: 'p2' }, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(state, "Tamiyo's Safekeeping").id,
      targets: [{ kind: 'object', objectId: named(state, 'Enemy Bear').id }],
    }))
    state = resolveStack(server.rules, state)
    expect(hasKeyword(named(state, 'Enemy Bear'), 'hexproof', state)).toBe(false)
    expect(cast(state, 'p1', 'Probe One', 'Enemy Bear')).toBe(true)
  })

  test('the grant ends when the Archetype leaves, and opponents can target again', () => {
    const { server, start, cast } = archetypeGame({
      p2: [fixtureCreature('Enemy Bear')],
    })
    let state = applyMove(server, start, 'Archetype of Endurance')
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(false)
    state = applyMove(server, state, 'Archetype of Endurance', 'graveyard')
    expect(hasKeyword(named(state, 'Ally Bear'), 'hexproof', state)).toBe(false)
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(true)
  })

  test('a creature entering later is covered by the same layer', () => {
    const { server, start, cast } = archetypeGame({
      hands: { p1: [deckCard('Archetype of Endurance'), probe('Probe One'), fixtureCreature('Late Bear')] },
    })
    let state = applyMove(server, start, 'Archetype of Endurance')
    expect(hasKeyword(named(state, 'Late Bear'), 'hexproof', state)).toBe(false)
    state = applyMove(server, state, 'Late Bear')
    expect(hasKeyword(named(state, 'Late Bear'), 'hexproof', state)).toBe(true)
    expect(cast(state, 'p2', 'Probe Two', 'Late Bear')).toBe(false)
  })

  test('your creature that changes controller loses your hexproof and gains none from the new side', () => {
    const { server, start } = archetypeGame()
    let state = applyMove(server, start, 'Archetype of Endurance')
    expect(hasKeyword(named(state, 'Ally Bear'), 'hexproof', state)).toBe(true)
    state = ok(server.rules(state, {
      type: 'move',
      objectId: named(state, 'Ally Bear').id,
      to: 'battlefield',
      controller: 'p2',
    }))
    expect(named(state, 'Ally Bear').controller).toBe('p2')
    expect(hasKeyword(named(state, 'Ally Bear'), 'hexproof', state)).toBe(false)
  })

  test("two Archetypes: each one's suppression beats the other's grant, so no creature has hexproof", () => {
    const { server, start, cast } = archetypeGame({
      p2: [deckCard('Archetype of Endurance'), fixtureCreature('Enemy Bear')],
    })
    const inHand = allNamed(start, 'Archetype of Endurance').find((object) => object.zone === 'hand')!
    expect(inHand.controller).toBe('p1')
    const state = ok(server.rules(start, { type: 'move', objectId: inHand.id, to: 'battlefield' }))
    expect(allNamed(state, 'Archetype of Endurance').map((object) => object.zone))
      .toEqual(['battlefield', 'battlefield'])
    const creatures = Object.values(state.objects).filter((object) =>
      object.zone === 'battlefield' && object.types.includes('Creature'))
    expect(creatures.length).toBeGreaterThan(4)
    expect(creatures.filter((object) => hasKeyword(object, 'hexproof', state))).toEqual([])
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(true)

    // With the rival gone, the first Archetype's grant is back.
    const rival = allNamed(state, 'Archetype of Endurance').find((object) => object.controller === 'p2')!
    const rivalGone = ok(server.rules(state, { type: 'move', objectId: rival.id, to: 'graveyard' }))
    expect(hasKeyword(named(rivalGone, 'Ally Bear'), 'hexproof', rivalGone)).toBe(true)
    expect(cast(rivalGone, 'p2', 'Probe Two', 'Ally Bear')).toBe(false)
  })

  test('an activated ability of an opponent cannot target a hexproof creature either', () => {
    const { server, start } = archetypeGame()
    const state = structuredClone(applyMove(server, start, 'Archetype of Endurance'))
    const opponentPoker = ok(server.rules(
      { ...state, active: 'p2', priority: 'p2' } as GameState,
      { type: 'move', objectId: named(state, 'Fixture Poker').id, to: 'battlefield', controller: 'p2' },
    ))
    const event: GameEvent = {
      type: 'activateAbility',
      abilityId: 'poker.poke',
      seat: 'p2',
      objectId: named(opponentPoker, 'Fixture Poker').id,
      targets: [{ kind: 'object', objectId: named(opponentPoker, 'Ally Bear').id }],
    }
    expect(server.rules({ ...opponentPoker, active: 'p2', priority: 'p2' }, event).ok).toBe(false)
  })
})
