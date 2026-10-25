import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { deckCardTemplate } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import type { CardTemplate } from '../newGame'
import { maximumHandSize } from '../plugins/turnStructure'
import { pendingOptionSelection } from '../rules/selectOptions'
import { DECLINE_LIFE_OPTION, PAY_LIFE_OPTION } from './dsl/v1'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'

/**
 * Círdan part B (mana): Alchemist's Refuge, Arbor Elf, Flooded Grove,
 * Waterlogged Grove, Simic Signet, Wild Growth, Utopia Sprawl and
 * Sea Gate Restoration // Sea Gate, Reborn, built from the deck's Oracle text.
 */

const SEA_GATE = 'Sea Gate Restoration // Sea Gate, Reborn'

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
  library?: number
  opponent?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      players: 2,
      hands: { p1: options.hand ?? [] },
      battlefield: { p1: options.battlefield ?? [], p2: options.opponent ?? [] },
      libraries: {
        p1: Array.from({ length: options.library ?? 12 }, (_, index) => cardTemplate(`Library ${index}`)),
      },
    },
    { random: () => 0.5 },
  )

type Server = ReturnType<typeof game>

const named = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

const one = (state: GameState, name: string) => named(state, name)[0]

const playSeaGate = (server: Server, state = server.state) =>
  ok(server.rules(state, {
    type: 'playLand',
    seat: 'p1',
    objectId: one(state, SEA_GATE).id,
  }))

const chooseSeaGateLife = (server: Server, state: GameState, optionId: string) => {
  const pending = pendingOptionSelection(state, 'p1')!
  return ok(server.rules(state, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: pending.id,
    optionId,
  }))
}

const run = (server: Server, state: GameState, events: GameEvent[]) =>
  events.reduce((current, event) => ok(server.rules(current, event)), state)

const withPool = (state: GameState, pool: Partial<GameState['players']['p1']['mana']>) => {
  const next = structuredClone(state)
  next.players.p1.mana = { ...emptyMana(), ...pool }
  return next
}

const castActs = (state: GameState, name: string) =>
  legalActsFor(state, 'p1').filter((act) =>
    act.kind === 'castSpell' && act.name === name)

const forest = () => deckCardTemplate('Forest')
const island = () => deckCardTemplate('Island')

const held = (count: number) =>
  Array.from({ length: count }, (_, index) => cardTemplate(`Held ${index}`))

describe('Arbor Elf', () => {
  const setup = (sick = false) => {
    const server = game({
      battlefield: [
        { ...deckCardTemplate('Arbor Elf'), summoningSickness: sick },
        { ...forest(), tapped: true },
        { ...island(), tapped: true },
        { ...deckCardTemplate('Breeding Pool'), tapped: true },
      ],
    })
    return server
  }
  const untap = (state: GameState, targetName: string): GameEvent => ({
    type: 'activateAbility',
    seat: 'p1',
    objectId: one(state, 'Arbor Elf').id,
    abilityId: '$.abilities[0]',
    targets: [{ kind: 'object', objectId: one(state, targetName).id }],
  })

  test('taps to untap a Forest, a nonbasic Forest included, and nothing else', () => {
    const server = setup()
    for (const land of ['Forest', 'Breeding Pool']) {
      const activated = ok(server.rules(server.state, untap(server.state, land)))
      expect(one(activated, 'Arbor Elf').tapped).toBe(true)
      const resolved = resolveStack(server.rules, activated)
      expect(one(resolved, land).tapped).toBe(false)
      expect(one(resolved, 'Island').tapped).toBe(true)
    }
  })

  test('an Island or the Elf itself is not a legal target', () => {
    const server = setup()
    expect(server.rules(server.state, untap(server.state, 'Island')).ok).toBe(false)
    expect(server.rules(server.state, untap(server.state, 'Arbor Elf')).ok).toBe(false)
  })

  test('the action layer offers one activation per Forest', () => {
    const server = setup()
    const acts = legalActsFor(server.state, 'p1').filter((act) =>
      act.kind === 'activateAbility' && act.name === 'Arbor Elf')
    const targets = acts.flatMap((act) =>
      act.kind === 'activateAbility'
        ? (act.targetGroups ?? []).flatMap((group) => group.targets.map((target) => target.name))
        : [])
    expect(targets.toSorted()).toEqual(['Breeding Pool', 'Forest'])
  })

  test('it cannot activate while summoning sick, and it is not a mana ability', () => {
    const sick = setup(true)
    expect(sick.rules(sick.state, untap(sick.state, 'Forest')).ok).toBe(false)
    expect(sick.rules(sick.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(sick.state, 'Arbor Elf').id,
    }).ok).toBe(false)
    const ready = setup()
    expect(ready.rules(ready.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(ready.state, 'Arbor Elf').id,
    }).ok).toBe(false)
  })

  test('a tapped Elf cannot untap a Forest', () => {
    const server = setup()
    const tapped = structuredClone(server.state)
    tapped.objects[one(tapped, 'Arbor Elf').id].tapped = true
    expect(server.rules(tapped, untap(tapped, 'Forest')).ok).toBe(false)
  })
})

