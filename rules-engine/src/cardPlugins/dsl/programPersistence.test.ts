import { describe, expect, test } from 'bun:test'
import {
  ability,
  actions,
  amount,
  card,
  chooseCards,
  chooseModes,
  compileCardRuleDefinition,
  copy,
  createDefinitionSnapshot,
  damage,
  destroy,
  discard,
  draw,
  gainLife,
  keyword,
  mill,
  objects,
  players,
  ref,
  replaceWith,
  replacement,
  select,
  self,
  sequence,
  spell,
  staticAbility,
  target,
  whenever,
  wouldDraw,
} from './v1'
import { commanderRules } from '../../formats'
import { createJournal, recordAccepted, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok, resolveStack } from '../../testHelpers'
import type { EventTrace, GameEvent, GameState, Plugin } from '../../types'
import { answerDiscard, discardThenDrawDefinition, ownDrawStep, pickReplacement } from './dslTestSupport'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const publicBoard = (state: GameState) => ({
  life: Object.fromEntries(state.playerOrder.map((seat) => [seat, state.players[seat].life])),
  stack: state.stack.map((item) => ({
    name: item.name,
    kind: item.kind,
    controller: item.controller,
  })),
  zones: Object.fromEntries(state.playerOrder.map((seat) => [seat, {
    hand: state.zoneOrder[seat].hand.map((id) => state.objects[id].name),
    battlefield: state.zoneOrder[seat].battlefield.map((id) => state.objects[id].name),
    graveyard: state.zoneOrder[seat].graveyard.map((id) => state.objects[id].name),
    library: state.zoneOrder[seat].library.map((id) => state.objects[id].name),
  }])),
})

const applyAndRecord = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  journal: ReturnType<typeof createJournal>,
  event: GameEvent,
) => ({
  state: ok(server.rules(state, event)),
  journal: recordAccepted(journal, event),
})

const resolveStackIntoJournal = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  journal: ReturnType<typeof createJournal>,
) => {
  let current = state
  let currentJournal = journal
  while (
    current.stack.length > 0
    && !current.stack[0].waiting
    && current.resolution?.phase !== 'waiting'
  ) {
    const stepped = applyAndRecord(server, current, currentJournal, { type: 'resolveTop' })
    current = stepped.state
    currentJournal = stepped.journal
  }
  return { state: current, journal: currentJournal }
}

const wallDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  keyword.defender,
  ability.whenever(self.enters, actions.draw.self.one),
])))

const lootDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  spell({
    instructions: [sequence(
      draw({ count: 1, targets: ref('controller') }),
      chooseCards({
        bindChoice: 'discarded',
        chooser: ref('controller'),
        filter: objects({ zone: 'hand', owner: 'you' }),
        count: 1,
      }),
      discard({ by: ref('controller'), targets: { kind: 'choiceRef', binding: 'discarded' } }),
    )],
  }),
])))

const lifeSpellDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  spell({
    instructions: [gainLife({ amount: 1, targets: ref('controller') })],
  }),
])))

const PRIVATE_CONTINUATION = ['pendingTriggers', 'applicationProgram', 'candidateIds'] as const

const roundTrip = (state: GameState) => JSON.parse(JSON.stringify(state)) as GameState

const assertPublicOmitsPrivateContinuation = (
  state: GameState,
  traces: readonly EventTrace[] = [],
) => {
  const traceText = JSON.stringify(traces)
  for (const viewer of ['p1', 'p2', null] as const) {
    const replica = projectForViewer(state, viewer)
    expect('pendingTriggers' in replica).toBe(false)
    expect('eventProcessing' in replica).toBe(false)
    expect('resolution' in replica).toBe(false)
    const text = `${JSON.stringify(replica)}\n${traceText}`
    for (const secret of PRIVATE_CONTINUATION) {
      expect(text).not.toContain(secret)
    }
  }
  expect(pendingSelectionFor(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
  expect(pendingOptionSelection(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
}

const entryDestroyerDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(self.enters, {
    decisions: {
      targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), count: 1 })],
    },
    instructions: [destroy({ targets: target(0) })],
  }),
])))

