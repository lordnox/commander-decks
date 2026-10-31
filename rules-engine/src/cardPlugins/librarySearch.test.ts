import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { hasKeyword } from '../keywords'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { pendingDialogLock } from '../pendingDialog'
import { pendingOptionSelection } from '../rules/selectOptions'
import { resolveStack } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { choiceEffects } from './choiceEffects'
import { becomeCopyOfTarget } from './becomeCopyOfTarget'
import { cycling } from './cycling'
import { librarySearch, RETIRED_SEARCH_FETCH } from './librarySearch'
import {
  card as dslCard,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  objects as dslObjects,
  ref as dslRef,
  searchLibrary as dslSearchLibrary,
  spell as dslSpell,
  activated as dslActivated,
  createDelayed as dslCreateDelayed,
  manaCost as dslManaCost,
  move as dslMove,
  stepDelayed as dslStepDelayed,
  tapCost as dslTapCost,
} from './dsl/v1'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = (name = 'Forest') =>
  card(name, ['Land'], { subtypes: ['Forest'], supertypes: ['Basic'], tapProduces: { G: 1 } })

const island = () =>
  card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'], tapProduces: { U: 1 } })

const SEARCH_FIXTURE = 'Forest search fixture'

const forestSearchSpell = () => card(SEARCH_FIXTURE, ['Sorcery'], {
  manaCost: '{1}{G}',
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([dslSpell({
    instructions: [dslSearchLibrary({
      bindChoice: 'forest',
      chooser: dslRef('controller'),
      filter: dslObjects({ zone: 'library', owner: 'you', subtypes: ['Forest'] }),
      count: 1,
      to: 'battlefield',
    })],
  })]))),
})

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (options: {
  hand?: CardTemplate[]
  battlefield?: CardTemplate[]
  library?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      hands: { p1: options.hand ?? [] },
      battlefield: { p1: options.battlefield ?? [] },
      libraries: { p1: options.library ?? [] },
    },
    { random: () => 0.5, cardPlugins: [pendingDialogLock] },
  )

const run = (
  server: ReturnType<typeof game>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

const withMana = (state: GameState) => ({
  ...state,
  players: {
    ...state.players,
    p1: { ...state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 } },
  },
})

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const searchPlugins = [becomeCopyOfTarget, cycling]

