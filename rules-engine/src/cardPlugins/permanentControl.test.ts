import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { damage } from '../plugins/damage'
import { cardTemplate } from '../newGame'
import { newGame } from '../testGame'
import { makeDraft } from '../draft'
import { continuousEffects } from './continuousEffects'
import { gainControlPermanent } from './effectBuilders'
import { targetedResolve } from './targetedResolve'
import { runInstructions } from './runInstructions'
import {
  permanentControl,
} from './permanentControl'
import { pendingPlayerSelectionFor, selectPlayers } from '../rules/selectPlayers'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { createServerGame } from '../runtime'
import type { GameState } from '../types'
import { hasKeyword } from '../keywords'
import { KEYWORDS } from './dsl/schema/v2'
import { ok, resolveStack } from '../testHelpers'
import { createLobby } from '../../../live-runner/src/lobby'
import {
  card as dslCard,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  createEffect as dslCreateEffect,
  distributeControl,
  draw as dslDraw,
  enters as dslEnters,
  gainControlEffect,
  objects as dslObjects,
  permanentEffect,
  players as dslPlayers,
  ref as dslRef,
  select as dslSelect,
  spell as dslSpell,
  target as dslTarget,
  untap as dslUntap,
  whenever,
} from './dsl/v1'
import {
  applyKernelChoice as applyKernelChoiceImpl,
  prepareKernelPendingChoice,
} from '../../../live-runner/src/kernelHost'

const applyKernelChoice = (
  kernel: Parameters<typeof applyKernelChoiceImpl>[0],
  lobby: Parameters<typeof applyKernelChoiceImpl>[1],
  seat: Parameters<typeof applyKernelChoiceImpl>[2],
  message: Parameters<typeof applyKernelChoiceImpl>[3],
) => applyKernelChoiceImpl(kernel, lobby, seat, {
  ...message,
  ...(message.requestId === undefined && lobby.topdeck?.requestId !== undefined
    ? { requestId: lobby.topdeck.requestId }
    : {}),
  ...(message.revision === undefined && lobby.topdeck?.revision !== undefined
    ? { revision: lobby.topdeck.revision }
    : {}),
})
import type { KernelHandle } from '../../../live-runner/src/kernelHandle'

const handleFor = (
  reduce: (state: GameState, event: Parameters<KernelHandle['dispatch']>[0]) => ReturnType<KernelHandle['dispatch']>,
  initial: GameState,
): KernelHandle => {
  let journal = createJournal(initial)
  const history = restoreJournal(journal, reduce)
  return {
    get journal() {
      return journal
    },
    history,
    rules: reduce,
    dispatch: (event) => {
      const result = history.dispatch(event)
      if (result.ok) journal = recordAccepted(journal, event)
      return result
    },
    save: () => {},
  }
}

const fictional = (name: string, controller: string) =>
  ({ ...cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2 }), controller })

const plugins = [continuousEffects, selectPlayers, permanentControl]

const canonicalDonation = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([dslSpell({
  instructions: [distributeControl({
    targets: dslObjects({ zone: 'battlefield', type: 'Creature', controller: 'you' }),
    chooser: dslRef('controller'),
    recipients: dslPlayers({ relation: 'opponent' }),
    distinct: true,
  })],
})])))

const mergeDraft = (state: ReturnType<typeof newGame>, draft: ReturnType<typeof makeDraft>) => ({
  ...state,
  objects: draft.objects,
  players: draft.players,
  priority: draft.priority,
  zoneOrder: draft.zoneOrder,
})