const optionalDrawToMill = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({ player: players({ relation: 'you' }) }),
    replaceWith(mill({ count: amount(1), targets: ref('event.player') })),
    { optional: true },
  )),
])))

const drawTwoSpell = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  spell({
    instructions: [draw({ count: 2, targets: ref('controller') })],
  }),
])))

const commandPattern = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  spell({
    decisions: { modes: chooseModes({ count: 2 }) },
    modes: [
      {
        decisions: {
          targets: [select({
            filter: objects({
              zone: 'battlefield',
              subtypes: ['Elemental'],
              controller: 'you',
            }),
            count: 1,
          })],
        },
        instructions: [copy({
          targets: target(0),
          controller: ref('controller'),
        })],
      },
      {
        decisions: {
          targets: [select({ filter: players({ relation: 'any' }), count: 1 })],
        },
        instructions: [damage({
          amount: 2,
          source: ref('source'),
          targets: objects({
            zone: 'battlefield',
            type: 'Creature',
            controller: target(0),
          }),
        })],
      },
    ],
  }),
])))

const elementalCopies = (state: GameState) =>
  Object.values(state.objects).filter((object) => object.token && object.name === 'Command Elemental')

describe('programPersistence', () => {
  test('journal restore of an untargeted ruleDefinition spell matches live zones, life, and stack', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Life burst', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: lifeSpellDefinition() })],
      },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'Life burst')
    const journal = createJournal(server.state)
    const cast = applyAndRecord(server, server.state, journal, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellObject.id,
    })
    const finished = resolveStackIntoJournal(server, cast.state, cast.journal)
    const restored = restoreJournal(finished.journal, server.rules).current()
    expect(publicBoard(restored)).toEqual(publicBoard(finished.state))
    expect(restored.players.p1.life).toBe(41)
    expect(restored.stack).toHaveLength(0)
    expect(named(restored, 'Life burst').zone).toBe('graveyard')
  })

  test('journal restore of Wall of Omens ETB draw matches live zones, life, and stack', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      libraries: { p1: [cardTemplate('Omens draw')] },
      hands: {
        p1: [cardTemplate('Wall of Omens', {
          types: ['Creature'],
          power: 0,
          toughness: 4,
          ruleDefinition: wallDefinition(),
        })],
      },
    }, { random: () => 0 })
    const wall = named(server.state, 'Wall of Omens')
    let journal = createJournal(server.state)
    const moved = applyAndRecord(server, server.state, journal, {
      type: 'move',
      objectId: wall.id,
      to: 'battlefield',
    })
    let state = moved.state
    journal = moved.journal
    const order = pendingSelectionFor(state, 'p1')
    if (order?.triggerOrder) {
      const ordered = applyAndRecord(server, state, journal, {
        type: 'selectCards',
        seat: 'p1',
        selectionId: order.id,
        kind: 'choose',
        count: order.count,
        objectIds: order.candidates,
      })
      state = ordered.state
      journal = ordered.journal
    }
    const finished = resolveStackIntoJournal(server, state, journal)
    const restored = restoreJournal(finished.journal, server.rules).current()
    expect(publicBoard(restored)).toEqual(publicBoard(finished.state))
    expect(named(restored, 'Omens draw').zone).toBe('hand')
    expect(named(restored, 'Wall of Omens').zone).toBe('battlefield')
    expect(restored.stack).toHaveLength(0)
  })

  test('JSON reconnect of a Chains discard resumes the same request without leaking private continuation', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: discardThenDrawDefinition() })] },
      hands: { p1: [cardTemplate('Secret Hand')] },
      libraries: { p1: [cardTemplate('Lib A'), cardTemplate('Lib B')] },
    }, { random: () => 0 })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    const pending = pendingSelectionFor(state, 'p1')!
    expect(pending.kind).toBe('discard')
    expect(state.eventProcessing).toBeDefined()

    const restored = JSON.parse(JSON.stringify(state)) as GameState
    const restoredPending = pendingSelectionFor(restored, 'p1')!
    expect(restoredPending.id).toBe(pending.id)
    expect(restoredPending.candidates).toEqual(pending.candidates)

    const replica = projectForViewer(restored, 'p2')
    expect('eventProcessing' in replica).toBe(false)
    expect('provisionalAnnouncement' in replica).toBe(false)
    expect('resolution' in replica).toBe(false)
    expect('deferredEventProcessing' in replica).toBe(false)
    expect(pendingSelectionFor(replica, 'p1')).toBeUndefined()
    const secretId = named(restored, 'Secret Hand').id
    expect(replica.objects[secretId]).toBeUndefined()
    expect(replica.zoneOrder.p1.hand).not.toContain(secretId)
    expect(JSON.stringify(replica)).not.toContain('Secret Hand')

    const answer: GameEvent = {
      type: 'selectCards',
      seat: 'p1',
      selectionId: restoredPending.id,
      kind: 'discard',
      count: 1,
      objectIds: [secretId],
    }
    const stolen = server.rules(restored, { ...answer, seat: 'p2' })
    expect(stolen.ok).toBe(false)

    const finished = ok(server.rules(restored, answer))
    expect(named(finished, 'Secret Hand').zone).toBe('graveyard')
    expect(named(finished, 'Lib A').zone).toBe('hand')
    expect(pendingSelectionFor(finished, 'p1')).toBeUndefined()
    expect(finished.eventProcessing).toBeUndefined()

    const replayed = server.rules(finished, answer)
    expect(replayed.ok).toBe(false)
  })

  test('suspended competing-replacement frame restores and finishes the same zones as a live run', () => {
    const preventDraw: Plugin = {
      id: 'test.preventDraw',
      replace: ({ event }) => (event.type === 'draw' ? null : undefined),
    }
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: discardThenDrawDefinition() })] },
      hands: { p1: [cardTemplate('H')] },
      libraries: { p1: [cardTemplate('L')] },
    }, { random: () => 0, cardPlugins: [preventDraw] })
    let state = ownDrawStep(server.state, 'p1')
    state.drawStepTracking!.actualDraws = { p1: 1 }
    state = ok(server.rules(state, { type: 'draw', seat: 'p1' }))
    expect(pendingOptionSelection(state, 'p1')?.options.length).toBeGreaterThanOrEqual(2)
    expect(state.eventProcessing).toBeDefined()

    const restored = JSON.parse(JSON.stringify(state)) as GameState
    let liveState = pickReplacement(server, state, 'Chains')
    let restoredState = pickReplacement(server, restored, 'Chains')
    expect(pendingSelectionFor(liveState, 'p1')?.kind).toBe('discard')
    expect(pendingSelectionFor(restoredState, 'p1')?.kind).toBe('discard')
    liveState = answerDiscard(server, liveState)
    restoredState = answerDiscard(server, restoredState)
    expect(publicBoard(restoredState)).toEqual(publicBoard(liveState))
    expect(named(restoredState, 'H').zone).toBe(named(liveState, 'H').zone)
  })

  test('restore pins the in-flight ruleDefinition revision against later template mutation', () => {
    const snapshot = lootDefinition()
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Loot spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: snapshot }),
          cardTemplate('Keep me'),
        ],
      },
      libraries: { p1: [cardTemplate('Drawn card')] },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'Loot spell')
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id }))
    const waiting = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(waiting.resolution?.kind).toBe('canonicalSpell')
    if (waiting.resolution?.kind !== 'canonicalSpell') return
    const pin = waiting.resolution.definitionSnapshot
    expect(pin.schemaVersion).toBe(snapshot.schemaVersion)
    expect(pin.definitionRevision).toBe(snapshot.definitionRevision)
    expect(waiting.stack[0]?.execution?.definitionSnapshot?.definitionRevision).toBe(snapshot.definitionRevision)

    const restored = JSON.parse(JSON.stringify(waiting)) as GameState
    expect(restored.resolution?.kind).toBe('canonicalSpell')
    if (restored.resolution?.kind !== 'canonicalSpell') return
    expect(restored.resolution.definitionSnapshot.schemaVersion).toBe(pin.schemaVersion)
    expect(restored.resolution.definitionSnapshot.definitionRevision).toBe(pin.definitionRevision)
    expect(restored.stack[0]?.execution?.definitionSnapshot?.definitionRevision).toBe(pin.definitionRevision)

    const clonedTemplate = structuredClone(snapshot)
    clonedTemplate.definition.abilities = []
    expect(restored.resolution.definitionSnapshot).not.toBe(clonedTemplate)
    expect(restored.resolution.definitionSnapshot.definitionRevision).toBe(pin.definitionRevision)
    expect(restored.resolution.definitionSnapshot.definition.abilities).toHaveLength(snapshot.definition.abilities.length)

    restored.objects[named(restored, 'Loot spell').id].ruleDefinition =
      createDefinitionSnapshot(compileCardRuleDefinition(card([])))

    const pick = pendingSelectionFor(restored, 'p1')!
    const drawn = named(restored, 'Drawn card')
    const finished = ok(server.rules(restored, {
      type: 'selectCards',
      seat: 'p1',
      selectionId: pick.id,
      kind: 'choose',
      count: 1,
      objectIds: [drawn.id],
    }))
    expect(named(finished, 'Drawn card').zone).toBe('graveyard')
    expect(finished.resolution).toBeUndefined()
    expect(finished.stack).toHaveLength(0)
  })

  test('JSON and journal restore of a scenario B ETB selectCards resume the same destroy target', () => {
    const server = createServerGame(commanderRules, {
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
    const creature = named(server.state, 'Entry destroyer')
    const victim = named(server.state, 'Entry victim')
    const journal = createJournal(server.state)
    const cast = applyAndRecord(server, server.state, journal, {
      type: 'castSpell',
      seat: 'p1',
      objectId: creature.id,
    })
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    const entered = ok(resolved)
    const pausedJournal = recordAccepted(cast.journal, { type: 'resolveTop' })
    expect(entered.objects[creature.id].zone).toBe('battlefield')
    expect(entered.stack).toHaveLength(0)
    const targetChoice = pendingSelectionFor(entered, 'p1')!
    expect(targetChoice.canonicalTrigger).toBeDefined()
    expect(targetChoice.candidates).toContain(victim.id)
    assertPublicOmitsPrivateContinuation(entered, resolved.trace)

    const restoredJson = roundTrip(entered)
    const jsonChoice = pendingSelectionFor(restoredJson, 'p1')!
    expect(jsonChoice.id).toBe(targetChoice.id)
    expect(jsonChoice.candidates).toEqual(targetChoice.candidates)

    const restoredJournal = restoreJournal(pausedJournal, server.rules).current()
    const journalChoice = pendingSelectionFor(restoredJournal, 'p1')!
    expect(journalChoice.id).toBe(targetChoice.id)
    expect(journalChoice.candidates).toEqual(targetChoice.candidates)

    const answer: GameEvent = {
      type: 'selectCards',
      seat: 'p1',
      selectionId: jsonChoice.id,
      kind: 'choose',
      count: 1,
      objectIds: [victim.id],
    }
    let live = ok(server.rules(entered, answer))
    let fromJson = ok(server.rules(restoredJson, answer))
    let fromJournal = ok(server.rules(restoredJournal, { ...answer, selectionId: journalChoice.id }))
    live = ok(server.rules(live, { type: 'resolveTop' }))
    fromJson = ok(server.rules(fromJson, { type: 'resolveTop' }))
    fromJournal = ok(server.rules(fromJournal, { type: 'resolveTop' }))
    expect(publicBoard(fromJson)).toEqual(publicBoard(live))
    expect(publicBoard(fromJournal)).toEqual(publicBoard(live))
    expect(named(fromJson, 'Entry victim').zone).toBe('graveyard')
    expect(named(fromJournal, 'Entry victim').zone).toBe('graveyard')
  })

  test('JSON and journal restore of a scenario G mill/draw frame continue the same mid-spell draws', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Draw-to-mill', { types: ['Enchantment'], ruleDefinition: optionalDrawToMill() })],
      },
      hands: {
        p1: [cardTemplate('Draw two spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: drawTwoSpell() })],
      },
      libraries: { p1: [cardTemplate('Milled card'), cardTemplate('Drawn card')] },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'Draw two spell')
    const journal = createJournal(server.state)
    const cast = applyAndRecord(server, server.state, journal, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellObject.id,
    })
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    const paused = ok(resolved)
    const pausedJournal = recordAccepted(cast.journal, { type: 'resolveTop' })
    expect(paused.stack).toHaveLength(1)
    expect(paused.priority).toBeNull()
    expect(paused.eventProcessing).toBeDefined()
    expect(pendingOptionSelection(paused, 'p1')).toBeDefined()
    expect(paused.pendingTriggers ?? []).toHaveLength(0)
    assertPublicOmitsPrivateContinuation(paused, resolved.trace)

    const finishDrawTwo = (state: GameState) => {
      let current = pickReplacement(server, state, 'Draw-to-mill')
      expect(named(current, 'Milled card').zone).toBe('graveyard')
      current = pickReplacement(server, current, 'Decline')
      if (current.objects[spellObject.id].zone === 'stack') {
        current = ok(server.rules(current, { type: 'resolveTop' }))
      }
      return current
    }

    const live = finishDrawTwo(paused)
    const fromJson = finishDrawTwo(roundTrip(paused))
    const fromJournal = finishDrawTwo(restoreJournal(pausedJournal, server.rules).current())
    expect(publicBoard(fromJson)).toEqual(publicBoard(live))
    expect(publicBoard(fromJournal)).toEqual(publicBoard(live))
    expect(named(fromJson, 'Milled card').zone).toBe('graveyard')
    expect(named(fromJson, 'Drawn card').zone).toBe('hand')
    expect(named(fromJournal, 'Drawn card').zone).toBe('hand')
    expect(fromJson.stack).toHaveLength(0)
  })

  test('journal restore of scenario N keeps the copied Elemental and its marked damage', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [cardTemplate('Ashling command', {
          types: ['Sorcery'],
          manaCost: '{0}',
          ruleDefinition: commandPattern(),
        })],
      },
      battlefield: {
        p1: [
          cardTemplate('Command Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
          cardTemplate('Command Bear', { types: ['Creature'], power: 2, toughness: 4 }),
        ],
        p2: [
          cardTemplate('Opposing Elemental', {
            types: ['Creature'],
            subtypes: ['Elemental'],
            power: 3,
            toughness: 3,
          }),
        ],
      },
    }, { random: () => 0 })
    const spellObject = named(server.state, 'Ashling command')
    const elemental = named(server.state, 'Command Elemental')
    const journal = createJournal(server.state)
    const cast = applyAndRecord(server, server.state, journal, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spellObject.id,
      modeIndices: [0, 1],
      targetClauses: [[{ kind: 'object', objectId: elemental.id }], [{ kind: 'player', player: 'p1' }]],
    })
    const resolved = server.rules(cast.state, { type: 'resolveTop' })
    const finished = ok(resolved)
    const finishedJournal = recordAccepted(cast.journal, { type: 'resolveTop' })
    const liveCopies = elementalCopies(finished)
    expect(liveCopies).toHaveLength(1)
    expect(liveCopies[0].damageMarked).toBe(2)
    expect(finished.objects[elemental.id].damageMarked).toBe(2)
    assertPublicOmitsPrivateContinuation(finished, resolved.trace)

    const fromJson = roundTrip(finished)
    const jsonCopies = elementalCopies(fromJson)
    expect(jsonCopies).toHaveLength(1)
    expect(jsonCopies[0].token).toBe(true)
    expect(jsonCopies[0].damageMarked).toBe(2)
    expect(fromJson.objects[elemental.id].damageMarked).toBe(2)
    expect(named(fromJson, 'Command Bear').damageMarked).toBe(2)
    expect(named(fromJson, 'Opposing Elemental').damageMarked ?? 0).toBe(0)

    const fromJournal = restoreJournal(finishedJournal, server.rules).current()
    const journalCopies = elementalCopies(fromJournal)
    expect(publicBoard(fromJournal)).toEqual(publicBoard(finished))
    expect(journalCopies).toHaveLength(1)
    expect(journalCopies[0].token).toBe(true)
    expect(journalCopies[0].damageMarked).toBe(2)
    expect(fromJournal.objects[elemental.id].damageMarked).toBe(2)
  })
})

