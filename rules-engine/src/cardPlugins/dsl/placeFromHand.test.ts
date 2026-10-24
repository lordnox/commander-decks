import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import {
  captureAmount,
  choice,
  chooseCards,
  chooseCardsForEachPlayer,
  compareAmount,
  forEachPlayer,
  move,
  objects,
  players,
  ref,
  repeatWhile,
  resultAmount,
} from './v1'

const aceL = [
  { type: 'Artifact' },
  { type: 'Creature' },
  { type: 'Enchantment' },
  { type: 'Land' },
] as const

const permanents = [
  ...aceL,
  { type: 'Battle' },
  { type: 'Planeswalker' },
] as const

const showAndTell = {
  instructions: [
    chooseCardsForEachPlayer({
      of: players(),
      filter: objects({ zone: 'hand', owner: ref('event.player'), any: aceL }),
      min: 0,
      max: 1,
      bindChoice: 'placed',
    }),
    move({ targets: choice('placed'), to: 'battlefield' }),
  ],
}

const placementRound = forEachPlayer({
  of: players(),
  bindMax: { from: 'placed', field: 'amount', as: 'roundPuts' },
  instructions: [
    chooseCards({
      chooser: ref('event.player'),
      filter: objects({ zone: 'hand', owner: ref('event.player'), any: permanents }),
      min: 0,
      max: 1,
      bindChoice: 'chosen',
    }),
    move({ targets: choice('chosen'), to: 'battlefield', bindResult: 'placed' }),
  ],
})

const eureka = {
  instructions: [
    captureAmount({ amount: 0, bindResult: 'roundPuts' }),
    repeatWhile({
      condition: compareAmount(resultAmount('roundPuts'), 'gte', 1),
      instructions: [placementRound],
    }),
  ],
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const creature = (name: string) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2 })
const land = (name: string) => cardTemplate(name, { types: ['Land'], subtypes: ['Forest'], tapProduces: { G: 1 } })
const walker = (name: string) => cardTemplate(name, { types: ['Planeswalker'], printedLoyalty: 3 })
const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })

const setup = (program: Parameters<typeof instructionSpell>[0], hands: Record<string, ReturnType<typeof cardTemplate>[]>) =>
  createServerGame(commanderRules, {
    players: 3,
    hands: {
      p1: [instructionSpell(program), ...hands.p1 ?? []],
      p2: hands.p2 ?? [],
      p3: hands.p3 ?? [],
    },
  }, { random: () => 0 })

