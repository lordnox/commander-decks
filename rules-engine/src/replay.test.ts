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
})
