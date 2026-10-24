import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  linkExile,
  objects,
  ref,
  returnLinkedExile,
  select,
  self,
  target,
  whenever,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const compileCreature = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const durationCage = () => cardTemplate('Cage Cleric', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
  ruleDefinition: compileCreature([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), count: 1 })] },
      instructions: [linkExile({ targets: target(0), untilSourceLeaves: true })],
    }),
  ]),
})

const pairedWarden = () => cardTemplate('Paired Warden', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
  ruleDefinition: compileCreature([
    whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature', other: true }),
        min: 0,
        max: 1,
      })] },
      instructions: [linkExile({ targets: target(0) })],
    }),
    whenever(self.leaves, { instructions: [returnLinkedExile()] }),
  ]),
})

const enterAndChoose = (
  server: ReturnType<typeof createServerGame>,
  sourceId: string,
  targetIds: string[],
) => {
  const entered = ok(server.rules(server.state, { type: 'move', objectId: sourceId, to: 'battlefield' }))
  expect(pendingSelectionFor(entered, 'p1')).toBeDefined()
  return ok(server.rules(entered, {
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: 1,
    objectIds: targetIds,
  }))
}

describe('linkExile until source leaves', () => {
  test('a sacrifice returns the hostage immediately with an empty stack', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [durationCage()] },
      battlefield: { p2: [cardTemplate('Hostage Beast', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0.5 })
    const cageId = named(server.state, 'Cage Cleric').id
    const hostageId = named(server.state, 'Hostage Beast').id
    const resolved = resolveStack(server.rules, enterAndChoose(server, cageId, [hostageId]))
    expect(resolved.objects[hostageId]).toMatchObject({ zone: 'exile', exiledWith: cageId })
    expect(resolved.objects[cageId].exiledCards).toEqual([hostageId])
    expect(resolved.objects[cageId].returnLinkedExile).toBe('battlefield')

    const sacrificed = ok(server.rules(resolved, { type: 'sacrifice', objectId: cageId }))
    expect(sacrificed.stack).toHaveLength(0)
    expect(sacrificed.objects[hostageId]).toMatchObject({
      zone: 'battlefield',
      controller: sacrificed.objects[hostageId].owner,
    })
    expect(sacrificed.objects[hostageId].exiledWith).toBeUndefined()
  })

  test('a source that already left does not exile its chosen target', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [durationCage()] },
      battlefield: { p2: [cardTemplate('Fleeing Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const cageId = named(server.state, 'Cage Cleric').id
    const preyId = named(server.state, 'Fleeing Prey').id
    const targeted = enterAndChoose(server, cageId, [preyId])
    expect(targeted.stack).toHaveLength(1)
    expect(targeted.objects[preyId].zone).toBe('battlefield')

    const left = ok(server.rules(targeted, { type: 'move', objectId: cageId, to: 'graveyard' }))
    const resolved = resolveStack(server.rules, left)
    expect(resolved.objects[preyId].zone).toBe('battlefield')
    expect(resolved.objects[preyId].exiledWith).toBeUndefined()
  })

  test('the compiler rejects player recipients', () => {
    expect(() => compileCardRuleDefinition(card([
      whenever(self.enters, { instructions: [linkExile({ targets: ref('controller'), untilSourceLeaves: true })] }),
    ]))).toThrow()
  })
})

describe('returnLinkedExile as a separate leave trigger', () => {
  test('the leave trigger returns the hostage from the stack', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [pairedWarden()] },
      battlefield: { p2: [cardTemplate('Caged Prey', { types: ['Creature'], power: 3, toughness: 3 })] },
    }, { random: () => 0.5 })
    const wardenId = named(server.state, 'Paired Warden').id
    const preyId = named(server.state, 'Caged Prey').id
    const resolved = resolveStack(server.rules, enterAndChoose(server, wardenId, [preyId]))
    expect(resolved.objects[preyId]).toMatchObject({ zone: 'exile', exiledWith: wardenId })

    const left = ok(server.rules(resolved, { type: 'move', objectId: wardenId, to: 'graveyard' }))
    expect(left.stack).toHaveLength(1)
    expect(left.objects[preyId].zone).toBe('exile')

    const returned = resolveStack(server.rules, left)
    expect(returned.objects[preyId]).toMatchObject({
      zone: 'battlefield',
      controller: returned.objects[preyId].owner,
    })
  })

  test('a source that leaves before its entry resolves still exiles permanently', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [pairedWarden()] },
      battlefield: { p2: [cardTemplate('Kept Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const wardenId = named(server.state, 'Paired Warden').id
    const preyId = named(server.state, 'Kept Prey').id
    const targeted = enterAndChoose(server, wardenId, [preyId])
    expect(targeted.stack).toHaveLength(1)

    const left = ok(server.rules(targeted, { type: 'move', objectId: wardenId, to: 'hand' }))
    expect(left.stack.length).toBeGreaterThanOrEqual(2)
    expect(left.objects[preyId].zone).toBe('battlefield')

    const resolved = resolveStack(server.rules, left)
    expect(resolved.objects[preyId].zone).toBe('exile')
    expect(resolved.objects[preyId].exiledWith).toBe(wardenId)
  })

  test('optional link exile may choose zero targets', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [pairedWarden()] },
      battlefield: { p2: [cardTemplate('Marked Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const wardenId = named(server.state, 'Paired Warden').id
    const markId = named(server.state, 'Marked Prey').id
    const skipped = enterAndChoose(server, wardenId, [])
    expect(skipped.objects[markId].zone).toBe('battlefield')
  })
})