test.each([
  ['Felidar Guardian', false], ['Felidar Guardian', true],
  ['Restoration Angel', false], ['Restoration Angel', true],
] as const)('catalog targeted optional blink restores both choices for %s with accept=%s', (cardName, accept) => {
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: { p1: [cardTemplate(cardName)] },
    battlefield: {
      p1: [cardTemplate('Friend fixture', { types: [cardName === 'Restoration Angel' ? 'Creature' : 'Artifact'] }), cardTemplate('Another fixture', { types: ['Creature'], power: 1, toughness: 1 }), cardTemplate('Angel fixture', { types: ['Creature'], subtypes: ['Angel'], power: 1, toughness: 1 })],
      p2: [cardTemplate('Opponent fixture', { types: ['Artifact'] })],
    },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.W = 1
  ready.players.p1.mana.C = 3
  const sourceId = named(ready, cardName).id
  const friend = named(ready, 'Friend fixture').id
  const cast = ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: sourceId }))
  const waiting = resolveStack(server.rules, cast)
  const selection = pendingSelectionFor(waiting, 'p1')!
  expect(selection.min).toBe(1)
  expect(selection.candidates).toEqual(expect.arrayContaining([friend, named(waiting, 'Another fixture').id]))
  expect(selection.candidates).not.toContain(sourceId)
  if (cardName === 'Restoration Angel') expect(selection.candidates).not.toContain(named(waiting, 'Angel fixture').id)
  expect(selection.candidates).not.toContain(named(waiting, 'Opponent fixture').id)
  expect(pendingSelectionFor(projectForViewer(waiting, 'p1'), 'p1')).toBeDefined()
  expect(pendingSelectionFor(projectForViewer(waiting, 'p2'), 'p1')).toBeUndefined()
  const restoredTarget = restoreJournal(createJournal(waiting), server.rules).current()
  expect(pendingSelectionFor(restoredTarget, 'p1')!.id).toBe(selection.id)
  expect(server.rules(restoredTarget, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [sourceId] }).ok).toBe(false)
  const selected = ok(server.rules(restoredTarget, { type: 'selectCards', seat: 'p1', selectionId: selection.id, kind: 'choose', count: 1, objectIds: [friend] }))
  const withoutSource = ok(server.rules(selected, { type: 'move', objectId: sourceId, to: 'hand' }))
  const optional = resolveStack(server.rules, withoutSource)
  const pending = pendingOptionSelection(optional, 'p1')!
  expect(optional.objects[friend]!.incarnation).toBe(ready.objects[friend]!.incarnation)
  expect(pending.optionalAction).toBeDefined()
  expect(pendingOptionSelection(projectForViewer(optional, 'p1'), 'p1')).toBeDefined()
  expect(pendingOptionSelection(projectForViewer(optional, 'p2'), 'p1')).toBeUndefined()
  const restoredOptional = restoreJournal(createJournal(optional), server.rules).current()
  expect(pendingOptionSelection(restoredOptional, 'p1')!.id).toBe(pending.id)
  const answer = { type: 'selectOption' as const, seat: 'p1', selectionId: pending.id, optionId: pending.options[accept ? 0 : 1]!.id }
  const finished = ok(server.rules(restoredOptional, answer))
  expect(finished.objects[friend]).toMatchObject({ zone: 'battlefield', incarnation: ready.objects[friend]!.incarnation + (accept ? 2 : 0), owner: 'p1', controller: 'p1' })
  expect(finished.objects[sourceId]!.zone).toBe('hand')
  expect(finished.resolution).toBeUndefined()
  expect(finished.stack).toHaveLength(0)
  expect(server.rules(finished, answer).ok).toBe(false)
})
