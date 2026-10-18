import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { deckCardTemplate, loadCardPlugins } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import type { CardTemplate } from '../newGame'
import { DIALOG_CHOSEN } from '../pendingDialog'
import { maximumHandSize } from '../plugins/turnStructure'
import { pendingOptionSelection } from '../rules/selectOptions'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'

/**
 * Círdan part B (mana): Alchemist's Refuge, Arbor Elf, Flooded Grove,
 * Waterlogged Grove, Simic Signet, Wild Growth, Utopia Sprawl and
 * Sea Gate Restoration // Sea Gate, Reborn, built from the deck's Oracle text.
 */

const NAMES = [
  "Alchemist's Refuge",
  'Arbor Elf',
  'Flooded Grove',
  'Waterlogged Grove',
  'Simic Signet',
  'Wild Growth',
  'Utopia Sprawl',
  'Sea Gate Restoration // Sea Gate, Reborn',
]

const PLUGINS = await loadCardPlugins([...NAMES, 'Forest', 'Island', 'Breeding Pool'])

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
    { random: () => 0.5, cardPlugins: PLUGINS },
  )

type Server = ReturnType<typeof game>

const named = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

const one = (state: GameState, name: string) => named(state, name)[0]

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

/** Cast `name` through the action layer, enchanting `targetId`, and resolve it. */
const castAura = (server: Server, state: GameState, name: string, targetId: string) => {
  const act = castActs(state, name).find((candidate) =>
    candidate.kind === 'castSpell' && candidate.targetObjectId === targetId)
  if (!act) throw new Error(`no cast of ${name} onto ${targetId}`)
  return resolveStack(server.rules, run(server, state, eventsForAvailableAction(state, 'p1', act)!))
}

const forest = () => deckCardTemplate('Forest')
const island = () => deckCardTemplate('Island')

const sprawl = () => deckCardTemplate('Utopia Sprawl')

const floodedGrove = () => deckCardTemplate('Flooded Grove')

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
    abilityId: 'arborElf.untap',
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

describe('Flooded Grove', () => {
  const filter = (state: GameState, choices?: string[]): GameEvent => ({
    type: 'activateAbility',
    seat: 'p1',
    objectId: one(state, 'Flooded Grove').id,
    abilityId: 'floodedGrove.filter',
    manaAbility: true,
    ...(choices ? { choices } : {}),
  })

  test('without a named pool the controller chooses privately, and the choice survives a restart', () => {
    const server = game({ battlefield: [floodedGrove()] })
    const state = withPool(server.state, { U: 1 })
    const opened = ok(server.rules(state, filter(state)))
    const pending = pendingOptionSelection(opened, 'p1')!
    expect(pending.options.map(({ id }) => id)).toEqual(['GG', 'UG', 'UU'])
    expect(server.project(opened, 'p1').players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
    expect(server.project(opened, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()

    // Host restart: the open choice lives in the state, so a fresh copy still answers it.
    const restarted = structuredClone(opened)
    expect(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'UU',
    }).ok).toBe(false)
    expect(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'RR',
    }).ok).toBe(false)
    const resolved = ok(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'UG',
    }))
    expect(resolved.players.p1.mana).toEqual({ ...emptyMana(), G: 1, U: 1 })
  })

})


describe('Utopia Sprawl', () => {
  const enter = () => {
    const server = game({ hand: [sprawl()], battlefield: [forest(), island()] })
    const prepared = withPool(server.state, { G: 1 })
    const entered = castAura(server, prepared, 'Utopia Sprawl', one(prepared, 'Forest').id)
    return { server, entered }
  }

  test('entering opens a private color choice that survives a restart and stores the pick', () => {
    const { server, entered } = enter()
    const pending = pendingOptionSelection(entered, 'p1')!
    expect(pending.options.map(({ id }) => id)).toEqual(['W', 'U', 'B', 'R', 'G'])
    expect(server.project(entered, 'p1').players.p1.data['kernel.pendingOptionSelection']).toBeDefined()
    expect(server.project(entered, 'p2').players.p1.data['kernel.pendingOptionSelection']).toBeUndefined()
    expect(server.rules(entered, { type: 'passPriority', seat: 'p1' }).ok).toBe(false)

    const restarted = structuredClone(entered)
    expect(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'C',
    }).ok).toBe(false)
    expect(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'U',
    }).ok).toBe(false)
    const chosen = ok(server.rules(restarted, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'U',
    }))
    expect(one(chosen, 'Utopia Sprawl').chosenColor).toBe('U')
    expect(pendingOptionSelection(chosen)).toBeUndefined()
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

  const play = (server: Server) =>
    ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: one(server.state, SEA_GATE).id,
    }))

  test('as a land you may pay exactly 3 life to have it untapped, and it taps for {U}', () => {
    const server = game({ hand: [card()] })
    const asked = play(server)
    expect(one(asked, SEA_GATE)).toMatchObject({ types: ['Land'], tapped: false })
    const [dialog] = asked.players.p1.data['kernel.pendingDialog'] as Array<{ prompt: string }>
    expect(dialog).toMatchObject({ source: SEA_GATE, kind: 'may-pay-life', count: 3 })
    expect(dialog.prompt).toContain('pay 3 life')
    const paid = ok(server.rules(asked, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    const settled = resolveStack(server.rules, paid)
    expect(settled.players.p1.life).toBe(server.state.players.p1.life - 3)
    expect(one(settled, SEA_GATE).tapped).toBe(false)
    const mana = ok(server.rules(settled, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(settled, SEA_GATE).id,
    }))
    expect(mana.players.p1.mana).toEqual({ ...emptyMana(), U: 1 })
  })

  test('declining the payment enters it tapped and costs no life', () => {
    const server = game({ hand: [card()] })
    const declined = ok(server.rules(play(server), {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: false },
    }))
    expect(one(declined, SEA_GATE).tapped).toBe(true)
    expect(declined.players.p1.life).toBe(server.state.players.p1.life)
  })

  test('at 2 life the 3-life payment is not possible, so the land enters tapped', () => {
    const server = game({ hand: [card()] })
    const low = structuredClone(server.state)
    low.players.p1.life = 2
    const asked = ok(server.rules(low, {
      type: 'playLand',
      seat: 'p1',
      objectId: one(low, SEA_GATE).id,
    }))
    const settled = ok(server.rules(asked, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(settled.players.p1.life).toBe(2)
    expect(one(settled, SEA_GATE).tapped).toBe(true)
  })

  test('at exactly 3 life the 3-life payment is allowed, and it costs the game', () => {
    const server = game({ hand: [card()] })
    const edge = structuredClone(server.state)
    edge.players.p1.life = 3
    const asked = ok(server.rules(edge, {
      type: 'playLand',
      seat: 'p1',
      objectId: one(edge, SEA_GATE).id,
    }))
    const settled = ok(server.rules(asked, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(settled.players.p1.life).toBe(0)
    expect(settled.players.p1.lost).toBe(true)
  })

  test('the life choice is private to its controller and survives a restart', () => {
    const server = game({ hand: [card()] })
    const asked = play(server)
    expect(server.project(asked, 'p2').players.p1.data['kernel.pendingDialog']).toBeUndefined()
    const restarted = structuredClone(asked)
    expect(restarted.players.p1.data['kernel.pendingDialog']).toMatchObject([{ count: 3 }])
    const paid = ok(server.rules(restarted, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(resolveStack(server.rules, paid).players.p1.life)
      .toBe(server.state.players.p1.life - 3)
  })
})
