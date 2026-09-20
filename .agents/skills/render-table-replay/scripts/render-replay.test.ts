import { describe, expect, test } from 'bun:test'
import {
  publicGame,
  validateCastStacks,
  validateEnterUntapped,
  validateOpenMana,
  validatePlanDrawKnowledge,
  validatePlans,
  validateTokenMetadata,
  validateTriggerStacks,
  validateTurnLabels,
} from './render-replay'

type Json = Record<string, any>

const seats = [
  { id: 'p1', name: 'Attacker', commanders: ['Osgir, the Reconstructor'] },
  { id: 'p2', name: 'Defender', commanders: ['Hazel of the Rootbloom'] },
  { id: 'p3', name: 'Third', commanders: ["Sin, Spira's Punishment"] },
  { id: 'p4', name: 'Fourth', commanders: ['Homer, the Hermit'] },
]

const state = (turn: number, phase: string, osgirTapped = true) => {
  const players = Object.fromEntries(
    seats.map((seat) => [
      seat.id,
      {
        life: 40,
        library_count: 80,
        hand: [],
        battlefield: [],
        graveyard: [],
        command: [...seat.commanders],
      },
    ]),
  ) as Json
  players.p1.battlefield = [
    {
      name: 'Osgir, the Reconstructor',
      tapped: osgirTapped,
      pt: '4/4',
    },
  ]
  players.p2.battlefield = [{ name: 'Squirrel', token: true, pt: '1/1' }]
  return { active: 'p1', turn, phase, players }
}

const game = (schema = 2, osgirTapped = true): Json => ({
  schema,
  seed: 1729,
  starting_life: 40,
  headline: 'Test',
  result: {
    winner: null,
    ended: 'truncated',
    turn: 1,
    summary: '',
  },
  seats: structuredClone(seats),
  catalog: {
    'Osgir, the Reconstructor': { type_line: 'Legendary Creature' },
    'Hazel of the Rootbloom': { type_line: 'Legendary Creature' },
    "Sin, Spira's Punishment": { type_line: 'Legendary Creature' },
    'Homer, the Hermit': { type_line: 'Legendary Creature' },
    Squirrel: { type_line: 'Token Creature' },
  },
  events: [
    {
      id: 0,
      turn: 0,
      phase: 'setup',
      seat: null,
      kind: 'setup',
      summary: 'Opening',
      state: state(0, 'setup'),
    },
    {
      id: 1,
      turn: 1,
      phase: 'untap',
      seat: 'p1',
      kind: 'note',
      summary: 'Turn 1',
      state: state(1, 'untap'),
    },
    {
      id: 2,
      turn: 1,
      phase: 'draw',
      seat: 'p1',
      kind: 'draw',
      summary: 'Draws a card',
      state: state(1, 'draw'),
    },
    {
      id: 3,
      turn: 1,
      phase: 'combat',
      seat: 'p1',
      kind: 'attack',
      summary: 'Osgir attacks Defender.',
      cards: ['Osgir, the Reconstructor'],
      combat: {
        step: 'attackers',
        attackers: [
          {
            card: 'Osgir, the Reconstructor',
            defender: 'p2',
            pt: '4/4',
            tapped: osgirTapped,
            keywords: [],
          },
        ],
        possible_blockers: { p2: ['Squirrel'] },
      },
      state: state(1, 'combat', osgirTapped),
    },
    {
      id: 4,
      turn: 1,
      phase: 'combat',
      seat: 'p2',
      kind: 'block',
      summary: 'Defender chump blocks.',
      combat: {
        step: 'blockers',
        blocks: [
          {
            attacker: 'Osgir, the Reconstructor',
            blockers: ['Squirrel'],
          },
        ],
        unblocked: [],
      },
      state: state(1, 'combat', osgirTapped),
    },
    {
      id: 5,
      turn: 1,
      phase: 'combat',
      seat: 'p1',
      kind: 'damage',
      summary: 'Osgir deals 4 combat damage to Squirrel.',
      combat: { step: 'combat_damage' },
      damage: [
        {
          source: 'Osgir, the Reconstructor',
          target: 'Squirrel',
          amount: 4,
          type: 'combat',
          commander: true,
        },
      ],
      state: state(1, 'combat', osgirTapped),
    },
  ],
})

