import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingSelectionFor } from '../rules/selectCards'
import { ok, resolveStack, roomDoor } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import {
  ability,
  addChosenColorMana,
  destroyTargetPermanent,
  discardCards,
  draw,
  mayDiscard,
  onResolve,
  onUnlock,
  optionalTargetOnResolve,
  putPermanentFromGraveyard,
  pumpTargetX,
  returnCreatureManaValueX,
  returnTargetFromGraveyard,
  saga,
  selfMill,
  serializableEffects,
  upToTargetsOnResolve,
  yourUpkeepPutPermanentFromGraveyard,
} from './effects'
import { onResolve as onResolvePlugin } from './onResolve'
import { targetedResolve } from './targetedResolve'

const plugins = [targetedResolve, activated, onResolvePlugin]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const land = (name: string) => cardTemplate(name, { types: ['Land'] })
const creature = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const run = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const bury = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  names: string[],
) => names.reduce(
  (current, name) => ok(server.rules(current, {
    type: 'move',
    objectId: named(current, name).id,
    to: 'graveyard',
  })),
  state,
)

describe('optional and up-to targeting', () => {
  test('an up-to-one pump spell casts with zero or one target and still runs extra instructions', () => {
    const spell = cardTemplate('Optional Drain', {
      types: ['Sorcery'],
      manaCost: '{X}{B}',
      effects: serializableEffects([
        optionalTargetOnResolve(
          'select',
          { zone: 'battlefield', type: 'Creature' },
          pumpTargetX(-1),
          returnCreatureManaValueX(5, true),
        ),
      ]),
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell, creature('Returned')] },
        battlefield: { p2: [creature('Victim')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = bury(server, structuredClone(server.state), ['Returned'])
    ready.players.p1.mana.B = 1
    ready.players.p1.mana.C = 5
    const withTarget = run(server, ready, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(ready, 'Optional Drain').id,
        x: 5,
        targets: [{ kind: 'object', objectId: named(ready, 'Victim').id }],
      },
      { type: 'resolveTop' },
    ])
    expect(withTarget.objects[named(withTarget, 'Victim').id].zone).toBe('graveyard')
    expect(pendingSelectionFor(withTarget, 'p1')).toMatchObject({ kind: 'choose', min: 0 })

    const zeroReady = bury(server, structuredClone(server.state), ['Returned'])
    zeroReady.players.p1.mana.B = 1
    zeroReady.players.p1.mana.C = 5
    const zero = run(server, zeroReady, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(zeroReady, 'Optional Drain').id,
        x: 5,
        targets: [],
      },
      { type: 'resolveTop' },
    ])
    expect(zero.objects[named(zero, 'Victim').id]).toMatchObject({ power: 2, toughness: 2 })
    expect(pendingSelectionFor(zero, 'p1')).toMatchObject({ kind: 'choose', min: 0 })
    const returned = named(zero, 'Returned').id
    const finished = ok(server.rules(zero, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [returned],
    }))
    expect(finished.objects[returned]).toMatchObject({ zone: 'battlefield', tapped: true })
  })

  test('up to three graveyard lands can be 0, 1, or 3 targets and reject 4', () => {
    const spell = cardTemplate('Up To Lands', {
      types: ['Sorcery'],
      manaCost: '{1}{G}',
      effects: serializableEffects([
        upToTargetsOnResolve(3, 'bounce', { zone: 'graveyard', type: 'Land' }),
      ]),
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell, land('A'), land('B'), land('C'), land('D')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = bury(server, structuredClone(server.state), ['A', 'B', 'C', 'D'])
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    const ids = ['A', 'B', 'C', 'D'].map((name) => named(ready, name).id)
    const spellId = named(ready, 'Up To Lands').id

    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellId,
      targets: ids.map((objectId) => ({ kind: 'object', objectId })),
    }).ok).toBe(false)

    const none = run(server, ready, [
      { type: 'castSpell', seat: 'p1', objectId: spellId, targets: [] },
      { type: 'resolveTop' },
    ])
    expect(ids.every((id) => none.objects[id].zone === 'graveyard')).toBe(true)

    const oneReady = bury(server, structuredClone(server.state), ['A', 'B', 'C', 'D'])
    oneReady.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    const one = run(server, oneReady, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(oneReady, 'Up To Lands').id,
        targets: [{ kind: 'object', objectId: named(oneReady, 'A').id }],
      },
      { type: 'resolveTop' },
    ])
    expect(one.objects[named(one, 'A').id].zone).toBe('hand')
    expect(one.objects[named(one, 'B').id].zone).toBe('graveyard')

    const threeReady = bury(server, structuredClone(server.state), ['A', 'B', 'C', 'D'])
    threeReady.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
    const three = run(server, threeReady, [
      {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(threeReady, 'Up To Lands').id,
        targets: ['A', 'B', 'C'].map((name) => ({
          kind: 'object' as const,
          objectId: named(threeReady, name).id,
        })),
      },
      { type: 'resolveTop' },
    ])
    expect(['A', 'B', 'C'].map((name) => three.objects[named(three, name).id].zone))
      .toEqual(['hand', 'hand', 'hand'])
    expect(three.objects[named(three, 'D').id].zone).toBe('graveyard')
  })
})

