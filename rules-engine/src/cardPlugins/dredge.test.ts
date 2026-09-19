import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import type { GameState, ReduceResult } from '../types'
import { dredge } from './dredge'

const card = (name: string) => cardTemplate(name, { types: ['Sorcery'] })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const names = (state: GameState, seat: string, zone: 'hand' | 'library' | 'graveyard') =>
  state.zoneOrder[seat][zone].map((id) => state.objects[id].name)

const gameWithDredgers = (dredgers: string[], library: string[]) => {
  const server = createServerGame(
    commanderRules,
    {
      hands: { p1: dredgers.map(card) },
      libraries: { p1: library.map(card) },
      players: 2,
    },
    { random: () => 0.5, cardPlugins: [dredge] },
  )
  let state = server.state
  for (const objectId of state.zoneOrder.p1.hand) {
    state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
  }
  return { server, state }
}

describe('dredge', () => {
  test('chooses dredge instead of drawing, or declines for a real draw', () => {
    const dredging = gameWithDredgers(
      ['Life from the Loam'],
      ['One', 'Two', 'Three', 'Drawn'],
    )
    const choosing = ok(dredging.server.rules(dredging.state, { type: 'draw', seat: 'p1' }))
    const loamId = choosing.zoneOrder.p1.graveyard.find(
      (id) => choosing.objects[id].name === 'Life from the Loam',
    )!

    const dredged = ok(dredging.server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [loamId],
    }))

    expect(names(dredged, 'p1', 'hand')).toEqual(['Life from the Loam'])
    expect(names(dredged, 'p1', 'graveyard')).toEqual(['One', 'Two', 'Three'])
    expect(names(dredged, 'p1', 'library')).toEqual(['Drawn'])
    expect(pendingSelectionFor(dredged, 'p1')).toBeUndefined()

    const drawing = gameWithDredgers(['Life from the Loam'], ['Top', 'Next', 'Third'])
    const offered = ok(drawing.server.rules(drawing.state, { type: 'draw', seat: 'p1' }))
    const drawn = ok(drawing.server.rules(offered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))

    expect(names(drawn, 'p1', 'hand')).toEqual(['Top'])
    expect(names(drawn, 'p1', 'library')).toEqual(['Next', 'Third'])
    expect(names(drawn, 'p1', 'graveyard')).toEqual(['Life from the Loam'])
  })

  test('does not offer dredge when the library has fewer than N cards', () => {
    const { server, state } = gameWithDredgers(['Life from the Loam'], ['Top', 'Next'])

    const drawn = ok(server.rules(state, { type: 'draw', seat: 'p1' }))

    expect(pendingSelectionFor(drawn, 'p1')).toBeUndefined()
    expect(names(drawn, 'p1', 'hand')).toEqual(['Top'])
    expect(names(drawn, 'p1', 'graveyard')).toEqual(['Life from the Loam'])
  })

  test('offers every eligible dredger for at most one replacement', () => {
    const { server, state } = gameWithDredgers(
      ['Life from the Loam', 'Dakmor Salvage'],
      ['One', 'Two', 'Three'],
    )

    const choosing = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    const selection = pendingSelectionFor(choosing, 'p1')!

    expect(selection.min).toBe(0)
    expect(selection.count).toBe(1)
    expect(selection.candidates.map((id) => choosing.objects[id].name).sort())
      .toEqual(['Dakmor Salvage', 'Life from the Loam'])
  })

  test('rechecks dredge options between cards in a multi-card draw', () => {
    const { server, state } = gameWithDredgers(
      ['Life from the Loam', 'Dakmor Salvage'],
      ['One', 'Two', 'Three', 'Four', 'Five'],
    )
    const firstChoice = ok(server.rules(state, { type: 'draw', seat: 'p1', count: 2 }))
    const loamId = firstChoice.zoneOrder.p1.graveyard.find(
      (id) => firstChoice.objects[id].name === 'Life from the Loam',
    )!

    const secondChoice = ok(server.rules(firstChoice, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [loamId],
    }))
    const selection = pendingSelectionFor(secondChoice, 'p1')!

    expect(selection.candidates.map((id) => secondChoice.objects[id].name))
      .toEqual(['Dakmor Salvage'])
    expect(names(secondChoice, 'p1', 'library')).toEqual(['Four', 'Five'])
  })

  test('projects graveyard options only to the drawing seat', () => {
    const { server, state } = gameWithDredgers(
      ['Life from the Loam', 'Dakmor Salvage'],
      ['One', 'Two', 'Three'],
    )
    const choosing = ok(server.rules(state, { type: 'draw', seat: 'p1' }))

    expect(pendingSelectionFor(server.project(choosing, 'p1'), 'p1')?.candidates)
      .toHaveLength(2)
    expect(pendingSelectionFor(server.project(choosing, 'p2'), 'p1')).toBeUndefined()
  })
})