describe('combat records', () => {
  test('recorded combat passes', () => {
    expect(publicGame(game()).schema).toBe(2)
  })

  test('attack without declared blockers is rejected', () => {
    const replay = game()
    replay.events.splice(4, 1)
    replay.events.forEach((event: Json, index: number) => {
      event.id = index
    })
    expect(() => publicGame(replay)).toThrow(/never declared blockers/)
  })

  test('declining to block needs a reason', () => {
    const replay = game()
    replay.events[4].combat.blocks = []
    expect(() => publicGame(replay)).toThrow(/decision\.reason/)
  })

  test('declining to block with a reason passes', () => {
    const replay = game()
    replay.events[4].combat.blocks = []
    replay.events[4].decision = {
      reason: 'The Squirrels are food for the sacrifice outlet this turn.',
    }
    expect(() => publicGame(replay)).not.toThrow()
  })

  test('defender with no blockers needs no reason', () => {
    const replay = game()
    replay.events[3].combat.possible_blockers = { p2: [] }
    replay.events[4].combat.blocks = []
    expect(() => publicGame(replay)).not.toThrow()
  })

  test('untyped damage is rejected', () => {
    const replay = game()
    delete replay.events[5].damage[0].type
    expect(() => publicGame(replay)).toThrow(/combat.*noncombat/)
  })

  test('attacker tapped state must match snapshot', () => {
    const replay = game()
    replay.events[3].combat.attackers[0].tapped = false
    expect(() => publicGame(replay)).toThrow(/declares tapped/)
  })

  test('vigilant attacker stays untapped', () => {
    const replay = game(2, false)
    replay.events[3].combat.attackers[0].keywords = ['vigilance']
    expect(() => publicGame(replay)).not.toThrow()
  })

  test('legacy schema one renders without combat records', () => {
    const replay = game(1)
    replay.events = replay.events.slice(0, 4)
    replay.events[3] = {
      id: 3,
      turn: 1,
      phase: 'combat',
      seat: 'p1',
      kind: 'damage',
      summary: 'Osgir deals 4 to Defender.',
      state: state(1, 'combat'),
    }
    expect(() => publicGame(replay)).not.toThrow()
  })

  test('combat damage needs a declared attack', () => {
    const replay = game()
    replay.events = [...replay.events.slice(0, 3), replay.events[5]]
    replay.events.forEach((event: Json, index: number) => {
      event.id = index
    })
    expect(() => publicGame(replay)).toThrow(/without a declared attack/)
  })
})

describe('turn labels', () => {
  test('matching untap turn label passes', () => {
    expect(() => validateTurnLabels(game().events)).not.toThrow()
  })

  test('mismatched untap turn label is rejected', () => {
    const replay = game()
    replay.events[1].summary = 'Turn 16 — Attacker untaps.'
    expect(() => validateTurnLabels(replay.events)).toThrow(
      /summary says turn 16/,
    )
  })
})

const planningEvents = (): Json[] => {
  const events = seats.map((seat, index) => ({
    id: index,
    turn: 0,
    phase: 'planning',
    seat: seat.id,
    kind: 'think',
    plan: {
      scope: 'game',
      status: 'set',
      summary: `${seat.name} follows its primer.`,
    },
  }))
  events.push(
    {
      id: 4,
      turn: 1,
      phase: 'planning',
      seat: 'p1',
      kind: 'think',
      plan: {
        scope: 'turn',
        status: 'set',
        summary: 'Develop mana, then cast the commander.',
        steps: ['Play a land', 'Cast a mana rock'],
      },
    },
    {
      id: 5,
      turn: 1,
      phase: 'untap',
      seat: 'p1',
      kind: 'untap',
    },
    {
      id: 6,
      turn: 1,
      phase: 'draw',
      seat: 'p1',
      kind: 'draw',
    },
    {
      id: 7,
      turn: 1,
      phase: 'impact',
      seat: 'p1',
      kind: 'think',
      plan: {
        scope: 'impact',
        status: 'kept',
        summary: 'Develop mana, then cast the commander.',
      },
    },
  )
  return events
}

const seatIds = new Set(seats.map((seat) => seat.id))

describe('plan records', () => {
  test('complete plan cycle passes', () => {
    expect(() => validatePlans(planningEvents(), seatIds, true)).not.toThrow()
  })

  test('untap without turn plan is rejected', () => {
    const events = planningEvents()
    events.splice(4, 1)
    expect(() => validatePlans(events, seatIds, true)).toThrow(
      /preceding turn plan/,
    )
  })

  test('draw without impact plan is rejected', () => {
    expect(() =>
      validatePlans(planningEvents().slice(0, -1), seatIds, true),
    ).toThrow(/following impact plan/)
  })

  test('old replay does not require plan cycle', () => {
    expect(() => validatePlans([], seatIds, false)).not.toThrow()
  })
})

const planState = (hand: string[] = [], revealedTop: string[] = []) => {
  const snapshot = state(5, 'planning')
  snapshot.players.p1.hand = hand
  snapshot.players.p1.revealed_top = revealedTop
  return snapshot
}

const turnPlanEvents = (summary: string, hand: string[] = []): Json[] => [
  {
    id: 0,
    turn: 5,
    phase: 'planning',
    seat: 'p1',
    kind: 'think',
    plan: { scope: 'turn', status: 'set', summary },
    state: planState(hand),
  },
  {
    id: 1,
    turn: 5,
    phase: 'draw',
    seat: 'p1',
    kind: 'draw',
    cards: ['Boltwave'],
    state: state(5, 'draw'),
  },
]