describe('permanent control change', () => {
  test('gainControlPermanent gives rest-of-game control via stack targets', () => {
    const state = newGame({
      players: 4,
      builtinRules: ['continuousEffects', 'selectPlayers', 'permanentControl'],
    })
    const draft = makeDraft(state)
    const sourceId = draft.allocId('obj')
    const giftId = draft.allocId('obj')
    draft.objects[sourceId] = {
      ...cardTemplate('Fictional Gift', { types: ['Sorcery'] }),
      id: sourceId,
      owner: 'p1',
      controller: 'p1',
      zone: 'stack',
      tapped: false,
      summoningSickness: false,
      damageMarked: 0,
      counters: {},
      attachedTo: null,
      attacking: null,
      blocking: null,
      grantedRules: [],
      token: false,
      tags: [],
      loyaltyActivatedTurn: null,
      oracleText: '',
      manaCost: '',
      manaValue: 0,
      colors: '',
      subtypes: [],
      supertypes: [],
      printedLoyalty: null,
      printedDefense: null,
    }
    draft.objects[giftId] = {
      ...fictional('Party Guest', 'p1'),
      id: giftId,
      owner: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSickness: false,
      damageMarked: 0,
      counters: {},
      attachedTo: null,
      attacking: null,
      blocking: null,
      grantedRules: [],
      token: false,
      tags: [],
      loyaltyActivatedTurn: null,
      oracleText: '',
      manaCost: '',
      manaValue: 0,
      colors: '',
      subtypes: [],
      supertypes: [],
      printedLoyalty: null,
      printedDefense: null,
    }
    draft.zoneOrder.p1.battlefield.push(giftId)

    runInstructions(
      draft,
      draft.objects[sourceId],
      [gainControlPermanent()],
      {
        id: 'stack-1',
        kind: 'spell',
        objectId: sourceId,
        controller: 'p1',
        name: 'Fictional Gift',
        targets: [
          { kind: 'object', objectId: giftId },
          { kind: 'player', player: 'p3' },
        ],
      },
    )

    const guest = draft.objects[giftId]
    expect(guest.controller).toBe('p3')
    expect(guest.continuousEffects?.[0].duration).toEqual({ kind: 'permanent' })
  })

  test('rest-of-game control survives the source leaving the game', () => {
    const catalog = createCatalog([continuousEffects, damage])
    const state = newGame({
      players: 4,
      builtinRules: ['continuousEffects', 'selectPlayers', 'permanentControl'],
      battlefield: {
        p1: [
          fictional('Fictional Host', 'p1'),
          fictional('Party Guest', 'p1'),
        ],
      },
    })
    const host = Object.values(state.objects).find((o) => o.name === 'Fictional Host')!
    const guest = Object.values(state.objects).find((o) => o.name === 'Party Guest')!
    const draft = makeDraft(state)
    runInstructions(
      draft,
      host,
      [gainControlPermanent()],
      {
        id: 'stack-1',
        kind: 'spell',
        objectId: host.id,
        controller: 'p1',
        name: 'Fictional Host',
        targets: [
          { kind: 'object', objectId: guest.id },
          { kind: 'player', player: 'p2' },
        ],
      },
    )
    expect(draft.objects[guest.id].controller).toBe('p2')

    const merged = mergeDraft(state, draft)
    const sacrificed = ok(rules(
      merged,
      { type: 'sacrifice', objectId: host.id },
      catalog,
    ))
    expect(sacrificed.objects[guest.id].controller).toBe('p2')
  })

  test('control donation does not follow a new object after a zone change', () => {
    const catalog = createCatalog([continuousEffects, damage])
    const state = newGame({
      players: 4,
      builtinRules: ['continuousEffects', 'selectPlayers', 'permanentControl'],
      battlefield: { p1: [fictional('Blinked Guest', 'p1')] },
    })
    const original = Object.values(state.objects)[0]
    const draft = makeDraft(state)
    runInstructions(
      draft,
      original,
      [gainControlPermanent()],
      {
        id: 'stack-1',
        kind: 'spell',
        objectId: original.id,
        controller: 'p1',
        name: 'Blinked Guest',
        targets: [
          { kind: 'object', objectId: original.id },
          { kind: 'player', player: 'p3' },
        ],
      },
    )
    expect(draft.objects[original.id].controller).toBe('p3')

    const blinked = ok(rules(
      mergeDraft(state, draft),
      { type: 'move', objectId: original.id, to: 'exile' },
      catalog,
    ))
    const replacementId = `o${blinked.nextId}`
    blinked.nextId += 1
    blinked.objects[replacementId] = {
      ...fictional('Blinked Guest', 'p1'),
      id: replacementId,
      owner: 'p1',
      controller: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSickness: false,
      damageMarked: 0,
      counters: {},
      attachedTo: null,
      attacking: null,
      blocking: null,
      grantedRules: [],
      token: false,
      tags: [],
      loyaltyActivatedTurn: null,
      oracleText: '',
      manaCost: '',
      manaValue: 0,
      colors: '',
      subtypes: [],
      supertypes: [],
      printedLoyalty: null,
      printedDefense: null,
    }
    blinked.zoneOrder.p1.battlefield.push(replacementId)
    expect(blinked.objects[replacementId].controller).toBe('p1')
    expect(blinked.objects[replacementId].continuousEffects).toBeUndefined()
  })

  test('canonical control distribution choice survives a host restart', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: { p1: [cardTemplate('Fictional Party', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: canonicalDonation })] },
      battlefield: {
        p1: [fictional('Guest Alpha', 'p1'), fictional('Guest Beta', 'p1')],
      },
    }, { random: () => 0.5 })
    const spell = server.state.zoneOrder.p1.hand[0]!
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spell }))
    const resolving = resolveStack(server.rules, cast)
    const kernel = handleFor(server.rules, resolving)
    expect(pendingPlayerSelectionFor(kernel.history.current(), 'p1')).toBeDefined()
    const lobby = createLobby()
    lobby.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, lobby)).toBe(true)
    expect(lobby.topdeck).toMatchObject({
      kind: 'target-players',
      kernel: { stage: 'select-players' },
    })

    const restarted = createLobby()
    restarted.phase = 'play'
    expect(prepareKernelPendingChoice(kernel, restarted)).toBe(true)
    const selection = pendingPlayerSelectionFor(kernel.history.current(), 'p1')!
    const cards = restarted.topdeck?.cards ?? []
    expect(applyKernelChoice(kernel, restarted, 'p1', {
      type: 'topdeck',
      choices: cards.map((card, slot) => ({
        card,
        slot,
        destination: card === 'p2' ? 'target' : 'skip',
      })),
    })).toBe(true)
    expect(kernel.journal.events).toContainEqual({
      type: 'selectPlayers',
      selectionId: selection.id,
      seat: 'p1',
      players: ['p2'],
    })
    expect(pendingPlayerSelectionFor(kernel.history.current(), 'p1')?.candidates).toEqual(['p3', 'p4'])
  })
})

