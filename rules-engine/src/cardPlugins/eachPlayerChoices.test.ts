import { describe, expect, test } from 'bun:test'
import { projectForViewer } from '../index'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { instructionSpell } from './dsl/instructionTestSupport'
import { choice, chooseCardsForEachPlayer, chooseInstructions, discard, discardHands, draw, exileThisSpell as dslExileThisSpell, forEachPlayer, move, objects, players, ref } from './dsl/v1'






type Server = ReturnType<typeof createServerGame>

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const filler = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`${prefix} ${index + 1}`))

const permanent = (name: string, types: string[]) => cardTemplate(name, { types })

const card = (name: string, types: string[], extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types, ...extra })

const wheelProgram = () => forEachPlayer({
  of: players(),
  startingWith: ref('controller'),
  instructions: [chooseInstructions({
    chooser: ref('event.player'),
    prompt: 'You may discard your hand. If you do, draw 7 cards.',
    options: [
      {
        label: 'Discard your hand and draw 7 cards',
        instructions: [
          discardHands({ targets: ref('event.player') }),
          draw({ targets: ref('event.player'), count: 7 }),
        ],
      },
      { label: 'Keep your hand', instructions: [] },
    ],
  })],
})

const canonicalInstant = (name: string, instructions: NonNullable<Parameters<typeof instructionSpell>[0]['instructions']>) => ({
  ...instructionSpell({ instructions }, '{1}'),
  name,
})

const castAndResolve = (server: Server, state: GameState, seat: string, name: string) => {
  const ready = structuredClone(state)
  ready.players[seat].mana.C = 1
  const cast = ok(server.rules(ready, {
    type: 'castSpell',
    seat,
    objectId: named(ready, name).id,
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

const toGraveyard = (server: Server, state: GameState, prefix: string, count: number) => {
  let current = state
  for (let index = 1; index <= count; index += 1) {
    current = ok(server.rules(current, {
      type: 'move',
      objectId: named(current, `${prefix} ${index}`).id,
      to: 'graveyard',
    }))
  }
  return current
}

describe('eachPlayerReturn', () => {
  const returnServer = () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      first: 'p2',
      hands: {
        p2: [canonicalInstant('Common Grave', [
          chooseCardsForEachPlayer({
            of: players(),
            filter: objects({ zone: 'graveyard', owner: ref('event.player') }),
            min: 0,
            max: 2,
            bindChoice: 'returned',
          }),
          move({ targets: choice('returned'), to: 'hand' }),
          dslExileThisSpell(),
        ])],
        p1: filler('A', 3),
        p3: filler('C', 1),
      },
      libraries: { p1: filler('Lib', 3), p2: filler('Lib2', 3), p3: filler('Lib3', 3) },
    }, { random: () => 0.5 })
    const state = toGraveyard(server, toGraveyard(server, server.state, 'A', 3), 'C', 1)
    return { server, state }
  }

  test('is clone-safe', () => {
    const instructions = [
      chooseCardsForEachPlayer({
        of: players(), filter: objects({ zone: 'graveyard', owner: ref('event.player') }),
        min: 0, max: 2, bindChoice: 'returned',
      }),
      move({ targets: choice('returned'), to: 'hand' }),
      dslExileThisSpell(),
    ]
    expect(structuredClone(instructions)).toEqual(instructions)
  })

  test('opens a private choice per player with cards, in turn order', () => {
    const { server, state } = returnServer()
    const paused = castAndResolve(server, state, 'p2', 'Common Grave')
    expect(pendingSelectionFor(paused, 'p2')).toBeUndefined()
    const p3Card = named(state, 'C 1')
    expect(pendingSelectionFor(paused, 'p3')).toMatchObject({
      count: 1,
      min: 0,
      candidates: [p3Card.id],
      destinations: ['target'],
      targetIdentities: { [p3Card.id]: { zone: 'graveyard' } },
    })
    const first = pendingSelectionFor(paused, 'p3')!
    expect(pendingSelectionFor(paused, 'p1')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(paused, 'p1'), 'p3')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(paused, 'p3'), 'p3')).toBeDefined()

    const next = ok(server.rules(paused, {
      type: 'selectCards', seat: 'p3', selectionId: first.id, kind: 'choose', count: first.count,
      objectIds: [p3Card.id],
    }))
    expect(pendingSelectionFor(next, 'p1')).toMatchObject({
      count: 2,
      min: 0,
      candidates: ['A 1', 'A 2', 'A 3'].map((name) => named(state, name).id),
    })
    expect(pendingSelectionFor(projectForViewer(next, 'p1'), 'p1')).toBeDefined()
    expect(pendingSelectionFor(projectForViewer(next, 'p3'), 'p1')).toBeUndefined()
  })

  test('rejects illegal picks and completes after every seat answered, across a restart', () => {
    const { server, state } = returnServer()
    const paused = castAndResolve(server, state, 'p2', 'Common Grave')
    const reject = (seat: string, objectIds: string[]) =>
      server.rules(paused, { type: 'selectCards', seat, kind: 'choose', count: 2, objectIds })
    expect(reject('p1', ['A 1', 'A 2', 'A 3'].map((name) => named(state, name).id)).ok).toBe(false)
    expect(reject('p1', [named(state, 'C 1').id]).ok).toBe(false)
    expect(reject('p2', []).ok).toBe(false)

    const restarted = structuredClone(paused)
    let current = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p3',
      kind: 'choose',
      count: 1,
      objectIds: [named(state, 'C 1').id],
    }))
    current = ok(server.rules(current, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 2,
      objectIds: ['A 1', 'A 3'].map((name) => named(state, name).id),
    }))
    current = resolveStack(server.rules, current)
    expect(current.zoneOrder.p3.hand).toEqual([named(state, 'C 1').id])
    expect(current.zoneOrder.p1.hand.toSorted())
      .toEqual(['A 1', 'A 3'].map((name) => named(state, name).id).toSorted())
    expect(named(current, 'A 2').zone).toBe('graveyard')
    expect(named(current, 'Common Grave').zone).toBe('exile')
    for (const seat of current.playerOrder) {
      expect(pendingSelectionFor(current, seat)).toBeUndefined()
    }
  })

  test('a player may return nothing', () => {
    const { server, state } = returnServer()
    const paused = castAndResolve(server, state, 'p2', 'Common Grave')
    let current = ok(server.rules(paused, {
      type: 'selectCards',
      seat: 'p3',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    current = ok(server.rules(current, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 2,
      objectIds: [],
    }))
    current = resolveStack(server.rules, current)
    expect(current.zoneOrder.p3.hand).toEqual([])
    expect(current.zoneOrder.p1.hand).toEqual([])
    expect(named(current, 'Common Grave').zone).toBe('exile')
  })
})

