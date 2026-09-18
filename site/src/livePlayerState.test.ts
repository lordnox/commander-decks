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

test('opponent known hand slots mix faces with hidden backs', () => {
  const panel = toPlayerState(seat({
    hand_count: 3,
    known_hand: ['Grizzly Bears'],
  }), false)

  expect(panel.hand).toEqual([
    { name: 'Grizzly Bears' },
    { hidden: true },
    { hidden: true },
  ])
})

test('private hand and command cards keep their kernel object IDs', () => {
  const state = {
    zoneOrder: {
      p1: {
        hand: ['o7'],
        command: ['o8'],
      },
    },
  } as Parameters<typeof toPlayerState>[2]
  const panel = toPlayerState(seat({
    hand: ['Forest'],
    command: ['Lady Evangela'],
  }), true, state)

  expect(panel.hand).toEqual([{ name: 'Forest', objectId: 'o7' }])
  expect(panel.command).toEqual([{ name: 'Lady Evangela', objectId: 'o8' }])
})
