import { describe, expect, test } from 'bun:test'
import { commanderRules, createServerGame } from '../../rules-engine/src/index'
import type { CardTemplate } from '../../rules-engine/src/newGame'
import { createLobby } from './lobby'
import { kernelCombat, liveSeatsFromState, liveSnapshotFromState } from './kernelView'

const creature = (name: string, oracleText = ''): CardTemplate => ({
  name,
  tapped: false,
  summoningSickness: false,
  damageMarked: 0,
  counters: {},
  types: ['Creature'],
  subtypes: [],
  supertypes: [],
  manaCost: '{B}',
  power: 1,
  toughness: 1,
  oracleText,
  attachedTo: null,
  attacking: null,
  blocking: null,
  grantedRules: [],
  token: false,
  tags: [],
})

const combatTable = () => {
  const server = createServerGame(
    commanderRules,
    {
      first: 'p1',
      battlefield: {
        p1: [creature('Foulmire Knight', 'Deathtouch'), creature('Sygg, River Cutthroat')],
        p2: [creature('Satyr Wayfinder')],
      },
    },
    { random: () => 0.5, cardPlugins: [] },
  )
  const state = structuredClone(server.state)
  state.step = 'declareAttackers'
  for (const id of state.zoneOrder.p1.battlefield) {
    state.objects[id].summoningSickness = false
  }
  const lobby = createLobby()
  lobby.occupants.p1 = { name: 'Thousand Cuts', deck: 'decks/sygg' }
  lobby.occupants.p2 = { name: 'Sin-fall', deck: 'decks/sin' }
  return { state, lobby, server }
}

const attackerId = (state: ReturnType<typeof combatTable>['state']) =>
  state.zoneOrder.p1.battlefield
    .find((id) => state.objects[id].name === 'Foulmire Knight')!

describe('kernel combat projection', () => {
  test('a declared attack reaches the combat panel and the card face', () => {
    const { state, lobby } = combatTable()
    const knight = state.objects[attackerId(state)]
    knight.attacking = 'p2'
    knight.tapped = true

    const combat = kernelCombat(state)
    expect(combat?.step).toBe('attackers')
    expect(combat?.attackers).toEqual([
      {
        card: 'Foulmire Knight',
        defender: 'p2',
        pt: '1/1',
        tapped: true,
        keywords: ['deathtouch'],
      },
    ])
    expect(combat?.possible_blockers).toEqual({ p2: ['Satyr Wayfinder'] })

    const seats = liveSeatsFromState(state, lobby, 'p1')
    const attacker = seats[0].battlefield?.find((card) => card.name === 'Foulmire Knight')
    expect(attacker?.attacking).toBe('Sin-fall')
    const bystander = seats[0].battlefield?.find((card) => card.name === 'Sygg, River Cutthroat')
    expect(bystander?.attacking).toBeUndefined()
  })

  test('declared blocks replace the possible blockers', () => {
    const { state } = combatTable()
    const knightId = attackerId(state)
    state.objects[knightId].attacking = 'p2'
    state.objects[knightId].tapped = true
    state.step = 'declareBlockers'
    const blockerId = state.zoneOrder.p2.battlefield[0]
    state.objects[blockerId].blocking = knightId

    const combat = kernelCombat(state)
    expect(combat?.possible_blockers).toBeUndefined()
    expect(combat?.blocks).toEqual([
      { attacker: 'Foulmire Knight', blockers: ['Satyr Wayfinder'] },
    ])
    expect(combat?.unblocked).toEqual([])

    const seats = liveSeatsFromState(state, createLobby(), 'p2')
    expect(seats[1].battlefield?.[0].blocking).toBe('Foulmire Knight')
  })

  test('a board outside combat carries no combat block', () => {
    const { state, lobby } = combatTable()
    state.step = 'precombatMain'

    expect(kernelCombat(state)).toBeUndefined()
    expect(liveSnapshotFromState({ state, lobby, viewer: 'p1' }).combat).toBeUndefined()
  })
})