const begin = (server: ReturnType<typeof setup>, active?: 'p1' | 'p2' | 'p3') => {
  const initial = active && active !== 'p1' ? structuredClone(server.state) : server.state
  if (active && active !== 'p1') {
    initial.active = active
    initial.priority = 'p1'
  }
  const cast = ok(server.rules(initial, { type: 'castSpell', seat: 'p1', objectId: initial.zoneOrder.p1.hand[0]! }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

const choose = (server: ReturnType<typeof setup>, state: GameState, seat: string, names: readonly string[]) => {
  const pending = pendingSelectionFor(state, seat)!
  const objectIds = names.map(name => named(state, name).id)
  const event = { type: 'selectCards' as const, seat, selectionId: pending.id, kind: 'choose' as const, count: pending.count, objectIds }
  const direct = ok(server.rules(state, event))
  expect(ok(server.rules(JSON.parse(JSON.stringify(state)), event))).toEqual(direct)
  return direct
}

test('Show and Tell keeps chosen cards in hand until every seat has chosen, then they enter together', () => {
  const server = setup(showAndTell, {
    p1: [creature('Bear'), instant('Lightning')],
    p2: [land('Forest'), walker('Walker')],
    p3: [cardTemplate('Aura', { types: ['Enchantment'] })],
  })
  let state = begin(server)
  const chosen: string[] = []
  for (const [seat, name] of [['p1', 'Bear'], ['p2', 'Forest'], ['p3', 'Aura']] as const) {
    const pending = pendingSelectionFor(state, seat)!
    const own = server.project(state, seat)
    const other = seat === 'p1' ? 'p2' : 'p1'
    for (const id of state.zoneOrder[other].hand) expect(own.objects[id]).toBeUndefined()
    expect(pending.candidates).not.toContain(named(state, 'Lightning').id)
    expect(pending.candidates).not.toContain(named(state, 'Walker').id)
    for (const id of chosen) expect(state.objects[id]!.zone).toBe('hand')
    chosen.push(named(state, name).id)
    state = choose(server, state, seat, [name])
  }
  for (const id of chosen) expect(state.objects[id]!.zone).toBe('battlefield')
  expect(named(state, 'Lightning').zone).toBe('hand')
  expect(named(state, 'Walker').zone).toBe('hand')
  expect(state.resolution).toBeUndefined()
})

test('Show and Tell follows APNAP order and lets a seat decline', () => {
  const server = setup(showAndTell, {
    p1: [creature('Bear')],
    p2: [land('Forest')],
    p3: [creature('Elf')],
  })
  let state = begin(server, 'p2')
  expect(pendingSelectionFor(state, 'p2')!.seat).toBe('p2')
  state = choose(server, state, 'p2', ['Forest'])
  expect(named(state, 'Forest').zone).toBe('hand')
  expect(pendingSelectionFor(state, 'p3')!.seat).toBe('p3')
  state = choose(server, state, 'p3', [])
  expect(pendingSelectionFor(state, 'p1')!.seat).toBe('p1')
  state = choose(server, state, 'p1', ['Bear'])
  expect(named(state, 'Bear').zone).toBe('battlefield')
  expect(named(state, 'Forest').zone).toBe('battlefield')
  expect(named(state, 'Elf').zone).toBe('hand')
  expect(state.resolution).toBeUndefined()
})

test('Eureka puts each chosen card before the next seat chooses, then stops after a full decline', () => {
  const server = setup(eureka, {
    p1: [creature('Bear'), walker('Walker')],
    p2: [land('Forest'), land('Island'), instant('Lightning')],
    p3: [creature('Elf')],
  })
  let state = begin(server)
  expect(pendingSelectionFor(state, 'p1')!.candidates).toContain(named(state, 'Walker').id)
  expect(pendingSelectionFor(state, 'p1')!.candidates).not.toContain(named(state, 'Lightning').id)
  state = choose(server, state, 'p1', ['Bear'])
  expect(named(state, 'Bear').zone).toBe('battlefield')
  expect(pendingSelectionFor(state, 'p2')).toBeDefined()
  expect(pendingSelectionFor(state, 'p2')!.candidates).not.toContain(named(state, 'Lightning').id)
  state = choose(server, state, 'p2', ['Forest'])
  expect(named(state, 'Forest').zone).toBe('battlefield')
  state = choose(server, state, 'p3', [])
  expect(named(state, 'Elf').zone).toBe('hand')
  expect(pendingSelectionFor(state, 'p1')).toBeDefined()
  state = choose(server, state, 'p1', [])
  state = choose(server, state, 'p2', [])
  state = choose(server, state, 'p3', [])
  expect(named(state, 'Walker').zone).toBe('hand')
  expect(named(state, 'Island').zone).toBe('hand')
  expect(named(state, 'Elf').zone).toBe('hand')
  expect(state.resolution).toBeUndefined()
})

test('Eureka skips empty hands and stops when the first round puts nothing', () => {
  const server = setup(eureka, {
    p1: [instant('Lightning')],
    p2: [],
    p3: [creature('Elf')],
  })
  let state = begin(server)
  expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  expect(pendingSelectionFor(state, 'p2')).toBeUndefined()
  expect(pendingSelectionFor(state, 'p3')!.seat).toBe('p3')
  state = choose(server, state, 'p3', [])
  expect(named(state, 'Elf').zone).toBe('hand')
  expect(named(state, 'Lightning').zone).toBe('hand')
  expect(state.resolution).toBeUndefined()
})
