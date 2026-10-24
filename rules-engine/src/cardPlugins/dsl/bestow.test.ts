import { expect, test } from 'bun:test'
import { legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { cardTemplate, forest } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import {
  amount,
  bestow,
  card,
  compareAmount,
  compileCardRuleDefinition,
  copy,
  count,
  createDefinitionSnapshot,
  createToken,
  enters,
  ifThen,
  manaCost,
  modifyStats,
  objects,
  payOptional,
  ref,
  resultAmount,
  staticAbility,
  token,
  whenever,
} from './v1'

const snapshot = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const creature = (name = 'Grizzly Bears') => cardTemplate(name, {
  types: ['Creature'],
  power: 2,
  toughness: 2,
})

const bestower = (extra: Parameters<typeof card>[0] = []) => cardTemplate('Bestow fixture', {
  types: ['Enchantment', 'Creature'],
  subtypes: ['Insect', 'Monk'],
  manaCost: '{5}',
  power: 2,
  toughness: 2,
  ruleDefinition: snapshot([
    ...bestow('{1}{G}'),
    staticAbility(modifyStats({
      targets: objects({ zone: 'battlefield', enchantedBy: ref('source') }),
      power: amount(1),
      toughness: amount(1),
    })),
    ...extra,
  ]),
})

const landfallBestower = () => bestower([
  whenever(enters({ filter: { type: 'Land', controller: 'you' } }), {
    instructions: [ifThen(
      compareAmount(count(objects({ zone: 'battlefield', enchantedBy: ref('source'), controller: 'you' })), 'gte', 1),
      {
        then: [payOptional({
          payer: ref('controller'),
          cost: manaCost('{1}{G}'),
          bindResult: 'paidCopy',
          ifPaid: [
            copy({
              targets: objects({ zone: 'battlefield', enchantedBy: ref('source') }),
              bindResult: 'copiedHost',
            }),
            ifThen(compareAmount(resultAmount('copiedHost', 'created'), 'eq', 0), {
              then: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
            }),
          ],
          ifDeclined: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
        })],
        otherwise: [createToken({ count: 1, targets: ref('controller'), token: token('Insect-1-1-G') })],
      },
    )],
  }),
])

const game = (options: { hand?: ReturnType<typeof cardTemplate>[]; battlefield?: ReturnType<typeof cardTemplate>[] }) =>
  createServerGame(commanderRules, {
    hands: { p1: options.hand ?? [] },
    battlefield: { p1: options.battlefield ?? [] },
  }, { random: () => 0.5 })

const named = (state: ReturnType<typeof game>['state'], name: string) =>
  Object.values(state.objects).filter(object => object.name === name)

test('bestow requires a cost', () => {
  expect(() => compileCardRuleDefinition(card([{
    kind: 'static',
    activeIn: ['stack', 'battlefield'],
    effects: [{ kind: 'bestow' } as never],
  }]))).toThrow(/cost/)
})

test('legalActsFor offers a creature cast and a bestowed Aura cast that pays the bestow cost', () => {
  const server = game({ hand: [bestower()], battlefield: [creature()] })
  server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 5 }
  const sourceId = server.state.zoneOrder.p1.hand[0]!
  const target = named(server.state, 'Grizzly Bears')[0]!
  const casts = legalActsFor(server.state, 'p1').filter(
    action => action.kind === 'castSpell' && action.objectId === sourceId,
  )
  const creatureCast = casts.find(action => action.kind === 'castSpell' && action.selectedAlternativeCost === undefined)
  const bestowed = casts.find(action => action.kind === 'castSpell' && action.selectedAlternativeCost === 0)
  expect(creatureCast).toBeDefined()
  expect(creatureCast?.kind === 'castSpell' && creatureCast.targetGroups?.some(group => group.min > 0)).toBe(false)
  expect(bestowed?.kind === 'castSpell' && bestowed.targetGroups?.[0].targets.map(candidate => candidate.objectId)).toContain(target.id)
  const stacked = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
    selectedAlternativeCost: 0,
    targets: [{ kind: 'object', objectId: target.id }],
  }))
  expect(stacked.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 4 })
  expect(stacked.objects[sourceId]).toMatchObject({
    zone: 'stack',
    types: ['Enchantment'],
    subtypes: ['Aura'],
    power: null,
    toughness: null,
  })
  const resolved = resolveStack(server.rules, stacked)
  expect(resolved.objects[sourceId]).toMatchObject({
    zone: 'battlefield',
    types: ['Enchantment'],
    subtypes: ['Aura'],
    attachedTo: target.id,
    power: null,
    toughness: null,
  })
  expect(resolved.objects[target.id]).toMatchObject({ power: 3, toughness: 3 })
})