describe('targeted player draw then discard', () => {
  test('the targeted player draws and discards while the controller does not', () => {
    const rock = cardTemplate('Target Loot', {
      types: ['Land'],
      effects: serializableEffects([
        ability(
          { id: 'loot.target', targets: { filter: { players: 'any' } } },
          { tap: true },
          draw(3, 'target'),
          discardCards(3, 'target'),
        ),
      ]),
    })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [rock] },
        libraries: {
          p1: [land('Controller Draw')],
          p2: [land('Opp 1'), land('Opp 2'), land('Opp 3')],
        },
        hands: {
          p2: [land('H1'), land('H2'), land('H3')],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    const p1Library = ready.zoneOrder.p1.library.length
    const p1Hand = ready.zoneOrder.p1.hand.length
    const activated = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: 'loot.target',
      seat: 'p1',
      objectId: named(ready, 'Target Loot').id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    const afterAbility = ok(server.rules(activated, { type: 'resolveTop' }))
    expect(afterAbility.zoneOrder.p1.library.length).toBe(p1Library)
    expect(afterAbility.zoneOrder.p1.hand.length).toBe(p1Hand)
    expect(afterAbility.zoneOrder.p2.hand.length).toBe(6)
    expect(afterAbility.stack[0]).toMatchObject({ actionId: 'discard' })
    const resolved = ok(server.rules(afterAbility, { type: 'resolveTop' }))
    expect(resolved.stack[0]).toMatchObject({ actionId: 'discard', waiting: 'choice' })
    expect(resolved.priority).toBe('p2')

    const discarded = resolved.zoneOrder.p2.hand.slice(0, 3)
    const finished = ok(server.rules(resolved, {
      type: 'continueAction',
      stackId: resolved.stack[0].id,
      seat: 'p2',
      payload: { objectIds: discarded },
    }))
    expect(discarded.every((id) => finished.objects[id].zone === 'graveyard')).toBe(true)
    expect(finished.zoneOrder.p2.hand.length).toBe(3)
    expect(finished.zoneOrder.p1.hand.length).toBe(p1Hand)
  })
})

