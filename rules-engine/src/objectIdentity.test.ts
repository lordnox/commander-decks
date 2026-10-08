import { describe, expect, test } from 'bun:test'
import { card, createDefinitionSnapshot, compileCardRuleDefinition } from './cardPlugins/dsl/v1'
import { cardTemplate, newGame } from './newGame'
import { commanderRules } from './formats'
import { freezeDraft, makeDraft } from './draft'
import { targetObject } from './objectIdentity'
import { projectForViewer } from './runtime'
import { createServerGame } from './runtime'
import { ok } from './testHelpers'
import { activated } from './cardPlugins/activated'
import { staticBoardPump as pumpEffect } from './cardPlugins/effects'
import { pendingSelectionFor } from './rules/selectCards'
import { pendingPlayerSelectionFor } from './rules/selectPlayers'
import { createJournal, recordAccepted, restoreJournal } from './journal'
import { openStackCopyChoice, stackCopy } from './cardPlugins/stackCopy'
import { applyFace } from './plugins/doubleFaced'

describe('rules object identity', () => {
  test('pins targets once and does not rebind them after leave and return', () => {
    const state = newGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: {
        p1: [cardTemplate('Source')],
        p2: [cardTemplate('Target', { types: ['Creature'] })],
      },
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Source')!
    const target = Object.values(state.objects).find((object) => object.name === 'Target')!
    const draft = makeDraft(state)
    const item = draft.addToStack({
      kind: 'ability',
      objectId: source.id,
      controller: 'p1',
      name: source.name,
      targets: [{ kind: 'object', objectId: target.id }],
    })
    const pinned = item.targets[0]
    expect(pinned).toEqual({
      kind: 'object',
      objectId: target.id,
      incarnation: 1,
      zone: 'battlefield',
    })

    draft.move(target.id, 'exile')
    draft.move(target.id, 'battlefield')

    expect(draft.objects[target.id].incarnation).toBe(3)
    expect(pinned.kind === 'object' && targetObject(draft, pinned)).toBeUndefined()
  })

  test('distinguishes reorder and same-zone new-object events while phasing keeps identity', () => {
    const state = newGame(commanderRules, {
      players: ['p1', 'p2'],
      libraries: { p1: [cardTemplate('Top'), cardTemplate('Bottom')] },
      battlefield: { p1: [cardTemplate('Phaser', { types: ['Creature'] })] },
      command: { p1: [cardTemplate('Commander')] },
    })
    const top = Object.values(state.objects).find((object) => object.name === 'Top')!
    const phaser = Object.values(state.objects).find((object) => object.name === 'Phaser')!
    const commander = Object.values(state.objects).find((object) => object.name === 'Commander')!
    const draft = makeDraft(state)

    draft.move(top.id, 'library', 'bottom', 'reorder')
    expect(draft.objects[top.id].incarnation).toBe(1)
    draft.objects[phaser.id].phasedOut = true
    expect(draft.objects[phaser.id].incarnation).toBe(1)
    draft.move(commander.id, 'command', 'bottom', 'newObject')
    expect(draft.objects[commander.id].incarnation).toBe(2)
  })

  test('captures the ability controller separately and refreshes source LKI before departure', () => {
    const state = newGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: { p1: [cardTemplate('Source', { types: ['Creature'], power: 2, toughness: 2 })] },
    })
    const source = Object.values(state.objects)[0]
    const draft = makeDraft(state)
    const liveSource = draft.objects[source.id]
    const item = draft.addTriggeredAbility(liveSource, [])

    liveSource.power = 7
    liveSource.controller = 'p2'
    draft.move(source.id, 'graveyard')

    expect(item.controller).toBe('p1')
    expect(item.execution?.controller).toBe('p1')
    expect(item.execution?.source.information).toBe('lastKnown')
    expect(item.execution?.source.snapshot.power).toBe(7)
    expect(item.execution?.source.snapshot.controller).toBe('p2')
    expect(item.execution?.source.ref).toEqual({
      objectId: source.id,
      incarnation: 1,
      zone: 'battlefield',
    })
  })

  test('serializes definition pins, occurrences, snapshots, and amounts without projecting them', () => {
    const state = newGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: { p1: [cardTemplate('Source')] },
      hands: { p2: [cardTemplate('Private Card')] },
    })
    const source = Object.values(state.objects).find((object) => object.name === 'Source')!
    const privateCard = Object.values(state.objects).find((object) => object.name === 'Private Card')!
    const draft = makeDraft(state)
    const definitionSnapshot = createDefinitionSnapshot(compileCardRuleDefinition(card([])))
    const item = draft.addToStack({
      kind: 'ability',
      objectId: source.id,
      controller: 'p1',
      name: source.name,
      targets: [],
      execution: {
        controller: 'p1',
        source: {
          ref: { objectId: source.id, incarnation: 1, zone: 'battlefield' },
          snapshot: structuredClone(source),
          information: 'current',
        },
        definitionSnapshot,
        declarationPath: '$.abilities[0]',
        occurrence: {
          kind: 'event',
          eventType: 'draw',
          player: 'p2',
          amount: 3,
          object: { before: structuredClone(privateCard) },
        },
      },
      payload: {
        nested: {
          execution: {
            controller: 'p1',
            source: {
              ref: { objectId: source.id, incarnation: 1, zone: 'battlefield' },
              snapshot: { ...structuredClone(source), name: 'Hidden Source Face', faceDown: true },
              information: 'current',
            },
          },
        },
      },
    })
    draft.players.p1.data['kernel.pendingSelection'] = {
      id: 'selection-private-context',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      candidates: [privateCard.id],
      triggerExecution: item.execution,
    }
    const restored = JSON.parse(JSON.stringify(freezeDraft(draft))) as typeof state
    expect(restored.stack[0].execution).toEqual(item.execution)

    const projected = projectForViewer(restored, 'p1')
    expect(projected.stack[0].execution).toBeUndefined()
    const nested = projected.stack[0].payload?.nested as { execution?: unknown } | undefined
    expect(nested?.execution).toBeUndefined()
    expect(pendingSelectionFor(projected, 'p1')?.triggerExecution).toBeUndefined()
    expect(JSON.stringify(projected)).not.toContain('Private Card')
    expect(JSON.stringify(projected)).not.toContain('Hidden Source Face')
    expect(JSON.stringify(projected)).not.toContain('definitionRevision')
  })

  test('a blinked target is not rescued by returning before legacy spell resolution', () => {
    const spell = cardTemplate('Removal', {
      types: ['Sorcery'],
      effects: [{
        op: 'targetedResolve',
        target: 0,
        filter: { zone: 'battlefield', type: 'Creature' },
        action: 'destroy',
      }],
    })
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      hands: { p1: [spell] },
      battlefield: { p2: [cardTemplate('Blinking Bear', { types: ['Creature'] })] },
    })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Removal')!
    const target = Object.values(server.state.objects).find((object) => object.name === 'Blinking Bear')!
    const draft = makeDraft(server.state)
    draft.move(source.id, 'stack')
    draft.addToStack({
      kind: 'spell',
      objectId: source.id,
      controller: 'p1',
      name: source.name,
      targets: [{ kind: 'object', objectId: target.id }],
      castFrom: 'hand',
    })
    let state = freezeDraft(draft)
    state = ok(server.rules(state, { type: 'move', objectId: target.id, to: 'exile' }))
    state = ok(server.rules(state, { type: 'move', objectId: target.id, to: 'battlefield' }))
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(state.objects[target.id].zone).toBe('battlefield')
    expect(state.objects[target.id].incarnation).toBe(3)
  })

  test('an activated ability resolves from LKI for its captured controller', () => {
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: {
        p1: [cardTemplate('Independent Source', {
          types: ['Creature'],
          effects: [{
            op: 'activate',
            id: 'gain',
            costs: {},
            do: [{ kind: 'gainLife', count: 2 }],
          }],
        })],
      },
    }, { random: () => 0.5, cardPlugins: [activated] })
    const source = Object.values(server.state.objects)[0]
    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: source.id,
      abilityId: 'gain',
    }))
    const changedControl = structuredClone(state)
    changedControl.objects[source.id].controller = 'p2'
    state = ok(server.rules(changedControl, {
      type: 'move',
      objectId: source.id,
      to: 'graveyard',
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(state.players.p1.life).toBe(42)
    expect(state.players.p2.life).toBe(40)
  })

  test('a dies trigger captures derived source LKI and the event occurrence', () => {
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: {
        p1: [
          cardTemplate('Static Lord', {
            types: ['Creature'],
            power: 3,
            toughness: 3,
            effects: [pumpEffect(3, 3, ['Creature'])],
          }),
          cardTemplate('Dying Source', {
            types: ['Creature'],
            power: 2,
            toughness: 2,
            effects: [{
              op: 'trigger',
              on: 'dies',
              do: [{ kind: 'gainLife', count: 1 }],
            }],
          }),
        ],
      },
    })
    let state = ok(server.rules(server.state, { type: 'custom', name: 'staticBoardPump.sync' }))
    const source = Object.values(state.objects).find((object) => object.name === 'Dying Source')!
    expect(source.power).toBe(5)

    state = ok(server.rules(state, { type: 'move', objectId: source.id, to: 'graveyard' }))
    const execution = state.stack[0].execution!
    expect(execution.controller).toBe('p1')
    expect(execution.source.information).toBe('lastKnown')
    expect(execution.source.snapshot.power).toBe(5)
    expect(execution.occurrence?.object?.before?.power).toBe(5)
    expect(execution.occurrence?.object?.after).toMatchObject({
      zone: 'graveyard',
      incarnation: 2,
    })
  })

  test('card-target trigger context survives an open choice, journal restore, and source departure', () => {
    const sourceCard = cardTemplate('Choosing Source', {
      types: ['Creature'],
      effects: [{
        op: 'trigger',
        on: 'enters',
        targets: { filter: { zone: 'battlefield', type: 'Creature', other: true } },
        do: [{ kind: 'destroyTargetPermanent', types: ['Creature'] }],
      }],
    })
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      hands: { p1: [sourceCard] },
      battlefield: { p2: [cardTemplate('Chosen Bear', { types: ['Creature'] })] },
    })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Choosing Source')!
    const target = Object.values(server.state.objects).find((object) => object.name === 'Chosen Bear')!
    const enter = { type: 'move' as const, objectId: source.id, to: 'battlefield' as const }
    let state = ok(server.rules(server.state, enter))
    const pending = pendingSelectionFor(state, 'p1')!
    expect(pending.triggerExecution?.occurrence?.object?.after).toMatchObject({
      id: source.id,
      zone: 'battlefield',
      incarnation: 2,
    })

    let journal = createJournal(server.state)
    journal = recordAccepted(journal, enter)
    state = restoreJournal(structuredClone(journal), server.rules).current()
    expect(pendingSelectionFor(state, 'p1')?.triggerExecution).toEqual(pending.triggerExecution)

    let blinked = ok(server.rules(state, { type: 'move', objectId: target.id, to: 'exile' }))
    blinked = ok(server.rules(blinked, { type: 'move', objectId: target.id, to: 'battlefield' }))
    expect(server.rules(blinked, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [target.id],
    })).toMatchObject({ ok: false })

    state = ok(server.rules(state, { type: 'move', objectId: source.id, to: 'graveyard' }))
    const refreshed = pendingSelectionFor(state, 'p1')!
    expect(refreshed.triggerExecution?.source.information).toBe('lastKnown')
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [target.id],
    }))
    expect(state.stack[0].controller).toBe('p1')
    expect(state.stack[0].targets[0]).toMatchObject({
      kind: 'object',
      objectId: target.id,
      incarnation: 1,
      zone: 'battlefield',
    })
    expect(state.stack[0].execution).toEqual(refreshed.triggerExecution)
  })

  test('player-target trigger answers retain the captured controller and occurrence', () => {
    const sourceCard = cardTemplate('Player Choosing Source', {
      types: ['Creature'],
      effects: [{
        op: 'trigger',
        on: 'enters',
        targets: 'opponent',
        do: [{ kind: 'gainLife', count: 1 }],
      }],
    })
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2', 'p3'],
      hands: { p1: [sourceCard] },
    })
    const source = Object.values(server.state.objects)[0]
    let state = ok(server.rules(server.state, {
      type: 'move',
      objectId: source.id,
      to: 'battlefield',
    }))
    const pending = pendingPlayerSelectionFor(state, 'p1')!
    expect(pending.candidates).toEqual(['p2', 'p3'])
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      selectionId: pending.id,
      seat: 'p1',
      players: ['p2'],
    }))
    expect(state.stack[0]).toMatchObject({
      controller: 'p1',
      targets: [{ kind: 'player', player: 'p2' }],
    })
    expect(state.stack[0].execution?.occurrence?.object?.after?.id).toBe(source.id)
  })

  test('a stack copy keeps the original identity pin after the target blinks', () => {
    const server = createServerGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: {
        p1: [cardTemplate('Copy Source')],
        p2: [cardTemplate('Copy Target', { types: ['Creature'] })],
      },
    }, { random: () => 0.5, cardPlugins: [stackCopy] })
    const source = Object.values(server.state.objects).find((object) => object.name === 'Copy Source')!
    const target = Object.values(server.state.objects).find((object) => object.name === 'Copy Target')!
    const draft = makeDraft(server.state)
    const original = draft.addToStack({
      kind: 'ability',
      objectId: source.id,
      controller: 'p1',
      name: source.name,
      targets: [{ kind: 'object', objectId: target.id }],
      payload: {
        instructions: [{ kind: 'destroyTargetPermanent', types: ['Creature'] }],
        targetFilter: { zone: 'battlefield', type: 'Creature' },
      },
    })
    openStackCopyChoice(draft, {
      sourceId: source.id,
      source: source.name,
      seat: 'p1',
      stackId: original.id,
      cost: '{0}',
      optional: true,
    })
    let state = freezeDraft(draft)
    state = ok(server.rules(state, { type: 'move', objectId: target.id, to: 'exile' }))
    state = ok(server.rules(state, { type: 'move', objectId: target.id, to: 'battlefield' }))
    state = ok(server.rules(state, {
      type: 'copyStackItem',
      seat: 'p1',
      sourceId: source.id,
      stackId: original.id,
      accept: true,
    }))
    expect(state.stack[0].targets[0]).toEqual(original.targets[0])
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[target.id]).toMatchObject({ zone: 'battlefield', incarnation: 3 })
  })

  test('phasing and face characteristic changes keep the incarnation', () => {
    const state = newGame(commanderRules, {
      players: ['p1', 'p2'],
      battlefield: {
        p1: [cardTemplate('Changing Object', {
          types: ['Creature'],
          power: 2,
          toughness: 2,
        })],
      },
    })
    const object = Object.values(state.objects)[0]
    const server = createServerGame(commanderRules, { players: ['p1', 'p2'] })
    const phased = ok(server.rules(state, { type: 'phaseOut', objectId: object.id }))
    expect(phased.objects[object.id].incarnation).toBe(1)
    const changed = structuredClone(phased)
    applyFace(changed.objects[object.id], {
      types: ['Creature'],
      subtypes: [],
      supertypes: [],
      manaCost: '',
      manaValue: 0,
      colors: [],
      power: 4,
      toughness: 4,
      oracleText: '',
    })
    expect(changed.objects[object.id].incarnation).toBe(1)
  })
})
