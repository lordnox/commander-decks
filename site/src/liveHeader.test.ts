import { describe, expect, test } from 'bun:test'
import { liveHeader } from './liveHeader'

const base = {
  youName: 'Sin-fall',
  youSeat: 'p4',
  activeName: 'Sin-fall',
  activeSeat: 'p4',
  turn: 3,
  phaseLabel: 'First main',
  yourAction: false,
  actionPending: false,
  viewingPast: false,
}

describe('live header', () => {
  test('names the seat the viewer holds and whose turn it is', () => {
    expect(liveHeader({ ...base, yourAction: true })).toEqual({
      identity: 'You are Sin-fall',
      state: 'Turn 3 · First main · your turn',
      status: { label: 'Your move', tone: 'act' },
    })
  })

  test('another seat turn waits on that seat by name', () => {
    const header = liveHeader({
      ...base,
      youName: 'Foggy Blood Transfusion',
      youSeat: 'p1',
    })

    expect(header.identity).toBe('You are Foggy Blood Transfusion')
    expect(header.state).toBe("Turn 3 · First main · Sin-fall's turn")
    expect(header.status).toEqual({
      label: 'Waiting on Sin-fall',
      tone: 'waiting',
    })
  })

  test('a submitted action reads as sent rather than actionable', () => {
    expect(liveHeader({ ...base, yourAction: false, actionPending: true }).status)
      .toEqual({ label: 'Sent, waiting for the host', tone: 'pending' })
  })

  test('history review never claims the viewer may act', () => {
    const header = liveHeader({ ...base, yourAction: true, viewingPast: true })

    expect(header.status).toEqual({
      label: 'Reviewing history',
      tone: 'history',
    })
  })

  test('a spectator is told they hold no seat', () => {
    const header = liveHeader({ ...base, youName: null, youSeat: null })

    expect(header.identity).toBe('Spectating this table')
    expect(header.state).toBe('Turn 3 · First main · Sin-fall\'s turn')
    expect(header.status).toEqual({ label: 'Watching', tone: 'waiting' })
  })
})
