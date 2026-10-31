import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  card,
  choice,
  chooseCards,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  forEachPlayer,
  linkExile as dslLinkExile,
  objects,
  players,
  ref,
  returnLinkedExile as dslReturnLinkedExile,
  select,
  self,
  target,
  whenever,
} from './dsl/v1'
import { activated } from './activated'

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
  createServerGame(commanderRules, { ...setup, players: 3 }, { random: () => 0.5 })

const canonicalDefinition = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

describe('linkedExile', () => {
  const pairedWarden = (name: string, abilities: Parameters<typeof card>[0]) =>
    cardTemplate(name, {
      types: ['Creature'],
      power: 2,
      toughness: 2,
      ruleDefinition: canonicalDefinition(abilities),
    })

  test('Fiend Hunter link choice stays private to its chooser', () => {
    const hunter = cardTemplate('Fiend Hunter', { types: ['Creature'], power: 2, toughness: 2 })
    const prey = cardTemplate('Hidden Prey', { types: ['Creature'] })
    const server = createServerGame(commanderRules, {
      players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] },
    }, { random: () => 0.5, cardPlugins: [activated] })
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move', objectId: named(server.state, 'Fiend Hunter').id, to: 'battlefield',
    })))
    expect(pendingSelectionFor(entered, 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(server.project(entered, 'p1'), 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(server.project(entered, 'p2'), 'p2')).toBeUndefined()
  })

  test('Fiend Hunter resumes a linked target choice after restart', () => {
    const hunter = cardTemplate('Fiend Hunter', { types: ['Creature'], power: 2, toughness: 2 })
    const prey = cardTemplate('Restart Prey', { types: ['Creature'] })
    const server = createServerGame(commanderRules, {
      players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] },
    }, { random: () => 0.5, cardPlugins: [activated] })
    const preyId = named(server.state, 'Restart Prey').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move', objectId: named(server.state, 'Fiend Hunter').id, to: 'battlefield',
    })))
    const before = pendingSelectionFor(entered, 'p1')
    expect(before).toBeDefined()
    const restarted = structuredClone(entered)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(before?.id)
    expect(server.rules(restarted, { type: 'selectCards', seat: 'p2', kind: 'choose', count: 1, objectIds: [preyId] }).ok).toBe(false)
    const finished = ok(server.rules(restarted, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 1, objectIds: [preyId] }))
    expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
    expect(finished.stack).toHaveLength(1)
    expect(named(resolveStack(server.rules, finished), 'Restart Prey').zone).toBe('exile')
  })
  test('optional link exile may choose zero targets', () => {
    const warden = pairedWarden('Paired Warden', [whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }),
        min: 0,
        max: 1,
      })] },
      instructions: [dslLinkExile({ targets: target(0) })],
    })])
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
    const warden = pairedWarden('Paired Warden', [
      whenever(self.enters, {
        decisions: { targets: [select({
          filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }),
          min: 0,
          max: 1,
        })] },
        instructions: [dslLinkExile({ targets: target(0) })],
      }),
      whenever(self.leaves, { instructions: [dslReturnLinkedExile()] }),
    ])
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
    const vault = pairedWarden('Mass Vault', [whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({
          zone: 'battlefield',
          controller: 'you',
          other: true,
          not: { type: 'Land' },
        }),
        min: 0,
        max: 3,
      })] },
      instructions: [dslLinkExile({ targets: target(0) })],
    })])
    const relic = cardTemplate('Vault Relic', { types: ['Artifact'] })
    const token = cardTemplate('Vault Ally', { types: ['Creature'] })
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
    const warden = pairedWarden('Border Warden', [whenever(self.enters, {
      instructions: [
        forEachPlayer({
          of: players({ relation: 'opponent' }),
          collectObjects: { from: 'picked', as: 'targets' },
          instructions: [chooseCards({
            chooser: ref('controller'),
            filter: objects({ zone: 'battlefield', type: 'Creature', controller: ref('event.player') }),
            min: 0,
            max: 1,
            bindChoice: 'picked',
          })],
        }),
        dslLinkExile({ targets: choice('targets') }),
      ],
    })])
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

  test('open link-exile selection survives projection for the choosing seat', () => {
    const cage = cardTemplate('Cage Cleric', {
      types: ['Creature'], power: 2, toughness: 2,
      ruleDefinition: canonicalDefinition([whenever(self.enters, {
        decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), count: 1 })] },
        instructions: [dslLinkExile({ targets: target(0) })],
      })]),
    })
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