test('an illegal bestow target makes the spell enter as a creature', () => {
  const server = game({ hand: [bestower()], battlefield: [creature()] })
  server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
  const sourceId = server.state.zoneOrder.p1.hand[0]!
  const target = named(server.state, 'Grizzly Bears')[0]!
  const stacked = ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
    selectedAlternativeCost: 0,
    targets: [{ kind: 'object', objectId: target.id }],
  }))
  const removed = ok(server.rules(stacked, { type: 'move', objectId: target.id, to: 'graveyard' }))
  const resolved = resolveStack(server.rules, removed)
  expect(resolved.objects[sourceId]).toMatchObject({
    zone: 'battlefield',
    types: ['Enchantment', 'Creature'],
    subtypes: ['Insect', 'Monk'],
    attachedTo: null,
    power: 2,
    toughness: 2,
  })
})

test('an unattached bestowed Aura becomes a creature instead of dying', () => {
  const server = game({ hand: [bestower()], battlefield: [creature()] })
  server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
  const sourceId = server.state.zoneOrder.p1.hand[0]!
  const target = named(server.state, 'Grizzly Bears')[0]!
  const attached = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
    selectedAlternativeCost: 0,
    targets: [{ kind: 'object', objectId: target.id }],
  })))
  const moved = ok(server.rules(attached, { type: 'move', objectId: target.id, to: 'graveyard' }))
  expect(moved.objects[sourceId]).toMatchObject({
    zone: 'battlefield',
    types: ['Enchantment', 'Creature'],
    subtypes: ['Insect', 'Monk'],
    attachedTo: null,
    power: 2,
    toughness: 2,
  })
  expect(moved.objects[target.id]).toMatchObject({ zone: 'graveyard', power: 2, toughness: 2 })
})

const playTestLand = (state: ReturnType<typeof game>['state']) => {
  const next = structuredClone(state)
  next.zoneOrder.p1.hand.push('land')
  next.zoneCounts.p1.hand += 1
  next.objects.land = { ...forest(), id: 'land', owner: 'p1', controller: 'p1', zone: 'hand' }
  return next
}

test('landfall copies the attached creature when paid and makes an Insect otherwise', () => {
  const attachedServer = game({ hand: [landfallBestower()], battlefield: [creature()] })
  attachedServer.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
  const sourceId = attachedServer.state.zoneOrder.p1.hand[0]!
  const target = named(attachedServer.state, 'Grizzly Bears')[0]!
  const attached = resolveStack(attachedServer.rules, ok(attachedServer.rules(attachedServer.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
    selectedAlternativeCost: 0,
    targets: [{ kind: 'object', objectId: target.id }],
  })))
  attached.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
  const triggered = ok(attachedServer.rules(playTestLand(attached), { type: 'playLand', seat: 'p1', objectId: 'land' }))
  const choosing = resolveStack(attachedServer.rules, triggered)
  const offer = pendingOptionSelection(choosing, 'p1')!
  const copied = ok(attachedServer.rules(choosing, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: offer.id,
    optionId: 'pay',
  }))
  expect(named(copied, 'Grizzly Bears')).toHaveLength(2)
  expect(named(copied, 'Insect')).toHaveLength(0)
  expect(copied.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })

  const declinedServer = game({ hand: [landfallBestower()], battlefield: [creature()] })
  declinedServer.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 }
  const declinedSource = declinedServer.state.zoneOrder.p1.hand[0]!
  const declinedTarget = named(declinedServer.state, 'Grizzly Bears')[0]!
  const declinedAttached = resolveStack(declinedServer.rules, ok(declinedServer.rules(declinedServer.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: declinedSource,
    selectedAlternativeCost: 0,
    targets: [{ kind: 'object', objectId: declinedTarget.id }],
  })))
  const declinedTrigger = ok(declinedServer.rules(playTestLand(declinedAttached), {
    type: 'playLand',
    seat: 'p1',
    objectId: 'land',
  }))
  const declinedChoice = resolveStack(declinedServer.rules, declinedTrigger)
  const declinedOffer = pendingOptionSelection(declinedChoice, 'p1')!
  const insect = ok(declinedServer.rules(declinedChoice, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: declinedOffer.id,
    optionId: 'decline',
  }))
  expect(named(insect, 'Grizzly Bears')).toHaveLength(1)
  expect(named(insect, 'Insect')).toHaveLength(1)
})

test('unattached landfall skips the copy payment and makes an Insect', () => {
  const server = game({ hand: [landfallBestower()] })
  server.state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 5 }
  const sourceId = server.state.zoneOrder.p1.hand[0]!
  const entered = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'castSpell',
    seat: 'p1',
    objectId: sourceId,
  })))
  const triggered = ok(server.rules(playTestLand(entered), { type: 'playLand', seat: 'p1', objectId: 'land' }))
  const resolved = resolveStack(server.rules, triggered)
  expect(pendingOptionSelection(resolved, 'p1')).toBeUndefined()
  expect(named(resolved, 'Insect')).toHaveLength(1)
})