describe('catalog loot discard lifecycle', () => {
  test("Collector's Vault draws, discards, and finishes with a Treasure", () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [cardTemplate("Collector's Vault", { types: ['Artifact'] })] },
      hands: { p1: [cardTemplate('Hand Fodder', { types: ['Instant'] })] },
      libraries: { p1: [cardTemplate('Library Card', { types: ['Instant'] })] },
    }, { random: () => 0.5 })
    const artifact = named(server.state, "Collector's Vault").id
    server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 }
    let resolved = ok(server.rules(server.state, { type: 'activateAbility', seat: 'p1', objectId: artifact, abilityId: '$.abilities[0]' }))
    const fodder = named(resolved, 'Hand Fodder').id
    for (let step = 0; step < 8; step += 1) {
      const pendingDiscard = pendingSelectionFor(resolved, 'p1')
      if (pendingDiscard) {
        resolved = ok(server.rules(resolved, { type: 'selectCards', seat: 'p1', kind: pendingDiscard.kind, count: pendingDiscard.count, objectIds: [fodder] }))
        continue
      }
      if (resolved.stack.length === 0 || resolved.stack[0]?.waiting) break
      resolved = ok(server.rules(resolved, { type: 'resolveTop' }))
    }
    expect(named(resolved, 'Library Card').zone).toBe('hand')
    expect(resolved.zoneOrder.p1.battlefield.filter((id) => resolved.objects[id].subtypes.includes('Treasure'))).toHaveLength(1)
    expect(projectForViewer(resolved, 'p2').zoneOrder.p1.library).toHaveLength(0)
  })
})

describe('catalog typed sacrifice selection', () => {
  test('Reprocess retains the optional typed sacrifice and draws for each selected permanent', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Reprocess', { types: ['Sorcery'], manaCost: '{2}{B}{B}' })] },
      battlefield: { p1: [permanent('Relic', ['Artifact']), permanent('Body', ['Creature']), permanent('Song', ['Enchantment'])] },
      libraries: { p1: [cardTemplate('Fresh', { types: ['Instant'] })] },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 2, R: 0, G: 0, C: 2 }
    const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: ready.zoneOrder.p1.hand[0] }))
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 2, min: 0, fromZone: 'battlefield' })
    expect(selection.candidates).toHaveLength(2)
    expect(server.project(choosing, 'p2').players.p1.data['kernel.pendingSelection']).toBeUndefined()
    const relic = named(choosing, 'Relic')
    expect(server.rules(choosing, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count,
      objectIds: [relic.id, relic.id],
    }).ok).toBe(false)
    const resolved = ok(server.rules(structuredClone(choosing), {
      type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: selection.count, objectIds: [relic.id],
    }))
    expect(resolved.objects[relic.id].zone).toBe('graveyard')
    expect(named(resolved, 'Fresh').zone).toBe('hand')
    expect(named(resolved, 'Song').zone).toBe('battlefield')
  })
})

