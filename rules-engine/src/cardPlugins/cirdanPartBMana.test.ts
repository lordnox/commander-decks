import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { deckCardTemplate, loadCardPlugins } from '../deckCardFixtures'
import { emptyMana } from '../draft'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { DIALOG_CHOSEN } from '../pendingDialog'
import { maximumHandSize } from '../plugins/turnStructure'
import { pendingOptionSelection } from '../rules/selectOptions'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { cardPluginEntry } from './index'

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

describe('registration', () => {
  test.each(NAMES)('%s is in the card pool from its deck Oracle text', (name) => {
    // Every card must at least load: the template builds and its plugins resolve.
    expect(deckCardTemplate(name).oracleText.length).toBeGreaterThan(0)
  })

  test.each(NAMES.filter((name) => name !== 'Arbor Elf'))(
    '%s is table-driven, not name-only',
    (name) => {
      expect(cardPluginEntry(name)).toBeDefined()
    },
  )

  test('Arbor Elf is table-driven too', () => {
    expect(cardPluginEntry('Arbor Elf')?.handlerIds).toContain('activated')
  })
})

describe("Alchemist's Refuge", () => {
  const refuge = () => deckCardTemplate("Alchemist's Refuge")
  const surprise = () => cardTemplate('Surprise Bear', {
    types: ['Creature'],
    manaCost: '{0}',
    manaValue: 0,
  })
  const activateEvent = (state: GameState): GameEvent => ({
    type: 'activateAbility',
    seat: 'p1',
    objectId: one(state, "Alchemist's Refuge").id,
    abilityId: 'alchemistsRefuge.flash',
  })
  const opponentsCombat = (state: GameState): GameState => ({
    ...structuredClone(state),
    active: 'p2',
    step: 'declareBlockers',
    priority: 'p1',
  })
  const castOf = (server: Server, state: GameState) =>
    server.rules(state, { type: 'castSpell', seat: 'p1', objectId: one(state, 'Surprise Bear').id })

  test('its free tap adds {C} and grants nothing', () => {
    const server = game({ battlefield: [refuge()], hand: [surprise()] })
    const tapped = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(server.state, "Alchemist's Refuge").id,
    }))
    expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), C: 1 })
    expect(tapped.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
  })

  test('{G}{U}, {T} grants flash for the turn: paid, tapped, then a creature is cast off-turn', () => {
    const server = game({ battlefield: [refuge()], hand: [surprise()] })
    const off = opponentsCombat(server.state)
    expect(castOf(server, off))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })

    const paid = withPool(server.state, { G: 1, U: 1 })
    const activated = ok(server.rules(paid, activateEvent(paid)))
    expect(activated.players.p1.mana).toEqual(emptyMana())
    expect(one(activated, "Alchemist's Refuge").tapped).toBe(true)
    // The grant waits on the stack and exists only once the ability resolves.
    expect(activated.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
    const granted = resolveStack(server.rules, activated)
    expect(granted.rules.find((rule) => rule.pluginId === 'flashGrant')?.params)
      .toMatchObject({ untilCleanup: true, controller: 'p1' })

    const bear = castOf(server, opponentsCombat(granted))
    expect(ok(bear).stack[0]).toMatchObject({ name: 'Surprise Bear' })
    expect(legalActsFor(opponentsCombat(granted), 'p1').some((act) =>
      act.kind === 'castSpell' && act.name === 'Surprise Bear')).toBe(true)
  })

  test('it needs both colors, an untapped Refuge, and its controller', () => {
    const server = game({ battlefield: [refuge()] })
    const noMana = server.rules(server.state, activateEvent(server.state))
    expect(noMana.ok).toBe(false)
    const wrongColors = withPool(server.state, { G: 2 })
    expect(server.rules(wrongColors, activateEvent(wrongColors)).ok).toBe(false)

    const paid = withPool(server.state, { G: 1, U: 1 })
    const tapped = ok(server.rules(paid, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(paid, "Alchemist's Refuge").id,
    }))
    expect(server.rules(withPool(tapped, { G: 1, U: 1 }), activateEvent(tapped)).ok).toBe(false)

    expect(server.rules(paid, { ...activateEvent(paid), seat: 'p2' } as GameEvent).ok).toBe(false)
  })

  test('the grant is the controller\'s and ends at cleanup', () => {
    const server = game({ battlefield: [refuge()], hand: [surprise()] })
    const paid = withPool(server.state, { G: 1, U: 1 })
    const granted = resolveStack(server.rules, ok(server.rules(paid, activateEvent(paid))))

    const rival = { ...opponentsCombat(granted), active: 'p1', priority: 'p2' } as GameState
    expect(server.rules(rival, {
      type: 'castSpell',
      seat: 'p2',
      objectId: one(rival, 'Surprise Bear').id,
    }).ok).toBe(false)

    const ending = { ...structuredClone(granted), step: 'end' as const }
    const cleanup = ok(server.rules(ending, { type: 'advanceStep' }))
    expect(cleanup.step).toBe('cleanup')
    expect(cleanup.rules.some((rule) => rule.pluginId === 'flashGrant')).toBe(false)
    const later = { ...opponentsCombat(ok(server.rules(cleanup, { type: 'advanceStep' }))), priority: 'p1' }
    expect(castOf(server, later as GameState))
      .toMatchObject({ ok: false, error: 'non-instant spells require the active player' })
  })
})

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
  const grove = () => deckCardTemplate('Flooded Grove')
  const filter = (state: GameState, choices?: string[]): GameEvent => ({
    type: 'activateAbility',
    seat: 'p1',
    objectId: one(state, 'Flooded Grove').id,
    abilityId: 'floodedGrove.filter',
    manaAbility: true,
    ...(choices ? { choices } : {}),
  })

  test('a free tap adds {C}', () => {
    const server = game({ battlefield: [grove()] })
    const tapped = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(server.state, 'Flooded Grove').id,
    }))
    expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), C: 1 })
  })

  test.each([
    ['GG', { G: 2 }],
    ['UG', { G: 1, U: 1 }],
    ['UU', { U: 2 }],
  ])('{G/U}, {T} filters into %s', (choice, pool) => {
    for (const paid of ['G', 'U'] as const) {
      const server = game({ battlefield: [grove()] })
      const state = withPool(server.state, { [paid]: 1 })
      const next = ok(server.rules(state, filter(state, [choice])))
      expect(next.players.p1.mana).toEqual({ ...emptyMana(), ...pool })
      expect(one(next, 'Flooded Grove').tapped).toBe(true)
    }
  })

  test('it cannot filter without {G} or {U}, with another color, or into an unprinted pool', () => {
    const server = game({ battlefield: [grove()] })
    expect(server.rules(server.state, filter(server.state, ['GG'])).ok).toBe(false)
    const red = withPool(server.state, { R: 1 })
    expect(server.rules(red, filter(red, ['GG'])).ok).toBe(false)
    const green = withPool(server.state, { G: 1 })
    expect(server.rules(green, filter(green, ['RR'])).ok).toBe(false)
    expect(server.rules(green, filter(green, ['GGG'])).ok).toBe(false)
  })

  test('without a named pool the controller chooses privately, and the choice survives a restart', () => {
    const server = game({ battlefield: [grove()] })
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

  test('the planner turns an Island into {G}{G} for a {G}{G} spell', () => {
    const spell = cardTemplate('Planner Spell', { types: ['Creature'], manaCost: '{G}{G}' })
    const server = game({ battlefield: [grove(), island()], hand: [spell] })
    const act = castActs(server.state, 'Planner Spell')[0]
    const events = eventsForAvailableAction(server.state, 'p1', act)!
    expect(events.map((event) => event.type)).toEqual(['tapForMana', 'activateAbility', 'castSpell'])
    expect(one(run(server, server.state, events), 'Planner Spell').zone).toBe('stack')
  })
})

