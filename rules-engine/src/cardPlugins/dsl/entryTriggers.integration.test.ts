import { describe, expect, test } from 'bun:test'
import {
  card,
  compileCardRuleDefinition,
  counter,
  createDefinitionSnapshot,
  destroy,
  objects,
  select,
  spell,
  stackItems,
  target,
  whenever,
  keyword,
  self,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import type { GameState } from '../../types'
import { hasKeyword } from '../../keywords'
import { mossbornHydra } from '../mossborn-hydra'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('entryTriggers — integration', () => {

  describe('targeted entry trigger', () => {
    const entryDestroyerDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      whenever(self.enters, {
        decisions: {
          targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
        },
        instructions: [destroy({ targets: target(0) })],
      }),
    ])))
    const counterSpellDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      spell({
        decisions: {
          targets: [select({ filter: stackItems({ kind: 'spell', other: true }), count: 1 })],
        },
        instructions: [counter({ targets: target(0) })],
      }),
    ])))
    const entryDestroyerBoard = () => createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Entry destroyer', {
          types: ['Creature'],
          manaCost: '{0}',
          ruleDefinition: entryDestroyerDefinition(),
        })],
      },
      battlefield: {
        p2: [cardTemplate('Entry victim', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0 })

    test('entering the battlefield requests a destroy target before the trigger reaches the stack', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const entered = reduce(server, server.state, { type: 'move', objectId: creature.id, to: 'battlefield' })
      expect(entered.stack).toHaveLength(0)
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      expect(targetChoice.candidates).toContain(victim.id)
      expect(targetChoice.canonicalTrigger).toBeDefined()
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(stacked.stack).toHaveLength(1)
      expect(stacked.stack[0].kind).toBe('ability')
      const finished = resolveStack(server.rules, stacked)
      expect(finished.objects[victim.id].zone).toBe('graveyard')
    })

    test('permanent spell resolution collects ETB from the resolving card before the trigger stacks', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      expect(cast.stack).toHaveLength(1)
      expect(cast.stack[0].kind).toBe('spell')
      expect(pendingSelectionFor(cast, 'p1')).toBeUndefined()
      const entered = reduce(server, cast, { type: 'resolveTop' })
      expect(entered.objects[creature.id].zone).toBe('battlefield')
      expect(entered.stack).toHaveLength(0)
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      expect(targetChoice.candidates).toContain(victim.id)
      expect(targetChoice.canonicalTrigger).toBeDefined()
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(stacked.stack).toHaveLength(1)
      expect(stacked.stack[0].kind).toBe('ability')
      expect(stacked.priority).toBe('p1')
      const finished = resolveStack(server.rules, stacked)
      expect(finished.objects[victim.id].zone).toBe('graveyard')
    })

    test('a later illegal target does not resolve the captured entry trigger', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const entered = reduce(server, cast, { type: 'resolveTop' })
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      const departed = reduce(server, stacked, { type: 'move', objectId: victim.id, to: 'graveyard' })
      const resolved = reduce(server, departed, { type: 'resolveTop' })
      expect(resolved.objects[victim.id].zone).toBe('graveyard')
      expect(resolved.objects[creature.id].zone).toBe('battlefield')
      expect(resolved.log.some((line) => line.includes('didNotResolve:allTargetsIllegal'))).toBe(true)
      expect(resolved.stack).toHaveLength(0)
    })

    test('a copied no-program permanent becomes a token instead of vanishing', () => {
      const wallDefinition = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.defender])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [cardTemplate('Wall', {
            types: ['Creature'],
            manaCost: '{0}',
            power: 0,
            toughness: 4,
            ruleDefinition: wallDefinition,
          })],
        },
      }, { random: () => 0 })
      const wall = named(server.state, 'Wall')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: wall.id })
      const original = cast.stack[0]
      const copied = reduce(server, cast, {
        type: 'copySpell', stackId: original.id, controller: 'p1', targets: [], retarget: false,
      })
      expect(copied.stack[0].copy).toBe(true)
      const resolved = reduce(server, copied, { type: 'resolveTop' })
      const token = Object.values(resolved.objects).find((object) => object.token && object.name === 'Wall')
      expect(token).toMatchObject({ zone: 'battlefield', token: true, power: 0, toughness: 4 })
      expect(token?.spellCopy).toBeUndefined()
      expect(hasKeyword(token!, 'defender', resolved)).toBe(true)
      expect(resolved.objects[wall.id].zone).toBe('stack')
      expect(resolved.stack).toHaveLength(1)
      expect(resolved.stack[0].id).toBe(original.id)
      expect(resolved.stack[0].copy).toBeFalsy()
      expect(Object.values(resolved.objects).filter((object) => object.zone === 'battlefield')).toHaveLength(1)
    })

    test('copied permanent resolution still collects the card\'s own ETB', () => {
      const server = entryDestroyerBoard()
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const original = cast.stack[0]
      const copied = reduce(server, cast, {
        type: 'copySpell', stackId: original.id, controller: 'p1', targets: [], retarget: false,
      })
      const entered = reduce(server, copied, { type: 'resolveTop' })
      const token = Object.values(entered.objects).find((object) => object.token && object.name === 'Entry destroyer')
      expect(token).toMatchObject({ zone: 'battlefield', token: true })
      expect(entered.objects[creature.id].zone).toBe('stack')
      expect(entered.stack).toHaveLength(1)
      expect(entered.stack[0].id).toBe(original.id)
      const targetChoice = pendingSelectionFor(entered, 'p1')!
      expect(targetChoice.candidates).toContain(victim.id)
      expect(targetChoice.canonicalTrigger).toBeDefined()
      const stacked = reduce(server, entered, {
        type: 'selectCards', seat: 'p1', selectionId: targetChoice.id, kind: 'choose', count: 1, objectIds: [victim.id],
      })
      expect(stacked.stack).toHaveLength(2)
      expect(stacked.stack[0].kind).toBe('ability')
      const afterTrigger = reduce(server, stacked, { type: 'resolveTop' })
      expect(afterTrigger.objects[victim.id].zone).toBe('graveyard')
      expect(afterTrigger.objects[creature.id].zone).toBe('stack')
      expect(afterTrigger.stack).toHaveLength(1)
      expect(afterTrigger.stack[0].id).toBe(original.id)
    })

    test('countering the creature spell before entry prevents the trigger', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: {
          p1: [
            cardTemplate('Entry destroyer', {
              types: ['Creature'],
              manaCost: '{0}',
              ruleDefinition: entryDestroyerDefinition(),
            }),
            cardTemplate('Counter probe', {
              types: ['Instant'],
              manaCost: '{0}',
              ruleDefinition: counterSpellDefinition(),
            }),
          ],
        },
        battlefield: {
          p2: [cardTemplate('Entry victim', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      }, { random: () => 0 })
      const creature = named(server.state, 'Entry destroyer')
      const victim = named(server.state, 'Entry victim')
      let state = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: creature.id })
      const stackId = state.stack.find((item) => item.objectId === creature.id)!.id
      const counterObject = named(state, 'Counter probe')
      state = reduce(server, state, {
        type: 'castSpell', seat: 'p1', objectId: counterObject.id,
        targets: [{ kind: 'stackItem', stackId }],
      })
      state = reduce(server, state, { type: 'resolveTop' })
      expect(state.objects[creature.id].zone).toBe('graveyard')
      expect(state.objects[victim.id].zone).toBe('battlefield')
      expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
      expect(state.pendingTriggers ?? []).toHaveLength(0)
      expect(state.stack.some((item) => item.kind === 'ability')).toBe(false)
    })
  })
})

