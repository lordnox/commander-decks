import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import {
  catalogEntry,
  deckCards,
  deckCardTemplate,
  DECK_DIRECTORIES,
  loadCardPlugins,
} from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, ManaId, ManaPool } from '../types'
import { effectsFromTokenSpec } from './effects'

/**
 * Every mana source of the four decks planned for the live table (Homer,
 * Lady Evangela, Sin, Círdan), driven the way the table drives it: the card is
 * built from its `cards.json` Oracle text through the production template
 * path and the human or agent reaches its mana through `legalActsFor`.
 *
 * - Planner route: a probe spell sits in hand and the action planner must find
 *   exactly the Oracle mana (and not one more) to cast it.
 * - Act route: abilities the planner does not fund by itself (they cost mana,
 *   mill or life first) are offered as explicit activations once payable, and
 *   the kernel must accept them and add exactly the Oracle mana.
 */

type Probe = { types: string[]; subtypes?: string[]; supertypes?: string[] }

type Fund = {
  /** A probe spell with this cost must be castable by tapping the source. */
  cost: string
  /** Life p1 must have lost after paying it (pain, Mana Confluence, ...). */
  life: number
  /** Overrides the scenario's probe for this cost. */
  probe?: Probe
}

type Refuse = { cost: string; probe?: Probe }

type Scenario = {
  /** Other permanents p1 controls (untapped, not summoning sick). */
  helpers?: string[]
  /** Permanents p2 controls. */
  opponent?: string[]
  /** Colors of p1's commander, which waits in the command zone. */
  commander?: ManaId[]
  fund: Array<string | Fund>
  /** Costs that must not be payable, on top of "each fund cost plus {1}". */
  refuse?: Array<string | Refuse>
  /** Probe spell characteristics (a permanent spell, which the planner offers). */
  probe?: Probe
  /** Cards p1 owns in exile. */
  exile?: CardTemplate[]
  /** The card is a modal double-faced land played from hand; the face it shows is tested. */
  play?: boolean
  /** Patch the built game before planning (linked exile, chosen creature type, ...). */
  setup?: (state: GameState, sourceId: string) => void
  /** Template fields that a real table deal adds for this card (token effects). */
  override?: Partial<CardTemplate>
  /** Do not also require every fund cost plus {1} to be refused (a helper makes surplus mana). */
  surplus?: boolean
  /** A mana creature must not tap while summoning sick. */
  sickBlocked?: boolean
}

const free = (...costs: string[]): Scenario => ({ fund: costs })
const typed = (...costs: string[]): Scenario => ({ fund: costs, refuse: ['{R}'] })
const pain = (...colors: string[]): Scenario => ({
  fund: ['{C}', ...colors.map((cost): Fund => ({ cost, life: 1 }))],
})
const anyColor = (life = 0): Scenario => ({
  fund: ['{W}', '{U}', '{B}', '{R}', '{G}'].map((cost): Fund => ({ cost, life })),
})
const landFace = (...costs: string[]): Scenario => ({ play: true, fund: costs, refuse: ['{R}'] })

const ELF: Probe = { types: ['Creature'], subtypes: ['Elf'] }
const GOBLIN: Probe = { types: ['Creature'], subtypes: ['Goblin'] }
const ARTIFACT: Probe = { types: ['Artifact'] }
const LEGEND: Probe = { types: ['Creature'], supertypes: ['Legendary'] }
const PLAIN: Probe = { types: ['Creature'] }

