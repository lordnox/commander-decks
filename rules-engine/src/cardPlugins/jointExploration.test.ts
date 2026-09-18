import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createServerGame } from '../runtime'
import { cardTemplate } from '../newGame'
import {
  JOINT_LAND_CHOSEN,
  jointExploration,
  pendingJointExploration,
} from './jointExploration'
import { onResolve } from './onResolve'

const card = (name: string, types: string[], manaCost = '') =>
  cardTemplate(name, { types, manaCost, power: null, toughness: null })

test('Joint Exploration completes scry, draw, and kicked land in the kernel', () => {
  const server = createServerGame(commanderRules, {
    hands: {
      p1: [
        card('Joint Exploration', ['Instant'], '{1}{U}'),
        card('Hand Land', ['Land']),
      ],
    },
    libraries: {
      p1: [
        card('Kept', ['Instant']),
        card('Bottomed', ['Instant']),
        card('Drawn', ['Instant']),
      ],
    },
  }, { random: () => 0.5, cardPlugins: [jointExploration, onResolve] })
  let state = server.state
  const spell = state.zoneOrder.p1.hand[0]
  state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 }
  const cast = server.rules(
    state,
    { type: 'castSpell', seat: 'p1', objectId: spell, kicked: true },
  )
  if (!cast.ok) throw new Error(cast.error)
  expect(cast.state.stack[0].kicked).toBe(true)

  const opened = server.rules(cast.state, { type: 'resolveTop' })
  if (!opened.ok) throw new Error(opened.error)
  state = opened.state
  expect(pendingJointExploration(state, 'p1')?.stage).toBe('scry')
  expect(state.stack).toHaveLength(1)

  const kept = state.zoneOrder.p1.library[0]
  const bottomed = state.zoneOrder.p1.library[1]
  const scried = server.rules(state, {
    type: 'selectCards',
    seat: 'p1',
    kind: 'scry',
    count: 2,
    choices: [
      { objectId: kept, destination: 'top' },
      { objectId: bottomed, destination: 'bottom' },
    ],
  })
  if (!scried.ok) throw new Error(scried.error)
  state = scried.state
  expect(state.zoneOrder.p1.hand.map((id) => state.objects[id].name))
    .toEqual(['Hand Land', 'Kept'])
  expect(pendingJointExploration(state, 'p1')?.stage).toBe('putLand')

  const handLand = Object.values(state.objects).find((object) => object.name === 'Hand Land')!
  for (const event of [
    { type: 'move', objectId: handLand.id, to: 'battlefield' } as const,
    { type: 'custom', name: JOINT_LAND_CHOSEN, seat: 'p1' } as const,
  ]) {
    const result = server.rules(state, event)
    if (!result.ok) throw new Error(result.error)
    state = result.state
  }
  expect(handLand.id && state.objects[handLand.id].zone).toBe('battlefield')
  expect(pendingJointExploration(state, 'p1')).toBeUndefined()
})
