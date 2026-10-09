import { describe, expect, test } from 'bun:test'
import { amount, ref } from './cardPlugins/dsl/builders'
import { card } from './cardPlugins/dsl/sugar/card'
import { compileCardRuleDefinition, createDefinitionSnapshot } from './cardPlugins/dsl/compiler'
import type { Instruction } from './cardPlugins/dsl/schema/v1'
import { finishResolution, prepareResolutionStep, startCanonicalResolution } from './driver'
import { ptEqualsLife } from './cardPlugins/effects'
import { cdaLifePt } from './plugins/cdaLifePt'
import { freezeDraft, makeDraft } from './draft'
import { commanderRules } from './formats'
import { cardTemplate } from './newGame'
import { createServerGame, projectForViewer } from './runtime'
import { openOptionSelection, pendingOptionSelection } from './rules/selectOptions'
import type { GameState, Plugin, ReduceResult } from './types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const controller = ref('controller')

const snapshotFor = (...instructions: Instruction[]) => createDefinitionSnapshot(
  compileCardRuleDefinition(card([{
    kind: 'spell',
    costs: [],
    decisions: { targets: [] },
    instructions,
  }])),
)

const canonicalServer = (
  instructions: Instruction[],
  cardPlugins: Plugin[] = [],
) => createServerGame(commanderRules, {
  players: 2,
  hands: {
    p1: [cardTemplate('Canonical Test', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      ruleDefinition: snapshotFor(...instructions),
    })],
  },
}, { random: () => 0, cardPlugins })

const drawChoiceReplacement: Plugin = {
  id: 'test.drawChoiceReplacement',
  replace: ({ event }) => event.type === 'draw'
    ? { type: 'custom', name: 'test.openDrawChoice', seat: event.seat }
    : undefined,
  apply: ({ event, draft }) => {
    if (event.type !== 'custom' || event.name !== 'test.openDrawChoice') return
    const seat = typeof event.seat === 'string' ? event.seat : 'p1'
    openOptionSelection(draft, {
      seat,
      prompt: 'Choose whether the replacement finishes.',
      options: [{ id: 'continue', label: 'Continue' }],
      action: { kind: 'mana-choice', pools: { continue: {} } },
    })
  },
}

const cast = (server: ReturnType<typeof createServerGame>) => {
  const spell = Object.values(server.state.objects).find(
    (object) => object.name === 'Canonical Test',
  )!
  return ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: spell.id,
  }))
}

