import { expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { goadTarget, goadTargetUntilEot } from '../cardPlugins/effectBuilders'
import { goadPermanent, goadUntilEndOfTurn } from '../cardPlugins/continuousEffects'
import { runInstructions } from '../cardPlugins/effects'
import { eventsForCombatDeclaration } from '../actions'
import { legalDefendersForAttacker, isGoaded } from '../plugins/goad'
import { rules } from '../kernel'
import { makeDraft } from '../draft'
import { cardTemplate } from '../newGame'
import { bears, newGame } from '../testGame'
import { combat } from '../plugins/combat'
import { continuousEffects } from '../cardPlugins/continuousEffects'
import { turnStructure } from '../plugins/turnStructure'

const combatCatalog = () => createCatalog([turnStructure, continuousEffects, combat])

const fictional = (name: string, controller: 'p1' | 'p2' | 'p3' | 'p4' = 'p2') => ({
  ...bears(),
  name,
  controller,
  owner: controller,
  summoningSickness: false,
})

test('goaded creature attacks a player other than the goading player', () => {
  const catalog = combatCatalog()
  const state = newGame({
    players: 4,
    battlefield: {
      p2: [fictional('Forced Marauder', 'p2')],
    },
    builtinRules: ['combat', 'continuousEffects'],
  })
  const marauder = Object.values(state.objects).find((o) => o.name === 'Forced Marauder')!
  goadPermanent(marauder, 'p1')
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'

  const legal = rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: marauder.id, defender: 'p3' }],
  }, catalog)
  expect(legal.ok).toBe(true)

  const atGoader = rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: marauder.id, defender: 'p1' }],
  }, catalog)
  expect(atGoader.ok).toBe(false)
})

test('goaded creature may attack the goading player when no other player is legal', () => {
  const catalog = combatCatalog()
  const state = newGame({
    players: 4,
    battlefield: { p2: [fictional('Last Option', 'p2')] },
    builtinRules: ['combat', 'continuousEffects'],
  })
  state.players.p3.lost = true
  state.players.p4.lost = true
  const creature = Object.values(state.objects)[0]
  goadPermanent(creature, 'p1')
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'

  const result = rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: creature.id, defender: 'p1' }],
  }, catalog)
  expect(result.ok).toBe(true)
})

test('goaded creature must attack if able', () => {
  const catalog = combatCatalog()
  const state = newGame({
    players: 4,
    battlefield: {
      p2: [fictional('Obliged Raider', 'p2'), fictional('Idle Scout', 'p2')],
    },
    builtinRules: ['combat', 'continuousEffects'],
  })
  const raider = Object.values(state.objects).find((o) => o.name === 'Obliged Raider')!
  goadPermanent(raider, 'p1')
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'

  const skip = rules(state, { type: 'declareAttackers', seat: 'p2', attackers: [] }, catalog)
  expect(skip.ok).toBe(false)

  const scout = Object.values(state.objects).find((o) => o.name === 'Idle Scout')!
  const partial = rules(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: scout.id, defender: 'p3' }],
  }, catalog)
  expect(partial.ok).toBe(false)
})

test('goad does not follow a new object after a zone change', () => {
  const catalog = combatCatalog()
  const state = newGame({
    players: 4,
    battlefield: { p2: [fictional('Blinked Goad', 'p2')] },
    builtinRules: ['combat', 'continuousEffects'],
  })
  const original = Object.values(state.objects)[0]
  goadPermanent(original, 'p1')
  const blinked = rules(state, { type: 'move', objectId: original.id, to: 'exile' }, catalog)
  expect(blinked.ok).toBe(true)
  if (!blinked.ok) return
  const replacementId = `o${blinked.state.nextId}`
  blinked.state.nextId += 1
  blinked.state.objects[replacementId] = {
    ...cardTemplate('Blinked Goad', { types: ['Creature'], power: 2, toughness: 2 }),
    id: replacementId,
    owner: 'p2',
    controller: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSickness: false,
    damageMarked: 0,
    counters: {},
    attachedTo: null,
    attacking: null,
    blocking: null,
    grantedRules: [],
    token: false,
    tags: [],
    loyaltyActivatedTurn: null,
    oracleText: '',
    manaCost: '',
    manaValue: 0,
    colors: [],
    subtypes: [],
    supertypes: [],
    printedLoyalty: null,
    printedDefense: null,
  }
  blinked.state.zoneOrder.p2.battlefield.push(replacementId)
  const replacement = blinked.state.objects[replacementId]
  expect(isGoaded(replacement)).toBe(false)
})

