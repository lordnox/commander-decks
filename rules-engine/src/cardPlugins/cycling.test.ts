import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { resolveStack } from '../testHelpers'
import type { GameState, ReduceResult } from '../types'
import { card, cardCycled, compileCardRuleDefinition, createDefinitionSnapshot, cycleFromHand, draw, objects, ref, searchLibrary, whenever } from './dsl/v1'
import { pendingSelectionFor } from '../rules/selectCards'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plains = (name = 'Plains') =>
  cardTemplate(name, {
    types: ['Land'],
    subtypes: ['Plains'],
    supertypes: ['Basic'],
    tapProduces: { W: 1 },
  })

const definition = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const plainsSearch = () => cycleFromHand({
  mana: '{2}',
  instructions: [searchLibrary({
    bindChoice: 'found',
    chooser: ref('controller'),
    filter: objects({ zone: 'library', owner: 'you', subtypes: ['Plains'] }),
    min: 0,
    max: 1,
    to: 'hand',
  })],
})

const cycleListener = () => cardTemplate('Cycle Listener', {
  types: ['Enchantment'],
  ruleDefinition: definition([whenever(cardCycled(), {
    instructions: [draw({ targets: ref('controller'), count: 1 })],
  })]),
})

describe('cycling', () => {
  test('Cycle Meadow cycles for {W} and draws from hand', () => {
    const cycler = cardTemplate('Cycle Meadow', {
      types: ['Land'],
      ruleDefinition: definition([cycleFromHand({ mana: '{W}' })]),
    })
    const drawn = cardTemplate('Drawn card', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [cycler] }, libraries: { p1: [drawn] } },
      { random: () => 0.5 },
    )
    const cyclerId = named(server.state, 'Cycle Meadow').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.W = 1

    const cycled = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: cyclerId,
    }))
    expect(cycled.objects[cyclerId].zone).toBe('graveyard')
    expect(cycled.players.p1.mana.W).toBe(0)
    expect(cycled.stack).toHaveLength(1)

    const resolved = ok(server.rules(cycled, { type: 'resolveTop' }))
    expect(named(resolved, 'Drawn card').zone).toBe('hand')
    expect(resolved.stack).toHaveLength(0)
  })

  test('Plains Cycler plainscycles for {2} through library search', () => {
    const cycler = cardTemplate('Plains Cycler', {
      types: ['Creature'],
      ruleDefinition: definition([plainsSearch()]),
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cycler] },
        libraries: { p1: [plains(), cardTemplate('Mountain', { types: ['Land'], subtypes: ['Mountain'] })] },
      },
      { random: () => 0.5 },
    )
    const cyclerId = named(server.state, 'Plains Cycler').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2

    const stacked = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: cyclerId,
    }))
    expect(stacked.objects[cyclerId].zone).toBe('graveyard')
    expect(stacked.stack).toHaveLength(1)

    const opened = ok(server.rules(stacked, { type: 'resolveTop' }))
    const pending = pendingSelectionFor(opened, 'p1')!
    expect(pending).toMatchObject({ kind: 'choose', min: 0, count: 1 })
    expect(pending.candidates.map((id) => opened.objects[id].name)).toEqual(['Plains'])

    const p2View = projectForViewer(opened, 'p2')
    expect(p2View.zoneCounts.p1.library).toBe(opened.zoneCounts.p1.library)
    expect(Object.keys(p2View.objects).some((id) => opened.objects[id]?.zone === 'library')).toBe(false)

    const found = named(opened, 'Plains').id
    const finished = ok(server.rules(opened, {
      type: 'selectCards', seat: 'p1', selectionId: pending.id, kind: 'choose', count: 1, objectIds: [found],
    }))
    expect(named(finished, 'Plains').zone).toBe('hand')
    expect(finished.stack).toHaveLength(0)
  })

  test('plainscycling listeners resolve before the library search', () => {
    const cycler = cardTemplate('Plains Cycler', {
      types: ['Creature'],
      ruleDefinition: definition([plainsSearch()]),
    })
    const listener = cycleListener()
    const bonus = cardTemplate('Bonus card', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [listener] },
        hands: { p1: [cycler] },
        libraries: { p1: [plains(), bonus] },
      },
      { random: () => 0.5 },
    )
    const cyclerId = named(server.state, 'Plains Cycler').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.C = 2

    const stacked = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: cyclerId,
    }))
    expect(stacked.stack.map((item) => item.name)).toEqual(['Cycle Listener', 'Plains Cycler'])
    const afterListener = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(named(afterListener, 'Plains').zone).toBe('hand')
    expect(afterListener.stack.map((item) => item.name)).toEqual(['Plains Cycler'])

    const finished = resolveStack(server.rules, afterListener)
    expect(finished.stack.some((item) => item.name === 'Cycle Listener')).toBe(false)
    expect(named(finished, 'Bonus card').zone).toBe('library')
  })

  test('cycle event triggers battlefield listeners without name checks', () => {
    const cycler = cardTemplate('Cycle Meadow', {
      types: ['Land'],
      ruleDefinition: definition([cycleFromHand({ mana: '{W}' })]),
    })
    const listener = cycleListener()
    const drawn = cardTemplate('Bonus card', { types: ['Instant'] })
    const server = createServerGame(
      commanderRules,
      {
        battlefield: { p1: [listener] },
        hands: { p1: [cycler] },
        libraries: { p1: [drawn] },
      },
      { random: () => 0.5 },
    )
    const cyclerId = named(server.state, 'Cycle Meadow').id
    const ready = structuredClone(server.state)
    ready.players.p1.mana.W = 1

    const stacked = ok(server.rules(ready, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: cyclerId,
    }))
    expect(stacked.stack.map(item => item.name)).toEqual(['Cycle Listener', 'Cycle Meadow'])
    const resolved = ok(server.rules(stacked, { type: 'resolveTop' }))
    expect(named(resolved, 'Bonus card').zone).toBe('hand')
    expect(resolved.stack.map(item => item.name)).toEqual(['Cycle Meadow'])
  })
})
