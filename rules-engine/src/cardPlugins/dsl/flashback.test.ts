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
  counter,
  createDefinitionSnapshot,
  flashback,
  move,
  objects,
  select,
  spell,
  stackItems,
  target,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const creature = (name: string) => cardTemplate(name, {
  types: ['Creature'],
  power: 1,
  toughness: 1,
})

const flashbackReturn = () => cardTemplate('Yard Return', {
  types: ['Sorcery'],
  manaCost: '{2}{B}{B}',
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({
      decisions: {
        targets: [select({ filter: objects({ zone: 'graveyard', type: 'Creature' }), count: 1 })],
      },
      instructions: [move({ targets: target(0), to: 'battlefield' })],
    }),
    flashback({
      label: 'Flashback—Sacrifice three creatures.',
      sacrifice: { type: 'Creature', count: 3 },
    }),
  ]))),
})

const cancel = () => cardTemplate('Cancel', {
  types: ['Instant'],
  manaCost: '{U}',
  ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([
    spell({
      decisions: {
        targets: [select({ filter: stackItems({ kind: 'spell' }), count: 1 })],
      },
      instructions: [counter({ targets: target(0) })],
    }),
  ]))),
})

describe('canonical flashback', () => {
  test('pays the alternate graveyard cost, resolves, and still casts from hand', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [flashbackReturn(), creature('Reanimation Target')],
      },
      battlefield: {
        p1: [creature('One'), creature('Two'), creature('Three')],
      },
    }, { random: () => 0.5 })
    const fromHand = structuredClone(server.state)
    const target = named(fromHand, 'Reanimation Target')
    fromHand.zoneOrder.p1.hand = fromHand.zoneOrder.p1.hand.filter(id => id !== target.id)
    fromHand.zoneOrder.p1.graveyard.push(target.id)
    fromHand.zoneCounts.p1.hand -= 1
    fromHand.zoneCounts.p1.graveyard += 1
    target.zone = 'graveyard'
    fromHand.players.p1.mana.B = 2
    fromHand.players.p1.mana.C = 2
    const dread = named(fromHand, 'Yard Return')
    const normallyCast = ok(server.rules(fromHand, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const normallyResolved = ok(server.rules(normallyCast, { type: 'resolveTop' }))
    expect(normallyResolved.objects[dread.id].zone).toBe('graveyard')
    expect(normallyResolved.objects[target.id].zone).toBe('battlefield')

    const ready = structuredClone(server.state)
    for (const name of ['Yard Return', 'Reanimation Target']) {
      const object = named(ready, name)
      const from = object.zone
      ready.zoneOrder[object.owner][from] = ready.zoneOrder[object.owner][from]
        .filter(objectId => objectId !== object.id)
      ready.zoneCounts[object.owner][from] -= 1
      ready.zoneOrder[object.owner].graveyard.push(object.id)
      ready.zoneCounts[object.owner].graveyard += 1
      object.zone = 'graveyard'
    }
    const sacrifices = ['One', 'Two', 'Three'].map(name => named(ready, name).id)
    const restored = restoreJournal(createJournal(ready), server.rules).current()
    const action = legalActsFor(restored, 'p1').find(candidate =>
      candidate.kind === 'castSpell'
      && candidate.objectId === dread.id
      && candidate.castOption === 'flashback')
    expect(action).toMatchObject({
      kind: 'castSpell',
      castLabel: 'Flashback—Sacrifice three creatures.',
    })
    if (action?.kind !== 'castSpell') throw new Error('expected flashback cast')
    expect(action.targetGroups?.find(group => group.purpose === 'cost')).toMatchObject({
      min: 3,
      max: 3,
    })
    expect(legalActsFor(restored, 'p1').some(candidate =>
      candidate.kind === 'castSpell'
      && candidate.objectId === dread.id
      && !candidate.castOption)).toBe(false)
    expect(server.rules(restored, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      castOption: 'flashback',
      sacrifice: sacrifices.slice(0, 2),
      targets: [{ kind: 'object', objectId: named(restored, 'Reanimation Target').id }],
    }).ok).toBe(false)

    const cast = ok(server.rules(restored, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      castOption: 'flashback',
      sacrifice: sacrifices,
      targets: [{ kind: 'object', objectId: named(restored, 'Reanimation Target').id }],
    }))
    expect(sacrifices.every(id => cast.objects[id].zone === 'graveyard')).toBe(true)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[dread.id].zone).toBe('exile')
    expect(resolved.objects[named(resolved, 'Reanimation Target').id].zone).toBe('battlefield')
  })

  test('a countered flashback spell is exiled', () => {
    const server = createServerGame(commanderRules, {
      hands: {
        p1: [flashbackReturn(), creature('Target')],
        p2: [cancel()],
      },
      battlefield: {
        p1: [creature('One'), creature('Two'), creature('Three')],
      },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    for (const name of ['Yard Return', 'Target']) {
      const object = named(ready, name)
      const from = object.zone
      ready.zoneOrder[object.owner][from] = ready.zoneOrder[object.owner][from]
        .filter(objectId => objectId !== object.id)
      ready.zoneCounts[object.owner][from] -= 1
      ready.zoneOrder[object.owner].graveyard.push(object.id)
      ready.zoneCounts[object.owner].graveyard += 1
      object.zone = 'graveyard'
    }
    const dread = named(ready, 'Yard Return')
    const target = named(ready, 'Target')
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: dread.id,
      castOption: 'flashback',
      sacrifice: ['One', 'Two', 'Three'].map(name => named(ready, name).id),
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    cast.priority = 'p2'
    cast.players.p2.mana.U = 1
    const response = ok(server.rules(cast, {
      type: 'castSpell',
      seat: 'p2',
      objectId: named(cast, 'Cancel').id,
      targets: [{ kind: 'stackItem', stackId: cast.stack.find(item => item.objectId === dread.id)!.id }],
    }))
    const countered = ok(server.rules(response, { type: 'resolveTop' }))
    expect(countered.objects[dread.id].zone).toBe('exile')
  })
})