const SCENARIOS: Record<string, Scenario> = {
  // Basic lands and basic-typed duals: the land type itself is the mana ability.
  Forest: free('{G}'),
  Island: free('{U}'),
  Swamp: free('{B}'),
  Plains: free('{W}'),
  'Breeding Pool': typed('{G}', '{U}'),
  'Hedge Maze': typed('{G}', '{U}'),
  'Tropical Island': typed('{G}', '{U}'),
  'Overgrown Tomb': typed('{B}', '{G}'),
  'Underground Mortuary': typed('{B}', '{G}'),
  'Watery Grave': typed('{U}', '{B}'),
  'Undercity Sewers': typed('{U}', '{B}'),
  'Sunken Hollow': typed('{U}', '{B}'),
  'Eclipsed Steppe': typed('{W}', '{B}'),
  'Godless Shrine': typed('{W}', '{B}'),
  'Shadowy Backstreet': typed('{W}', '{B}'),
  'Hallowed Fountain': typed('{W}', '{U}'),
  "Raffine's Tower": typed('{W}', '{U}', '{B}'),
  'Zagoth Triome': typed('{B}', '{G}', '{U}'),
  'Mystic Sanctuary': free('{U}'),
  // Printed lands with a plain tap ability.
  'Botanical Sanctum': typed('{G}', '{U}'),
  'Glacial Fortress': typed('{W}', '{U}'),
  'Hinterland Harbor': typed('{G}', '{U}'),
  'Rejuvenating Springs': typed('{G}', '{U}'),
  'Adarkar Wastes': pain('{W}', '{U}'),
  'Caves of Koilos': pain('{W}', '{B}'),
  'Underground River': pain('{U}', '{B}'),
  'Yavimaya Coast': pain('{G}', '{U}'),
  'Cephalid Coliseum': { fund: [{ cost: '{U}', life: 1 }] },
  'Mana Confluence': anyColor(1),
  'Boseiju, Who Endures': free('{G}'),
  'Dakmor Salvage': free('{B}'),
  'Field of the Dead': free('{C}'),
  'Ghost Town': free('{C}'),
  'Esper Panorama': free('{C}'),
  'Blighted Woodland': free('{C}'),
  'Myriad Landscape': free('{C}'),
  'Reliquary Tower': free('{C}'),
  'Deserted Temple': free('{C}'),
  "Minamo, School at Water's Edge": free('{U}'),
  'Otawara, Soaring City': free('{U}'),
  'Oboro, Palace in the Clouds': free('{U}'),
  'Hall of Storm Giants': free('{U}'),
  'Lair of the Hydra': free('{G}'),
  'Dryad Arbor': free('{G}'),
  'Dimir Aqueduct': free('{U}{B}'),
  'Orzhov Basilica': free('{W}{B}'),
  'Golgari Rot Farm': free('{B}{G}'),
  'Simic Growth Chamber': free('{G}{U}'),
  'Alchemist\'s Refuge': free('{C}'),
  'Waterlogged Grove': { fund: [{ cost: '{G}', life: 1 }, { cost: '{U}', life: 1 }], refuse: ['{B}'] },
  // Artifacts and creatures with a plain tap ability.
  'Sol Ring': free('{C}{C}'),
  'Fyndhorn Elves': { fund: ['{G}'], sickBlocked: true },
  'Llanowar Elves': { fund: ['{G}'], sickBlocked: true },
  'Skull Prophet': { fund: ['{B}', '{G}'], sickBlocked: true, refuse: ['{U}'] },
  "Bender's Waterskin": anyColor(),
  'Phial of Galadriel': anyColor(),
  'Firdoch Core': anyColor(),
  'Eldrazi Spawn': {
    fund: ['{C}'],
    // A token a table deal makes has its mana ability from its token spec, not from tapProduces.
    override: {
      token: true,
      summoningSickness: true,
      tapProduces: undefined,
      effects: effectsFromTokenSpec({ name: 'Eldrazi Spawn', sacrificeForMana: { C: 1 } }),
    },
  },
  // Mana that depends on the board.
  'Command Tower': {
    commander: ['G', 'U'],
    fund: ['{G}', '{U}'],
    refuse: ['{B}', '{R}', '{W}'],
  },
  'Arcane Signet': {
    commander: ['W', 'B'],
    fund: ['{W}', '{B}'],
    refuse: ['{G}', '{U}', '{R}'],
  },
  'Exotic Orchard': {
    opponent: ['Forest', 'Swamp'],
    fund: ['{G}', '{B}'],
    refuse: ['{U}', '{W}'],
  },
  'Fellwar Stone': {
    opponent: ['Forest', 'Swamp'],
    fund: ['{G}', '{B}'],
    refuse: ['{U}', '{W}'],
  },
  'Reflecting Pool': {
    helpers: ['Forest', 'Island'],
    fund: ['{G}', '{U}'],
    refuse: ['{B}', '{W}'],
    surplus: true,
  },
  'Horizon of Progress': {
    helpers: ['Forest', 'Island'],
    // The Forest and Island make {G} and {U} themselves, so the second of a color is Horizon's.
    fund: [{ cost: '{G}{G}', life: 1 }, { cost: '{U}{U}', life: 1 }],
    refuse: ['{G}{G}{G}', '{B}{G}'],
    surplus: true,
  },
  'Temple of the False God': {
    helpers: ['Forest', 'Forest', 'Forest', 'Forest'],
    fund: ['{G}{G}{G}{G}{C}{C}'],
    refuse: ['{G}{G}{G}{G}{C}{C}{1}'],
    surplus: true,
  },
  'Pit of Offerings': {
    exile: [cardTemplate('Exiled Red Card', { types: ['Creature'], colors: ['R'] })],
    setup: (state, sourceId) => {
      const exiled = Object.values(state.objects).find((object) => object.name === 'Exiled Red Card')!
      state.objects[sourceId].exiledCards = [exiled.id]
    },
    fund: ['{C}', '{R}'],
    refuse: ['{G}', '{U}'],
  },
  'Cavern of Souls': {
    setup: (state, sourceId) => { state.objects[sourceId].chosenType = 'Elf' },
    fund: [
      '{C}',
      { cost: '{G}', life: 0, probe: ELF },
      { cost: '{R}', life: 0, probe: ELF },
    ],
    refuse: [
      { cost: '{G}', probe: GOBLIN },
      { cost: '{G}', probe: ARTIFACT },
    ],
  },
  'Delighted Halfling': {
    sickBlocked: true,
    fund: [
      '{C}',
      { cost: '{G}', life: 0, probe: LEGEND },
      { cost: '{R}', life: 0, probe: LEGEND },
    ],
    refuse: [
      { cost: '{G}', probe: PLAIN },
      { cost: '{G}', probe: ARTIFACT },
    ],
  },
  // Costed mana abilities the planner funds from other sources: a Signet is not a free tap.
  'Dimir Signet': { helpers: ['Island'], fund: ['{U}{B}'], refuse: ['{G}'] },
  'Orzhov Signet': { helpers: ['Plains'], fund: ['{W}{B}'], refuse: ['{G}'] },
  'Simic Signet': { helpers: ['Island'], fund: ['{G}{U}'], refuse: ['{B}'] },
  'Flooded Grove': {
    helpers: ['Island'],
    fund: ['{C}', '{G}{G}', '{G}{U}', '{U}{U}'],
    refuse: ['{B}', '{G}{G}{G}'],
    surplus: true,
  },
  // Free taps that the table's land-playing rule turns into a land face first.
  'Bala Ged Recovery // Bala Ged Sanctuary': landFace('{G}'),
  'Malakir Rebirth // Malakir Mire': landFace('{B}'),
  'Fell the Profane // Fell Mire': landFace('{B}'),
  'Bridgeworks Battle // Tanglespan Bridgeworks': landFace('{G}'),
  'Hagra Mauling // Hagra Broodpit': landFace('{B}'),
  'Khalni Ambush // Khalni Territory': landFace('{G}'),
  'Revitalizing Repast // Old-Growth Grove': landFace('{B}', '{G}'),
  'Sink into Stupor // Soporific Springs': landFace('{U}'),
  'Waterlogged Teachings // Inundated Archive': landFace('{U}', '{B}'),
  'Sea Gate Restoration // Sea Gate, Reborn': landFace('{U}'),
  'Zanarkand, Ancient Metropolis // Lasting Fayth': landFace('{G}'),
}