describe('librarySearch', () => {
  test('Expedition Map opens the generic hidden library search', () => {
    const map = cardTemplate('Expedition Map', { types: ['Artifact'] })
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [map] }, libraries: { p1: [forest('Hidden Forest')] },
    }, { random: () => 0.5, cardPlugins: searchPlugins })
    const mapId = named(server.state, 'Expedition Map').id
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana.C = 2
    const announced = ok(server.rules(ready, { type: 'activateAbility', abilityId: '$.abilities[0]', seat: 'p1', objectId: mapId }))
    const opened = resolveStack(server.rules, announced)
    expect(opened.objects[mapId].zone).toBe('graveyard')
    expect(pendingSelectionFor(opened, 'p1')).toMatchObject({ kind: 'choose', min: 0, count: 1, viewLibrary: true })
    expect(projectForViewer(opened, 'p2').zoneOrder.p1.library).toEqual([])
  })

  test("Archaeomancer's Map finds up to two Plains and puts them in hand", () => {
    const map = cardTemplate("Archaeomancer's Map", { types: ['Artifact'], manaCost: '{2}{W}' })
    const p1 = cardTemplate('Plains A', { types: ['Land'], subtypes: ['Plains'], supertypes: ['Basic'] })
    const p2 = cardTemplate('Plains B', { types: ['Land'], subtypes: ['Plains'], supertypes: ['Basic'] })
    const server = createServerGame(commanderRules, {
      hands: { p1: [map] },
      libraries: { p1: [p1, p2, cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] })] },
    }, { random: () => 0.5, cardPlugins: searchPlugins })
    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.players.p1.mana = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 2 }
    const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0] }))
    const resolved = resolveStack(server.rules, cast)
    const pick = pendingSelectionFor(resolved, 'p1')!
    expect(pick).toMatchObject({ kind: 'choose', min: 0, count: 2, viewLibrary: true })
    expect(pick.candidates.map(id => resolved.objects[id].name)).toEqual(['Plains A', 'Plains B'])
    const finished = ok(server.rules(resolved, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: 2, objectIds: pick.candidates }))
    expect(finished.zoneOrder.p1.hand).toHaveLength(2)
    expect(projectForViewer(finished, 'p2').zoneOrder.p1.library).toEqual([])
  })

  test('a plain Forest rejects the retired library-search fetch action', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [forest()] },
      libraries: { p1: [forest()] },
    }, { random: () => 0.5, cardPlugins: [librarySearch] })
    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: RETIRED_SEARCH_FETCH,
      seat: 'p1',
      objectId: server.state.zoneOrder.p1.battlefield[0],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no library-search ability')
  })

  test('Settle exiles attackers and resumes a private typed basic-land search after restart', () => {
    const basic = (name: string, subtype: string) => card(name, ['Land'], {
      supertypes: ['Basic'], subtypes: [subtype],
    })
    const server = createServerGame(commanderRules, {
      hands: { p1: [card('Settle the Wreckage', ['Instant'], { manaCost: '{2}{W}{W}' })] },
      battlefield: { p2: [card('Attacker One', ['Creature']), card('Attacker Two', ['Creature'])] },
      libraries: { p2: [basic('Plains', 'Plains'), basic('Island', 'Island'), card('Guildgate', ['Land'])] },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 2 }
    for (const id of ready.zoneOrder.p2.battlefield) ready.objects[id].attacking = { kind: 'player', player: 'p1' }
    named(ready, 'Attacker Two').tags = ['commander']
    const noTarget = server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: named(ready, 'Settle the Wreckage').id })
    expect(noTarget.ok).toBe(false)
    const castEvent = { type: 'castSpell' as const, seat: 'p1' as const, objectId: named(ready, 'Settle the Wreckage').id, targets: [{ kind: 'player' as const, player: 'p2' as const }] }
    const cast = ok(server.rules(ready, castEvent))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(named(resolved, 'Attacker One').zone).toBe('exile')
    expect(named(resolved, 'Attacker Two').zone).toBe('command')
    const selection = pendingSelectionFor(resolved, 'p2')!
    expect(selection.candidates).toHaveLength(2)
    expect(selection.count).toBe(1)
    expect(selection.candidates.every((id) => Boolean(projectForViewer(resolved, 'p2').objects[id]))).toBe(true)
    expect(selection.candidates.every((id) => !projectForViewer(resolved, 'p1').objects[id])).toBe(true)
    let journal = createJournal(ready)
    journal = recordAccepted(journal, castEvent)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restored = restoreJournal(journal, server.rules).current()
    expect(pendingSelectionFor(restored, 'p2')?.id).toBe(selection.id)
    expect(server.rules(restored, { type: 'selectCards', seat: 'p2', kind: 'choose', count: 1, objectIds: [named(restored, 'Guildgate').id] }).ok).toBe(false)
    const chosen = selection.candidates[0]
    const finished = ok(server.rules(restored, { type: 'selectCards', seat: 'p2', kind: 'choose', count: 1, objectIds: [chosen] }))
    expect(finished.objects[chosen]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(pendingSelectionFor(finished, 'p2')).toBeUndefined()
  })

  test('a canonical search spell stops resolution with a private typed choice', () => {
    const server = game({
      hand: [forestSearchSpell()],
      library: [forest('Wooded Foothills'), card('Not a land', ['Instant'])],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])

    expect(state.stack).toHaveLength(1)
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', fromZone: 'library', count: 1, viewLibrary: true })
    expect(selection.candidates.map((id) => state.objects[id].name)).toEqual(['Wooded Foothills'])
    expect(pendingSelectionFor(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
    expect(Object.values(projectForViewer(state, 'p2').objects).some((object) => object.name === 'Wooded Foothills'))
      .toBe(false)
  })

  test('nobody may pass priority while a search is open', () => {
    const server = game({
      hand: [forestSearchSpell()],
      library: [forest()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const passed = server.rules(state, { type: 'passPriority', seat: 'p1' })
    expect(passed.ok).toBe(false)
    expect(passed.ok === false && passed.error).toContain('resolution is waiting for input')
  })

  test('a repeated resolveTop cannot skip the open choice', () => {
    const server = game({
      hand: [forestSearchSpell()],
      library: [forest()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const state = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const repeated = server.rules(state, { type: 'resolveTop' })
    expect(repeated.ok).toBe(false)
    expect(repeated.state).toEqual(state)
    expect(state.stack).toHaveLength(1)
    expect(state.objects[spell].zone).toBe('stack')
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
  })

  test('choosing a card resolves the whole spell and clears the pending selection', () => {
    const server = game({
      hand: [forestSearchSpell()],
      library: [forest('Wooded Foothills'), island()],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const opened = run(server, withMana(server.state), [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    const selection = pendingSelectionFor(opened, 'p1')!
    const found = named(opened, 'Wooded Foothills').id
    const state = ok(server.rules(opened, {
      type: 'selectCards', seat: 'p1', selectionId: selection.id,
      kind: 'choose', count: selection.count, objectIds: [found],
    }))

    expect(state.objects[found].zone).toBe('battlefield')
    expect(state.objects[found].tapped).toBe(false)
    expect(state.objects[spell].zone).toBe('graveyard')
    expect(state.stack).toHaveLength(0)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
  })







  test('a Hideout sacrifices itself, gains life, and completes its typed basic search', () => {
    const server = game({
      hand: [card('Brokers Hideout', ['Land'])],
      library: [
        forest(),
        island(),
        card('Wastes', ['Land'], { supertypes: ['Basic'] }),
      ],
    })
    const hideout = server.state.zoneOrder.p1.hand[0]
    const opened = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand', seat: 'p1', objectId: hideout,
    })))
    expect(opened.objects[hideout].zone).toBe('graveyard')
    expect(opened.players.p1.life).toBe(40)
    const selection = pendingSelectionFor(opened, 'p1')!
    expect(selection.candidates.map(id => opened.objects[id].name)).toEqual(['Forest', 'Island'])
    const found = named(opened, 'Forest').id
    const resolved = ok(server.rules(opened, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [found] }))
    expect(resolved.objects[found]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.resolution).toBeUndefined()
  })

  test('a Hideout search does not expose library identities to another seat', () => {
    const server = game({
      hand: [card('Obscura Storefront', ['Land'])],
      library: [island()],
    })
    const opened = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand', seat: 'p1', objectId: server.state.zoneOrder.p1.hand[0],
    })))
    const projected = server.project(opened, 'p2')
    expect(projected.zoneOrder.p1.library).toEqual([])
    expect(Object.values(projected.objects).some((object) => object.name === 'Island')).toBe(false)
    expect(pendingSelectionFor(projected, 'p1')).toBeUndefined()
  })

  test('Dreamscape Artist discards a card and sacrifices a land to search', () => {
    const server = game({
      battlefield: [
        card('Dreamscape Artist', ['Creature']),
        forest(),
      ],
      hand: [card('Idle Thoughts', ['Instant'])],
      library: [forest('Dryad Arbor'), island()],
    })
    const artist = named(server.state, 'Dreamscape Artist').id
    const landId = named(server.state, 'Forest').id
    const discarded = named(server.state, 'Idle Thoughts').id
    const ready = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 2 } },
      },
    }

    expect(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: artist,
    }).ok).toBe(false)

    const opened = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: artist,
      choices: [discarded, landId],
    }))
    expect(opened.objects[artist]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(opened.objects[discarded].zone).toBe('graveyard')
    expect(opened.objects[landId].zone).toBe('graveyard')
    const searching = resolveStack(server.rules, opened)
    const selection = pendingSelectionFor(searching, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', min: 0, count: 2 })
    const finished = ok(server.rules(searching, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 2, objectIds: selection.candidates }))
    for (const id of selection.candidates) expect(finished.objects[id]).toMatchObject({ zone: 'battlefield', tapped: false })
  })









  test('Farhaven Elf optional search can be declined', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [card('Farhaven Elf', ['Creature'], { manaCost: '{2}{G}', power: 1, toughness: 1 })] },
        libraries: { p1: [forest()] },
      },
      {
        random: () => 0.5,
        cardPlugins: [pendingDialogLock, choiceEffects],
      },
    )
    const elf = server.state.zoneOrder.p1.hand[0]
    const opened = ok(server.rules({
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 } },
      },
    }, { type: 'castSpell', seat: 'p1', objectId: elf }))
    const resolved = resolveStack(server.rules, opened)
    const choice = pendingOptionSelection(resolved, 'p1')!
    expect(choice.options.map(option => option.label)).toEqual(['Accept', 'Decline'])
    const declined = ok(server.rules(resolved, {
      type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options[1].id,
    }))
    expect(pendingOptionSelection(declined, 'p1')).toBeUndefined()
    expect(declined.objects[elf].zone).toBe('battlefield')
  })

  test('canonical search registers its delayed return after the choice and restores at cleanup', () => {
    const glacierDefinition = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([
      dslActivated({
        costs: [dslTapCost(), dslManaCost('{1}')],
        instructions: [
          dslSearchLibrary({
            bindChoice: 'land',
            chooser: dslRef('controller'),
            filter: dslObjects({ zone: 'library', owner: 'you', type: 'Land', supertypes: ['Basic'] }),
            min: 0,
            max: 1,
            to: 'battlefield',
            tapped: true,
          }),
          dslCreateDelayed({
            condition: dslStepDelayed({ step: 'cleanup' }),
            instructions: [dslMove({ targets: dslRef('source'), to: 'hand' })],
          }),
        ],
      }),
    ])))
    const glacier = card('Test Cleanup Fetch', ['Land'], { ruleDefinition: glacierDefinition })
    const server = game({
      battlefield: [glacier],
      library: [forest()],
    })
    const sourceId = named(server.state, 'Test Cleanup Fetch').id
    const found = named(server.state, 'Forest').id
    const ready = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: {
          ...server.state.players.p1,
          mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
        },
      },
    }
    const announcedEvent = {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: sourceId,
    } as const
    const opened = ok(server.rules(ready, announcedEvent))
    expect(opened.objects[sourceId]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(opened.delayedTriggers).toHaveLength(0)
    const openedSearch = resolveStack(server.rules, opened)
    const selection = pendingSelectionFor(openedSearch, 'p1')!
    let journal = createJournal(ready)
    journal = recordAccepted(journal, announcedEvent)
    journal = recordAccepted(journal, { type: 'resolveTop' })
    const restoredSearch = restoreJournal(journal, server.rules).current()
    const searched = ok(server.rules(restoredSearch, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: selection.id,
      kind: 'choose',
      count: 1,
      objectIds: [found],
    }))
    expect(searched.objects[sourceId]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(searched.objects[found]).toMatchObject({ zone: 'battlefield', tapped: true })
    expect(searched.delayedTriggers).toHaveLength(1)
    expect(searched.delayedTriggers[0].condition).toEqual({ kind: 'step', step: 'cleanup' })

    let state: GameState = { ...restoreJournal(createJournal(searched), server.rules).current(), step: 'end' as const }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.objects[sourceId].zone).toBe('battlefield')
    expect(state.stack[0]).toMatchObject({ kind: 'ability', name: 'Test Cleanup Fetch' })
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[sourceId].zone).toBe('hand')
    expect(state.objects[found].zone).toBe('battlefield')
  })
})

