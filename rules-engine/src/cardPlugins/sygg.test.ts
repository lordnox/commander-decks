import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { choiceEffects } from './choiceEffects'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, ...extra })

const syggCard = () => card('Sygg, River Cutthroat', ['Creature'], {
  subtypes: ['Merfolk', 'Rogue'],
  supertypes: ['Legendary'],
  power: 1,
  toughness: 3,
  oracleText:
    'At the beginning of each end step, if an opponent lost 3 or more life this turn, '
    + 'you may draw a card.',
})

/** Walk to the end step of the turn the state is currently in. */
const toEndStep = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => {
  let current = state
  while (current.step !== 'end') {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

const game = () => createServerGame(
  commanderRules,
  {
    battlefield: { p3: [syggCard()] },
    libraries: { p3: [card('Island', ['Land']), card('Swamp', ['Land'])] },
  },
  { random: () => 0.5, cardPlugins: [choiceEffects] },
)

const resolveSyggTrigger = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => resolveStack(server.rules, state)

test('an opponent bleeding three life puts Sygg on the stack before the draw choice', () => {
  const server = game()
  const bled = ok(server.rules(server.state, {
    type: 'loseLife',
    seat: 'p1',
    amount: 3,
  }))

  const ending = toEndStep(server, bled)

  expect(pendingDialog(ending)).toBeUndefined()
  expect(ending.stack[0]).toMatchObject({
    kind: 'ability',
    name: 'Sygg, River Cutthroat',
    controller: 'p3',
  })

  const offered = resolveSyggTrigger(server, ending)
  expect(pendingDialog(offered)).toMatchObject({
    kind: 'may-draw',
    seat: 'p3',
    source: 'Sygg, River Cutthroat',
  })
})

test('accepting the trigger draws a card and declining does not', () => {
  const server = game()
  const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 5 }))
  const ending = resolveSyggTrigger(server, toEndStep(server, bled))
  const before = ending.zoneCounts.p3.hand

  const drawn = ok(server.rules(ending, {
    type: 'custom',
    name: DIALOG_CHOSEN,
    seat: 'p3',
    payload: { accepted: true },
  }))
  const declined = ok(server.rules(ending, {
    type: 'custom',
    name: DIALOG_CHOSEN,
    seat: 'p3',
    payload: { accepted: false },
  }))

  expect(drawn.zoneCounts.p3.hand).toBe(before + 1)
  expect(pendingDialog(drawn)).toBeUndefined()
  expect(declined.zoneCounts.p3.hand).toBe(before)
  expect(pendingDialog(declined)).toBeUndefined()
})

test('an opponent who died to that life loss still counts', () => {
  const server = game()
  let current = ok(server.rules(server.state, {
    type: 'loseLife',
    seat: 'p1',
    amount: 60,
  }))
  current = ok(server.rules(current, { type: 'concede', seat: 'p1' }))

  const ending = toEndStep(server, current)

  expect(ending.players.p1.lost).toBe(true)
  expect(ending.stack[0]).toMatchObject({ kind: 'ability', name: 'Sygg, River Cutthroat' })
  expect(pendingDialog(resolveSyggTrigger(server, ending))).toMatchObject({
    kind: 'may-draw',
    seat: 'p3',
  })
})

test('two life lost by an opponent is not enough', () => {
  const server = game()
  const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 2 }))

  const ending = toEndStep(server, bled)

  expect(ending.stack).toHaveLength(0)
  expect(pendingDialog(ending)).toBeUndefined()
})

test("Sygg's own life loss does not trigger it", () => {
  const server = game()
  const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p3', amount: 9 }))

  const ending = toEndStep(server, bled)

  expect(ending.stack).toHaveLength(0)
  expect(pendingDialog(ending)).toBeUndefined()
})

test('life lost on an earlier turn does not carry over', () => {
  const server = game()
  const bled = ok(server.rules(server.state, { type: 'loseLife', seat: 'p1', amount: 6 }))
  let current = resolveSyggTrigger(server, toEndStep(server, bled))
  current = ok(server.rules(current, {
    type: 'custom',
    name: DIALOG_CHOSEN,
    seat: 'p3',
    payload: { accepted: false },
  }))

  // Walk into the next turn, whose untap step resets every "this turn" count.
  while (current.step !== 'end' || current.turn === bled.turn) {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }

  expect(current.turn).toBeGreaterThan(bled.turn)
  expect(current.stack).toHaveLength(0)
  expect(pendingDialog(current)).toBeUndefined()
})
