import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { effectsFor } from './cardRules'
import { allNamed, deckCard, fixtureCreature, named } from './cirdanCreatureCards'
import { activate, targetOnResolve } from './effects'
import { cardPluginEntry } from './index'
import { targetedResolve } from './targetedResolve'

const stats = (state: GameState, name: string) => {
  const object = named(state, name)
  return [object.power, object.toughness]
}

const move = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
  to: 'battlefield' | 'graveyard' | 'exile' = 'battlefield',
) => ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to }))

/** "Target creature gets hit": a spell that targets, so hexproof is visible from its legality. */
const probe = (name: string) => cardTemplate(name, {
  types: ['Instant'],
  effects: [targetOnResolve('select', { zone: 'battlefield', type: 'Creature' })],
})

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

const lieutenantGame = () => {
  const server = createServerGame(
    commanderRules,
    {
      players: 3,
      battlefield: {
        p1: [
          deckCard('Thunderfoot Baloth'),
          fixtureCreature('Ally Bear'),
          cardTemplate('Ally Relic', { types: ['Artifact'] }),
        ],
        p2: [fixtureCreature('Enemy Bear')],
      },
      command: {
        p1: [fixtureCreature('Our General', { power: 3, toughness: 3, tags: ['commander'] })],
        p2: [fixtureCreature('Their General', { power: 3, toughness: 3, tags: ['commander'] })],
      },
    },
    { random: () => 0.5 },
  )
  return { server, start: ok(server.rules(server.state, { type: 'custom', name: 'staticBoardPump.sync' })) }
}