describe('restricted chosen-color mana', () => {
  test('{B} or {G} mana rejects {U} and only offers those colors', () => {
    const rock = cardTemplate('Dual Color Rock', {
      types: ['Artifact'],
      effects: serializableEffects([
        ability(
          { id: 'dual.mana', manaAbility: true },
          { tap: true },
          addChosenColorMana(['B', 'G']),
        ),
      ]),
    })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [rock] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const objectId = named(server.state, 'Dual Color Rock').id
    const actions = legalActsFor(server.state, 'p1').filter((action) =>
      action.kind === 'activateAbility' && action.abilityId === 'dual.mana')
    expect(actions.map((action) => action.mana).sort()).toEqual(['B', 'G'])

    expect(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'dual.mana',
      seat: 'p1',
      objectId,
      manaAbility: true,
      choices: ['U'],
    }).ok).toBe(false)

    const added = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'dual.mana',
      seat: 'p1',
      objectId,
      manaAbility: true,
      choices: ['B'],
    }))
    expect(added.players.p1.mana.B).toBe(1)
    expect(added.objects[objectId].tapped).toBe(true)

    const events = eventsForAvailableAction(server.state, 'p1', {
      kind: 'activateAbility',
      objectId,
      name: 'Dual Color Rock',
      text: 'dual.mana',
      abilityId: 'dual.mana',
      mana: 'G',
    })
    expect(events?.[0]).toMatchObject({ choices: ['G'] })
  })
})

describe('optional graveyard permanent put', () => {
  test('unlock may decline or put a graveyard permanent onto the battlefield', () => {
    const cellar = cardTemplate('Test Cellar', {
      roomDoors: [
        roomDoor('Open Door', '{G}', {
          effects: [onUnlock(putPermanentFromGraveyard())],
        }),
        roomDoor('Closed Door', '{G}'),
      ],
      unlockedDoors: [],
    })
    const relic = cardTemplate('Relic', { types: ['Artifact'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [cellar] },
        hands: { p1: [relic] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const objectId = Object.values(server.state.objects).find((object) => object.roomDoors)!.id
    const relicId = named(server.state, 'Relic').id
    const funded = bury(server, structuredClone(server.state), ['Relic'])
    funded.players.p1.mana.G = 1
    const unlocked = ok(server.rules(funded, {
      type: 'unlockDoor',
      seat: 'p1',
      objectId,
      door: 'left',
    }))
    const choosing = ok(server.rules(unlocked, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', min: 0, count: 1 })
    expect(selection.candidates).toContain(relicId)
    expect(pendingSelectionFor(projectForViewer(choosing, 'p2'), 'p1')).toBeUndefined()
    expect(projectForViewer(choosing, 'p1').objects[relicId]?.zone).toBe('graveyard')

    const declined = ok(server.rules(structuredClone(choosing), {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(declined.objects[relicId].zone).toBe('graveyard')

    const accepted = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [relicId],
    }))
    expect(accepted.objects[relicId].zone).toBe('battlefield')
  })

  test('your-upkeep composition opens the same optional graveyard put', () => {
    const source = cardTemplate('Upkeep Cellar', {
      types: ['Enchantment'],
      effects: serializableEffects([yourUpkeepPutPermanentFromGraveyard()]),
    })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [source] },
        hands: { p1: [cardTemplate('Relic', { types: ['Artifact'] })] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = bury(server, server.state, ['Relic'])
    state = { ...state, step: 'untap', active: 'p1', priority: 'p1' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.step).toBe('upkeep')
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingSelectionFor(state, 'p1')).toMatchObject({ kind: 'choose', min: 0 })
  })

  test('host restart preserves an open graveyard selection', () => {
    const spell = cardTemplate('Graveyard Gift', {
      types: ['Sorcery'],
      manaCost: '{G}',
      effects: serializableEffects([onResolve(putPermanentFromGraveyard())]),
    })
    const relic = cardTemplate('Relic', { types: ['Artifact'] })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [spell, relic] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = bury(server, structuredClone(server.state), ['Relic'])
    ready.players.p1.mana.G = 1
    const castEvent = {
      type: 'castSpell' as const,
      seat: 'p1' as const,
      objectId: named(ready, 'Graveyard Gift').id,
    }
    const cast = ok(server.rules(ready, castEvent))
    const opened = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection.candidates).toContain(named(opened, 'Relic').id)

    let journal = createJournal(ready)
    journal = recordAccepted(journal, castEvent)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p1')?.id).toBe(selection.id)

    const finished = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(restored, 'Relic').id],
    }))
    expect(finished.objects[named(finished, 'Relic').id].zone).toBe('battlefield')
  })
})

