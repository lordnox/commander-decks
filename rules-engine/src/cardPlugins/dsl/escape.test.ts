import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  compareAmount,
  count,
  createDefinitionSnapshot,
  draw,
  escape,
  gainLife,
  ifThen,
  move,
  objects,
  ref,
  select,
  spell,
  target,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const clingLike = () => cardTemplate('Yard Exile', {
  types: ['Instant'],
  manaCost: '{B}',
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'graveyard' }), count: 1 })],
      },
      instructions: [
        ifThen(compareAmount(count(objects({ among: target(0), type: 'Creature' })), 'gte', 1), {
          then: [gainLife({ amount: 3, targets: ref('controller') })],
          otherwise: [draw(1)],
        }),
        move({ targets: target(0), to: 'exile' }),
      ],
    }),
    escape('{3}{B}', 5),
  ]))),
})

const filler = (index: number) => cardTemplate(`Filler ${index}`, { types: ['Sorcery'] })

describe('canonical escape', () => {
  test('exiles other graveyard cards, pays the escape mana, and still casts from hand', () => {
    const fillers = Array.from({ length: 5 }, (_, index) => filler(index))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [clingLike(), ...fillers, cardTemplate('Target Creature', { types: ['Creature'] })],
      },
    }, { random: () => 0.5 })
    let state = structuredClone(server.state)
    for (const objectId of state.zoneOrder.p1.hand.slice()) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state.players.p1.mana.B = 1
    state.players.p1.mana.C = 3
    const cling = named(state, 'Yard Exile')
    const targetCard = named(state, 'Target Creature')
    const costs = fillers.map(({ name }) => named(state, name).id)
    const restored = restoreJournal(createJournal(state), server.rules).current()
    const action = legalActsFor(restored, 'p1').find(candidate =>
      candidate.kind === 'castSpell'
      && candidate.objectId === cling.id
      && candidate.castOption === 'escape')
    expect(action).toMatchObject({
      castLabel: 'Escape—{3}{B}, Exile 5 other cards from your graveyard.',
    })
    if (action?.kind !== 'castSpell') throw new Error('expected escape cast')
    expect(action.targetGroups?.find(group => group.purpose === 'cost')).toMatchObject({
      min: 5,
      max: 5,
    })
    expect(server.rules(restored, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: [cling.id, ...costs.slice(0, 4)],
      targets: [{ kind: 'object', objectId: targetCard.id }],
    }).ok).toBe(false)
    const cast = ok(server.rules(restored, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: costs,
      targets: [{ kind: 'object', objectId: targetCard.id }],
    }))
    expect(costs.every(id => cast.objects[id].zone === 'exile')).toBe(true)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[targetCard.id].zone).toBe('exile')
    expect(resolved.objects[cling.id].zone).toBe('graveyard')
    expect(resolved.players.p1.life).toBe(43)
  })

  test('a noncreature escape target draws instead of gaining life', () => {
    const fillers = Array.from({ length: 5 }, (_, index) => filler(index))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [clingLike(), ...fillers, cardTemplate('Target Instant', { types: ['Instant'] })],
      },
      libraries: {
        p1: [cardTemplate('Library Card', { types: ['Sorcery'] })],
      },
    }, { random: () => 0.5 })
    let state = structuredClone(server.state)
    for (const objectId of state.zoneOrder.p1.hand.slice()) {
      state = ok(server.rules(state, { type: 'move', objectId, to: 'graveyard' }))
    }
    state.players.p1.mana.B = 1
    state.players.p1.mana.C = 3
    const cling = named(state, 'Yard Exile')
    const targetCard = named(state, 'Target Instant')
    const costs = fillers.map(({ name }) => named(state, name).id)
    const before = state.zoneCounts.p1.hand
    const cast = ok(server.rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: cling.id,
      castOption: 'escape',
      exile: costs,
      targets: [{ kind: 'object', objectId: targetCard.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[targetCard.id].zone).toBe('exile')
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.zoneCounts.p1.hand).toBe(before + 1)
  })
})