describe('Archetype of Endurance', () => {
  test('registers a grant for its controller and a suppression for opponents, nothing else', () => {
    expect(effectsFor('Archetype of Endurance')).toEqual([
      {
        op: 'static',
        pluginId: 'staticBoardPump',
        staticBoardPump: {
          power: 0,
          toughness: 0,
          requireTypes: ['Creature'],
          grantKeywords: ['hexproof'],
        },
      },
      {
        op: 'static',
        pluginId: 'staticBoardPump',
        staticBoardPump: {
          power: 0,
          toughness: 0,
          requireTypes: ['Creature'],
          controller: 'opponent',
          suppressKeywords: ['hexproof'],
        },
      },
    ])
    expect(cardPluginEntry('Archetype of Endurance')).toMatchObject({
      pluginIds: ['staticBoardPump', 'staticBoardPump'],
    })
  })

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
    const state = move(server, start, 'Archetype of Endurance')
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
    const state = move(server, start, 'Archetype of Endurance')
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(false)
    expect(cast(state, 'p3', 'Probe Three', 'Archetype of Endurance')).toBe(false)
    expect(cast(state, 'p1', 'Probe One', 'Ally Bear')).toBe(true)
    expect(cast(state, 'p1', 'Probe One', 'Archetype of Endurance')).toBe(true)
  })

  test('you can target an opposing creature that printed hexproof, and opponents among themselves still can', () => {
    const { server, start, cast } = archetypeGame()
    const state = move(server, start, 'Archetype of Endurance')
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
    let state = move(server, start, 'Archetype of Endurance')
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
    let state = move(server, start, 'Archetype of Endurance')
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(false)
    state = move(server, state, 'Archetype of Endurance', 'graveyard')
    expect(hasKeyword(named(state, 'Ally Bear'), 'hexproof', state)).toBe(false)
    expect(cast(state, 'p2', 'Probe Two', 'Ally Bear')).toBe(true)
  })

  test('a creature entering later is covered by the same layer', () => {
    const { server, start, cast } = archetypeGame({
      hands: { p1: [deckCard('Archetype of Endurance'), probe('Probe One'), fixtureCreature('Late Bear')] },
    })
    let state = move(server, start, 'Archetype of Endurance')
    expect(hasKeyword(named(state, 'Late Bear'), 'hexproof', state)).toBe(false)
    state = move(server, state, 'Late Bear')
    expect(hasKeyword(named(state, 'Late Bear'), 'hexproof', state)).toBe(true)
    expect(cast(state, 'p2', 'Probe Two', 'Late Bear')).toBe(false)
  })

  test('your creature that changes controller loses your hexproof and gains none from the new side', () => {
    const { server, start } = archetypeGame()
    let state = move(server, start, 'Archetype of Endurance')
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
    const state = structuredClone(move(server, start, 'Archetype of Endurance'))
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

describe('Thunderfoot Baloth', () => {
  test('registers two commander-conditioned layer effects and no handler', () => {
    expect(cardPluginEntry('Thunderfoot Baloth')).toMatchObject({
      pluginIds: ['staticBoardPump', 'staticBoardPump'],
    })
    expect(effectsFor('Thunderfoot Baloth').map((effect) =>
      effect.op === 'static' ? effect.staticBoardPump : undefined)).toEqual([
      { power: 2, toughness: 2, requireTypes: ['Creature'], if: { kind: 'controlsCommander' }, affects: 'self' },
      {
        power: 2,
        toughness: 2,
        requireTypes: ['Creature'],
        if: { kind: 'controlsCommander' },
        affects: 'others',
        grantKeywords: ['trample'],
      },
    ])
  })


  test('without the commander it is a vanilla 5/5 trampler and its team is untouched', () => {
    const { start } = lieutenantGame()
    expect(hasKeyword(named(start, 'Thunderfoot Baloth'), 'trample', start)).toBe(true)
    expect(stats(start, 'Thunderfoot Baloth')).toEqual([5, 5])
    expect(stats(start, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(start, 'Ally Bear'), 'trample', start)).toBe(false)
  })

  test('with your commander out it is 7/7 and your other creatures get +2/+2 and trample', () => {
    const { server, start } = lieutenantGame()
    const state = move(server, start, 'Our General')
    expect(stats(state, 'Thunderfoot Baloth')).toEqual([7, 7])
    expect(stats(state, 'Ally Bear')).toEqual([4, 4])
    expect(stats(state, 'Our General')).toEqual([5, 5])
    expect(hasKeyword(named(state, 'Ally Bear'), 'trample', state)).toBe(true)
    expect(hasKeyword(named(state, 'Our General'), 'trample', state)).toBe(true)
    expect(stats(state, 'Enemy Bear')).toEqual([2, 2])
    expect(hasKeyword(named(state, 'Enemy Bear'), 'trample', state)).toBe(false)
    // It never grants itself the keyword twice; it already has trample printed.
    expect(hasKeyword(named(state, 'Thunderfoot Baloth'), 'trample', state)).toBe(true)
    // Noncreatures are not pumped.
    expect(stats(state, 'Ally Relic')).toEqual([null, null])
  })

  test('another player commander does not count, and losing the commander removes everything', () => {
    const { server, start } = lieutenantGame()
    const theirs = move(server, start, 'Their General')
    expect(stats(theirs, 'Thunderfoot Baloth')).toEqual([5, 5])
    expect(stats(theirs, 'Ally Bear')).toEqual([2, 2])

    const arrived = move(server, start, 'Our General')
    const left = move(server, arrived, 'Our General', 'exile')
    expect(named(left, 'Our General').zone).toBe('command')
    expect(stats(left, 'Thunderfoot Baloth')).toEqual([5, 5])
    expect(stats(left, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(left, 'Ally Bear'), 'trample', left)).toBe(false)
    const again = move(server, left, 'Our General')
    expect(stats(again, 'Thunderfoot Baloth')).toEqual([7, 7])
    expect(stats(again, 'Ally Bear')).toEqual([4, 4])
  })

  test('if the Baloth is the commander, it pumps itself and the rest of the team', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [deckCard('Thunderfoot Baloth', { tags: ['commander'] }), fixtureCreature('Ally Bear')],
        },
      },
      { random: () => 0.5 },
    )
    const state = ok(server.rules(server.state, { type: 'custom', name: 'staticBoardPump.sync' }))
    expect(stats(state, 'Thunderfoot Baloth')).toEqual([7, 7])
    expect(stats(state, 'Ally Bear')).toEqual([4, 4])
  })

  test('the pump goes away with the Baloth', () => {
    const { server, start } = lieutenantGame()
    const arrived = move(server, start, 'Our General')
    const gone = move(server, arrived, 'Thunderfoot Baloth', 'graveyard')
    expect(stats(gone, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(gone, 'Ally Bear'), 'trample', gone)).toBe(false)
    expect(stats(gone, 'Our General')).toEqual([3, 3])
  })
})
