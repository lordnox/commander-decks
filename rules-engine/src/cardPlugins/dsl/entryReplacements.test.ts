import { describe, expect, test } from 'bun:test'
import {
  card,
  amount, captureAmount, characteristic, choice as chosenObjects, chooseCards, gainLife, ref, resultAmount, self, whenever,
  compareAmount, count, objects,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  replacement,
  staticAbility,
  wouldEnter,
  modifyEvent,
  asThisEntersChooseColor,
  asThisEntersPayLifeOrTap,
  DECLINE_LIFE_OPTION,
  PAY_LIFE_OPTION,
  redirectEvent, suppressEvent,
} from './v1'
import { resolveStack } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { emptyMana } from '../../draft'
import type { Amount } from './schema/v1'
import type { GameState, Plugin, ReduceResult } from '../../types'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('entryReplacements', () => {

  test('self-entry replacements suspend before the battlefield move commits', () => {
    const toExile: Plugin = {
      id: 'test.selfToExile',
      replace: ({ event, rule }) => (
        event.type === 'move' && event.to === 'battlefield' && event.objectId === rule.sourceId
          ? { ...event, to: 'exile' as const }
          : undefined
      ),
    }
    const toGrave: Plugin = {
      id: 'test.selfToGrave',
      replace: ({ event, rule }) => (
        event.type === 'move' && event.to === 'battlefield' && event.objectId === rule.sourceId
          ? { ...event, to: 'graveyard' as const }
          : undefined
      ),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Self Entry', { types: ['Creature'] })] },
      builtinRules: commanderRules.rules,
    }, { random: () => 0, cardPlugins: [toExile, toGrave] })
    const permanentId = server.state.zoneOrder.p1.hand[0]!
    let state = ok(server.rules(server.state, { type: 'addRule', pluginId: 'test.selfToExile', sourceId: permanentId }))
    state = ok(server.rules(state, { type: 'addRule', pluginId: 'test.selfToGrave', sourceId: permanentId }))
    state = ok(server.rules(state, { type: 'move', objectId: permanentId, to: 'battlefield' }))
    expect(state.objects[permanentId].zone).not.toBe('battlefield')
    expect(state.eventProcessing?.originalEvent).toMatchObject({ type: 'move', objectId: permanentId })
    const pending = pendingOptionSelection(state, 'p1')!
    const exileRule = state.rules.find((rule) => rule.pluginId === 'test.selfToExile' && rule.sourceId === permanentId)!
    state = ok(server.rules(state, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: exileRule.instanceId,
    }))
    expect(state.objects[permanentId].zone).toBe('exile')
  })

  test('self-entry color choice applies prospectively before the battlefield move commits', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(asThisEntersChooseColor()),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Color chooser', { types: ['Creature'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: creature.id, to: 'battlefield' }))
    expect(paused.objects[creature.id].zone).not.toBe('battlefield')
    expect(paused.priority).toBeNull()
    const pending = pendingOptionSelection(paused, 'p1')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    const entered = ok(server.rules(paused, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'R',
    }))
    expect(entered.objects[creature.id].zone).toBe('battlefield')
    expect(entered.objects[creature.id].chosenColor).toBe('R')
    expect(entered.eventProcessing).toBeUndefined()
  })

  test('a later entry replacement can still prevent the committed object', () => {
    const chooser = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(asThisEntersChooseColor()),
    ])))
    const exile = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(replacement(wouldEnter({ object: { type: 'Creature' } }), redirectEvent('exile'))),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('No creatures', { types: ['Enchantment'], ruleDefinition: exile })] },
      hands: { p1: [cardTemplate('Color chooser', { types: ['Creature'], ruleDefinition: chooser })] },
    }, { random: () => 0 })
    const creature = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, { type: 'move', objectId: creature.id, to: 'battlefield' }))
    const pending = pendingOptionSelection(paused, 'p1')!
    const finished = ok(server.rules(paused, {
      type: 'selectOption',
      seat: 'p1',
      selectionId: pending.id,
      optionId: 'W',
    }))
    expect(finished.objects[creature.id].zone).toBe('exile')
    expect(finished.objects[creature.id].chosenColor).toBe('W')
  })

  test('self-entry color choice is offered to the prospective controller', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(asThisEntersChooseColor()),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Color chooser', { types: ['Artifact'], ruleDefinition: definition })] },
    }, { random: () => 0 })
    const artifact = Object.values(server.state.objects).find((object) => object.name === 'Color chooser')!
    const paused = ok(server.rules(server.state, {
      type: 'move',
      objectId: artifact.id,
      to: 'battlefield',
      controller: 'p2',
    }))
    expect(pendingOptionSelection(paused, 'p1')).toBeUndefined()
    expect(paused.objects[artifact.id].zone).toBe('hand')
    const restored = JSON.parse(JSON.stringify(paused)) as GameState
    const pending = pendingOptionSelection(restored, 'p2')!
    expect(pending.action.kind).toBe('replacementProgramChoice')
    const entered = ok(server.rules(restored, {
      type: 'selectOption',
      seat: 'p2',
      selectionId: pending.id,
      optionId: 'U',
    }))
    expect(entered.objects[artifact.id]).toMatchObject({
      zone: 'battlefield',
      controller: 'p2',
      chosenColor: 'U',
    })
  })
})


