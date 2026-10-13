import { describe, expect, test } from 'bun:test'
import {
  ability,
  actions,
  card,
  chooseCards,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  discard,
  draw,
  gainLife,
  keyword,
  objects,
  ref,
  self,
  sequence,
  spell,
} from './v1'
import { commanderRules } from '../../formats'
import { createJournal, recordAccepted, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { ok } from '../../testHelpers'
import type { GameEvent, GameState, Plugin } from '../../types'
import {
  answerDiscard,
  chainsDefinition,
  ownDrawStep,
  pickReplacement,
} from './dslTestSupport'

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

describe('Rule DSL Part 15 persistence (new-format evidence)', () => {
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
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
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
      battlefield: { p1: [cardTemplate('Chains', { types: ['Enchantment'], ruleDefinition: chainsDefinition() })] },
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
})