test('until end of turn goad expires during cleanup', () => {
  const catalog = combatCatalog()
  const state = newGame({
    players: 4,
    battlefield: { p2: [fictional('Temporary Goad', 'p2')] },
    builtinRules: ['turnStructure', 'continuousEffects', 'combat'],
  })
  const creature = Object.values(state.objects)[0]
  goadUntilEndOfTurn(creature, 'p1')
  expect(creature.continuousEffects).toHaveLength(1)

  const cleaned = rules(
    { ...state, step: 'end' },
    { type: 'advanceStep' },
    catalog,
  )
  expect(cleaned.ok).toBe(true)
  if (!cleaned.ok) return
  expect(cleaned.state.objects[creature.id].continuousEffects).toBeUndefined()
})

test('goadTargets instruction stamps goad from the resolving source controller', () => {
  const state = newGame({ players: 4, builtinRules: ['continuousEffects'] })
  const draft = makeDraft(state)
  const sourceId = draft.allocId('obj')
  const targetId = draft.allocId('obj')
  draft.objects[sourceId] = {
    ...cardTemplate('Goad Cantrip', { types: ['Instant'] }),
    id: sourceId,
    owner: 'p1',
    controller: 'p1',
    zone: 'stack',
    tapped: false,
    summoningSickness: false,
    damageMarked: 0,
    counters: {},
    attachedTo: null,
    attacking: null,
    blocking: null,
    grantedRules: [],
    token: false,
    tags: [],
    loyaltyActivatedTurn: null,
    oracleText: '',
    manaCost: '{U}',
    manaValue: 1,
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    printedLoyalty: null,
    printedDefense: null,
  }
  draft.objects[targetId] = {
    ...cardTemplate('Victim', { types: ['Creature'], power: 3, toughness: 3 }),
    id: targetId,
    owner: 'p2',
    controller: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSickness: false,
    damageMarked: 0,
    counters: {},
    attachedTo: null,
    attacking: null,
    blocking: null,
    grantedRules: [],
    token: false,
    tags: [],
    loyaltyActivatedTurn: null,
    oracleText: '',
    manaCost: '{2}',
    manaValue: 2,
    colors: [],
    subtypes: [],
    supertypes: [],
    printedLoyalty: null,
    printedDefense: null,
  }
  draft.zoneOrder.p2.battlefield.push(targetId)

  runInstructions(
    draft,
    draft.objects[sourceId],
    [goadTarget()],
    {
      id: 'stack-1',
      kind: 'spell',
      objectId: sourceId,
      controller: 'p1',
      name: 'Goad Cantrip',
      targets: [{ kind: 'object', objectId: targetId }],
    },
  )

  const victim = draft.objects[targetId]
  expect(victim.continuousEffects).toHaveLength(1)
  expect(victim.continuousEffects?.[0].effect).toEqual({
    kind: 'goad',
    sourceController: 'p1',
  })
  expect(victim.continuousEffects?.[0].duration).toEqual({ kind: 'permanent' })

  runInstructions(
    draft,
    draft.objects[sourceId],
    [goadTargetUntilEot()],
    {
      id: 'stack-2',
      kind: 'spell',
      objectId: sourceId,
      controller: 'p1',
      name: 'Goad Cantrip',
      targets: [{ kind: 'object', objectId: targetId }],
    },
  )
  expect(victim.continuousEffects).toHaveLength(2)
  expect(victim.continuousEffects?.some(
    ({ duration }) => duration.kind === 'untilCleanup',
  )).toBe(true)
})

test('host combat declaration rejects illegal goad targets', () => {
  const state = newGame({
    players: 4,
    battlefield: { p2: [fictional('Host Check', 'p2')] },
    builtinRules: ['combat', 'continuousEffects'],
  })
  const creature = Object.values(state.objects)[0]
  goadPermanent(creature, 'p1')
  state.active = 'p2'
  state.priority = 'p2'
  state.step = 'declareAttackers'

  expect(legalDefendersForAttacker(state, creature).some(
    (target) => target.kind === 'player' && target.player === 'p1',
  )).toBe(false)

  expect(eventsForCombatDeclaration(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: creature.id, defender: 'p1' }],
  })).toBeNull()

  expect(eventsForCombatDeclaration(state, {
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: creature.id, defender: 'p3' }],
  })).toEqual([{
    type: 'declareAttackers',
    seat: 'p2',
    attackers: [{ objectId: creature.id, defender: 'p3' }],
  }])
})