describe('Waterlogged Grove', () => {
  const grove = () => deckCardTemplate('Waterlogged Grove')
  const draw = (state: GameState): GameEvent => ({
    type: 'activateAbility',
    seat: 'p1',
    objectId: one(state, 'Waterlogged Grove').id,
    abilityId: 'waterloggedGrove.draw',
  })

  test.each(['G', 'U'] as const)('{T}, pay 1 life adds {%s}', (mana) => {
    const server = game({ battlefield: [grove()] })
    const next = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(server.state, 'Waterlogged Grove').id,
      mana,
    }))
    const resolved = resolveStack(server.rules, next)
    expect(resolved.players.p1.mana).toEqual({ ...emptyMana(), [mana]: 1 })
    expect(resolved.players.p1.life).toBe(server.state.players.p1.life - 1)
  })

  test('it makes no colorless mana, and no mana at 0 life', () => {
    const server = game({ battlefield: [grove()] })
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(server.state, 'Waterlogged Grove').id,
      mana: 'C',
    }).ok).toBe(false)
    const dead = structuredClone(server.state)
    dead.players.p1.life = 0
    expect(server.rules(dead, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(dead, 'Waterlogged Grove').id,
      mana: 'G',
    }).ok).toBe(false)
  })

  test('{1}, {T}, sacrifice it: draw a card', () => {
    const server = game({ battlefield: [grove()] })
    const paid = withPool(server.state, { C: 1 })
    const handBefore = paid.zoneOrder.p1.hand.length
    const activated = ok(server.rules(paid, draw(paid)))
    expect(one(activated, 'Waterlogged Grove').zone).toBe('graveyard')
    expect(activated.players.p1.mana).toEqual(emptyMana())
    const drawn = resolveStack(server.rules, activated)
    expect(drawn.zoneOrder.p1.hand.length).toBe(handBefore + 1)
  })

  test('the draw needs {1} and an untapped land', () => {
    const server = game({ battlefield: [grove()] })
    expect(server.rules(server.state, draw(server.state)).ok).toBe(false)
    const tapped = ok(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(server.state, 'Waterlogged Grove').id,
      mana: 'G',
    }))
    expect(server.rules(withPool(tapped, { C: 1 }), draw(tapped)).ok).toBe(false)
  })
})

