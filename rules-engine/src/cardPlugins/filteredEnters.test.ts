import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { createTokenInstruction, enters, gainLife, type TargetFilter, type TokenSpec } from './effects'

const whiteKnight = {
  name: 'White Knight', types: ['Creature'], subtypes: ['Knight'], colors: ['W'],
  power: 2, toughness: 2,
}
const scenarios: { name: string; token: boolean; seat: 'p1' | 'p2'; spec: TokenSpec }[] = [
  { name: 'your white Knight token', token: true, seat: 'p1', spec: whiteKnight },
  { name: 'opponent white Knight token', token: true, seat: 'p2', spec: whiteKnight },
  { name: 'your blue Knight token', token: true, seat: 'p1', spec: { ...whiteKnight, colors: ['U'] } },
  { name: 'your multicolor Knight token', token: true, seat: 'p1', spec: { ...whiteKnight, colors: ['W', 'U'] } },
  { name: 'your white Soldier token', token: true, seat: 'p1', spec: { ...whiteKnight, subtypes: ['Soldier'] } },
  { name: 'your white Knight creature card', token: false, seat: 'p1', spec: whiteKnight },
  { name: 'your white noncreature token', token: true, seat: 'p1', spec: { ...whiteKnight, types: ['Artifact'] } },
  { name: 'your white land token', token: true, seat: 'p1', spec: { ...whiteKnight, types: ['Land'] } },
]

const filters: { name: string; filter: TargetFilter; matching: number[] }[] = [
  { name: 'white creature tokens', filter: { colors: ['W'], type: 'Creature', token: true }, matching: [0, 1, 3, 4] },
  { name: 'tokens under your control', filter: { token: true, controller: 'you' }, matching: [0, 2, 3, 4, 6, 7] },
  { name: 'Knight tokens', filter: { subtypes: ['Knight'], token: true }, matching: [0, 1, 2, 3, 6, 7] },
  { name: 'Knight creatures', filter: { type: 'Creature', subtypes: ['Knight'] }, matching: [0, 1, 2, 3, 5] },
  { name: 'white nonland permanents', filter: { colors: ['W'], nonland: true }, matching: [0, 1, 3, 4, 5, 6] },
  { name: 'your white Knight creature tokens', filter: {
    colors: ['W'], type: 'Creature', subtypes: ['Knight'], token: true, controller: 'you',
  }, matching: [0, 3] },
]

describe('filtered enters', () => {
  for (const { name, filter, matching } of filters) {
    scenarios.forEach((scenario, index) => {
      test(`${name}: ${scenario.name}`, () => {
        const entering = scenario.token
          ? cardTemplate('Maker', {
              types: ['Artifact'], effects: [enters(createTokenInstruction({ ...scenario.spec }))],
            })
          : cardTemplate(scenario.spec.name, { ...scenario.spec })
        const server = createServerGame(commanderRules, {
          players: 2,
          battlefield: { p1: [cardTemplate('Watcher', {
            types: ['Enchantment'], effects: [enters({ filter }, gainLife(1))],
          })] },
          hands: { [scenario.seat]: [entering] },
        }, { random: () => 0.5 })
        const objectId = server.state.zoneOrder[scenario.seat].hand[0]
        const moved = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
        const settled = resolveStack(server.rules, moved)
        expect(settled.players.p1.life).toBe(40 + (matching.includes(index) ? 1 : 0))
        expect(settled.players.p2.life).toBe(40)
      })
    })
  }

  test('unmarked token entry triggers a filtered entry watcher but not a creation watcher', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [
        cardTemplate('Entry Watcher', {
          types: ['Enchantment'], effects: [enters({ filter: { token: true } }, gainLife(1))],
        }),
        cardTemplate('Creation Watcher', {
          types: ['Enchantment'], effects: [enters({ filter: { token: true }, createdOnly: true }, gainLife(10))],
        }),
        cardTemplate('Knight Token', { types: ['Creature'], token: true }),
      ] },
    }, { random: () => 0.5 })
    const token = Object.values(server.state.objects).find((object) => object.token)!
    const entered = ok(server.rules(server.state, {
      type: 'custom', name: 'cardPlugins.permanentEntered', seat: 'p1', payload: { objectId: token.id },
    }))
    expect(entered.stack.map((item) => item.name)).toEqual(['Entry Watcher'])
    expect(resolveStack(server.rules, entered).players.p1.life).toBe(41)
  })
})
