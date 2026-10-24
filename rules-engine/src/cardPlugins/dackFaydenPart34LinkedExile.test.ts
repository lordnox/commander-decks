import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { effectsFor } from './cardRules'
import { exilePayoffs } from './exilePayoffs'
import { linkedExile } from './linkedExile'

const plugins = [activated, exilePayoffs, linkedExile]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const fromPool = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra, effects: effectsFor(name) })

const enterAndLinkExile = (
  server: ReturnType<typeof createServerGame>,
  sourceId: string,
  seat: 'p1' | 'p2',
  targetIds: string[],
) => {
  let state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move',
    objectId: sourceId,
    to: 'battlefield',
  })))
  const pick = pendingSelectionFor(state, seat)
  if (pick) {
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat,
      kind: 'choose',
      count: pick.count,
      objectIds: targetIds,
    }))
    state = resolveStack(server.rules, state)
  }
  return state
}

describe('Dack Fayden part 34 — assignment checklist (gaps)', () => {

})

describe('Dack Fayden part 34 — linked exile cages', () => {
  test('Fiend Hunter exiles on ETB and returns the hostage when it dies', () => {
    const hunter = fromPool('Fiend Hunter')
    const prey = cardTemplate('Caged Prey', { types: ['Creature'], power: 3, toughness: 3 })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Caged Prey').id

    let state = enterAndLinkExile(server, hunterId, 'p1', [preyId])
    expect(state.objects[preyId]).toMatchObject({ zone: 'exile', exiledWith: hunterId })

    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'graveyard' }))
    expect(state.stack).toHaveLength(1)
    expect(state.objects[preyId].zone).toBe('exile')
    state = resolveStack(server.rules, state)
    expect(state.objects[preyId]).toMatchObject({
      zone: 'battlefield',
      controller: state.objects[preyId].owner,
    })
  })

  test('Fiend Hunter returns the hostage when blinked off the battlefield', () => {
    const hunter = fromPool('Fiend Hunter')
    const prey = cardTemplate('Blink Prey', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Blink Prey').id

    let state = enterAndLinkExile(server, hunterId, 'p1', [preyId])
    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'hand' }))
    expect(state.stack).toHaveLength(1)
    expect(state.objects[preyId].zone).toBe('exile')
    state = resolveStack(server.rules, state)
    expect(state.objects[preyId].zone).toBe('battlefield')
  })

  test('Banisher Priest cages on ETB and returns the creature when the Priest leaves', () => {
    const priest = fromPool('Banisher Priest')
    const foe = cardTemplate('Opponent Bear', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [priest] }, battlefield: { p2: [foe] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const priestId = named(server.state, 'Banisher Priest').id
    const foeId = named(server.state, 'Opponent Bear').id

    let state = enterAndLinkExile(server, priestId, 'p1', [foeId])
    expect(state.objects[foeId].zone).toBe('exile')

    state = ok(server.rules(state, { type: 'sacrifice', objectId: priestId }))
    expect(state.objects[foeId].zone).toBe('battlefield')
  })

  test('Werefox Bodyguard may exile zero or one non-Fox creature', () => {
    const fox = fromPool('Werefox Bodyguard', { subtypes: ['Fox', 'Elf', 'Knight'] })
    const mark = cardTemplate('Werefox Mark', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [fox] }, battlefield: { p2: [mark] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const foxId = named(server.state, 'Werefox Bodyguard').id
    const markId = named(server.state, 'Werefox Mark').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: foxId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(state.objects[markId].zone).toBe('battlefield')
  })

  test('link-exile target selection is visible only to the choosing seat after projection', () => {
    const hunter = fromPool('Fiend Hunter')
    const prey = cardTemplate('Hidden Prey', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    expect(pendingSelectionFor(entered, 'p1')?.candidates.length).toBeGreaterThan(0)
    const p1View = server.project(entered, 'p1')
    const p2View = server.project(entered, 'p2')
    expect(pendingSelectionFor(p1View, 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(p2View, 'p2')).toBeUndefined()
  })

  test('host restart preserves an open link-exile target choice', () => {
    const hunter = fromPool('Fiend Hunter')
    const prey = cardTemplate('Restart Prey', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Restart Prey').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    const before = pendingSelectionFor(entered, 'p1')
    expect(before).toBeDefined()
    const restarted = structuredClone(entered)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(before?.id)
    const finished = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [preyId],
    }))
    expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
    expect(finished.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, finished)
    expect(resolved.objects[preyId].zone).toBe('exile')
  })
})