describe('Simic Signet', () => {
  const signet = () => deckCardTemplate('Simic Signet')
  const filter = (state: GameState): GameEvent => ({
    type: 'activateAbility',
    seat: 'p1',
    objectId: one(state, 'Simic Signet').id,
    abilityId: 'signet.simic',
    manaAbility: true,
  })

  test('{1}, {T} adds {G}{U}', () => {
    const server = game({ battlefield: [signet()] })
    const paid = withPool(server.state, { C: 1 })
    const next = ok(server.rules(paid, filter(paid)))
    expect(next.players.p1.mana).toEqual({ ...emptyMana(), G: 1, U: 1 })
    expect(one(next, 'Simic Signet').tapped).toBe(true)
  })

  test('it is not a free tap and needs its {1}', () => {
    const server = game({ battlefield: [signet()] })
    expect(server.rules(server.state, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(server.state, 'Simic Signet').id,
    }).ok).toBe(false)
    expect(server.rules(server.state, filter(server.state)).ok).toBe(false)
  })

  test('an untapped Signet cannot be activated twice', () => {
    const server = game({ battlefield: [signet()] })
    const paid = withPool(server.state, { C: 2 })
    const once = ok(server.rules(paid, filter(paid)))
    expect(server.rules(once, filter(once)).ok).toBe(false)
  })

  test('the planner pays {1} from a land to cast a {G}{U} spell', () => {
    const spell = cardTemplate('Planner Spell', { types: ['Creature'], manaCost: '{G}{U}' })
    const server = game({ battlefield: [signet(), island()], hand: [spell] })
    const events = eventsForAvailableAction(server.state, 'p1', castActs(server.state, 'Planner Spell')[0])!
    expect(events.map((event) => event.type)).toEqual(['tapForMana', 'activateAbility', 'castSpell'])
    expect(one(run(server, server.state, events), 'Planner Spell').zone).toBe('stack')
  })
})

