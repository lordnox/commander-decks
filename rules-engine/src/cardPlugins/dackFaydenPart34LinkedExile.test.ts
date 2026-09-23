import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { EMBALM_ABILITY_ID } from './embalm.test'
import { activated } from './activated'
import { cardDefinition, effectsFor } from './cardRules'
import { exilePayoffs } from './exilePayoffs'
import { linkedExile } from './linkedExile'
import { missingCardPlugins } from './index'

const plugins = [activated, exilePayoffs, linkedExile]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const fromPool = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra, effects: effectsFor(name) })

const moveToGraveyard = (state: GameState, name: string) => {
  const object = named(state, name)
  state.zoneOrder[object.owner][object.zone] = state.zoneOrder[object.owner][object.zone]
    .filter((id) => id !== object.id)
  state.zoneCounts[object.owner][object.zone] -= 1
  state.zoneOrder[object.owner].graveyard.push(object.id)
  state.zoneCounts[object.owner].graveyard += 1
  object.zone = 'graveyard'
}

const enterAndLinkExile = (
  server: ReturnType<typeof createServerGame>,
  sourceId: string,
  seat: 'p1' | 'p2',
  targetIds: string[],
) => {
  let state = resolveStack(server.rules, ok(server.rules(server.state, {
    type: 'move',
    objectId: sourceId,
    to: 'battlefield',
  })))
  const pick = pendingSelectionFor(state, seat)
  if (pick) {
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat,
      kind: 'choose',
      count: pick.count,
      objectIds: targetIds,
    }))
    state = resolveStack(server.rules, state)
  }
  return state
}

const part34Registered = [
  'Angel of Sanctions',
  'Banisher Priest',
  'Bishop of Binding',
  'Fiend Hunter',
  'Glorious Protector',
  'Lumbering Battlement',
  'Palace Jailer',
  'Werefox Bodyguard',
]

const part34GapCards = [
  'Abdel Adrian, Gorion\'s Ward',
  'Angel of Serenity',
  'Constricting Sliver',
  'Driftgloom Coyote',
] as const

describe('Dack Fayden part 34 — assignment checklist (gaps)', () => {
  test.each(part34GapCards)('%s is not registered until Pass 1 adds missing builders', (name) => {
    expect(effectsFor(name)).toEqual([])
    expect(cardDefinition(name)).toBeUndefined()
  })

  test('Constricting Sliver — GAP: granted enters triggers do not stamp linkedExileUntilLeaves on Slivers', () => {
    expect(effectsFor('Constricting Sliver')).toEqual([])
  })

  test('Abdel Adrian, Gorion\'s Ward — GAP: no createToken-per-linked-exile-count instruction', () => {
    expect(effectsFor('Abdel Adrian, Gorion\'s Ward')).toEqual([])
  })

  test('Angel of Serenity — GAP: linkExile is battlefield-only; Oracle needs graveyard zones and hand return', () => {
    expect(effectsFor('Angel of Serenity')).toEqual([])
  })

  test('Driftgloom Coyote — GAP: no +1/+1 when exiled creature power ≤ 2', () => {
    expect(effectsFor('Driftgloom Coyote')).toEqual([])
  })

  test('Lumbering Battlement — GAP: TargetFilter has no nontoken; tokens wrongly appear as link-exile candidates', () => {
    const battlement = fromPool('Lumbering Battlement', { controller: 'p1' })
    const token = cardTemplate('Battlement Token', { types: ['Creature'], controller: 'p1', token: true })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [battlement] }, battlefield: { p1: [token] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const battlementId = named(server.state, 'Lumbering Battlement').id
    const tokenId = named(server.state, 'Battlement Token').id
    const state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: battlementId,
      to: 'battlefield',
    })))
    const candidates = pendingSelectionFor(state, 'p1')?.candidates ?? []
    expect(candidates).toContain(tokenId)
  })
})