describe('eachPlayerReturn after a pause', () => {
  test('never offers the resolving spell, which already sits in the graveyard', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [
          canonicalInstant('Paused Grave', [
            discard({ targets: players(), count: 1 }),
            chooseCardsForEachPlayer({
              of: players(), filter: objects({ zone: 'graveyard', owner: ref('event.player') }),
              min: 0, max: 2, bindChoice: 'returned',
            }),
            move({ targets: choice('returned'), to: 'hand' }),
            dslExileThisSpell(),
          ]),
          ...filler('Fodder', 1),
        ],
      },
      libraries: { p1: filler('Lib', 3) },
    }, { random: () => 0.5 })
    const paused = castAndResolve(server, server.state, 'p1', 'Paused Grave')
    const afterDiscard = resolveStack(server.rules, ok(server.rules(paused, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(paused, 'Fodder 1').id],
    })))
    expect(pendingSelectionFor(afterDiscard, 'p1')?.candidates)
      .toEqual([named(afterDiscard, 'Fodder 1').id])
  })
})

describe('eachPlayerMayWheel', () => {
  const wheelServer = () => createServerGame(commanderRules, {
    players: 3,
    first: 'p2',
    hands: {
      p2: [{ ...instructionSpell({ instructions: [wheelProgram()] }, '{1}'), name: 'Sweeping Tide' }],
      p1: filler('A', 2),
      p3: filler('C', 3),
    },
    libraries: { p1: filler('Lib', 10), p2: filler('Lib2', 10), p3: filler('Lib3', 10) },
  }, { random: () => 0.5 })

  test('is clone-safe', () => {
    expect(structuredClone(wheelProgram())).toEqual(wheelProgram())
  })

  test('asks one player at a time in turn order, privately, and each may decline', () => {
    const server = wheelServer()
    let state = castAndResolve(server, server.state, 'p2', 'Sweeping Tide')
    expect(pendingOptionSelection(state)?.seat).toBe('p2')
    expect(pendingOptionSelection(state, 'p3')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(state, 'p1'), 'p2')).toBeUndefined()
    expect(pendingOptionSelection(projectForViewer(state, 'p2'), 'p2')).toBeDefined()

    const first = pendingOptionSelection(state, 'p2')!
    expect(first.options.map((option) => option.id)).toEqual(['instruction:0', 'instruction:1'])
    expect(first.options.map((option) => option.label)).toEqual([
      'Discard your hand and draw 7 cards',
      'Keep your hand',
    ])
    const attempt = (seat: string, optionId: string, selectionId = first.id) =>
      server.rules(state, { type: 'selectOption', seat, selectionId, optionId })
    expect(attempt('p2', 'bogus').ok).toBe(false)
    expect(attempt('p3', 'instruction:0').ok).toBe(false)
    expect(attempt('p2', 'instruction:0', 'stale').ok).toBe(false)

    state = ok(attempt('p2', 'instruction:1'))
    expect(state.zoneOrder.p2.hand).toHaveLength(0)
    expect(pendingOptionSelection(state)?.seat).toBe('p3')

    const restarted = structuredClone(state)
    expect(pendingOptionSelection(restarted, 'p3')?.id).toBe(pendingOptionSelection(state, 'p3')!.id)
    state = ok(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p3',
      selectionId: pendingOptionSelection(restarted, 'p3')!.id,
      optionId: 'instruction:0',
    }))
    expect(state.zoneOrder.p3.hand).toHaveLength(7)
    expect(['C 1', 'C 2', 'C 3'].map((name) => named(state, name).zone))
      .toEqual(['graveyard', 'graveyard', 'graveyard'])

    expect(pendingOptionSelection(state)?.seat).toBe('p1')
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pendingOptionSelection(state, 'p1')!.id,
      optionId: 'instruction:1',
    }))
    expect(pendingOptionSelection(state)).toBeUndefined()
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
  })
})

describe('relocated from sinFallGaps.test.ts → eachPlayerChoices.test.ts', () => {
  test('Frantic Search draws two then discards two', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [
              {
                ...instructionSpell({ instructions: [
                  draw({ targets: ref('controller'), count: 2 }),
                  discard({ targets: ref('controller'), count: 2 }),
                ] }, '{2}{U}'),
                name: 'Frantic Search',
              },
              card('Keep', ['Instant']),
              card('Dump', ['Instant']),
            ],
          },
          libraries: { p1: [card('Drawn One', ['Instant']), card('Drawn Two', ['Instant'])] },
        },
        { random: () => 0.5 },
      )
      let state = structuredClone(server.state)
      state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
      const spell = named(state, 'Frantic Search').id
      state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell }))
      state = ok(server.rules(state, { type: 'resolveTop' }))
      expect(state.zoneOrder.p1.hand).toHaveLength(4)
      expect(pendingSelectionFor(state, 'p1')).toMatchObject({ kind: 'discard', count: 2 })
      const dump = named(state, 'Dump').id
      const keep = named(state, 'Keep').id
      state = ok(server.rules(state, {
        type: 'selectCards',
        seat: 'p1',
        kind: 'discard',
        count: 2,
        objectIds: [dump, keep],
      }))
      expect([dump, keep].every((id) => state.objects[id].zone === 'graveyard')).toBe(true)
    })

})
