import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState, ReduceResult } from '../types'
import { deckCard, fixtureCreature } from './cirdanCreatureCards'
import { resolveStack } from '../testHelpers'
import { amount, card, compileCardRuleDefinition, createDefinitionSnapshot, modifyStats, objects, staticAbility } from './dsl/v1'

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

const snapshot = (ability: ReturnType<typeof staticAbility>) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card([ability])))

const lord = () => cardTemplate('Land-Creature Lord', {
  types: ['Creature'],
  power: 3,
  toughness: 3,
  ruleDefinition: snapshot(staticAbility(modifyStats({
    targets: objects({ zone: 'battlefield', controller: 'you', all: [{ type: 'Creature' }, { type: 'Land' }] }),
    power: amount(1),
    toughness: amount(1),
  }))),
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
  test('a Forest Dryad gets +1/+1 and a non-land creature does not', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [lord(), forestDryad(), bear()] },
    }, { random: () => 0.5 })
    expect(stats(server.state, 'Forest Dryad')).toEqual([2, 2])
    expect(stats(server.state, 'Plain Bear')).toEqual([2, 2])
  })

  test("an opponent's land creature is unchanged", () => {
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: { p1: [lord()], p2: [forestDryad()] },
    }, { random: () => 0.5 })
    expect(stats(server.state, 'Forest Dryad')).toEqual([1, 1])
  })
})

const lieutenantGame = () => {
  const server = createServerGame(commanderRules, {
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
  }, { random: () => 0.5 })
  return { server, start: server.state }
}

describe('Thunderfoot Baloth', () => {
  test('without the commander it is a vanilla 5/5 trampler and its team is untouched', () => {
    const { start } = lieutenantGame()
    expect(hasKeyword(named(start, 'Thunderfoot Baloth'), 'trample')).toBe(true)
    expect(stats(start, 'Thunderfoot Baloth')).toEqual([5, 5])
    expect(stats(start, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(start, 'Ally Bear'), 'trample')).toBe(false)
  })

  test('with your commander out it is 7/7 and your other creatures get +2/+2 and trample', () => {
    const { server, start } = lieutenantGame()
    const state = move(server, start, 'Our General')
    expect(stats(state, 'Thunderfoot Baloth')).toEqual([7, 7])
    expect(stats(state, 'Ally Bear')).toEqual([4, 4])
    expect(stats(state, 'Our General')).toEqual([5, 5])
    expect(hasKeyword(named(state, 'Ally Bear'), 'trample')).toBe(true)
    expect(hasKeyword(named(state, 'Our General'), 'trample')).toBe(true)
    expect(stats(state, 'Enemy Bear')).toEqual([2, 2])
    expect(hasKeyword(named(state, 'Enemy Bear'), 'trample')).toBe(false)
    // It never grants itself the keyword twice; it already has trample printed.
    expect(hasKeyword(named(state, 'Thunderfoot Baloth'), 'trample')).toBe(true)
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
    expect(hasKeyword(named(left, 'Ally Bear'), 'trample')).toBe(false)
    const again = move(server, left, 'Our General')
    expect(stats(again, 'Thunderfoot Baloth')).toEqual([7, 7])
    expect(stats(again, 'Ally Bear')).toEqual([4, 4])
  })

  test('if the Baloth is the commander, it pumps itself and the rest of the team', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [deckCard('Thunderfoot Baloth', { tags: ['commander'] }), fixtureCreature('Ally Bear')] },
    }, { random: () => 0.5 })
    expect(stats(server.state, 'Thunderfoot Baloth')).toEqual([7, 7])
    expect(stats(server.state, 'Ally Bear')).toEqual([4, 4])
  })

  test('the pump goes away with the Baloth', () => {
    const { server, start } = lieutenantGame()
    const arrived = move(server, start, 'Our General')
    const gone = move(server, arrived, 'Thunderfoot Baloth', 'graveyard')
    expect(stats(gone, 'Ally Bear')).toEqual([2, 2])
    expect(hasKeyword(named(gone, 'Ally Bear'), 'trample')).toBe(false)
    expect(stats(gone, 'Our General')).toEqual([3, 3])
  })
})

describe('relocated from sinFallGaps.test.ts → staticBoardPump.test.ts', () => {
  const namedObject = (state: GameState, name: string) => named(state, name)

  test('Colossification attaches, taps, and pumps the creature', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate('Bear', { types: ['Creature'], power: 2, toughness: 2 })] },
      hands: { p1: [cardTemplate('Colossification')] },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    ready.players.p1!.mana = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 5 }
    const aura = namedObject(ready, 'Colossification').id
    const bearId = namedObject(ready, 'Bear').id
    const entered = resolveStack(server.rules, ok(server.rules(ready, {
      type: 'castSpell', seat: 'p1', objectId: aura,
      targets: [{ kind: 'object', objectId: bearId }],
    })))
    expect(entered.objects[aura]!.attachedTo).toBe(bearId)
    expect(entered.objects[bearId]).toMatchObject({ tapped: true, power: 22, toughness: 22 })
  })
})