describe('relocated from sinFallFinishers.test.ts → librarySearch.test.ts', () => {
  const creature = (name: string, manaCost = '{2}{G}', extra: Partial<CardTemplate> = {}) =>
    cardTemplate(name, { types: ['Creature'], manaCost, power: 2, toughness: 2, ...extra })

  const forest = (name = 'Forest') =>
    cardTemplate(name, {
      types: ['Land'],
      subtypes: ['Forest'],
      supertypes: ['Basic'],
      tapProduces: { G: 1 },
    })

  const run = (
    server: ReturnType<typeof createServerGame>,
    state: GameState,
    events: GameEvent[],
  ) => events.reduce((current, event) => ok(server.rules(current, event)), state)

  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  test('Finale of Devastation finds a graveyard creature without shuffling', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [
              cardTemplate('Finale of Devastation'),
              creature('Graveyard Pet', '{1}{G}', { zone: 'graveyard' }),
            ],
          },
          libraries: { p1: [forest()] },
        },
        { random: () => 0.5 },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 }
      const libraryBefore = [...ready.zoneOrder.p1.library]
      const spell = named(ready, 'Finale of Devastation')
      const searching = run(server, ready, [
        { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 3 },
        { type: 'resolveTop' },
      ])
      const pick = pendingSelectionFor(searching, 'p1')!
      expect(pick.viewLibrary).toBe(true)
      const done = ok(server.rules(searching, {
        type: 'selectCards',
        seat: 'p1',
        selectionId: pick.id,
        kind: 'choose',
        count: 1,
        objectIds: [named(searching, 'Graveyard Pet').id],
      }))
      expect(named(done, 'Graveyard Pet').zone).toBe('battlefield')
      expect(done.zoneOrder.p1.library).toEqual(libraryBefore)
      expect(done.log.filter(line => line === 'p1 shuffles')).toHaveLength(0)
      expect(done.objects[spell.id].zone).toBe('graveyard')
    })

  test('Finale of Devastation shuffles after a library find and pumps at X ≥ 10', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: { p1: [cardTemplate('Finale of Devastation')] },
          battlefield: { p1: [creature('Team Mate', '{2}{G}')] },
          libraries: { p1: [creature('Library Pet', '{2}{G}')] },
        },
        { random: () => 0.5 },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 12, C: 0 }
      ready.step = 'precombatMain'
      const spell = named(ready, 'Finale of Devastation')
      const pet = named(ready, 'Library Pet')
      const mate = named(ready, 'Team Mate')
      const searching = run(server, ready, [
        { type: 'castSpell', seat: 'p1', objectId: spell.id, x: 10 },
        { type: 'resolveTop' },
      ])
      const pick = pendingSelectionFor(searching, 'p1')!
      const done = ok(server.rules(searching, {
        type: 'selectCards',
        seat: 'p1',
        selectionId: pick.id,
        kind: 'choose',
        count: 1,
        objectIds: [pet.id],
      }))
      expect(named(done, 'Library Pet').zone).toBe('battlefield')
      expect(done.log.filter(line => line === 'p1 shuffles')).toHaveLength(1)
      expect(done.objects[mate.id]).toMatchObject({ power: 12, toughness: 12 })
      expect(hasKeyword(done.objects[mate.id], 'haste')).toBe(true)
    })

})