describe('plan draw knowledge', () => {
  test('turn plan cannot know unrevealed next draw', () => {
    expect(() =>
      validatePlanDrawKnowledge(
        turnPlanEvents('Cast Boltwave after the land drop.'),
        { Boltwave: {} },
        [],
      ),
    ).toThrow(/knew unrevealed next draw Boltwave/)
  })

  test('turn plan may name search target that is next draw', () => {
    expect(() =>
      validatePlanDrawKnowledge(
        turnPlanEvents('Tutor for Boltwave if the damage is lethal.'),
        { Boltwave: {} },
        [],
      ),
    ).not.toThrow()
  })

  test('unrelated if does not excuse topdeck knowledge', () => {
    expect(() =>
      validatePlanDrawKnowledge(
        turnPlanEvents('Cast Boltwave if Alania is tapped.'),
        { Boltwave: {} },
        [],
      ),
    ).toThrow(/knew unrevealed next draw Boltwave/)
  })

  test('hypothetical draw is allowed', () => {
    expect(() =>
      validatePlanDrawKnowledge(
        turnPlanEvents('If I draw Boltwave, cast it before combat.'),
        { Boltwave: {} },
        [],
      ),
    ).not.toThrow()
  })

  test('basic next draw does not match part of land name', () => {
    const events = turnPlanEvents(
      'Play Misty Rainforest, then cast the commander.',
      ['Misty Rainforest'],
    )
    events[1].cards = ['Forest']
    expect(() =>
      validatePlanDrawKnowledge(
        events,
        { Forest: {}, 'Misty Rainforest': {} },
        [],
      ),
    ).not.toThrow()
  })

  test('impact plan cannot claim previous seat draw', () => {
    const events = [
      {
        id: 0,
        turn: 7,
        phase: 'draw',
        seat: 'p4',
        kind: 'draw',
        cards: ['Goblin Electromancer'],
        state: state(7, 'draw'),
      },
      {
        id: 1,
        turn: 7,
        phase: 'impact',
        seat: 'p4',
        kind: 'think',
        plan: {
          scope: 'impact',
          status: 'kept',
          summary: 'Hold the first instant.',
          details: 'Drew Snow-Covered Swamp.',
        },
        state: state(7, 'impact'),
      },
    ]
    expect(() =>
      validatePlanDrawKnowledge(
        events,
        { 'Goblin Electromancer': {}, 'Snow-Covered Swamp': {} },
        [],
      ),
    ).toThrow(/preceding draw was Goblin Electromancer/)
  })

  test('impact plan may name its actual draw', () => {
    const events = [
      {
        id: 0,
        turn: 7,
        phase: 'draw',
        seat: 'p4',
        kind: 'draw',
        cards: ['Goblin Electromancer'],
        state: state(7, 'draw'),
      },
      {
        id: 1,
        turn: 7,
        phase: 'impact',
        seat: 'p4',
        kind: 'think',
        plan: {
          scope: 'impact',
          status: 'revised',
          summary: 'Cast Goblin Electromancer.',
          details: 'Drew Goblin Electromancer.',
        },
        state: state(7, 'impact'),
      },
    ]
    expect(() =>
      validatePlanDrawKnowledge(
        events,
        { 'Goblin Electromancer': {} },
        [],
      ),
    ).not.toThrow()
  })
})