const steal = () => cardTemplate('Fixture Steal Spell', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([dslSpell({
    decisions: {
      targets: [dslSelect({ filter: dslObjects({ zone: 'battlefield', controller: 'opponent' }), count: 1 })],
    },
    instructions: [
      dslCreateEffect({
        targets: dslTarget(0),
        effect: gainControlEffect(dslRef('controller')),
        duration: permanentEffect(),
      }),
      dslUntap(dslTarget(0)),
    ],
  })]))),
})

const find = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('gain control of a target permanent without a player target', () => {
  const setupSteal = (extra: ReturnType<typeof cardTemplate>[] = []) => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [steal()] },
      battlefield: {
        p1: [fictional('Fixture Own Creature', 'p1')],
        p2: [
          {
            ...fictional('Fixture Victim', 'p2'),
            tapped: true,
            counters: { stun: 1 },
            attacking: 'p3',
          },
          ...extra,
        ],
      },
    }, { random: () => 0.5, cardPlugins: [...plugins, targetedResolve] })
    const cast = (target: string) => server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: find(server.state, 'Fixture Steal Spell').id,
      targets: [{ kind: 'object', objectId: find(server.state, target).id }],
    })
    return { server, cast }
  }

  test('the caster gains control for good, summoning sick and out of combat', () => {
    const { server, cast } = setupSteal()
    const resolved = ok(server.rules(ok(cast('Fixture Victim')), { type: 'resolveTop' }))
    const victim = find(resolved, 'Fixture Victim')
    expect(victim.controller).toBe('p1')
    expect(victim.owner).toBe('p2')
    expect(victim.summoningSickness).toBe(true)
    expect(victim.attacking).toBeNull()
    expect(victim.continuousEffects?.[0].duration).toEqual({ kind: 'permanent' })
    expect(resolved.stack).toHaveLength(0)

    const nextTurn = ok(server.rules(
      { ...resolved, step: 'cleanup' },
      { type: 'advanceStep' },
    ))
    expect(find(nextTurn, 'Fixture Victim').controller).toBe('p1')
  })

  test('the untap is a real untap event, so a stun counter is spent instead', () => {
    const { server, cast } = setupSteal()
    const resolved = ok(server.rules(ok(cast('Fixture Victim')), { type: 'resolveTop' }))
    expect(find(resolved, 'Fixture Victim').tapped).toBe(true)
    expect(find(resolved, 'Fixture Victim').counters.stun).toBeUndefined()
  })

  test('an unstunned permanent is untapped', () => {
    const { server, cast } = setupSteal([
      { ...fictional('Fixture Loose Rock', 'p2'), tapped: true },
    ])
    const resolved = ok(server.rules(ok(cast('Fixture Loose Rock')), { type: 'resolveTop' }))
    expect(find(resolved, 'Fixture Loose Rock').controller).toBe('p1')
    expect(find(resolved, 'Fixture Loose Rock').tapped).toBe(false)
  })

  test('gaining control does not trigger enters-the-battlefield abilities', () => {
    const { server, cast } = setupSteal([
      {
        ...fictional('Fixture Loose Rock', 'p2'),
        ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([whenever(
          dslEnters({ filter: dslRef('self') }),
          { instructions: [dslDraw({ targets: dslRef('controller'), count: 1 })] },
        )]))),
      },
    ])
    const resolved = ok(server.rules(ok(cast('Fixture Loose Rock')), { type: 'resolveTop' }))
    expect(find(resolved, 'Fixture Loose Rock').controller).toBe('p1')
    expect(resolved.stack).toHaveLength(0)
  })

  test('your own permanent is not a legal target', () => {
    const { cast } = setupSteal()
    expect(cast('Fixture Own Creature').ok).toBe(false)
  })

  test('a hexproof permanent is not a legal target', () => {
    const { cast } = setupSteal([
      cardTemplate('Fixture Shrouded', {
        types: ['Creature'],
        power: 1,
        toughness: 1,
        oracleText: 'Hexproof',
      }),
    ])
    expect(cast('Fixture Shrouded').ok).toBe(false)
  })
})