type ActCase = {
  /** Other permanents p1 controls. */
  helpers?: string[]
  /** Mana already in p1's pool (the ability's own cost). */
  pool?: Partial<ManaPool>
  /** The ability the act offers, and the mana each offered choice adds. */
  abilityId: string
  adds: Array<{ mana?: ManaId; pool: Partial<ManaPool> }>
  /** Life p1 loses and cards p1 mills while paying the ability's cost. */
  life?: number
  milled?: number
  /** The ability taps its source. */
  taps?: boolean
  /** Offered only once its mana cost is already in the pool (not planner-funded). */
  poolGated?: boolean
}

const EVERY_COLOR: ActCase['adds'] = (['W', 'U', 'B', 'R', 'G'] as const)
  .map((mana) => ({ mana, pool: { [mana]: 1 } }))

const ACT_CASES: Record<string, ActCase> = {
  Millikin: {
    abilityId: 'selfMill.millikin',
    adds: [{ pool: { C: 1 } }],
    milled: 1,
    taps: true,
  },
  'Blood Celebrant': {
    pool: { B: 1 },
    abilityId: 'bloodCelebrant.mana',
    adds: EVERY_COLOR,
    life: 1,
  },
  'Talon Gates of Madara': {
    pool: { C: 1 },
    abilityId: 'talon.any-mana',
    adds: EVERY_COLOR,
    taps: true,
  },
  'Lotus Field': {
    abilityId: 'lotusField.mana',
    adds: (['W', 'U', 'B', 'R', 'G'] as const).map((mana) => ({ mana, pool: { [mana]: 3 } })),
    taps: true,
  },
  'Cabal Coffers': {
    helpers: ['Swamp', 'Swamp', 'Swamp'],
    pool: { C: 2 },
    abilityId: 'coffers.cabal',
    poolGated: true,
    adds: [{ pool: { B: 3 } }],
    taps: true,
  },
  'Cabal Stronghold': {
    helpers: ['Swamp', 'Swamp', 'Swamp', 'Swamp'],
    pool: { C: 3 },
    abilityId: 'coffers.stronghold',
    poolGated: true,
    adds: [{ pool: { B: 4 } }],
    taps: true,
  },
  'Magus of the Coffers': {
    helpers: ['Swamp', 'Swamp', 'Swamp'],
    pool: { C: 2 },
    abilityId: 'coffers.magus',
    poolGated: true,
    adds: [{ pool: { B: 3 } }],
    taps: true,
  },
}

