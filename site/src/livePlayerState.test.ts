import { expect, test } from 'bun:test'
import { toPlayerState } from './LivePage'
import type { LiveSeat } from './liveCodec'

const seat = (extra: Partial<LiveSeat> = {}): LiveSeat => ({
  id: 'p1',
  name: 'Eva',
  commanders: ['Lady Evangela'],
  color: '#ffffff',
  life: 44,
  library_count: 87,
  hand_count: 5,
  ...extra,
})

test('a seat panel keeps the floating mana the snapshot reported', () => {
  expect(toPlayerState(seat({ mana: { W: 1, U: 1, B: 1 } }), true).mana)
    .toEqual({ W: 1, U: 1, B: 1 })
  expect(toPlayerState(seat(), true).mana).toBeUndefined()
})
