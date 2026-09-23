import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { cardDefinition, effectsFor } from './cardRules'
import { enters, ptEqualsLife, tapAll } from './effects'
import { entersTapped as entersTappedPlugin } from './entersTapped'
import { onResolve as onResolvePlugin } from './onResolve'
import { targetedResolve } from './targetedResolve'

type Part37Status = 'registered' | 'kernel-only' | 'gap'

/** Every card name assigned to plug-dack part 37 (deck Oracle names). */
export const PART37_ASSIGNED = [
  'Act of Vengeance',
  'Astral Drift',
  'Ondu Inversion // Ondu Skyruins',
  'Rally the Ancestors',
  'Realm-Cloaked Giant // Cast Off',
  'Sandstone Oracle',
  'Serra Avatar',
  'Soul of Eternity',
  'Spawning Pit',
  'Steel Hellkite',
  'Storm of Souls',
  'Subjugator Angel',
  'Sudden Salvation',
  "Thalia's Lancers",
  'The Eagles Are Coming!',
  'The Restoration of Eiganjo // Architect of Restoration',
  'Timeless Dragon',
  'Tri-Sentinel, Act of Vengeance',
  'Twins of Discord',
  'Wakening Sun\'s Avatar',
  'Zetalpa, Primal Dawn',
] as const

export const PART37_STATUS: Record<typeof PART37_ASSIGNED[number], Part37Status> = {
  'Act of Vengeance': 'gap',
  'Astral Drift': 'registered',
  'Ondu Inversion // Ondu Skyruins': 'gap',
  'Rally the Ancestors': 'gap',
  'Realm-Cloaked Giant // Cast Off': 'gap',
  'Sandstone Oracle': 'registered',
  'Serra Avatar': 'gap',
  'Soul of Eternity': 'registered',
  'Spawning Pit': 'gap',
  'Steel Hellkite': 'gap',
  'Storm of Souls': 'gap',
  'Subjugator Angel': 'registered',
  'Sudden Salvation': 'gap',
  "Thalia's Lancers": 'registered',
  'The Eagles Are Coming!': 'gap',
  'The Restoration of Eiganjo // Architect of Restoration': 'gap',
  'Timeless Dragon': 'gap',
  'Tri-Sentinel, Act of Vengeance': 'gap',
  'Twins of Discord': 'gap',
  'Wakening Sun\'s Avatar': 'gap',
  'Zetalpa, Primal Dawn': 'kernel-only',
}

export const PART37_GAP_REASONS: Partial<Record<typeof PART37_ASSIGNED[number], string>> = {
  'Act of Vengeance':
    'Not a separate card in this deck; ETB damage is on Tri-Sentinel, Act of Vengeance — no per-opponent targeted damage builder',
  'Ondu Inversion // Ondu Skyruins':
    'MDFC spell half destroys all nonland permanents; land face alone is not sufficient registration',
  'Rally the Ancestors':
    'Return each creature card with mana value X or less from your graveyard, then exile those creatures at the beginning of your next upkeep',
  'Realm-Cloaked Giant // Cast Off':
    'Adventure Cast Off destroys all non-Giant creatures; no mass-destroy-by-subtype-exclusion builder',
  'Serra Avatar':
    'Power/toughness equal life plus shuffle into library from graveyard anywhere — no shuffle-self-from-graveyard builder',
  'Spawning Pit':
    'Sacrifice a creature to add charge counters; pay mana and remove two counters to create a 2/2 Spawn token',
  'Steel Hellkite':
    '{2} pump and {X} destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn',
  'Storm of Souls':
    'Return all creature cards from your graveyard, each becomes a 1/1 Spirit with flying in addition to its types, then exile the spell',
  'Sudden Salvation':
    'Return up to three battlefield-this-turn permanents from graveyards tapped; draw for each opponent who controls one',
  'The Eagles Are Coming!':
    'Kicker returns any number of creatures you own; next upkeep creates 4/4 Bird Soldier tokens per creature returned',
  'The Restoration of Eiganjo // Architect of Restoration':
    'Saga chapters (search, discard-to-reanimate MV≤2, exile then return transformed) and Architect attack/block Spirit tokens',
  'Timeless Dragon':
    'Plainscycling and eternalize exile-from-graveyard token copy — no eternalize builder',
  'Tri-Sentinel, Act of Vengeance':
    'ETB: for each opponent, deal 3 damage to up to one target creature that player controls; unearth {7} not registered without full ETB',
  'Twins of Discord':
    'Attack: choose odd or even mana value creatures that cannot block; grant bloodthirst 2 to other colorless creatures you control',
  'Wakening Sun\'s Avatar':
    'When cast from hand, destroy all non-Dinosaur creatures — no cast-from-hand conditional mass destroy builder',
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const enterBattlefield = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'move',
  objectId: named(state, name).id,
  to: 'battlefield',
})))

