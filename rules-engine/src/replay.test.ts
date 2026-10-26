import { describe, expect, test } from 'bun:test'
import { applyCopy } from './cardPlugins/effects'
import { commanderRules } from './formats'
import { cardTemplate } from './newGame'
import { createServerGame } from './runtime'
import {
  replayCardTemplate,
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
  energy: 0,
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
    expect<unknown>(replayComparableState(run.state)).toEqual(replayExpectedState(replay, 2))
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
    expect<unknown>(replayComparableState(imported)).toEqual(
      replayExpectedState(replay, latest.turn),
    )
  })

  test('a planning frame that already drew does not draw again', async () => {
    const replay = await Bun.file(replayPath).json() as TableReplay
    const index = replay.events.findIndex(
      (event) => event.phase === 'untap' && event.turn === 3,
    )
    replay.events = replay.events.slice(0, index + 1)
    const latest = replay.events.at(-1)!
    const seat = latest.state.active
    latest.phase = 'planning'
    latest.state.phase = 'planning'
    // The opening walk records the turn draw before parking on planning.
    latest.kind = 'draw'
    replay._libraries = Object.fromEntries(
      replay.seats.map(({ id }) => [
        id,
        Array.from(
          { length: latest.state.players[id].library_count },
          (_, card) => `Hidden ${id} ${card + 1}`,
        ),
      ]),
    )
    const handBefore = latest.state.players[seat].hand.length

    const imported = importLiveReplayState(replay)

    expect(imported.step).toBe('precombatMain')
    expect(imported.zoneOrder[seat].hand).toHaveLength(handBefore)
    expect(imported.log.some((line) => line.includes('draws a card'))).toBe(false)
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

  test('imports printed supertypes and keeps a double-faced card front face', () => {
    const replay: TableReplay = {
      starting_life: 40,
      seats: [{ id: 'p1' }, { id: 'p2' }],
      catalog: {
        Island: {
          type_line: 'Basic Land — Island',
          mana_cost: '',
          oracle_text: '({T}: Add {U}.)',
          stats: '',
        },
        'Snow-Covered Forest': {
          type_line: 'Basic Snow Land — Forest',
          mana_cost: '',
          oracle_text: '({T}: Add {G}.)',
          stats: '',
        },
        'Boseiju, Who Endures': {
          type_line: 'Legendary Land',
          mana_cost: '',
          oracle_text: 'Channel',
          stats: '',
        },
        'Bala Ged Recovery': {
          type_line: 'Sorcery // Land',
          mana_cost: '{2}{G}',
          oracle_text: 'Return target card from your graveyard to your hand. // {T}: Add {G}.',
          stats: '',
          faces: [{
            type_line: 'Sorcery',
            mana_cost: '{2}{G}',
            oracle_text: 'Return target card from your graveyard to your hand.',
            stats: '',
          }, {
            type_line: 'Land',
            mana_cost: '',
            oracle_text: '{T}: Add {G}.',
            stats: '',
          }],
        },
        'Funeral Room // Awakening Hall': {
          type_line: 'Enchantment — Room // Enchantment — Room',
          mana_cost: '{2}{B} // {6}{B}{B}',
          oracle_text: 'Funeral text // Awakening text',
          stats: '',
          faces: [{
            name: 'Funeral Room',
            type_line: 'Enchantment — Room',
            mana_cost: '{2}{B}',
            oracle_text: 'Funeral text',
            stats: '',
          }, {
            name: 'Awakening Hall',
            type_line: 'Enchantment — Room',
            mana_cost: '{6}{B}{B}',
            oracle_text: 'Awakening text',
            stats: '',
          }],
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
            p1: replayPlayer([
              { name: 'Island' },
              { name: 'Snow-Covered Forest' },
              { name: 'Boseiju, Who Endures' },
              { name: 'Bala Ged Recovery' },
              { name: 'Funeral Room // Awakening Hall' },
            ]),
            p2: replayPlayer(),
          },
        },
      }],
      _libraries: { p1: [], p2: [] },
    }

    const imported = importLiveReplayState(replay)
    const supertypesOf = (name: string) =>
      Object.values(imported.objects).find((object) => object.name === name)!.supertypes

    expect(supertypesOf('Island')).toEqual(['Basic'])
    expect(supertypesOf('Snow-Covered Forest')).toEqual(['Basic', 'Snow'])
    expect(supertypesOf('Boseiju, Who Endures')).toEqual(['Legendary'])
    expect(Object.values(imported.objects).find(
      (object) => object.name === 'Bala Ged Recovery',
    )?.frontFace).toMatchObject({
      types: ['Sorcery'],
      manaCost: '{2}{G}',
    })
    expect(Object.values(imported.objects).find(
      (object) => object.roomDoors,
    )?.roomDoors).toMatchObject([
      { name: 'Funeral Room', manaCost: '{2}{B}' },
      { name: 'Awakening Hall', manaCost: '{6}{B}{B}' },
    ])
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

  test('a clone reports the card it is printed as alongside the face it wears', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Spark Double', { types: ['Creature'], manaCost: '{3}{U}' }),
            cardTemplate('Bear', { types: ['Creature'], power: 2, toughness: 2 }),
          ],
        },
      },
      { random: () => 0.5, cardPlugins: [] },
    )
    const state = structuredClone(server.state)
    const objects = Object.values(state.objects)
    applyCopy(
      objects.find((object) => object.name === 'Spark Double')!,
      objects.find((object) => object.name === 'Bear')!,
    )

    expect(replayComparableState(state).players.p1.battlefield).toContainEqual({
      name: 'Bear',
      tapped: false,
      printed_name: 'Spark Double',
    })
  })

  test('a stolen permanent shows on the board of the seat controlling it', () => {
    const server = createServerGame(
      commanderRules,
      { battlefield: { p2: [cardTemplate('Big Sphinx', { types: ['Creature'] })] } },
      { random: () => 0.5, cardPlugins: [] },
    )
    const sphinx = Object.values(server.state.objects).find(
      (object) => object.name === 'Big Sphinx',
    )!
    const stolen = server.rules(server.state, {
      type: 'move',
      objectId: sphinx.id,
      to: 'battlefield',
      controller: 'p1',
    })
    if (!stolen.ok) throw new Error(stolen.error)

    const players = replayComparableState(stolen.state).players
    expect(players.p1.battlefield.map((card) => card.name)).toEqual(['Big Sphinx'])
    expect(players.p2.battlefield).toEqual([])
  })

  test('a spell on the stack announces what it targets', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Reanimate', { types: ['Sorcery'], manaCost: '{B}' })] },
        battlefield: {
          p2: [cardTemplate('Spark Double', { types: ['Creature'], zone: 'graveyard' })],
        },
      },
      { random: () => 0.5, cardPlugins: [] },
    )
    const state = structuredClone(server.state)
    state.step = 'precombatMain'
    state.active = 'p1'
    state.priority = 'p1'
    state.players.p1.mana = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 }
    const spark = Object.values(state.objects).find(
      (object) => object.name === 'Spark Double',
    )!
    const cast = server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: state.zoneOrder.p1.hand[0],
      targets: [{ kind: 'object', objectId: spark.id }],
    })
    if (!cast.ok) throw new Error(cast.error)

    expect(replayComparableState(cast.state).stack).toEqual([{
      name: 'Reanimate',
      kind: 'spell',
      controller: 'p1',
      text: 'targeting Spark Double (p2 graveyard)',
    }])
  })
})