describe('saga chapter builders', () => {
  const chronicle = () => cardTemplate('Test Chronicle', {
    types: ['Enchantment'],
    subtypes: ['Saga'],
    oracleText: 'I — Destroy target nonland permanent.\nII — Mill three cards.\nIII — You may discard a card.',
    effects: serializableEffects([
      saga([
        {
          numbers: [1],
          targets: { filter: { zone: 'battlefield', nonland: true, permanent: true } },
          do: [destroyTargetPermanent()],
        },
        { numbers: [2], do: [selfMill(3)] },
        {
          numbers: [3],
          do: [mayDiscard(1, {
            filter: { zone: 'graveyard', types: ['Creature', 'Land'] },
            do: [returnTargetFromGraveyard('hand')],
          })],
        },
      ]),
    ]),
  })

  test('chapter I destroys the chosen nonland after lore enters', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [chronicle()],
          p2: [creature('Rock Bear'), land('Safe Forest')],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const source = named(server.state, 'Test Chronicle')
    const bear = named(server.state, 'Rock Bear').id
    const forest = named(server.state, 'Safe Forest').id
    const triggered = ok(server.rules(server.state, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 1,
    }))
    const selection = pendingSelectionFor(triggered, 'p1')!
    expect(selection.candidates).toContain(bear)
    expect(selection.candidates).not.toContain(forest)
    const stacked = ok(server.rules(triggered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bear],
    }))
    expect(stacked.stack[0]?.payload?.sagaChapter).toBe(1)
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(resolved.objects[bear].zone).toBe('graveyard')
    expect(resolved.objects[forest].zone).toBe('battlefield')
  })

  test('chapter II mills three with the second lore counter', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [{ ...chronicle(), counters: { lore: 1 } }] },
        libraries: {
          p1: [land('M1'), land('M2'), land('M3'), land('M4')],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const source = named(server.state, 'Test Chronicle')
    const triggered = ok(server.rules(server.state, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 1,
    }))
    expect(triggered.stack[0]?.payload?.sagaChapter).toBe(2)
    const resolved = resolveStack(server.rules, triggered)
    expect(resolved.zoneOrder.p1.graveyard).toHaveLength(3)
    expect(resolved.zoneOrder.p1.library).toHaveLength(1)
  })

  test('chapter III may discard then return a graveyard creature or land', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [{ ...chronicle(), counters: { lore: 2 } }] },
        hands: { p1: [creature('Discarded Bear'), land('Loam Land')] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const buried = bury(server, server.state, ['Loam Land'])
    const source = named(buried, 'Test Chronicle')
    const triggered = ok(server.rules(buried, {
      type: 'putCounters',
      objectId: source.id,
      counter: 'lore',
      count: 1,
    }))
    const chapter = ok(server.rules(triggered, { type: 'resolveTop' }))
    const discardChoice = pendingSelectionFor(chapter, 'p1')!
    expect(discardChoice).toMatchObject({ kind: 'discard', min: 0 })

    const declined = ok(server.rules(structuredClone(chapter), {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [],
    }))
    expect(declined.objects[named(declined, 'Discarded Bear').id].zone).toBe('hand')
    expect(declined.objects[named(declined, 'Loam Land').id].zone).toBe('graveyard')

    const discarded = ok(server.rules(chapter, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(chapter, 'Discarded Bear').id],
    }))
    const gyChoice = pendingSelectionFor(discarded, 'p1')!
    expect(gyChoice.kind).toBe('choose')
    const landId = named(discarded, 'Loam Land').id
    expect(gyChoice.candidates).toContain(landId)
    const stacked = ok(server.rules(discarded, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [landId],
    }))
    const returned = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(returned.objects[landId].zone).toBe('hand')
    expect(returned.objects[named(returned, 'Discarded Bear').id].zone).toBe('graveyard')
  })
})