describe('Dack Fayden part 34 — linked exile cages', () => {
  test('registered part-34 cards are in the card pool table', () => {
    expect(missingCardPlugins(part34Registered)).toEqual([])
    for (const name of part34Registered) {
      expect(cardDefinition(name)?.effects.length).toBeGreaterThan(0)
    }
  })

  test('Fiend Hunter exiles on ETB and returns the hostage when it dies', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Caged Prey', { types: ['Creature'], power: 3, toughness: 3, controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Caged Prey').id

    let state = enterAndLinkExile(server, hunterId, 'p1', [preyId])
    expect(state.objects[preyId]).toMatchObject({ zone: 'exile', exiledWith: hunterId })

    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'graveyard' }))
    expect(state.objects[preyId]).toMatchObject({
      zone: 'battlefield',
      controller: state.objects[preyId].owner,
    })
  })

  test('Fiend Hunter returns the hostage when blinked off the battlefield', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Blink Prey', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Blink Prey').id

    let state = enterAndLinkExile(server, hunterId, 'p1', [preyId])
    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'hand' }))
    expect(state.objects[preyId].zone).toBe('battlefield')
  })

  test('Banisher Priest cages on ETB and returns the creature when the Priest leaves', () => {
    const priest = fromPool('Banisher Priest', { controller: 'p1' })
    const foe = cardTemplate('Opponent Bear', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [priest] }, battlefield: { p2: [foe] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const priestId = named(server.state, 'Banisher Priest').id
    const foeId = named(server.state, 'Opponent Bear').id

    let state = enterAndLinkExile(server, priestId, 'p1', [foeId])
    expect(state.objects[foeId].zone).toBe('exile')

    state = ok(server.rules(state, { type: 'sacrifice', objectId: priestId }))
    expect(state.objects[foeId].zone).toBe('battlefield')
  })

  test('Angel of Sanctions optional ETB may exile zero permanents', () => {
    const angel = fromPool('Angel of Sanctions', { controller: 'p1' })
    const relic = cardTemplate('Opponent Relic', { types: ['Artifact'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [angel] }, battlefield: { p2: [relic] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const angelId = named(server.state, 'Angel of Sanctions').id
    const relicId = named(server.state, 'Opponent Relic').id
    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: angelId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[relicId].zone).toBe('battlefield')
  })

  test('Angel of Sanctions cages on ETB and returns the permanent when it leaves', () => {
    const angel = fromPool('Angel of Sanctions', { controller: 'p1' })
    const relic = cardTemplate('Sanctions Relic', { types: ['Artifact'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [angel] }, battlefield: { p2: [relic] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const angelId = named(server.state, 'Angel of Sanctions').id
    const relicId = named(server.state, 'Sanctions Relic').id
    let state = enterAndLinkExile(server, angelId, 'p1', [relicId])
    expect(state.objects[relicId]).toMatchObject({ zone: 'exile', exiledWith: angelId })
    state = ok(server.rules(state, { type: 'move', objectId: angelId, to: 'graveyard' }))
    expect(state.objects[relicId].zone).toBe('battlefield')
  })

  test('Angel of Sanctions embalms from the graveyard', () => {
    const angel = fromPool('Angel of Sanctions', { controller: 'p1', colors: ['W'], manaCost: '{3}{W}{W}' })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [angel] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    moveToGraveyard(state, 'Angel of Sanctions')
    state.players.p1.mana.W = 6
    const source = named(state, 'Angel of Sanctions')
    expect(legalActsFor(state, 'p1').some((action) =>
      action.kind === 'activateAbility'
      && action.objectId === source.id
      && action.abilityId === EMBALM_ABILITY_ID)).toBe(true)
    state = ok(server.rules(state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: source.id,
      abilityId: EMBALM_ABILITY_ID,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.zoneOrder.p1.battlefield).toHaveLength(1)
    const token = state.objects[state.zoneOrder.p1.battlefield[0]]
    expect(token).toMatchObject({ name: 'Angel of Sanctions', token: true, subtypes: ['Zombie'] })
  })

  test('Glorious Protector exiles your non-Angel creatures and returns them when it leaves', () => {
    const protector = fromPool('Glorious Protector', {
      controller: 'p1',
      subtypes: ['Angel', 'Cleric'],
    })
    const ally = cardTemplate('Protector Ally', { types: ['Creature'], controller: 'p1' })
    const angelBuddy = cardTemplate('Protector Angel Buddy', {
      types: ['Creature'],
      subtypes: ['Angel'],
      controller: 'p1',
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [protector] }, battlefield: { p1: [ally, angelBuddy] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const protectorId = named(server.state, 'Glorious Protector').id
    const allyId = named(server.state, 'Protector Ally').id
    const angelId = named(server.state, 'Protector Angel Buddy').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: protectorId,
      to: 'battlefield',
    })))
    const candidates = pendingSelectionFor(state, 'p1')?.candidates ?? []
    expect(candidates).toContain(allyId)
    expect(candidates).not.toContain(angelId)
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [allyId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[allyId].zone).toBe('exile')
    expect(state.objects[angelId].zone).toBe('battlefield')

    state = ok(server.rules(state, { type: 'move', objectId: protectorId, to: 'hand' }))
    expect(state.objects[allyId].zone).toBe('battlefield')
  })

  test('Palace Jailer becomes monarch and exiles until an opponent takes the crown', () => {
    const jailer = fromPool('Palace Jailer', { controller: 'p1' })
    const hostage = cardTemplate('Jail Hostage', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 3, hands: { p1: [jailer] }, battlefield: { p2: [hostage] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const jailerId = named(server.state, 'Palace Jailer').id
    const hostageId = named(server.state, 'Jail Hostage').id

    let state = enterAndLinkExile(server, jailerId, 'p1', [hostageId])
    expect(state.monarch).toBe('p1')
    expect(state.objects[hostageId]).toMatchObject({
      zone: 'exile',
      exiledUntilOpponentMonarch: true,
    })

    state = ok(server.rules(state, { type: 'becomeMonarch', seat: 'p2' }))
    expect(state.objects[hostageId].zone).toBe('battlefield')
  })

  test('Bishop of Binding pumps a target at attack time from linked exile power', () => {
    const bishop = fromPool('Bishop of Binding', {
      controller: 'p1',
      power: 1,
      toughness: 1,
      oracleText: 'Haste',
    })
    const vampire = cardTemplate('Vampire Recruit', {
      types: ['Creature'],
      subtypes: ['Vampire'],
      controller: 'p1',
      power: 2,
      toughness: 2,
    })
    const foe = cardTemplate('Tall Foe', { types: ['Creature'], power: 6, toughness: 6, controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [bishop] },
        battlefield: { p1: [vampire], p2: [foe] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const bishopId = named(server.state, 'Bishop of Binding').id
    const foeId = named(server.state, 'Tall Foe').id
    const vampireId = named(server.state, 'Vampire Recruit').id

    let state = enterAndLinkExile(server, bishopId, 'p1', [foeId])
    state.objects[bishopId].summoningSickness = false
    state.active = 'p1'
    state.priority = 'p1'
    state.step = 'declareAttackers'

    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: bishopId, defender: 'p2' }],
    }))
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [vampireId],
    }))
    state = resolveStack(server.rules, state)
    expect(state.objects[vampireId]).toMatchObject({ power: 8, toughness: 8 })
  })

  test('Lumbering Battlement grows for nontoken linked exiles and releases them when it leaves', () => {
    const battlement = fromPool('Lumbering Battlement', { controller: 'p1', power: 4, toughness: 5 })
    const ally = cardTemplate('Battlement Ally', { types: ['Creature'], controller: 'p1' })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [battlement] }, battlefield: { p1: [ally] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const battlementId = named(server.state, 'Lumbering Battlement').id
    const allyId = named(server.state, 'Battlement Ally').id

    let state = enterAndLinkExile(server, battlementId, 'p1', [allyId])
    expect(state.objects[battlementId]).toMatchObject({ power: 6, toughness: 7 })

    state = ok(server.rules(state, { type: 'sacrifice', objectId: battlementId }))
    expect(state.objects[allyId].zone).toBe('battlefield')
  })

  test('Werefox Bodyguard may exile zero or one non-Fox creature', () => {
    const fox = fromPool('Werefox Bodyguard', { controller: 'p1', subtypes: ['Fox', 'Elf', 'Knight'] })
    const mark = cardTemplate('Werefox Mark', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [fox] }, battlefield: { p2: [mark] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const foxId = named(server.state, 'Werefox Bodyguard').id
    const markId = named(server.state, 'Werefox Mark').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: foxId,
      to: 'battlefield',
    })))
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(state.objects[markId].zone).toBe('battlefield')
  })

  test('link-exile target selection is visible only to the choosing seat after projection', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Hidden Prey', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    expect(pendingSelectionFor(entered, 'p1')?.candidates.length).toBeGreaterThan(0)
    const p1View = server.project(entered, 'p1')
    const p2View = server.project(entered, 'p2')
    expect(pendingSelectionFor(p1View, 'p1')?.candidates.length).toBeGreaterThan(0)
    expect(pendingSelectionFor(p2View, 'p2')).toBeUndefined()
  })

  test('host restart preserves an open link-exile target choice', () => {
    const hunter = fromPool('Fiend Hunter', { controller: 'p1' })
    const prey = cardTemplate('Restart Prey', { types: ['Creature'], controller: 'p2' })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [hunter] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Restart Prey').id
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: hunterId,
      to: 'battlefield',
    })))
    const before = pendingSelectionFor(entered, 'p1')
    expect(before).toBeDefined()
    const restarted = structuredClone(entered)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(before?.id)
    const finished = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [preyId],
    }))
    expect(finished.objects[preyId].zone).toBe('exile')
  })
})