/**
 * Mana sources the live table cannot yet produce faithfully. Each names the
 * capability the rules engine lacks; none is registered with partial behaviour.
 */
const KNOWN_GAPS: Record<string, string> = {
  'Castle Garenbrig':
    '{2}{G}{G},{T}: Add six {G} that may only pay for creature spells or creature abilities needs a restricted-mana variant besides the chosen-creature-type one',
  'Barkchannel Pathway // Tidechannel Pathway':
    'playLand always shows the first land face; there is no way to choose the Tidechannel (blue) face',
}

/** Sources with their own describe block below. */
const BESPOKE = ['City of Brass']

const PROBE = 'Probe'

const costValue = (cost: string) =>
  [...cost.matchAll(/\{(\d+|[WUBRGC])\}/g)]
    .reduce((total, match) => total + (/^\d+$/.test(match[1]) ? Number(match[1]) : 1), 0)

const probeCard = (probe: Probe | undefined, cost: string) => cardTemplate(PROBE, {
  types: probe?.types ?? ['Creature'],
  subtypes: probe?.subtypes ?? [],
  supertypes: probe?.supertypes ?? [],
  manaCost: cost,
  manaValue: costValue(cost),
})

const commanderCard = (colors: ManaId[]) => cardTemplate('Test Commander', {
  types: ['Creature'],
  supertypes: ['Legendary'],
  colors,
  tags: ['commander'],
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

const PLUGINS = await loadCardPlugins([
  ...Object.keys(SCENARIOS),
  ...Object.keys(ACT_CASES),
  'City of Brass',
  ...[...Object.values(SCENARIOS), ...Object.values(ACT_CASES)].flatMap((scenario) => [
    ...(scenario.helpers ?? []),
    ...('opponent' in scenario ? scenario.opponent ?? [] : []),
  ]),
])

const build = (
  card: string,
  options: {
    helpers?: string[]
    opponent?: string[]
    commander?: ManaId[]
    hand?: CardTemplate[]
    exile?: CardTemplate[]
    override?: Partial<CardTemplate>
    sick?: boolean
    inHand?: boolean
    /** Put the source after its helpers in object order. */
    last?: boolean
    library?: number
  },
) => {
  const source = {
    ...deckCardTemplate(card, options.override),
    ...(options.sick ? { summoningSickness: true } : {}),
  }
  const helpers = (options.helpers ?? []).map((name) => deckCardTemplate(name))
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      battlefield: {
        p1: options.inHand ? helpers : options.last ? [...helpers, source] : [source, ...helpers],
        p2: (options.opponent ?? []).map((name) => deckCardTemplate(name)),
      },
      hands: {
        p1: [
          ...(options.hand ?? []),
          ...(options.inHand ? [source] : []),
          ...(options.exile ?? []).map((template): CardTemplate => ({ ...template, zone: 'exile' })),
        ],
      },
      libraries: {
        p1: Array.from({ length: options.library ?? 3 }, (_, index) => cardTemplate(`Library ${index}`)),
      },
      ...(options.commander ? { command: { p1: [commanderCard(options.commander)] } } : {}),
    },
    { random: () => 0.5, cardPlugins: PLUGINS },
  )
  return { server, state: structuredClone(server.state), sourceId: named(server.state, card)[0].id }
}

