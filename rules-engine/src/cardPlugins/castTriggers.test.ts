import { describe, expect, test } from 'bun:test'
import { pendingOptionSelection } from '../rules/selectOptions'
import { pendingSelectionFor } from '../rules/selectCards'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { CardTemplate } from '../newGame'
import type { GameState, PlayerId } from '../types'
import {
  card,
  chooseModes,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  draw,
  gainLife,
  ref,
  spellCast,
  whenever,
} from './dsl/v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const spell = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, manaCost: '{0}', manaValue: 0, ...extra })

const watcher = (name: string, ability: ReturnType<typeof whenever>) =>
  cardTemplate(name, {
    types: ['Enchantment'],
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([ability]))),
  })

const game = (permanents: CardTemplate[]) =>
  createServerGame(
    commanderRules,
    {
      players: 3,
      battlefield: { p1: permanents },
      hands: {
        p1: [spell('P1 Trick', ['Instant']), spell('P1 Bear', ['Creature'])],
        p2: [spell('P2 Trick', ['Instant']), spell('P2 Bear', ['Creature'])],
        p3: [spell('P3 Trick', ['Instant'])],
      },
      libraries: {
        p1: ['Lib A', 'Lib B', 'Lib C'].map((name) => cardTemplate(name, { types: ['Sorcery'] })),
      },
    },
    { random: () => 0.5 },
  )

const cast = (server: ReturnType<typeof game>, seat: PlayerId, name: string, state = server.state) =>
  ok(server.rules({ ...structuredClone(state), active: seat, priority: seat }, {
    type: 'castSpell',
    seat,
    objectId: named(state, name).id,
  }))

const handNames = (state: GameState, seat: PlayerId) =>
  state.zoneOrder[seat].hand.map((id) => state.objects[id].name)

const opponentNoncreatureCast = spellCast({ filter: { controller: 'opponent', not: { type: 'Creature' } } })

describe('canonical cast triggers with seat and spell-type filters', () => {
  test('an opponent casting a noncreature spell draws the watcher controller a card', () => {
    const server = game([watcher('Nezahal Stand-in', whenever(opponentNoncreatureCast, {
      instructions: [draw(1)],
    }))])
    const queued = cast(server, 'p2', 'P2 Trick')
    expect(handNames(queued, 'p1')).not.toContain('Lib A')
    expect(queued.stack[0].kind).toBe('ability')
    const afterP2 = resolveStack(server.rules, queued)
    expect(handNames(afterP2, 'p1')).toContain('Lib A')
    expect(handNames(afterP2, 'p2')).not.toContain('Lib A')

    const afterP3 = resolveStack(server.rules, cast(server, 'p3', 'P3 Trick', afterP2))
    expect(handNames(afterP3, 'p1')).toEqual(expect.arrayContaining(['Lib A', 'Lib B']))
  })

  test('an opponent casting a creature spell does not trigger it', () => {
    const server = game([watcher('Nezahal Stand-in', whenever(opponentNoncreatureCast, {
      instructions: [draw(1)],
    }))])
    const state = cast(server, 'p2', 'P2 Bear')
    expect(handNames(state, 'p1')).not.toContain('Lib A')
  })

  test('the controller casting a noncreature spell does not trigger an opponent watcher', () => {
    const server = game([watcher('Nezahal Stand-in', whenever(opponentNoncreatureCast, {
      instructions: [draw(1)],
    }))])
    const state = cast(server, 'p1', 'P1 Trick')
    expect(handNames(state, 'p1')).not.toContain('Lib A')
  })

  test('a watcher that has left the battlefield no longer triggers', () => {
    const server = game([watcher('Nezahal Stand-in', whenever(opponentNoncreatureCast, {
      instructions: [draw(1)],
    }))])
    const removed = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Nezahal Stand-in').id,
      to: 'graveyard',
    }))
    expect(handNames(cast(server, 'p2', 'P2 Trick', removed), 'p1')).not.toContain('Lib A')
  })

  test('without an opponent filter only the controller\'s creature casts trigger it', () => {
    const ownCreatureCast = spellCast({ filter: { controller: 'you', type: 'Creature' } })
    const server = game([watcher('Own Creature Watcher', whenever(ownCreatureCast, {
      instructions: [draw(1)],
    }))])
    expect(handNames(resolveStack(server.rules, cast(server, 'p1', 'P1 Bear')), 'p1')).toContain('Lib A')
    expect(handNames(resolveStack(server.rules, cast(server, 'p1', 'P1 Trick')), 'p1')).not.toContain('Lib A')
    expect(handNames(cast(server, 'p2', 'P2 Bear'), 'p1')).not.toContain('Lib A')
  })

  test('the noncreature filter also works on the controller\'s own casts', () => {
    const ownNoncreatureCast = spellCast({ filter: { controller: 'you', not: { type: 'Creature' } } })
    const server = game([watcher('Own Spell Watcher', whenever(ownNoncreatureCast, {
      instructions: [draw(1)],
    }))])
    expect(handNames(resolveStack(server.rules, cast(server, 'p1', 'P1 Trick')), 'p1')).toContain('Lib A')
    expect(handNames(resolveStack(server.rules, cast(server, 'p1', 'P1 Bear')), 'p1')).not.toContain('Lib A')
    expect(handNames(cast(server, 'p2', 'P2 Trick'), 'p1')).not.toContain('Lib A')
  })

  test('a selected modal cast trigger resolves separately from choosing its mode', () => {
    const modal = whenever(opponentNoncreatureCast, {
      decisions: { modes: chooseModes({ count: 1 }) },
      modes: [{ instructions: [gainLife({ amount: 2, targets: ref('controller') })] }],
    })
    const server = game([
      watcher('Nezahal Stand-in', whenever(opponentNoncreatureCast, {
        instructions: [draw(1)],
      })),
      watcher('Second Watcher', whenever(opponentNoncreatureCast, {
        instructions: [draw(1)],
      })),
      watcher('Modal Watcher', modal),
    ])
    const state = cast(server, 'p2', 'P2 Trick')
    const order = pendingSelectionFor(state, 'p1')
    const ordered = order ? ok(server.rules(state, {
      type: 'selectCards', seat: 'p1', selectionId: order.id, kind: 'choose',
      count: order.count, objectIds: order.candidates,
    })) : state

    expect(handNames(ordered, 'p1')).not.toContain('Lib A')
    expect(ordered.stack.filter((item) => item.kind === 'ability')).toHaveLength(2)
    const choice = pendingOptionSelection(ordered, 'p1')!
    expect(choice).toMatchObject({ seat: 'p1', prompt: 'Choose 1 mode for Modal Watcher.' })
    expect(pendingOptionSelection(ordered, 'p2')).toBeUndefined()
    const chosen = ok(server.rules(ordered, {
      type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: choice.options[0]!.id,
    }))
    expect(chosen.players.p1.life).toBe(40)
    expect(resolveStack(server.rules, chosen).players.p1.life).toBe(42)
  })
})
