import { describe, expect, test } from 'bun:test'
import {
  importLiveReplayState,
  replayComparableState,
  replayExpectedState,
  runReplayRounds,
  type TableReplay,
} from './replay'

const replayPath =
  `${import.meta.dir}/../../table-games/seed1729-sygg-doctor-osgir-bartolome.json`

const replayPlayer = (
  battlefield: { name: string; counters?: Record<string, number> }[] = [],
) => ({
  life: 40,
  poison: 0,
  library_count: 0,
  hand: [],
  battlefield,
  graveyard: [],
  exile: [],
  command: [],
})

describe('table replay conversion', () => {
  test('the shortest replay reaches the same public state after two rounds', async () => {
    const replay = await Bun.file(replayPath).json() as TableReplay
    const run = runReplayRounds(replay, 2)

    expect(replay.events).toHaveLength(101)
    expect(run.events.filter((event) => event.type === 'playLand')).toHaveLength(8)
    expect(run.events.filter((event) => event.type === 'castSpell')).toHaveLength(3)
    expect(replayComparableState(run.state)).toEqual(replayExpectedState(replay, 2))
  })

  test('a private live replay resumes from its exact latest frame', async () => {
    const replay = await Bun.file(replayPath).json() as TableReplay
    const latest = replay.events.at(-1)!
    replay._libraries = Object.fromEntries(
      replay.seats.map(({ id }) => [
        id,
        Array.from(
          { length: latest.state.players[id].library_count },
          (_, index) => `Hidden ${id} ${index + 1}`,
        ),
      ]),
    )

    const imported = importLiveReplayState(replay)
    expect(replayComparableState(imported)).toEqual(
      replayExpectedState(replay, latest.turn),
    )
  })

  test('a planning frame still owes its untap and land drop', async () => {
    const replay = await Bun.file(replayPath).json() as TableReplay
    const index = replay.events.findIndex(
      (event) => event.phase === 'untap' && event.turn === 3,
    )
    replay.events = replay.events.slice(0, index + 1)
    const latest = replay.events.at(-1)!
    const seat = latest.state.active
    latest.phase = 'planning'
    latest.state.phase = 'planning'
    latest.state.players[seat].battlefield = latest.state.players[seat].battlefield
      .map((card) => ({ ...card, tapped: true }))
    replay._libraries = Object.fromEntries(
      replay.seats.map(({ id }) => [
        id,
        Array.from(
          { length: latest.state.players[id].library_count },
          (_, card) => `Hidden ${id} ${card + 1}`,
        ),
      ]),
    )

    expect(latest.state.players[seat].battlefield.some((card) => card.tapped)).toBe(true)

    const imported = importLiveReplayState(replay)

    expect(imported.active).toBe(seat)
    expect(imported.step).toBe('untap')
    expect(imported.players[seat].landsPlayed).toBe(0)
    expect(
      imported.zoneOrder[seat].battlefield.map((id) => imported.objects[id].tapped),
    ).not.toContain(true)
  })

  test('imports printed and current planeswalker loyalty', () => {
    const replay: TableReplay = {
      starting_life: 40,
      seats: [{ id: 'p1' }, { id: 'p2' }],
      catalog: {
        'Ugin, the Spirit Dragon': {
          type_line: 'Legendary Planeswalker — Ugin',
          mana_cost: '{8}',
          oracle_text: '+2: Ugin deals 3 damage to any target.',
          stats: '7',
        },
      },
      events: [{
        id: 0,
        turn: 1,
        phase: 'main1',
        seat: 'p1',
        kind: 'setup',
        summary: 'setup',
        state: {
          active: 'p1',
          turn: 1,
          phase: 'main1',
          stack: [],
          players: {
            p1: replayPlayer([{
              name: 'Ugin, the Spirit Dragon',
              counters: { loyalty: 4 },
            }]),
            p2: replayPlayer(),
          },
        },
      }],
      _libraries: { p1: [], p2: [] },
    }

    const imported = importLiveReplayState(replay)
    const ugin = Object.values(imported.objects)[0]
    expect(ugin.printedLoyalty).toBe(7)
    expect(ugin.counters.loyalty).toBe(4)
    expect(replayComparableState(imported).players.p1.battlefield[0].counters)
      .toEqual({ loyalty: 4 })
  })
})