test.each(['playLand', 'move', 'castSpell'] as const)('%s applies a self-entry replacement before entry', (eventType) => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }))),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Entry fixture', { types: [eventType === 'castSpell' ? 'Artifact' : 'Land'], manaCost: '{0}', ruleDefinition: definition })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const entered = eventType === 'castSpell'
    ? resolveStack(server.rules, ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId })))
    : ok(server.rules(server.state, eventType === 'playLand'
    ? { type: 'playLand', seat: 'p1', objectId }
    : { type: 'move', objectId, to: 'battlefield' }))
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(entered.players.p1.landsPlayed).toBe(eventType === 'playLand' ? 1 : 0)
  expect(entered.stack).toEqual([])
})

const shockLand = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(asThisEntersPayLifeOrTap(2)),
])))

const playShockLand = (life = 40) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Shock fixture', { types: ['Land'], subtypes: ['Island', 'Swamp'], ruleDefinition: shockLand() })] },
  }, { random: () => 0 })
  server.state.players.p1.life = life
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const paused = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
  return { server, objectId, paused }
}

const chooseShock = (paused: GameState, optionId: string, server: ReturnType<typeof createServerGame>) => {
  const restored = JSON.parse(JSON.stringify(paused)) as GameState
  const choice = pendingOptionSelection(restored, 'p1')!
  return ok(server.rules(restored, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: choice.id,
    optionId,
  }))
}

test('paying the printed life as a land enters leaves it untapped', () => {
  const { server, objectId, paused } = playShockLand()
  expect(paused.objects[objectId].zone).toBe('hand')
  expect(paused.priority).toBeNull()
  expect(paused.players.p1.landsPlayed).toBe(1)
  const pending = pendingOptionSelection(paused, 'p1')!
  expect(pending.action.kind).toBe('replacementProgramChoice')
  expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
  const entered = chooseShock(paused, PAY_LIFE_OPTION, server)
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: false })
  expect(entered.players.p1.life).toBe(38)
  expect(entered.players.p1.landsPlayed).toBe(1)
  expect(pendingOptionSelection(entered, 'p1')).toBeUndefined()
})

test('declining the printed life as a land enters taps it', () => {
  const { server, objectId, paused } = playShockLand()
  const entered = chooseShock(paused, DECLINE_LIFE_OPTION, server)
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(entered.players.p1.life).toBe(40)
})

test('choosing to pay without enough life still taps the land', () => {
  const { server, objectId, paused } = playShockLand(1)
  const entered = chooseShock(paused, PAY_LIFE_OPTION, server)
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: true })
  expect(entered.players.p1.life).toBe(1)
})

