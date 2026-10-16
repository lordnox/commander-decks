import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { deckCard, fixtureCreature } from './cirdanCreatureCards'
import { pluginIdsFromEffects } from './effectRuntime'
import { staticBoardPump as pumpEffect } from './effects'
import { staticBoardPump } from './staticBoardPump'

import {resolveStack} from '../testHelpers'







import { targetedResolve } from './targetedResolve'
const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

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

const lord = () => cardTemplate('Land-Creature Lord', {
  types: ['Creature'],
  power: 3,
  toughness: 3,
  effects: [pumpEffect(1, 1, ['Creature', 'Land'])],
})

const forestDryad = () => cardTemplate('Forest Dryad', {
  types: ['Creature', 'Land'],
  subtypes: ['Forest', 'Dryad'],
  power: 1,
  toughness: 1,
})

const bear = () => cardTemplate('Plain Bear', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

describe('static board pump for land creatures', () => {
  test('stamped effects grant the staticBoardPump plugin', () => {
    expect(pluginIdsFromEffects([pumpEffect(1, 1, ['Creature', 'Land'])]))
      .toEqual(['staticBoardPump'])
    expect(staticBoardPump.id).toBe('staticBoardPump')
  })

  test('a Forest Dryad gets +1/+1 and a non-land creature does not', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [lord(), forestDryad(), bear()] } },
      { random: () => 0.5 },
    )
    const dryadId = Object.values(server.state.objects)
      .find((object) => object.name === 'Forest Dryad')!.id
    const bearId = Object.values(server.state.objects)
      .find((object) => object.name === 'Plain Bear')!.id
    const state = ok(server.rules(server.state, {
      type: 'custom',
      name: 'staticBoardPump.sync',
    }))
    expect([state.objects[dryadId].power, state.objects[dryadId].toughness]).toEqual([2, 2])
    expect([state.objects[bearId].power, state.objects[bearId].toughness]).toEqual([2, 2])
  })

  test("an opponent's land creature is unchanged", () => {
    const server = createServerGame(
      commanderRules,
      {
        players: ['p1', 'p2'],
        battlefield: {
          p1: [lord()],
          p2: [forestDryad()],
        },
      },
      { random: () => 0.5 },
    )
    const dryadId = Object.values(server.state.objects)
      .find((object) => object.name === 'Forest Dryad')!.id
    const state = ok(server.rules(server.state, {
      type: 'custom',
      name: 'staticBoardPump.sync',
    }))
    expect([state.objects[dryadId].power, state.objects[dryadId].toughness]).toEqual([1, 1])
  })

  test('structuredClone keeps the staticBoardPump static effect', () => {
    const stamped = [pumpEffect(1, 1, ['Creature', 'Land'])]
    expect(structuredClone(stamped)).toEqual(stamped)
  })
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

describe('Thunderfoot Baloth', () => {
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

describe('relocated from sinFallGaps.test.ts → staticBoardPump.test.ts', () => {
  const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types, ...extra })

  const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Colossification attaches, taps, and pumps the creature', () => {
      const server = createServerGame(
        commanderRules,
        {
          battlefield: {
            p1: [card('Bear', ['Creature'], { power: 2, toughness: 2 })],
          },
          hands: {
            p1: [card('Colossification', ['Enchantment'], {
              subtypes: ['Aura'],
              manaCost: '{5}{G}{G}',
            })],
          },
        },
        { random: () => 0.5, cardPlugins: [targetedResolve] },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 5 }
      const aura = named(ready, 'Colossification').id
      const bear = named(ready, 'Bear').id
      const entered = resolveStack(server.rules, ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: aura,
        targets: [{ kind: 'object', objectId: bear }],
      })))
      expect(entered.objects[aura].attachedTo).toBe(bear)
      expect(entered.objects[bear]).toMatchObject({
        tapped: true,
        power: 22,
        toughness: 22,
      })
    })

})
