import { describe, expect, test } from 'bun:test'
import { commanderRules, createServerGame } from '../../rules-engine/src/index'
import { cardTemplate } from '../../rules-engine/src/newGame'
import { createLobby } from './lobby'
import { kernelCombat, liveSeatsFromState, liveSnapshotFromState } from './kernelView'

const creature = (name: string, oracleText = '') =>
  cardTemplate(name, { types: ['Creature'], manaCost: '{B}', oracleText })

const combatTable = () => {
  const server = createServerGame(
    commanderRules,
    {
      first: 'p1',
      battlefield: {
        p1: [
          creature(
            'Foulmire Knight // Profane Insight',
            'Deathtouch // You draw a card and you lose 1 life.',
          ),
          creature('Sygg, River Cutthroat', 'Target creature gains flying until end of turn.'),
        ],
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
    .find((id) => state.objects[id].name.startsWith('Foulmire Knight'))!

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
        card: 'Foulmire Knight // Profane Insight',
        defender: 'p2',
        pt: '1/1',
        tapped: true,
        keywords: ['deathtouch'],
      },
    ])
    expect(combat?.possible_blockers).toEqual({ p2: ['Satyr Wayfinder'] })

    const seats = liveSeatsFromState(state, lobby, 'p1')
    const attacker = seats[0].battlefield?.find((card) => card.name === 'Foulmire Knight // Profane Insight')
    expect(attacker?.attacking).toBe('Sin-fall')
    const bystander = seats[0].battlefield?.find((card) => card.name === 'Sygg, River Cutthroat')
    expect(bystander?.attacking).toBeUndefined()

    const granter = state.zoneOrder.p1.battlefield
      .find((id) => state.objects[id].name.startsWith('Sygg'))!
    state.objects[granter].attacking = 'p2'
    expect(kernelCombat(state)?.attackers?.[1].keywords).toBeUndefined()
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
      { attacker: 'Foulmire Knight // Profane Insight', blockers: ['Satyr Wayfinder'] },
    ])
    expect(combat?.unblocked).toEqual([])

    const seats = liveSeatsFromState(state, createLobby(), 'p2')
    expect(seats[1].battlefield?.[0].blocking).toBe('Foulmire Knight // Profane Insight')
  })

  test('live counters reach the board instead of the printed card value', () => {
    const { state, lobby } = combatTable()
    state.step = 'precombatMain'
    const walker = state.objects[state.zoneOrder.p1.battlefield[1]]
    walker.counters = { loyalty: 5 }

    const seats = liveSeatsFromState(state, lobby, 'p1')
    const projected = seats[0].battlefield?.find((card) => card.name === walker.name)
    expect(projected?.counters).toEqual({ loyalty: 5 })

    // An untouched permanent stays lean on the wire.
    const plain = seats[1].battlefield?.[0]
    expect(plain?.counters).toBeUndefined()
  })

  test('a board outside combat carries no combat block', () => {
    const { state, lobby } = combatTable()
    state.step = 'precombatMain'

    expect(kernelCombat(state)).toBeUndefined()
    expect(liveSnapshotFromState({ state, lobby, viewer: 'p1' }).combat).toBeUndefined()
  })
})

describe('kernel snapshot prompts', () => {
  test('the private judge prompt reaches only the seat that owes an answer', () => {
    const { state, lobby } = combatTable()
    lobby.waiting = 'Sin-fall: the judge is checking your message.'
    lobby.privateWaiting = {
      p2: 'p2: confirm playing Forest, then casting Joint Exploration kicked.',
    }

    const own = liveSnapshotFromState({ state, lobby, viewer: 'p2' })
    expect(own.waiting).toBe(lobby.privateWaiting.p2)

    const other = liveSnapshotFromState({ state, lobby, viewer: 'p1' })
    expect(other.waiting).toBe(lobby.waiting)

    const table = liveSnapshotFromState({ state, lobby, viewer: null })
    expect(table.waiting).toBe(lobby.waiting)
  })
})