describe('durable canonical resolution driver', () => {
  test('commits each instruction before the next and defers lethal SBA checks', () => {
    const server = canonicalServer([
      { kind: 'loseLife', amount: amount(41), targets: controller },
      { kind: 'gainLife', amount: amount(42), targets: controller },
    ])
    const resolved = ok(server.rules(cast(server), { type: 'resolveTop' }))

    expect(resolved.players.p1.lost).toBe(false)
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.resolution).toBeUndefined()
    expect(resolved.stack).toEqual([])
  })

  test('marks a failed draw for the post-resolution SBA checkpoint', () => {
    const server = canonicalServer([
      { kind: 'draw', count: amount(1), targets: controller },
      { kind: 'gainLife', amount: amount(3), targets: controller },
    ])
    const resolved = ok(server.rules(cast(server), { type: 'resolveTop' }))

    expect(resolved.players.p1.life).toBe(43)
    expect(resolved.players.p1.lost).toBe(true)
    expect(resolved.log.some((line) => line.startsWith('p1 gains 3 life'))).toBe(true)
  })

  test('recomputes a zero-toughness CDA between instructions before the final SBA', () => {
    const vitality = cardTemplate('CDA Fixture', {
      types: ['Creature'],
      power: null,
      toughness: null,
      effects: [ptEqualsLife({ who: 'controller' })],
    })
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Canonical Test', {
          types: ['Instant'],
          manaCost: '{0}',
          manaValue: 0,
          ruleDefinition: snapshotFor(
            { kind: 'loseLife', amount: amount(40), targets: controller },
            { kind: 'gainLife', amount: amount(1), targets: controller },
          ),
        })],
      },
      battlefield: { p1: [vitality] },
    }, { random: () => 0, cardPlugins: [cdaLifePt] })

    const resolved = ok(server.rules(cast(server), { type: 'resolveTop' }))
    const creature = Object.values(resolved.objects).find((object) => object.name === 'CDA Fixture')!
    expect(resolved.players.p1.life).toBe(1)
    expect(resolved.players.p1.lost).toBe(false)
    expect(creature).toMatchObject({ zone: 'battlefield', power: 1, toughness: 1 })
  })

  test('all-pass resolves exactly one canonical top item and gives the active player priority', () => {
    const server = canonicalServer([
      { kind: 'gainLife', amount: amount(2), targets: controller },
    ])
    let state = cast(server)
    for (let index = 0; index < state.playerOrder.length; index += 1) {
      state = ok(server.rules(state, { type: 'passPriority', seat: state.priority! }))
    }

    expect(state.players.p1.life).toBe(42)
    expect(state.stack).toEqual([])
    expect(state.priority).toBe(state.active)
    expect(state.passedInRow).toEqual([])
  })

  test('all-pass canonical resolution suspends at a replacement choice without running SBAs', () => {
    const server = canonicalServer([
      { kind: 'loseLife', amount: amount(41), targets: controller },
      { kind: 'draw', count: amount(1), targets: controller },
      { kind: 'gainLife', amount: amount(42), targets: controller },
    ], [drawChoiceReplacement])
    let state = cast(server)
    for (let index = 0; index < state.playerOrder.length; index += 1) {
      state = ok(server.rules(state, { type: 'passPriority', seat: state.priority! }))
    }

    const pending = pendingOptionSelection(state, 'p1')
    expect(pending).toBeDefined()
    expect(state.resolution).toMatchObject({ kind: 'canonicalSpell', phase: 'waiting' })
    expect(state.priority).toBeNull()
    expect(pendingOptionSelection(projectForViewer(state, 'p1'), 'p1')).toBeDefined()
    expect(pendingOptionSelection(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
    expect(state.stack).toHaveLength(1)
    expect(state.players.p1.life).toBe(-1)
    expect(state.players.p1.lost).toBe(false)
    expect(server.rules(state, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)
    expect(server.rules(state, { type: 'resolveTop' }).ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending!.id,
      optionId: 'continue',
    }))
    expect(state.resolution).toBeUndefined()
    expect(state.stack).toEqual([])
    expect(state.players.p1.life).toBe(41)
    expect(state.players.p1.lost).toBe(false)
  })

  test('restores nested scopes and a pending instruction event from JSON data', () => {
    const server = canonicalServer([{
      kind: 'sequence',
      instructions: [
        { kind: 'gainLife', amount: amount(2), targets: controller },
        {
          kind: 'sequence',
          instructions: [{ kind: 'gainLife', amount: amount(3), targets: controller }],
        },
      ],
    }])
    const castState = cast(server)
    const draft = makeDraft(castState)
    startCanonicalResolution(draft, draft.stack[0])
    expect(prepareResolutionStep(draft)).toMatchObject({ kind: 'events' })
    const suspended = freezeDraft(draft)
    expect(suspended.resolution?.kind).toBe('canonicalSpell')
    if (suspended.resolution?.kind !== 'canonicalSpell') throw new Error('missing frame')
    expect(suspended.resolution.scopes.map(({ cursor }) => cursor)).toEqual([1, 1])
    expect(suspended.resolution.pendingEvents).toHaveLength(1)

    const restored = JSON.parse(JSON.stringify(suspended)) as GameState
    const resolved = ok(server.rules(restored, { type: 'resumeResolution' }))
    expect(resolved.players.p1.life).toBe(45)
    expect(resolved.resolution).toBeUndefined()
    expect(resolved.stack).toEqual([])
  })

  test('keeps frames private and never disposes a later incarnation', () => {
    const server = canonicalServer([
      { kind: 'gainLife', amount: amount(1), targets: controller },
    ])
    const castState = cast(server)
    const draft = makeDraft(castState)
    const frame = startCanonicalResolution(draft, draft.stack[0])
    const object = draft.object(frame.source.ref.objectId)!
    object.power = 7
    draft.move(object.id, 'graveyard')
    expect(draft.resolution?.kind).toBe('canonicalSpell')
    if (draft.resolution?.kind !== 'canonicalSpell') throw new Error('missing frame')
    expect(draft.resolution.controller).toBe('p1')
    expect(draft.resolution.source).toMatchObject({
      information: 'lastKnown',
      ref: frame.source.ref,
      snapshot: { power: 7 },
    })
    draft.move(object.id, 'stack')
    const laterIncarnation = object.incarnation
    draft.resolution.scopes = []
    expect(prepareResolutionStep(draft)).toEqual({ kind: 'complete', event: undefined })
    finishResolution(draft)
    const finished = freezeDraft(draft)

    expect(finished.objects[object.id].incarnation).toBe(laterIncarnation)
    expect(finished.objects[object.id].zone).toBe('stack')
    const projected = projectForViewer({ ...castState, resolution: frame }, 'p1')
    expect(projected.resolution).toBeUndefined()
  })
})