type Attempt = { castable: boolean; lifeLost: number }

/** Planner route: can a probe spell of this cost be cast by tapping the source? */
const attempt = (
  card: string,
  scenario: Scenario,
  cost: string,
  options: { sick?: boolean; probe?: Probe } = {},
): Attempt => {
  const { server, state: built, sourceId } = build(card, {
    helpers: scenario.helpers,
    opponent: scenario.opponent,
    commander: scenario.commander,
    hand: [probeCard(options.probe ?? scenario.probe, cost)],
    exile: scenario.exile,
    override: scenario.override,
    sick: options.sick,
    inHand: scenario.play,
  })
  let state = built
  if (scenario.play) {
    state = ok(server.rules(state, { type: 'playLand', seat: 'p1', objectId: sourceId }))
    if (state.players.p1.data['kernel.pendingDialog']) {
      state = ok(server.rules(state, {
        type: 'custom',
        name: DIALOG_CHOSEN,
        seat: 'p1',
        payload: { accepted: true },
      }))
    }
    state.objects[sourceId].tapped = false
  }
  scenario.setup?.(state, sourceId)
  const before = state.players.p1.life
  const act = legalActsFor(state, 'p1').find((candidate) =>
    candidate.kind === 'castSpell' && candidate.name === PROBE)
  const events = act ? eventsForAvailableAction(state, 'p1', act) : null
  if (!events) return { castable: false, lifeLost: 0 }
  const cast = events.reduce((current, event) => ok(server.rules(current, event)), state)
  const next = resolveStack(server.rules, cast)
  return {
    castable: named(next, PROBE)[0]?.zone === 'battlefield',
    lifeLost: before - next.players.p1.life,
  }
}

const costOf = (entry: string | Fund | Refuse) => typeof entry === 'string' ? entry : entry.cost
const lifeOf = (entry: string | Fund) => typeof entry === 'string' ? 0 : entry.life
const probeOf = (entry: string | Fund | Refuse) => typeof entry === 'string' ? undefined : entry.probe

