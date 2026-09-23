import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { activated } from './activated'
import {
  cycleHand,
  draw,
  triggerOn,
  typecycleHand,
} from './effects'
import {
  SEARCH_CHOSEN,
  librarySearch,
  pendingSearch,
  searchCandidates,
  searchSpecForPending,
  searchingSeat,
} from './librarySearch'
import { cycling } from './cycling'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plains = (name = 'Plains') =>
  cardTemplate(name, {
    types: ['Land'],
    subtypes: ['Plains'],
    supertypes: ['Basic'],
    tapProduces: { W: 1 },
  })

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

describe('cycling', () => {
  test('Cycle Meadow cycles for {W} and draws from hand', () => {
    const cycler = cardTemplate('Cycle Meadow', {
      types: ['Land'],
      effects: [cycleHand('cycling.cycleMeadow', '{W}')],
    })
    const drawn = cardTemplate('Drawn card', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [cycler] }, libraries: { p1: [drawn] } },
      { random: () => 0.5, cardPlugins: [activated, cycling] },
    )
    const cyclerId = named(server.state, 'Cycle Meadow').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.W = 1

    const cycled = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.cycleMeadow',
      seat: 'p1',
      objectId: cyclerId,
    }))
    expect(cycled.objects[cyclerId].zone).toBe('graveyard')
    expect(cycled.players.p1.mana.W).toBe(0)
    expect(cycled.stack).toHaveLength(1)

    const resolved = ok(server.rules(cycled, { type: 'resolveTop' }))
    expect(named(resolved, 'Drawn card').zone).toBe('hand')
    expect(resolved.stack).toHaveLength(0)
  })

  test('Plains Cycler plainscycles for {2} through library search', () => {
    const cycler = cardTemplate('Plains Cycler', {
      types: ['Creature'],
      effects: [typecycleHand('cycling.plainsCycler', '{2}', 'Plains')],
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cycler] },
        libraries: { p1: [plains(), cardTemplate('Mountain', { types: ['Land'], subtypes: ['Mountain'] })] },
      },
      { random: () => 0.5, cardPlugins: [activated, cycling, librarySearch] },
    )
    const cyclerId = named(server.state, 'Plains Cycler').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2

    const stacked = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.plainsCycler',
      seat: 'p1',
      objectId: cyclerId,
    }))
    expect(stacked.objects[cyclerId].zone).toBe('graveyard')
    expect(stacked.stack).toHaveLength(1)

    const opened = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(searchingSeat(opened)).toBe('p1')
    const pending = pendingSearch(opened, 'p1')!
    const spec = searchSpecForPending(opened, pending)!
    expect(searchCandidates(opened, 'p1', spec).map((object) => object.name)).toEqual(['Plains'])

    const p2View = projectForViewer(opened, 'p2')
    expect(p2View.zoneCounts.p1.library).toBe(opened.zoneCounts.p1.library)
    expect(Object.keys(p2View.objects).some((id) => opened.objects[id]?.zone === 'library')).toBe(false)

    const found = named(opened, 'Plains').id
    const finished = run(server, opened, [
      { type: 'move', objectId: found, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(named(finished, 'Plains').zone).toBe('hand')
    expect(searchingSeat(finished)).toBeUndefined()
    expect(finished.stack).toHaveLength(0)
  })

  test('plainscycling cycle triggers wait until the library search closes', () => {
    const cycler = cardTemplate('Plains Cycler', {
      types: ['Creature'],
      effects: [typecycleHand('cycling.plainsCycler', '{2}', 'Plains')],
    })
    const listener = cardTemplate('Cycle Listener', {
      types: ['Enchantment'],
      effects: [triggerOn('cycle', { do: [draw(1)] })],
    })
    const bonus = cardTemplate('Bonus card', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [listener] },
        hands: { p1: [cycler] },
        libraries: { p1: [plains(), bonus] },
      },
      { random: () => 0.5, cardPlugins: [activated, cycling, librarySearch] },
    )
    const cyclerId = named(server.state, 'Plains Cycler').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2

    const opened = ok(server.rules(ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.plainsCycler',
      seat: 'p1',
      objectId: cyclerId,
    })), { type: 'resolveTop' }))
    expect(opened.stack.some((item) => item.name === 'Cycle Listener')).toBe(false)

    const found = named(opened, 'Plains').id
    const finished = run(server, opened, [
      { type: 'move', objectId: found, to: 'hand' },
      { type: 'shuffleLibrary', seat: 'p1' },
      { type: 'custom', name: SEARCH_CHOSEN, seat: 'p1' },
    ])
    expect(finished.stack.some((item) => item.name === 'Cycle Listener')).toBe(true)
    expect(named(finished, 'Bonus card').zone).toBe('library')
  })

  test('cycle event triggers battlefield listeners without name checks', () => {
    const cycler = cardTemplate('Cycle Meadow', {
      types: ['Land'],
      effects: [cycleHand('cycling.cycleMeadow', '{W}')],
    })
    const listener = cardTemplate('Cycle Listener', {
      types: ['Enchantment'],
      effects: [
        triggerOn('cycle', { do: [draw(1)] }),
      ],
    })
    const drawn = cardTemplate('Bonus card', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [listener] },
        hands: { p1: [cycler] },
        libraries: { p1: [drawn] },
      },
      { random: () => 0.5, cardPlugins: [activated, cycling] },
    )
    const cyclerId = named(server.state, 'Cycle Meadow').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.W = 1

    const stacked = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'cycling.cycleMeadow',
      seat: 'p1',
      objectId: cyclerId,
    }))
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(named(resolved, 'Bonus card').zone).toBe('hand')
    expect(resolved.stack.some((item) => item.name === 'Cycle Listener')).toBe(true)
  })
})