describe('legacy enters-with-counter plugin', () => {
  test('enters with a +1/+1 counter when its spell resolves', () => {
    const forest = () => cardTemplate('Forest', {
      types: ['Land'],
      subtypes: ['Forest'],
      tapProduces: { G: 1 },
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Mossborn Hydra', {
            types: ['Creature'],
            subtypes: ['Elemental', 'Hydra'],
            power: 0,
            toughness: 0,
            manaCost: '{2}{G}',
          })],
        },
        battlefield: { p1: [forest(), forest(), forest()] },
      },
      { random: () => 0.5, cardPlugins: [mossbornHydra] },
    )
    const [forestA, forestB, forestC] = server.state.zoneOrder.p1.battlefield
    const hydraId = server.state.zoneOrder.p1.hand[0]
    let state = server.state
    state = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forestA }))
    state = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forestB }))
    state = ok(server.rules(state, { type: 'tapForMana', seat: 'p1', objectId: forestC }))
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: hydraId }))
    state = ok(server.rules(state, { type: 'passPriority', seat: 'p1' }))
    state = ok(server.rules(state, { type: 'passPriority', seat: 'p2' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const resolved = state.objects[hydraId]
    expect(resolved.zone).toBe('battlefield')
    expect(resolved.counters['+1/+1']).toBe(1)
    expect([resolved.power, resolved.toughness]).toEqual([1, 1])
  })
})