describe('planner route: the mana a source yields is exactly its Oracle mana', () => {
  for (const [card, scenario] of Object.entries(SCENARIOS)) {
    describe(card, () => {
      for (const fund of scenario.fund) {
        const cost = costOf(fund)
        const label = probeOf(fund)?.subtypes?.[0] ? ` for a ${probeOf(fund)?.subtypes?.[0]}` : ''
        test(`funds ${cost}${label}${lifeOf(fund) ? ` for ${lifeOf(fund)} life` : ''}`, () => {
          const result = attempt(card, scenario, cost, { probe: probeOf(fund) })
          expect(result.castable).toBe(true)
          expect(result.lifeLost).toBe(lifeOf(fund))
        })
        if (!scenario.surplus && probeOf(fund) === undefined) {
          test(`cannot fund ${cost}{1}: no surplus mana`, () => {
            expect(attempt(card, scenario, `${cost}{1}`).castable).toBe(false)
          })
        }
      }
      for (const refuse of scenario.refuse ?? []) {
        const label = probeOf(refuse)
          ? ` for ${probeOf(refuse)?.subtypes?.[0] ?? probeOf(refuse)?.types[0]}`
          : ''
        test(`cannot fund ${costOf(refuse)}${label}`, () => {
          expect(attempt(card, scenario, costOf(refuse), { probe: probeOf(refuse) }).castable)
            .toBe(false)
        })
      }
      if (scenario.sickBlocked) {
        test('does not tap while summoning sick', () => {
          expect(attempt(card, scenario, costOf(scenario.fund[0]), { sick: true }).castable)
            .toBe(false)
        })
      }
    })
  }
})

describe('act route: costed mana abilities are offered and add exactly their Oracle mana', () => {
  for (const [card, scenario] of Object.entries(ACT_CASES)) {
    describe(card, () => {
      for (const { mana, pool } of scenario.adds) {
        test(`activates for ${Object.entries(pool).map(([symbol, count]) => `${count}${symbol}`).join('')}`, () => {
          const { server, state, sourceId } = build(card, { helpers: scenario.helpers })
          state.players.p1.mana = { ...emptyMana(), ...scenario.pool }
          const lifeBefore = state.players.p1.life
          const libraryBefore = state.zoneOrder.p1.library.length
          const act = legalActsFor(state, 'p1').find((candidate) =>
            candidate.kind === 'activateAbility'
            && candidate.objectId === sourceId
            && candidate.abilityId === scenario.abilityId
            && candidate.mana === mana)
          expect(act).toBeDefined()
          const events = eventsForAvailableAction(state, 'p1', act!)!
          const next = events.reduce((current, event) => ok(server.rules(current, event)), state)
          expect(next.players.p1.mana).toEqual({ ...emptyMana(), ...pool })
          expect(lifeBefore - next.players.p1.life).toBe(scenario.life ?? 0)
          expect(libraryBefore - next.zoneOrder.p1.library.length).toBe(scenario.milled ?? 0)
          expect(next.objects[sourceId].tapped).toBe(scenario.taps ?? false)
        })
      }
      if (scenario.poolGated) {
        test('is not offered until its cost is in the pool', () => {
          const { state, sourceId } = build(card, { helpers: scenario.helpers })
          state.players.p1.mana = emptyMana()
          expect(legalActsFor(state, 'p1').filter((candidate) =>
            candidate.kind === 'activateAbility'
            && candidate.objectId === sourceId
            && candidate.abilityId === scenario.abilityId)).toEqual([])
        })
      }
    })
  }
})