describe('creature control swap until cleanup', () => {
  test('swaps creature control until cleanup', () => {
    const spell = cardTemplate('Reins of Power', {
      types: ['Instant'],
      manaCost: '{2}{U}{U}',
      manaValue: 4,
    })
    const ours = cardTemplate('Llanowar Elves', { types: ['Creature'], power: 1, toughness: 1 })
    const hasty = cardTemplate('Raging Goblin', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
      oracleText: 'Haste',
    })
    const theirs = cardTemplate('Pathbreaker Ibex', { types: ['Creature'], power: 3, toughness: 3 })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell] },
        battlefield: { p1: [ours, hasty], p2: [theirs] },
      },
      { random: () => 0.5 },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 2 } },
      },
    }
    const cast = ok(server.rules(withMana, {
      type: 'castSpell',
      seat: 'p1',
      objectId: find(withMana, 'Reins of Power').id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[find(resolved, 'Pathbreaker Ibex').id].controller).toBe('p1')
    expect(resolved.objects[find(resolved, 'Llanowar Elves').id].controller).toBe('p2')
    expect(hasKeyword(resolved.objects[find(resolved, 'Pathbreaker Ibex').id], KEYWORDS.haste)).toBe(true)

    let state = resolved
    while (state.step !== 'cleanup') {
      state = ok(server.rules(state, { type: 'advanceStep' }))
    }
    expect(state.objects[find(state, 'Pathbreaker Ibex').id].controller).toBe('p2')
    expect(state.objects[find(state, 'Llanowar Elves').id].controller).toBe('p1')
    expect(hasKeyword(state.objects[find(state, 'Pathbreaker Ibex').id], KEYWORDS.haste)).toBe(false)
    expect(hasKeyword(state.objects[find(state, 'Raging Goblin').id], KEYWORDS.haste)).toBe(true)
  })
})