test('a move uses the same pay-life or tap replacement as a land drop', () => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Shock fixture', { types: ['Land'], ruleDefinition: shockLand() })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const paused = ok(server.rules(server.state, { type: 'move', objectId, to: 'battlefield' }))
  expect(paused.objects[objectId].zone).not.toBe('battlefield')
  const entered = chooseShock(paused, PAY_LIFE_OPTION, server)
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', tapped: false })
  expect(entered.players.p1.life).toBe(38)
  expect(entered.players.p1.landsPlayed).toBe(0)
})

test('land entry choice restores before committing the move without spending a second land play', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(asThisEntersChooseColor()),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Entry fixture', { types: ['Land'], ruleDefinition: definition })] },
  }, { random: () => 0 })
  const objectId = server.state.zoneOrder.p1.hand[0]!
  const paused = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId }))
  expect(paused.objects[objectId].zone).toBe('hand')
  expect(paused.priority).toBeNull()
  expect(paused.players.p1.landsPlayed).toBe(1)
  const restored = JSON.parse(JSON.stringify(paused)) as GameState
  const choice = pendingOptionSelection(restored, 'p1')!
  const entered = ok(server.rules(restored, { type: 'selectOption', seat: 'p1', selectionId: choice.id, optionId: 'G' }))
  expect(entered.objects[objectId]).toMatchObject({ zone: 'battlefield', chosenColor: 'G' })
  expect(entered.players.p1.landsPlayed).toBe(1)
  expect(pendingOptionSelection(entered, 'p1')).toBeUndefined()
})

test.each([0, 1, 2, 3])('conditional entry counts other controlled lands prospectively (%s)', lands => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(replacement(wouldEnter(), modifyEvent({ tapped: true }), {
      when: compareAmount(count(objects({ zone: 'battlefield', type: 'Land', controller: 'you', other: true })), 'gte', 2),
    })),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Entry fixture', { types: ['Land'], ruleDefinition: definition })] },
    battlefield: { p1: [cardTemplate('Foreign land', { types: ['Land'] })], p2: Array.from({ length: lands }, (_, i) => cardTemplate(`Own land ${i}`, { types: ['Land'] })) },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  const state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield', controller: 'p2' }))
  expect(state.objects[id]?.tapped).toBe(lands >= 2)
  expect(state.objects[id]?.controller).toBe('p2')
})

test.each(['reveal', 'decline', 'none'])('optional hand reveal resolves before entry and keeps unchosen cards private (%s)', mode => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate('Choked Estuary'), cardTemplate('Secret fixture', { types: ['Land'], subtypes: mode === 'none' ? ['Forest'] : ['Island'] }), cardTemplate('Other secret', { types: ['Instant'] })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  const eligible = server.state.zoneOrder.p1.hand[1]!
  let state = ok(server.rules(server.state, { type: 'playLand', seat: 'p1', objectId: id }))
  if (mode !== 'none') {
    expect(state.objects[id]?.zone).toBe('hand')
    expect(Object.values(server.project(state, 'p2').objects).some(object => object.name === 'Secret fixture')).toBe(false)
    const pick = pendingSelectionFor(state, 'p1')!
    expect(pick.candidates).toEqual([eligible])
    const answer = { type: 'selectCards' as const, seat: 'p1', selectionId: pick.id, kind: 'choose' as const, count: pick.count, objectIds: mode === 'reveal' ? [eligible] : [] }
    const direct = ok(server.rules(state, answer))
    state = ok(server.rules(JSON.parse(JSON.stringify(state)), answer))
    expect(state).toEqual(direct)
  }
  expect(state.objects[id]?.zone).toBe('battlefield')
  expect(state.objects[id]?.tapped).toBe(mode !== 'reveal')
  expect(state.objects[eligible]?.zone).toBe('hand')
  if (mode === 'reveal') expect(state.objects[eligible]?.knownTo).toEqual(state.playerOrder)
  expect(state.log.some(line => line.includes('reveals') && line.includes('Secret fixture'))).toBe(mode === 'reveal')
  expect(Object.values(server.project(state, 'p2').objects).some(object => object.name === 'Other secret')).toBe(false)
})