describe('plug-dack part 37 card pool', () => {
  test('inventory lists every assigned name as registered, kernel-only, or GAP with reasons', () => {
    expect(PART37_ASSIGNED).toHaveLength(21)
    for (const name of PART37_ASSIGNED) {
      const status = PART37_STATUS[name]
      expect(['registered', 'kernel-only', 'gap']).toContain(status)
      if (status === 'registered') {
        expect(effectsFor(name).length).toBeGreaterThan(0)
        expect(PART37_GAP_REASONS[name]).toBeUndefined()
      } else if (status === 'kernel-only') {
        expect(effectsFor(name)).toEqual([])
        expect(PART37_GAP_REASONS[name]).toBeUndefined()
      } else {
        expect(effectsFor(name)).toEqual([])
        expect(PART37_GAP_REASONS[name]).toMatch(/./)
      }
    }
  })

  test('named GAP cards stay out of cardRules until Pass 1 lands capability', () => {
    const gaps = PART37_ASSIGNED.filter((name) => PART37_STATUS[name] === 'gap')
    expect(gaps).toEqual([
      'Act of Vengeance',
      'Ondu Inversion // Ondu Skyruins',
      'Rally the Ancestors',
      'Realm-Cloaked Giant // Cast Off',
      'Serra Avatar',
      'Spawning Pit',
      'Steel Hellkite',
      'Storm of Souls',
      'Sudden Salvation',
      'The Eagles Are Coming!',
      'The Restoration of Eiganjo // Architect of Restoration',
      'Timeless Dragon',
      'Tri-Sentinel, Act of Vengeance',
      'Twins of Discord',
      'Wakening Sun\'s Avatar',
    ])
    expect(PART37_GAP_REASONS['Rally the Ancestors']).toContain('next upkeep')
    expect(PART37_GAP_REASONS['Storm of Souls']).toContain('1/1 Spirit')
    expect(PART37_GAP_REASONS['The Restoration of Eiganjo // Architect of Restoration']).toContain('Saga')
    expect(PART37_GAP_REASONS['Realm-Cloaked Giant // Cast Off']).toContain('Adventure')
    expect(PART37_GAP_REASONS['Ondu Inversion // Ondu Skyruins']).toContain('nonland')
  })

  test('Sandstone Oracle resolves entersTargetingOpponent into drawHandDifference draws', () => {
    const filler = (name: string) => cardTemplate(name, { types: ['Instant'] })
    const oracle = cardTemplate('Sandstone Oracle', {
      types: ['Artifact', 'Creature'],
      effects: effectsFor('Sandstone Oracle'),
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [oracle],
          p2: [filler('P2a'), filler('P2b'), filler('P2c')],
          p3: [filler('P3a')],
        },
        libraries: {
          p1: [filler('D1'), filler('D2'), filler('D3'), filler('D4')],
        },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Sandstone Oracle')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice.prompt).toContain('opponent')
    expect(choice.action).toMatchObject({
      kind: 'putTriggeredAbility',
      instructions: [{ kind: 'drawHandDifference' }],
    })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
    expect(state.zoneOrder.p2.hand).toHaveLength(3)
  })

  test('Subjugator Angel taps opposing creatures on enter', () => {
    const angel = cardTemplate('Subjugator Angel', {
      types: ['Creature'],
      effects: effectsFor('Subjugator Angel'),
    })
    const mine = cardTemplate('My Soldier', { types: ['Creature'] })
    const theirs = cardTemplate('Their Soldier', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [angel] },
        battlefield: { p1: [mine], p2: [theirs] },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin, targetedResolve, entersTappedPlugin] },
    )
    const entered = enterBattlefield(server, server.state, 'Subjugator Angel')
    expect(entered.objects[named(entered, 'My Soldier').id].tapped).toBe(false)
    expect(entered.objects[named(entered, 'Their Soldier').id].tapped).toBe(true)
  })

  test('registered staples match expected builders', () => {
    expect(cardDefinition('Soul of Eternity')?.effects).toMatchObject([
      ptEqualsLife({ who: 'controller' }),
      { op: 'activate', id: 'encore' },
    ])
    expect(cardDefinition('Astral Drift')?.effects).toMatchObject([
      { op: 'trigger', on: 'cycle' },
      { op: 'activate', id: 'cycling.astralDrift', cycling: true },
    ])
  })
})
