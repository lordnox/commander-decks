import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  enters,
  handler,
  leaves,
  linkExile,
  linkedExileUntilLeaves,
  returnLinkedExile,
} from './effects'
import { linkedExile } from './linkedExile'

const creature = (name: string, controller?: 'p1' | 'p2' | 'p3') =>
  cardTemplate(name, {
    types: ['Creature'],
    power: 2,
    toughness: 2,
    ...(controller ? { controller } : {}),
  })

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = (setup: {
  hands?: Record<string, ReturnType<typeof cardTemplate>[]>
  battlefield?: Record<string, ReturnType<typeof cardTemplate>[]>
}) =>
  createServerGame(
    commanderRules,
    { ...setup, players: 3 },
    { random: () => 0.5, cardPlugins: [linkedExile] },
  )

describe('linkedExile', () => {
  test('Cage Cleric returns the hostage when it leaves without a return trigger on the stack', () => {
    const cage = creature('Cage Cleric', 'p1')
    cage.effects = [
      handler('linkedExile'),
      linkedExileUntilLeaves(),
      {
        op: 'trigger',
        on: 'enters',
        targets: { filter: { type: 'Creature', controller: 'opponent' } },
        do: [linkExile({ type: 'Creature', controller: 'opponent' }, {})],
      },
    ]
    const hostage = creature('Hostage Beast', 'p2')
    const server = game({ hands: { p1: [cage] }, battlefield: { p2: [hostage] } })
    const cageId = named(server.state, 'Cage Cleric').id
    const hostageId = named(server.state, 'Hostage Beast').id

    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: cageId,
      to: 'battlefield',
    }))
    expect(pendingSelectionFor(entered, 'p1')).toBeDefined()
    const targeted = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [hostageId],
    }))
    const resolved = resolveStack(server.rules, targeted)
    expect(resolved.objects[hostageId]).toMatchObject({
      zone: 'exile',
      exiledWith: cageId,
    })
    expect(resolved.objects[cageId].exiledCards).toEqual([hostageId])

    const sacrificed = ok(server.rules(resolved, {
      type: 'sacrifice',
      objectId: cageId,
    }))
    expect(sacrificed.stack).toHaveLength(0)
    expect(sacrificed.objects[hostageId]).toMatchObject({
      zone: 'battlefield',
      controller: sacrificed.objects[hostageId].owner,
    })
    expect(sacrificed.objects[hostageId].exiledWith).toBeUndefined()
  })

  test('optional link exile may choose zero targets', () => {
    const warden = creature('Paired Warden', 'p1')
    warden.effects = [
      handler('linkedExile'),
      enters(linkExile({ type: 'Creature', controller: 'opponent' }, { optional: true })),
    ]
    const mark = creature('Marked Prey', 'p2')
    const server = game({ hands: { p1: [warden] }, battlefield: { p2: [mark] } })
    const wardenId = named(server.state, 'Paired Warden').id
    const markId = named(server.state, 'Marked Prey').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: wardenId,
      to: 'battlefield',
    })))
    const skipped = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(skipped.objects[markId].zone).toBe('battlefield')
  })

  test('Paired Warden leaves trigger returns exiled cards on the stack', () => {
    const warden = creature('Paired Warden', 'p1')
    warden.effects = [
      handler('linkedExile'),
      enters(linkExile({ type: 'Creature', controller: 'opponent' }, { optional: true })),
      leaves(returnLinkedExile()),
    ]
    const mark = creature('Marked Prey', 'p2')
    const server = game({ hands: { p1: [warden] }, battlefield: { p2: [mark] } })
    const wardenId = named(server.state, 'Paired Warden').id
    const markId = named(server.state, 'Marked Prey').id

    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: wardenId,
      to: 'battlefield',
    }))
    const opened = resolveStack(server.rules, entered)
    const exiled = ok(server.rules(opened, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [markId],
    }))
    const caged = resolveStack(server.rules, exiled)
    expect(caged.objects[markId].zone).toBe('exile')

    const killed = ok(server.rules(caged, {
      type: 'move',
      objectId: wardenId,
      to: 'graveyard',
    }))
    expect(killed.stack[0]).toMatchObject({
      kind: 'ability',
      name: 'Paired Warden',
    })
    const returned = resolveStack(server.rules, killed)
    expect(returned.objects[markId]).toMatchObject({
      zone: 'battlefield',
      controller: returned.objects[markId].owner,
    })
  })

  test('Mass Vault may exile any number of other nonland permanents you control', () => {
    const vault = creature('Mass Vault', 'p1')
    vault.effects = [
      handler('linkedExile'),
      linkedExileUntilLeaves(),
      enters(linkExile({ nonland: true }, { controlled: true, optional: true, max: 3 })),
    ]
    const relic = cardTemplate('Vault Relic', { types: ['Artifact'], controller: 'p1' })
    const token = cardTemplate('Vault Ally', { types: ['Creature'], controller: 'p1' })
    const server = game({ hands: { p1: [vault] }, battlefield: { p1: [relic, token] } })
    const vaultId = named(server.state, 'Mass Vault').id
    const relicId = named(server.state, 'Vault Relic').id
    const tokenId = named(server.state, 'Vault Ally').id

    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: vaultId,
      to: 'battlefield',
    })))
    const pick = pendingSelectionFor(entered, 'p1')!
    const chosen = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: pick.count,
      objectIds: [relicId, tokenId],
    }))
    const resolved = resolveStack(server.rules, chosen)
    expect(resolved.objects[vaultId].exiledCards?.sort()).toEqual([relicId, tokenId].sort())
    expect(resolved.objects[relicId].zone).toBe('exile')
    expect(resolved.objects[tokenId].zone).toBe('exile')
  })

  test('Border Warden exiles up to one creature per opponent', () => {
    const warden = creature('Border Warden', 'p1')
    warden.effects = [
      handler('linkedExile'),
      linkedExileUntilLeaves(),
      enters(linkExile(
        { type: 'Creature', controller: 'opponent' },
        { perOpponent: { max: 1 } },
      )),
    ]
    const east = creature('East Scout', 'p2')
    const north = creature('North Scout', 'p3')
    const server = game({
      hands: { p1: [warden] },
      battlefield: { p2: [east], p3: [north] },
    })
    const wardenId = named(server.state, 'Border Warden').id
    const eastId = named(server.state, 'East Scout').id
    const northId = named(server.state, 'North Scout').id

    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: wardenId,
      to: 'battlefield',
    })))
    const pickedEast = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [eastId],
    }))
    const pickedNorth = ok(server.rules(pickedEast, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [northId],
    }))
    const resolved = resolveStack(server.rules, pickedNorth)
    expect(resolved.objects[wardenId].exiledCards?.sort()).toEqual([eastId, northId].sort())
  })

  test('Hand Vault returns linked cards to their owners hands when it leaves', () => {
    const vault = creature('Hand Vault', 'p1')
    vault.effects = [
      handler('linkedExile'),
      linkedExileUntilLeaves('hand'),
      enters(linkExile({ type: 'Creature', controller: 'opponent' })),
    ]
    const prey = creature('Hand Prey', 'p2')
    const server = game({ hands: { p1: [vault] }, battlefield: { p2: [prey] } })
    const vaultId = named(server.state, 'Hand Vault').id
    const preyId = named(server.state, 'Hand Prey').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: vaultId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [preyId],
    }))
    state = resolveStack(server.rules, state)
    state = ok(server.rules(state, { type: 'sacrifice', objectId: vaultId }))
    expect(state.objects[preyId].zone).toBe('hand')
  })

  test('open link-exile selection survives projection for the choosing seat', () => {
    const cage = creature('Cage Cleric', 'p1')
    cage.effects = [
      handler('linkedExile'),
      linkedExileUntilLeaves(),
      {
        op: 'trigger',
        on: 'enters',
        targets: { filter: { type: 'Creature', controller: 'opponent' } },
        do: [linkExile({ type: 'Creature', controller: 'opponent' }, {})],
      },
    ]
    const hostage = creature('Hostage Beast', 'p2')
    const server = game({ hands: { p1: [cage] }, battlefield: { p2: [hostage] } })
    const cageId = named(server.state, 'Cage Cleric').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: cageId,
      to: 'battlefield',
    }))
    expect(pendingSelectionFor(entered, 'p1')?.candidates.length).toBeGreaterThan(0)
    const projected = server.project(entered, 'p1')
    expect(pendingSelectionFor(projected, 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(server.project(entered, 'p2'), 'p2')).toBeUndefined()
  })
})