describe('play invariants', () => {
  test('commander must remain in a zone', () => {
    const replay = game()
    const last = replay.events.at(-1)
    last.state.players.p1.command = []
    last.state.players.p1.battlefield = []
    expect(() => publicGame(replay)).toThrow(/missing Osgir/)
  })

  test('cast permanent does not enter tapped', () => {
    const catalog = {
      'Phial of Galadriel': {
        type_line: 'Legendary Artifact',
        oracle_text: '{T}: Add one mana of any color.',
      },
    }
    const empty = {
      life: 40,
      library_count: 80,
      hand: [],
      battlefield: [],
      graveyard: [],
      command: ['Osgir, the Reconstructor'],
    }
    const events = [
      {
        id: 0,
        kind: 'setup',
        seat: null,
        state: { players: { p1: empty } },
      },
      {
        id: 1,
        kind: 'cast',
        seat: 'p1',
        cards: ['Phial of Galadriel'],
        state: {
          players: {
            p1: {
              ...empty,
              battlefield: [{ name: 'Phial of Galadriel', tapped: true }],
            },
          },
        },
      },
    ]
    expect(() => validateEnterUntapped(events, catalog, [])).toThrow(
      /entered tapped/,
    )
  })

  test('cast spell stays on stack until its own resolution', () => {
    const events = [
      {
        id: 1,
        kind: 'cast',
        cards: ['Seedborn Muse'],
        state: { stack: [{ name: 'Seedborn Muse' }] },
      },
      {
        id: 2,
        kind: 'resolve',
        cards: ['Ms. Bumbleflower'],
        state: { stack: [{ name: 'Seedborn Muse' }] },
      },
      {
        id: 3,
        kind: 'resolve',
        cards: ['Seedborn Muse'],
        state: { stack: [] },
      },
    ]
    expect(() => validateCastStacks(events, [])).not.toThrow()
  })

  test('cast spell cannot disappear during its trigger', () => {
    const events = [
      {
        id: 1,
        kind: 'cast',
        cards: ['Loki, God of Mischief'],
        state: { stack: [{ name: 'Loki, God of Mischief' }] },
      },
      {
        id: 2,
        kind: 'resolve',
        cards: ['Ms. Bumbleflower'],
        state: { stack: [] },
      },
    ]
    expect(() => validateCastStacks(events, [])).toThrow(/left state\.stack/)
  })

  test('cast spell must appear on stack', () => {
    const events = [
      {
        id: 1,
        kind: 'cast',
        cards: ["Sin, Spira's Punishment"],
        state: { stack: [] },
      },
    ]
    expect(() => validateCastStacks(events, [])).toThrow(
      /must put it on state\.stack/,
    )
  })

  test('trigger must appear on stack with ability text', () => {
    const event = {
      id: 2,
      kind: 'trigger',
      cards: ['Ms. Bumbleflower'],
      state: {
        stack: [
          { name: 'Seedborn Muse', kind: 'spell' },
          {
            name: 'Ms. Bumbleflower',
            kind: 'trigger',
            text: 'Whenever you cast a spell — p3 draws',
          },
        ],
      },
    }
    expect(() => validateTriggerStacks([event], [])).not.toThrow()
    delete event.state.stack[1].kind
    expect(() => validateTriggerStacks([event], [])).toThrow(
      /must appear on state\.stack/,
    )
    event.state.stack[1].kind = 'trigger'
    event.state.stack[1].text = ''
    expect(() => validateTriggerStacks([event], [])).toThrow(
      /needs its ability text/,
    )
  })

  test('token must resolve to permanent metadata', () => {
    const events = [
      {
        id: 1,
        state: {
          players: {
            p1: {
              battlefield: [
                {
                  name: 'Elephant',
                  token: true,
                  token_id: 'copy',
                  pt: '3/3',
                },
              ],
            },
          },
        },
      },
    ]
    expect(() =>
      validateTokenMetadata(
        events,
        {},
        { copy: { type_line: 'Token' } },
        [],
      ),
    ).toThrow(/permanent type metadata/)
  })

  test('token can use exact printing or copied card metadata', () => {
    const events = [
      {
        id: 1,
        state: {
          players: {
            p1: {
              battlefield: [
                { name: 'Elephant', token: true, token_id: 'elephant' },
                { name: 'Forest', token: true },
              ],
            },
          },
        },
      },
    ]
    expect(() =>
      validateTokenMetadata(
        events,
        { Forest: { type_line: 'Basic Land — Forest' } },
        {
          elephant: {
            type_line: 'Token Creature — Elephant',
          },
        },
        [],
      ),
    ).not.toThrow()
  })

  test('open mana cannot ignore untapped lands', () => {
    const events = [
      {
        id: 1,
        seat: 'p1',
        decision: { open_mana: 0, reason: 'Hold interaction.' },
        state: {
          players: {
            p1: {
              battlefield: [
                { name: 'Island', tapped: false },
                { name: 'Island', tapped: false },
                { name: 'Island', tapped: false },
              ],
            },
          },
        },
      },
    ]
    expect(() =>
      validateOpenMana(
        events,
        { Island: { type_line: 'Basic Land — Island' } },
        [],
      ),
    ).toThrow(/open_mana is 0/)
  })

  test('reason cannot cite another hand', () => {
    const replay = game()
    replay.catalog["Tasha's Hideous Laughter"] = { type_line: 'Sorcery' }
    replay.events[3].decision = {
      reason: "Attack to stop Tasha's Hideous Laughter.",
    }
    replay.events[3].state.players.p3.hand = ["Tasha's Hideous Laughter"]
    expect(() => publicGame(replay, { strict: true })).toThrow(/hidden card/)
  })

  test('reason may name a basic land in another hand', () => {
    const replay = game()
    replay.catalog.Island = { type_line: 'Basic Land — Island' }
    replay.events[3].decision = {
      reason: 'Fetch an Island for the second blue source.',
    }
    replay.events[3].state.players.p3.hand = ['Island']
    expect(() => publicGame(replay, { strict: true })).not.toThrow()
  })
})