describe('replay color input boundary', () => {
  const printed = {
    type_line: 'Creature — Test', mana_cost: '{B}', oracle_text: '', stats: '1/1',
  }

  test('authoritative colors preserve colorless and normalize all five colors', () => {
    expect(replayCardTemplate('Fixture', { ...printed, colors: [] }).colors).toBe('')
    expect(replayCardTemplate('Fixture', {
      ...printed, colors: ['G', 'U', 'W', 'B', 'U', 'R'], color_indicator: ['R'],
    }).colors).toBe('WUBRG')
  })

  test('indicators precede mana inference, including empty indicators', () => {
    expect(replayCardTemplate('Fixture', { ...printed, color_indicator: ['R'] }).colors).toBe('R')
    expect(replayCardTemplate('Fixture', { ...printed, color_indicator: [] }).colors).toBe('')
    expect(replayCardTemplate('Fixture', printed).colors).toBe('B')
    expect(replayCardTemplate('Fixture', { ...printed, mana_cost: '{C}' }).colors).toBe('')
  })

  test('devoid suppresses inference in catalogs without authoritative fields', () => {
    expect(replayCardTemplate('Fixture', {
      ...printed, oracle_text: 'Devoid (This card has no color.)\nFlying',
    }).colors).toBe('')
  })

  test('external arrays reject invalid symbols instead of silently losing colors', () => {
    for (const symbol of ['C', 'blue', 'UB']) {
      expect(() => replayCardTemplate('Fixture', { ...printed, colors: [symbol] })).toThrow()
      expect(() => replayCardTemplate('Fixture', { ...printed, color_indicator: [symbol] })).toThrow()
    }
  })

  test('double-faced objects use the front face rather than the combined color set', () => {
    const template = replayCardTemplate('Front // Back', {
      ...printed, colors: ['B', 'R'], faces: [
        { ...printed, name: 'Front', colors: [] },
        { ...printed, name: 'Back', mana_cost: '', color_indicator: ['R'] },
      ],
    })
    expect(template.colors).toBe('')
    expect(template.frontFace?.colors).toBe('')
    expect(template.backFace?.colors).toBe('R')
  })

  test('Room doors retain their separate colors while the object uses combined colors', () => {
    const template = replayCardTemplate('Left // Right', {
      ...printed, type_line: 'Enchantment — Room', colors: ['U', 'R'], faces: [
        { ...printed, name: 'Left', type_line: 'Enchantment — Room', colors: ['U'] },
        { ...printed, name: 'Right', type_line: 'Enchantment — Room', colors: ['R'] },
      ],
    })
    expect(template.colors).toBe('UR')
    expect(template.roomDoors?.map((door) => door.colors)).toEqual(['U', 'R'])
  })
})
