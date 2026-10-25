import { pendingOptionSelection } from '../../rules/selectOptions'
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



import { activated } from '../activated'

import { choiceEffects } from '../choiceEffects'
import {librarySearch} from '../librarySearch'
import {onResolve} from '../onResolve'
import {targetedResolve} from '../targetedResolve'
import {ward} from '../ward'
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
      expect(hasKeyword(token!, 'defender')).toBe(true)
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

describe('relocated from homerPass2.test.ts → entryTriggers.integration.test.ts', () => {
  const named = (state: GameState, name: string) =>
    Object.values(state.objects).find((object) => object.name === name)!

  const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

  const plugins = [onResolve, targetedResolve, activated, choiceEffects, librarySearch, ward]

  test('Aftermath Analyst mills three on enter', () => {
      const server = createServerGame(
        commanderRules,
        {
          hands: {
            p1: [creature('Aftermath Analyst', { manaCost: '{1}{G}' })],
          },
          libraries: {
            p1: ['One', 'Two', 'Three', 'Four'].map((name) =>
              cardTemplate(name, { types: ['Instant'] })),
          },
        },
        { random: () => 0.5, cardPlugins: plugins },
      )
      const ready = structuredClone(server.state)
      ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
      const cast = ok(server.rules(ready, {
        type: 'castSpell',
        seat: 'p1',
        objectId: named(ready, 'Aftermath Analyst').id,
      }))
      const entered = resolveStack(server.rules, ok(server.rules(cast, { type: 'resolveTop' })))
      expect(named(entered, 'One').zone).toBe('graveyard')
      expect(named(entered, 'Two').zone).toBe('graveyard')
      expect(named(entered, 'Three').zone).toBe('graveyard')
    })

})


test.each([0, 1])('modal land-entry triggers announce mode %s before resolution', mode => {
  const server = createServerGame(commanderRules, {
    players: 3,
    battlefield: { p1: [cardTemplate('Retreat to Hagra')], p2: [cardTemplate('Recipient', { types: ['Creature'], power: 2, toughness: 3 })] },
    hands: { p1: [cardTemplate('Land fixture', { types: ['Land'] })] },
  }, { random: () => 0 })
  const creature = named(server.state, 'Recipient').id
  let state = reduce(server, server.state, { type: 'playLand', seat: 'p1', objectId: named(server.state, 'Land fixture').id })
  expect(state.stack).toHaveLength(0)
  const choice = pendingOptionSelection(state, 'p1')!
  expect(choice).toBeDefined()
  state = reduce(server, JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: `mode:${mode}` })
  if (mode === 0) {
    const targets = pendingSelectionFor(state, 'p1')!
    expect(targets.candidates).toContain(creature)
    state = reduce(server, state, { type: 'selectCards', seat: 'p1', selectionId: targets.id, kind: 'choose', count: 1, objectIds: [creature] })
  }
  expect(state.stack).toHaveLength(1)
  expect(state.players.p1.life).toBe(40)
  state = resolveStack(server.rules, state)
  if (mode === 0) {
    expect(hasKeyword(state.objects[creature], 'deathtouch')).toBe(true)
    expect(state.players.p2.life).toBe(40)
  } else {
    expect(state.players.p1.life).toBe(41)
    expect(state.players.p2.life).toBe(39)
    expect(state.players.p3.life).toBe(39)
    expect(hasKeyword(state.objects[creature], 'deathtouch')).toBe(false)
  }
})

test.each([
  { forcedTapped: true, accept: true },
  { forcedTapped: false, accept: true },
  { forcedTapped: false, accept: false },
])('untapped-entry occurrences use the actual entry state and make the return optional (%j)', ({ forcedTapped, accept }) => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: Array.from({ length: 3 }, (_, i) => cardTemplate(`Island ${i}`, { types: ['Land'], subtypes: ['Island'] })) },
    hands: { p1: [cardTemplate('Mystic Sanctuary')] },
    libraries: { p1: [cardTemplate('Return fixture', { types: ['Instant'], zone: 'graveyard' })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  const returning = server.state.zoneOrder.p1.graveyard[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield', tapped: forcedTapped }))
  if (forcedTapped) {
    expect(state.stack).toHaveLength(0)
    expect(pendingSelectionFor(state, 'p1')).toBeUndefined()
    return
  }
  const targetPick = pendingSelectionFor(state, 'p1')!
  state = ok(server.rules(state, { type: 'selectCards', seat: 'p1', selectionId: targetPick.id, kind: 'choose', count: targetPick.count, objectIds: [returning] }))
  // Tapping the Sanctuary or losing an Island later cannot undo its actual entry occurrence.
  state = ok(server.rules(state, { type: 'tap', objectId: id }))
  state = ok(server.rules(state, { type: 'move', objectId: server.state.zoneOrder.p1.battlefield[0]!, to: 'hand' }))
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'resolveTop' }))
  const optional = pendingOptionSelection(state, 'p1')!
  state = ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: optional.id, optionId: accept ? 'instruction:0' : 'instruction:1' }))
  expect(state.objects[returning]?.zone).toBe(accept ? 'library' : 'graveyard')
  if (accept) expect(state.zoneOrder.p1.library[0]).toBe(returning)
})

test('catalog Loran of the Third Path offers a typed entry target, then her activation draws for her controller and the target player', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Loran of the Third Path')] },
    libraries: { p1: [cardTemplate('Forest')], p2: [cardTemplate('Forest')] },
    battlefield: { p2: [cardTemplate('Target Relic', { types: ['Artifact'] })] },
  }, { random: () => 0.5 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  let state = reduce(server, ready, { type: 'castSpell', seat: 'p1', objectId: named(ready, 'Loran of the Third Path').id })
  state = reduce(server, state, { type: 'resolveTop' })
  const relic = named(state, 'Target Relic').id
  expect(pendingSelectionFor(state, 'p1')?.candidates).toContain(relic)
  state = reduce(server, state, { type: 'selectCards', seat: 'p1', kind: 'choose', count: 1, objectIds: [relic] })
  state = resolveStack(server.rules, state)
  expect(state.objects[relic].zone).toBe('graveyard')

  const loran = named(state, 'Loran of the Third Path')
  state.objects[loran.id].summoningSickness = false
  state.priority = 'p1'
  state = reduce(server, state, {
    type: 'activateAbility', abilityId: '$.abilities[2]', seat: 'p1', objectId: loran.id,
    targets: [{ kind: 'player', player: 'p2' }],
  })
  state = resolveStack(server.rules, state)
  expect(state.zoneOrder.p1.hand).toHaveLength(1)
  expect(state.zoneOrder.p2.hand).toHaveLength(1)
})

test('catalog Meteor Golem destroys the chosen opponent nonland permanent when it enters', () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Meteor Golem')] },
    battlefield: { p2: [cardTemplate('Fixture Rock', { types: ['Artifact'] })] },
  }, { random: () => 0.5 })
  let state = structuredClone(server.state)
  state.players.p1.mana.C = 8
  const rockId = named(state, 'Fixture Rock').id
  state = reduce(server, state, { type: 'castSpell', seat: 'p1', objectId: named(state, 'Meteor Golem').id })
  state = resolveStack(server.rules, state)
  const selection = pendingSelectionFor(state, 'p1')!
  state = reduce(server, state, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [rockId] })
  state = resolveStack(server.rules, state)
  expect(state.objects[rockId].zone).toBe('graveyard')
})