test('entry counters combine with the move payload before entry observers and state-based actions', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(replacement(wouldEnter(), modifyEvent({ enterCounters: { '+1/+1': amount(2) } }))),
    whenever(self.enters, { instructions: [gainLife({ targets: ref('controller'), amount: characteristic(ref('triggering.object.after'), 'power', { information: 'currentOrLastKnown' }) })] }),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2, hands: { p1: [cardTemplate('Counter entry fixture', { types: ['Creature'], power: 0, toughness: 0, ruleDefinition: definition })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield', enterCounters: { '+1/+1': 3 } }))
  expect(state.objects[id]).toMatchObject({ zone: 'battlefield', power: 5, toughness: 5, counters: { '+1/+1': 5 } })
  state = resolveStack(server.rules, JSON.parse(JSON.stringify(state)))
  expect(state.players.p1.life).toBe(45)
})

test('replacement choices can capture a numeric result for entry counters before the permanent enters', () => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(replacement(wouldEnter(), modifyEvent({}), { program: [
      chooseCards({ chooser: ref('controller'), filter: objects({ zone: 'hand', other: true }), bindChoice: 'chosen', min: 0, max: 2 }),
      captureAmount({ amount: count(objects({ zone: 'hand', among: chosenObjects('chosen') })), bindResult: 'entryCount' }),
      modifyEvent({ enterCounters: { charge: resultAmount('entryCount') } }),
      modifyEvent({ enterCounters: { charge: amount(1) } }),
    ] })),
  ])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Result entry', { types: ['Artifact'], ruleDefinition: definition }), cardTemplate('First choice'), cardTemplate('Second choice')] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
  const pick = pendingSelectionFor(state, 'p1')!
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: pick.count, objectIds: pick.candidates }))
  expect(state.objects[id]?.counters.charge).toBe(3)
})

test.each([false, true])('deferred entry procedures preserve choices when eligible cards disappear (%s)', removeEligible => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [cardTemplate('Choked Estuary'), cardTemplate('Choked Estuary'), cardTemplate('Eligible Island', { types: ['Land'], subtypes: ['Island'] })] },
  }, { random: () => 0 })
  const [first, second, island] = server.state.zoneOrder.p1.hand
  let state = ok(server.rules(server.state, { type: 'move', objectId: first!, to: 'battlefield' }))
  const firstPick = pendingSelectionFor(state, 'p1')!
  state = ok(server.rules(state, { type: 'move', objectId: second!, to: 'battlefield' }))
  expect(pendingSelectionFor(state, 'p1')?.id).toBe(firstPick.id)
  if (removeEligible) state = ok(server.rules(state, { type: 'move', objectId: island!, to: 'graveyard' }))
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: firstPick.id, kind: 'choose', count: firstPick.count, objectIds: removeEligible ? [] : [island!] }))
  expect(state.objects[first!]?.zone).toBe('battlefield')
  const secondPick = pendingSelectionFor(state, 'p1')!
  expect(secondPick.sourceId).toBe(second)
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectCards', seat: 'p1', selectionId: secondPick.id, kind: 'choose', count: secondPick.count, objectIds: [] }))
  expect(state.objects[first!]?.tapped).toBe(removeEligible)
  expect(state.objects[second!]?.tapped).toBe(true)
  expect(state.eventProcessing).toBeUndefined()
  expect(state.deferredEventProcessing).toBeUndefined()
})