describe('Sea Gate Restoration // Sea Gate, Reborn', () => {
  const card = () => deckCardTemplate(SEA_GATE)

  test('the spell draws your hand plus one and lifts the hand size limit for good', () => {
    const server = game({ hand: [card(), ...held(5)], library: 20 })
    const act = castActs(server.state, SEA_GATE)
    expect(act).toHaveLength(0) // not yet payable
    const prepared = withPool(server.state, { U: 3, C: 4 })
    const [cast] = castActs(prepared, SEA_GATE)
    expect(cast).toBeDefined()
    const resolved = resolveStack(
      server.rules,
      run(server, prepared, eventsForAvailableAction(prepared, 'p1', cast)!),
    )
    // Five cards were held when the spell resolved: draw 5 + 1.
    expect(resolved.zoneOrder.p1.hand).toHaveLength(5 + 6)
    expect(one(resolved, SEA_GATE).zone).toBe('graveyard')
    expect(maximumHandSize(resolved, 'p1')).toBeNull()
    expect(maximumHandSize(resolved, 'p2')).toBe(7)
    const cleanup = { ...resolved, step: 'cleanup' as const }
    expect(ok(server.rules(cleanup, { type: 'advanceStep' })).step).toBe('untap')
  })

  test('without enough mana the spell is neither offered nor castable', () => {
    const server = game({ hand: [card()] })
    const poor = withPool(server.state, { U: 2, C: 4 })
    expect(castActs(poor, SEA_GATE)).toHaveLength(0)
    expect(server.rules(poor, {
      type: 'castSpell',
      seat: 'p1',
      objectId: one(poor, SEA_GATE).id,
    }).ok).toBe(false)
  })

  test('as a land you may pay exactly 3 life to have it untapped, and it taps for {U}', () => {
    const server = game({ hand: [card()] })
    const asked = playSeaGate(server)
    const pending = pendingOptionSelection(asked, 'p1')!
    expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
    const settled = chooseSeaGateLife(server, asked, PAY_LIFE_OPTION)
    expect(settled.players.p1.life).toBe(server.state.players.p1.life - 3)
    expect(one(settled, SEA_GATE)).toMatchObject({ types: ['Land'], tapped: false })
    const mana = ok(server.rules(settled, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(settled, SEA_GATE).id,
    }))
    expect(mana.players.p1.mana).toEqual({ ...emptyMana(), U: 1 })
  })

  test('declining the payment enters it tapped and costs no life', () => {
    const server = game({ hand: [card()] })
    const declined = chooseSeaGateLife(server, playSeaGate(server), DECLINE_LIFE_OPTION)
    expect(one(declined, SEA_GATE).tapped).toBe(true)
    expect(declined.players.p1.life).toBe(server.state.players.p1.life)
  })

  test('at 2 life the 3-life payment is not possible, so the land enters tapped', () => {
    const server = game({ hand: [card()] })
    const low = structuredClone(server.state)
    low.players.p1.life = 2
    const settled = chooseSeaGateLife(server, playSeaGate(server, low), PAY_LIFE_OPTION)
    expect(settled.players.p1.life).toBe(2)
    expect(one(settled, SEA_GATE).tapped).toBe(true)
  })

  test('at exactly 3 life the 3-life payment is allowed, and it costs the game', () => {
    const server = game({ hand: [card()] })
    const edge = structuredClone(server.state)
    edge.players.p1.life = 3
    const settled = chooseSeaGateLife(server, playSeaGate(server, edge), PAY_LIFE_OPTION)
    expect(settled.players.p1.life).toBe(0)
    expect(settled.players.p1.lost).toBe(true)
  })

  test('the life choice is private to its controller and survives a restart', () => {
    const server = game({ hand: [card()] })
    const asked = playSeaGate(server)
    expect(server.project(asked, 'p1').players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
    expect(server.project(asked, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
    const restarted = structuredClone(asked)
    const pending = pendingOptionSelection(restarted, 'p1')!
    const paid = ok(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: PAY_LIFE_OPTION,
    }))
    expect(paid.players.p1.life).toBe(server.state.players.p1.life - 3)
  })
})