describe('Wild Growth', () => {
  const growth = () => deckCardTemplate('Wild Growth')

  test('can enchant any land, and only a land', () => {
    const server = game({
      hand: [growth()],
      battlefield: [island(), forest(), cardTemplate('Bear', { types: ['Creature'] })],
    })
    server.state.players.p1.mana.G = 1
    const targets = castActs(server.state, 'Wild Growth')
      .map((act) => act.kind === 'castSpell' ? act.targetName : undefined)
    expect(targets.toSorted()).toEqual(['Forest', 'Island'])
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: one(server.state, 'Wild Growth').id,
      targets: [{ kind: 'object', objectId: one(server.state, 'Bear').id }],
    }).ok).toBe(false)
  })

  test('the enchanted land adds an extra {G} when tapped for mana, other lands do not', () => {
    const server = game({ hand: [growth()], battlefield: [island(), forest()] })
    const prepared = withPool(server.state, { G: 1 })
    const entered = castAura(server, prepared, 'Wild Growth', one(prepared, 'Island').id)
    expect(one(entered, 'Wild Growth')).toMatchObject({
      zone: 'battlefield',
      attachedTo: one(entered, 'Island').id,
    })
    const boosted = ok(server.rules(entered, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(entered, 'Island').id,
    }))
    expect(boosted.players.p1.mana).toEqual({ ...emptyMana(), U: 1, G: 1 })
    const plain = ok(server.rules(entered, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(entered, 'Forest').id,
    }))
    expect(plain.players.p1.mana).toEqual({ ...emptyMana(), G: 1 })
  })

  test('the boost follows a costed {T} mana ability and ends with the land', () => {
    const server = game({
      hand: [growth()],
      battlefield: [deckCardTemplate('Flooded Grove')],
    })
    const prepared = withPool(server.state, { G: 1 })
    const entered = castAura(server, prepared, 'Wild Growth', one(prepared, 'Flooded Grove').id)
    const filtered = ok(server.rules(withPool(entered, { U: 1 }), {
      type: 'activateAbility',
      seat: 'p1',
      objectId: one(entered, 'Flooded Grove').id,
      abilityId: 'floodedGrove.filter',
      manaAbility: true,
      choices: ['UU'],
    }))
    expect(filtered.players.p1.mana).toEqual({ ...emptyMana(), U: 2, G: 1 })

    const gone = ok(server.rules(entered, {
      type: 'move',
      objectId: one(entered, 'Flooded Grove').id,
      to: 'graveyard',
    }))
    expect(one(gone, 'Wild Growth').zone).toBe('graveyard')
    expect(gone.rules.some((rule) => rule.pluginId === 'enchantedManaBoost')).toBe(false)
  })

  test('an Aura whose land left before it resolves does not enter', () => {
    const server = game({ hand: [growth()], battlefield: [forest()] })
    const prepared = withPool(server.state, { G: 1 })
    const act = castActs(prepared, 'Wild Growth')[0]
    const cast = run(server, prepared, eventsForAvailableAction(prepared, 'p1', act)!)
    const gone = ok(server.rules(cast, { type: 'move', objectId: one(cast, 'Forest').id, to: 'graveyard' }))
    expect(one(resolveStack(server.rules, gone), 'Wild Growth').zone).toBe('graveyard')
  })
})

describe('Utopia Sprawl', () => {
  const sprawl = () => deckCardTemplate('Utopia Sprawl')
  const enter = () => {
    const server = game({ hand: [sprawl()], battlefield: [forest(), island()] })
    const prepared = withPool(server.state, { G: 1 })
    const entered = castAura(server, prepared, 'Utopia Sprawl', one(prepared, 'Forest').id)
    return { server, entered }
  }

  test('can enchant only a Forest', () => {
    const server = game({
      hand: [sprawl()],
      battlefield: [forest(), island(), deckCardTemplate('Breeding Pool')],
    })
    server.state.players.p1.mana.G = 1
    expect(castActs(server.state, 'Utopia Sprawl')
      .map((act) => act.kind === 'castSpell' ? act.targetName : undefined).toSorted())
      .toEqual(['Breeding Pool', 'Forest'])
    const wrong = server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: one(server.state, 'Utopia Sprawl').id,
      targets: [{ kind: 'object', objectId: one(server.state, 'Island').id }],
    })
    expect(wrong.ok).toBe(false)
  })

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

  test('the enchanted Forest adds the chosen color, the other land adds only its own', () => {
    const { server, entered } = enter()
    const pending = pendingOptionSelection(entered, 'p1')!
    const chosen = ok(server.rules(entered, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'R',
    }))
    const boosted = ok(server.rules(chosen, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(chosen, 'Forest').id,
    }))
    expect(boosted.players.p1.mana).toEqual({ ...emptyMana(), G: 1, R: 1 })
    const plain = ok(server.rules(chosen, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(chosen, 'Island').id,
    }))
    expect(plain.players.p1.mana).toEqual({ ...emptyMana(), U: 1 })
  })

  test('no extra mana before a color is chosen', () => {
    const { server, entered } = enter()
    const tapped = ok(server.rules(entered, {
      type: 'tapForMana',
      seat: 'p1',
      objectId: one(entered, 'Forest').id,
    }))
    expect(tapped.players.p1.mana).toEqual({ ...emptyMana(), G: 1 })
  })
})

describe('Sea Gate Restoration // Sea Gate, Reborn', () => {
  const card = () => deckCardTemplate(SEA_GATE)
  const held = (count: number) =>
    Array.from({ length: count }, (_, index) => cardTemplate(`Held ${index}`))

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