test.each(['redirect', 'prevent'] as const)('entry counters do not leak onto a %s entry', outcome => {
  const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(replacement(wouldEnter(), modifyEvent({ enterCounters: { charge: amount(2) } }))),
    staticAbility(replacement(wouldEnter(), outcome === 'redirect' ? redirectEvent('exile') : suppressEvent())),
    whenever(self.enters, { instructions: [gainLife({ targets: ref('controller'), amount: amount(1) })] }),
  ])))
  const server = createServerGame(commanderRules, { hands: { p1: [cardTemplate('Competing entry fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.hand[0]!
  let state = ok(server.rules(server.state, { type: 'move', objectId: id, to: 'battlefield' }))
  const pick = pendingOptionSelection(state, 'p1')!
  expect(pick).toBeDefined()
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'selectOption', seat: 'p1', selectionId: pick.id, optionId: pick.options[0]!.id }))
  expect(state.objects[id]?.zone).toBe(outcome === 'redirect' ? 'exile' : 'hand')
  expect(state.objects[id]?.counters).toEqual({})
  expect(state.stack).toEqual([])
})

test('entry counter transforms validate amounts and reject unbound replacement results', () => {
  const invalidCounters: Readonly<Record<string, Amount>>[] = [{ '': amount(1) }, { charge: amount(-1) }, { charge: resultAmount('missing') }]
  for (const enterCounters of invalidCounters) {
    expect(() => compileCardRuleDefinition(card([staticAbility(replacement(wouldEnter(), modifyEvent({ enterCounters })))]))).toThrow()
  }
})

describe('catalog Sea Gate, Reborn pay-life-or-tap back face', () => {
  const SEA_GATE = 'Sea Gate Restoration // Sea Gate, Reborn'
  const game = () => createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate(SEA_GATE)] },
  }, { random: () => 0.5 })
  type Server = ReturnType<typeof game>
  const seaGate = (state: GameState) => Object.values(state.objects).find((object) => object.name === SEA_GATE)!
  const play = (server: Server, state = server.state) =>
    ok(server.rules(state, { type: 'playLand', seat: 'p1', objectId: seaGate(state).id }))
  const choose = (server: Server, state: GameState, optionId: string) => {
    const pending = pendingOptionSelection(state, 'p1')!
    return ok(server.rules(state, { type: 'selectOption', seat: 'p1', selectionId: pending.id, optionId }))
  }
  const withLife = (server: Server, life: number) => {
    const state = structuredClone(server.state)
    state.players.p1.life = life
    return state
  }

  test('as a land you may pay exactly 3 life to have it untapped, and it taps for {U}', () => {
    const server = game()
    const asked = play(server)
    const pending = pendingOptionSelection(asked, 'p1')!
    expect(pending).toMatchObject({ source: SEA_GATE })
    expect(pending.prompt).toContain('pay 3 life')
    expect(pending.options.map((option) => option.id)).toEqual([PAY_LIFE_OPTION, DECLINE_LIFE_OPTION])
    const settled = choose(server, asked, PAY_LIFE_OPTION)
    expect(settled.players.p1.life).toBe(server.state.players.p1.life - 3)
    expect(seaGate(settled)).toMatchObject({ types: ['Land'], tapped: false })
    const mana = ok(server.rules(settled, { type: 'tapForMana', seat: 'p1', objectId: seaGate(settled).id }))
    expect(mana.players.p1.mana).toEqual({ ...emptyMana(), U: 1 })
  })

  test('declining the payment enters it tapped and costs no life', () => {
    const server = game()
    const declined = choose(server, play(server), DECLINE_LIFE_OPTION)
    expect(seaGate(declined).tapped).toBe(true)
    expect(declined.players.p1.life).toBe(server.state.players.p1.life)
  })

  test('at 2 life the 3-life payment is not possible, so the land enters tapped', () => {
    const server = game()
    const settled = choose(server, play(server, withLife(server, 2)), PAY_LIFE_OPTION)
    expect(settled.players.p1.life).toBe(2)
    expect(seaGate(settled).tapped).toBe(true)
  })

  test('at exactly 3 life the 3-life payment is allowed, and it costs the game', () => {
    const server = game()
    const settled = choose(server, play(server, withLife(server, 3)), PAY_LIFE_OPTION)
    expect(settled.players.p1.life).toBe(0)
    expect(settled.players.p1.lost).toBe(true)
  })
})