describe('City of Brass', () => {
  const creature = () => cardTemplate(PROBE, {
    types: ['Creature'],
    manaCost: '{G}',
    manaValue: 1,
  })
  const castActs = (state: GameState) => legalActsFor(state, 'p1').filter((act) =>
    act.kind === 'castSpell' && act.name === PROBE)

  test.each([[false], [true]])(
    'a {G} creature is paid by the Forest, never by City of Brass, whatever the object order (City last: %s)',
    (last) => {
      const { server, state } = build('City of Brass', {
        helpers: ['Forest'],
        hand: [creature()],
        last,
      })
      const [act] = castActs(state)
      const events = eventsForAvailableAction(state, 'p1', act)!
      expect(events.map((event) => event.type)).toEqual(['tapForMana', 'castSpell'])
      expect(state.objects[(events[0] as { objectId: string }).objectId].name).toBe('Forest')
      const next = resolveStack(server.rules, events.reduce(
        (current, event) => ok(server.rules(current, event)),
        state,
      ))
      expect(named(next, PROBE)[0].zone).toBe('battlefield')
      expect(next.players.p1.life).toBe(state.players.p1.life)
      expect(named(next, 'City of Brass')[0].tapped).toBe(false)
    },
  )

  test('alone it is not offered a sorcery-speed cast, but can be tapped by hand and then cast from', () => {
    const { server, state, sourceId } = build('City of Brass', { hand: [creature()] })
    expect(castActs(state)).toEqual([])
    const manual = legalActsFor(state, 'p1').filter((act) =>
      act.kind === 'tapForMana' && act.objectId === sourceId)
    expect(manual.map((act) => act.kind === 'tapForMana' ? act.mana : undefined).toSorted())
      .toEqual(['B', 'G', 'R', 'U', 'W'])

    const tapped = ok(server.rules(state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: sourceId,
      mana: 'G',
    }))
    // The trigger waits on the stack, and the spell is not castable until it resolves.
    expect(tapped.stack).toHaveLength(1)
    expect(server.rules(tapped, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(tapped, PROBE)[0].id,
    }).ok).toBe(false)
    const resolved = resolveStack(server.rules, tapped)
    expect(resolved.players.p1.life).toBe(state.players.p1.life - 1)
    const [act] = castActs(resolved)
    const cast = eventsForAvailableAction(resolved, 'p1', act)!
      .reduce((current, event) => ok(server.rules(current, event)), resolved)
    expect(named(resolveStack(server.rules, cast), PROBE)[0].zone).toBe('battlefield')
  })

  test.each(['W', 'U', 'B', 'R', 'G'] as const)(
    'tapped by hand it adds {%s} and pings once the trigger resolves',
    (mana) => {
      const { server, state, sourceId } = build('City of Brass', {})
      const tapped = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: sourceId, mana }))
      expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), [mana]: 1 })
      const resolved = resolveStack(server.rules, tapped)
      expect(resolved.players.p1.life).toBe(state.players.p1.life - 1)
      expect(resolved.players.p1.mana).toEqual({ ...emptyMana(), [mana]: 1 })
    },
  )
})

describe('the mana-source inventory of the four decks is complete', () => {
  const MANA_LINE = /^\(?[^"\n]*?:\s*Add\b/

  /** Deck cards with a printed mana ability on any face. */
  const manaCards = DECK_DIRECTORIES.flatMap((directory) =>
    deckCards(directory)
      .filter((entry) => {
        const faces = entry.card.faces?.map((face) => face.oracle_text ?? '')
          ?? [entry.card.oracle_text ?? '']
        return faces.some((text) => text.split('\n').some((line) => MANA_LINE.test(line)))
      })
      .map((entry) => entry.name))

  test('every mana ability is covered by a scenario, an act case, or a named gap', () => {
    const covered = new Set([
      ...Object.keys(SCENARIOS),
      ...Object.keys(ACT_CASES),
      ...Object.keys(KNOWN_GAPS),
      ...BESPOKE,
    ])
    expect([...new Set(manaCards)].filter((name) => !covered.has(name))).toEqual([])
  })

  test('every scenario names a card the four decks play', () => {
    const played = new Set(DECK_DIRECTORIES.flatMap((directory) =>
      deckCards(directory).map((entry) => entry.name)))
    const missing = [
      ...Object.keys(SCENARIOS),
      ...Object.keys(ACT_CASES),
      ...Object.keys(KNOWN_GAPS),
      ...BESPOKE,
    ].filter((name) => !played.has(name))
    expect(missing).toEqual([])
  })

  test('catalog entries keep the deck Oracle text of a double-faced land', () => {
    const entry = deckCards('3-_cirdan-show-me-what-you-got')
      .find((card) => card.name === 'Sea Gate Restoration // Sea Gate, Reborn')!
    expect(catalogEntry(entry).faces?.[1].oracle_text)
      .toBe('As this land enters, you may pay 3 life. If you don\'t, it enters tapped.\n{T}: Add {U}.')
  })
})
