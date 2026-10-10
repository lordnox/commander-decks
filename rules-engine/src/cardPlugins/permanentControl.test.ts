import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { damage } from '../plugins/damage'
import { cardTemplate } from '../newGame'
import { newGame } from '../testGame'
import { makeDraft } from '../draft'
import { continuousEffects } from './continuousEffects'
import {
  gainControlPermanent,
  draw,
  enters,
  onResolve,
  pairDonateToOpponents,
  targetOnResolve,
} from './effectBuilders'
import { targetedResolve } from './targetedResolve'
import { runInstructions } from './runInstructions'
import { serializableEffects } from './effectRuntime'
import {
  PENDING_PERMANENT_DONATION,
  permanentControl,
  pendingPermanentDonation,
} from './permanentControl'
import { pendingPlayerSelectionFor, selectPlayers } from '../rules/selectPlayers'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { createServerGame } from '../runtime'
import type { GameState } from '../types'
import { ok, testObject } from '../testHelpers'
import { createLobby } from '../../../live-runner/src/lobby'
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
      colors: [],
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
      colors: [],
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
      colors: [],
      subtypes: [],
      supertypes: [],
      printedLoyalty: null,
      printedDefense: null,
    }
    blinked.zoneOrder.p1.battlefield.push(replacementId)
    expect(blinked.objects[replacementId].controller).toBe('p1')
    expect(blinked.objects[replacementId].continuousEffects).toBeUndefined()
  })

  test('pairDonateToOpponents assigns each permanent to a different opponent when counts match', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      battlefield: {
        p1: [
          fictional('Guest Alpha', 'p1'),
          fictional('Guest Beta', 'p1'),
          fictional('Guest Gamma', 'p1'),
        ],
      },
    }, { random: () => 0.5, cardPlugins: [permanentControl] })
    const ids = server.state.zoneOrder.p1.battlefield
    const host = testObject(cardTemplate('Fictional Party', { types: ['Sorcery'] }), {
      id: 'host-1', owner: 'p1', controller: 'p1', zone: 'stack',
    })
    server.state.objects[host.id] = host

    const draft = makeDraft(server.state)
    runInstructions(
      draft,
      host,
      [pairDonateToOpponents(ids)],
      {
        id: 'stack-1',
        kind: 'spell',
        objectId: host.id,
        controller: 'p1',
        name: host.name,
        targets: [],
      },
    )
    let current = mergeDraft(server.state, draft)

    const pick = (opponent: string) => {
      const selection = pendingPlayerSelectionFor(current, 'p1')!
      current = ok(server.rules(current, {
        type: 'selectPlayers',
        selectionId: selection.id,
        seat: 'p1',
        players: [opponent],
      }))
    }

    pick('p2')
    pick('p3')
    pick('p4')

    const controllers = ids.map((id) => current.objects[id].controller)
    expect(new Set(controllers)).toEqual(new Set(['p2', 'p3', 'p4']))
    expect(pendingPermanentDonation(current)).toBeUndefined()
  })

  test('rejects assigning the same opponent twice when counts match', () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      battlefield: {
        p1: [fictional('Guest Alpha', 'p1'), fictional('Guest Beta', 'p1')],
      },
    }, { random: () => 0.5, cardPlugins: [permanentControl] })
    const ids = server.state.zoneOrder.p1.battlefield
    const host = testObject(cardTemplate('Fictional Party', { types: ['Sorcery'] }), {
      id: 'host-2', owner: 'p1', controller: 'p1', zone: 'stack',
    })
    server.state.objects[host.id] = host
    const draft = makeDraft(server.state)
    runInstructions(
      draft,
      host,
      [pairDonateToOpponents(ids)],
      {
        id: 'stack-1',
        kind: 'spell',
        objectId: host.id,
        controller: 'p1',
        name: host.name,
        targets: [],
      },
    )
    let current = mergeDraft(server.state, draft)
    const first = pendingPlayerSelectionFor(current, 'p1')!
    current = ok(server.rules(current, {
      type: 'selectPlayers',
      selectionId: first.id,
      seat: 'p1',
      players: ['p2'],
    }))
    const second = pendingPlayerSelectionFor(current, 'p1')!
    expect(second.candidates).toEqual(['p3'])
    const duplicate = server.rules(current, {
      type: 'selectPlayers',
      selectionId: second.id,
      seat: 'p1',
      players: ['p2'],
    })
    expect(duplicate.ok).toBe(false)
  })

  test('stamped effects stay clone-safe', () => {
    const effects = serializableEffects([
      onResolve(pairDonateToOpponents(['a', 'b'])),
    ])
    expect(() => structuredClone(effects)).not.toThrow()
    expect(effects[0]).toMatchObject({
      op: 'trigger',
      on: 'resolve',
      do: [{ kind: 'pairDonateToOpponents', objectIds: ['a', 'b'] }],
    })
  })

  test('pair donation choice survives a host restart', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      battlefield: {
        p1: [fictional('Guest Alpha', 'p1'), fictional('Guest Beta', 'p1')],
      },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ids = server.state.zoneOrder.p1.battlefield
    const draft = makeDraft(server.state)
    const host = testObject(cardTemplate('Fictional Party', { types: ['Sorcery'] }), {
      id: 'host-3', owner: 'p1', controller: 'p1', zone: 'stack',
    })
    draft.objects[host.id] = host
    runInstructions(
      draft,
      host,
      [pairDonateToOpponents(ids)],
      {
        id: 'stack-1',
        kind: 'spell',
        objectId: host.id,
        controller: 'p1',
        name: host.name,
        targets: [],
      },
    )
    server.state.players.p1.data = draft.players.p1.data
    server.state.priority = 'p1'
    const kernel = handleFor(server.rules, server.state)
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
    expect(kernel.history.current().players.p1.data[PENDING_PERMANENT_DONATION]).toBeDefined()
  })
})

const steal = () => cardTemplate('Fixture Steal Spell', {
  types: ['Instant'],
  manaCost: '{0}',
  manaValue: 0,
  effects: [targetOnResolve(
    'select',
    { zone: 'battlefield', permanent: true, controller: 'opponent' },
    gainControlPermanent(true),
  )],
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
        effects: [enters(draw(1))],
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
