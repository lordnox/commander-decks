import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  linkExile,
  objects,
  ref,
  returnLinkedExile,
  select,
  self,
  target,
  whenever,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const compileCreature = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const durationCage = () => cardTemplate('Cage Cleric', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
  ruleDefinition: compileCreature([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), count: 1 })] },
      instructions: [linkExile({ targets: target(0), untilSourceLeaves: true })],
    }),
  ]),
})

const handReturnCage = () => cardTemplate('Hand Vault', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
  ruleDefinition: compileCreature([
    whenever(self.enters, {
      decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), count: 1 })] },
      instructions: [linkExile({ targets: target(0), untilSourceLeaves: true, returnTo: 'hand' })],
    }),
  ]),
})

const pairedWarden = () => cardTemplate('Paired Warden', {
  types: ['Creature'],
  power: 2,
  toughness: 2,
  ruleDefinition: compileCreature([
    whenever(self.enters, {
      decisions: { targets: [select({
        filter: objects({ zone: 'battlefield', type: 'Creature', other: true }),
        min: 0,
        max: 1,
      })] },
      instructions: [linkExile({ targets: target(0) })],
    }),
    whenever(self.leaves, { instructions: [returnLinkedExile()] }),
  ]),
})

const enterAndChoose = (
  server: ReturnType<typeof createServerGame>,
  sourceId: string,
  targetIds: string[],
  count = 1,
) => {
  const entered = ok(server.rules(server.state, { type: 'move', objectId: sourceId, to: 'battlefield' }))
  expect(pendingSelectionFor(entered, 'p1')).toBeDefined()
  return ok(server.rules(entered, {
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count,
    objectIds: targetIds,
  }))
}

describe('linkExile until source leaves', () => {
  test('a sacrifice returns the hostage immediately with an empty stack', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [durationCage()] },
      battlefield: { p2: [cardTemplate('Hostage Beast', { types: ['Creature'], power: 2, toughness: 2 })] },
    }, { random: () => 0.5 })
    const cageId = named(server.state, 'Cage Cleric').id
    const hostageId = named(server.state, 'Hostage Beast').id
    const resolved = resolveStack(server.rules, enterAndChoose(server, cageId, [hostageId]))
    expect(resolved.objects[hostageId]).toMatchObject({ zone: 'exile', exiledWith: cageId })
    expect(resolved.objects[cageId].exiledCards).toEqual([hostageId])
    expect(resolved.objects[cageId].returnLinkedExile).toBe('battlefield')

    const sacrificed = ok(server.rules(resolved, { type: 'sacrifice', objectId: cageId }))
    expect(sacrificed.stack).toHaveLength(0)
    expect(sacrificed.objects[hostageId]).toMatchObject({
      zone: 'battlefield',
      controller: sacrificed.objects[hostageId].owner,
    })
    expect(sacrificed.objects[hostageId].exiledWith).toBeUndefined()
  })

  test('a source can return linked cards to their owners hands when it leaves', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [handReturnCage()] },
      battlefield: { p2: [cardTemplate('Hand Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const sourceId = named(server.state, 'Hand Vault').id
    const preyId = named(server.state, 'Hand Prey').id
    const resolved = resolveStack(server.rules, enterAndChoose(server, sourceId, [preyId]))

    const sacrificed = ok(server.rules(resolved, { type: 'sacrifice', objectId: sourceId }))
    expect(sacrificed.stack).toHaveLength(0)
    expect(sacrificed.objects[preyId]).toMatchObject({ zone: 'hand', owner: 'p2' })
    expect(sacrificed.objects[preyId].exiledWith).toBeUndefined()
  })

  test('a source that already left does not exile its chosen target', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [durationCage()] },
      battlefield: { p2: [cardTemplate('Fleeing Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const cageId = named(server.state, 'Cage Cleric').id
    const preyId = named(server.state, 'Fleeing Prey').id
    const targeted = enterAndChoose(server, cageId, [preyId])
    expect(targeted.stack).toHaveLength(1)
    expect(targeted.objects[preyId].zone).toBe('battlefield')

    const left = ok(server.rules(targeted, { type: 'move', objectId: cageId, to: 'graveyard' }))
    const resolved = resolveStack(server.rules, left)
    expect(resolved.objects[preyId].zone).toBe('battlefield')
    expect(resolved.objects[preyId].exiledWith).toBeUndefined()
  })

  test('the compiler rejects player recipients', () => {
    expect(() => compileCardRuleDefinition(card([
      whenever(self.enters, { instructions: [linkExile({ targets: ref('controller'), untilSourceLeaves: true })] }),
    ]))).toThrow()
  })
})

describe('returnLinkedExile as a separate leave trigger', () => {
  test('the leave trigger returns the hostage from the stack', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [pairedWarden()] },
      battlefield: { p2: [cardTemplate('Caged Prey', { types: ['Creature'], power: 3, toughness: 3 })] },
    }, { random: () => 0.5 })
    const wardenId = named(server.state, 'Paired Warden').id
    const preyId = named(server.state, 'Caged Prey').id
    const resolved = resolveStack(server.rules, enterAndChoose(server, wardenId, [preyId]))
    expect(resolved.objects[preyId]).toMatchObject({ zone: 'exile', exiledWith: wardenId })

    const left = ok(server.rules(resolved, { type: 'move', objectId: wardenId, to: 'graveyard' }))
    expect(left.stack).toHaveLength(1)
    expect(left.objects[preyId].zone).toBe('exile')

    const returned = resolveStack(server.rules, left)
    expect(returned.objects[preyId]).toMatchObject({
      zone: 'battlefield',
      controller: returned.objects[preyId].owner,
    })
  })

  test('a source that leaves before its entry resolves still exiles permanently', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [pairedWarden()] },
      battlefield: { p2: [cardTemplate('Kept Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const wardenId = named(server.state, 'Paired Warden').id
    const preyId = named(server.state, 'Kept Prey').id
    const targeted = enterAndChoose(server, wardenId, [preyId])
    expect(targeted.stack).toHaveLength(1)

    const left = ok(server.rules(targeted, { type: 'move', objectId: wardenId, to: 'hand' }))
    expect(left.stack.length).toBeGreaterThanOrEqual(2)
    expect(left.objects[preyId].zone).toBe('battlefield')

    const resolved = resolveStack(server.rules, left)
    expect(resolved.objects[preyId].zone).toBe('exile')
    expect(resolved.objects[preyId].exiledWith).toBe(wardenId)
  })

  test('optional link exile may choose zero targets', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [pairedWarden()] },
      battlefield: { p2: [cardTemplate('Marked Prey', { types: ['Creature'] })] },
    }, { random: () => 0.5 })
    const wardenId = named(server.state, 'Paired Warden').id
    const markId = named(server.state, 'Marked Prey').id
    const skipped = enterAndChoose(server, wardenId, [])
    expect(skipped.objects[markId].zone).toBe('battlefield')
  })
})


test('a sacrificed activated source returns its linked creature after leaving', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Endless Sands'), cardTemplate('Stored creature', { types: ['Creature'], power: 2, toughness: 2 })] },
  }, { random: () => 0 })
  const source = named(server.state, 'Endless Sands').id
  const creature = named(server.state, 'Stored creature').id
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 6
  const exiled = resolveStack(server.rules, ok(server.rules(ready, {
    type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[1]', targets: [{ kind: 'object', objectId: creature }],
  })))
  expect(exiled.objects[creature]).toMatchObject({ zone: 'exile', exiledWith: source })
  const opponentsTurn = structuredClone(exiled)
  opponentsTurn.active = 'p2'
  opponentsTurn.priority = 'p1'
  opponentsTurn.step = 'declareAttackers'
  opponentsTurn.players.p1.mana.C = 4
  opponentsTurn.objects[source].tapped = false
  const announced = ok(server.rules(opponentsTurn, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[2]' }))
  expect(announced.objects[source].zone).toBe('graveyard')
  expect(announced.objects[creature].zone).toBe('exile')
  const returned = resolveStack(server.rules, announced)
  expect(returned.objects[creature]).toMatchObject({ zone: 'battlefield', controller: 'p1' })
  expect(returned.objects[source].zone).toBe('graveyard')
})

test('a creature moved away in response to Endless Sands is not linked or returned', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Endless Sands'), cardTemplate('Response target', { types: ['Creature'] })] },
  }, { random: () => 0 })
  server.state.players.p1.mana.C = 6
  const source = named(server.state, 'Endless Sands').id
  const targetId = named(server.state, 'Response target').id
  const announced = ok(server.rules(server.state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: source,
    abilityId: '$.abilities[1]',
    targets: [{ kind: 'object', objectId: targetId }],
  }))
  const moved = ok(server.rules(announced, { type: 'move', objectId: targetId, to: 'graveyard' }))
  const resolved = resolveStack(server.rules, moved)

  expect(resolved.objects[targetId]).toMatchObject({ zone: 'graveyard' })
  expect(resolved.objects[targetId].exiledWith).toBeUndefined()
  expect(resolved.objects[source].exiledCards ?? []).toEqual([])
})


test.each([0, 1, 2, 3])('linked exile accepts up to three graveyard targets across owners (%s chosen)', count => {
  const source = cardTemplate('Graveyard linker', {
    types: ['Land'],
    ruleDefinition: compileCreature([
      whenever(self.enters, {
        decisions: { targets: [select({ filter: objects({ zone: 'graveyard' }), min: 0, max: 3 })] },
        instructions: [linkExile({ targets: target(0) })],
      }),
    ]),
  })
  const server = createServerGame(commanderRules, {
    hands: { p1: [source] },
    libraries: {
      p1: [cardTemplate('Owned graveyard card', { zone: 'graveyard' })],
      p2: [cardTemplate('Other graveyard card', { zone: 'graveyard' }), cardTemplate('Third graveyard card', { zone: 'graveyard' })],
    },
  }, { random: () => 0.5 })
  const sourceId = named(server.state, 'Graveyard linker').id
  const candidates = [...server.state.zoneOrder.p1.graveyard, ...server.state.zoneOrder.p2.graveyard]
  const targets = candidates.slice(0, count)
  const resolved = resolveStack(server.rules, enterAndChoose(server, sourceId, targets, 3))
  expect(resolved.objects[sourceId].exiledCards ?? []).toEqual(targets)
  for (const id of candidates) {
    expect(resolved.objects[id].zone).toBe(targets.includes(id) ? 'exile' : 'graveyard')
    expect(resolved.objects[id].exiledWith).toBe(targets.includes(id) ? sourceId : undefined)
  }
})

/**
 * Catalog integrations: each card resolves its canonical catalog definition by
 * name, while hostages and bystanders stay exchangeable fixtures.
 */
describe('catalog linked-exile integrations', () => {
  const hostage = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
    cardTemplate(name, { types: ['Creature'], ...extra })

  const catalogGame = (setup: Parameters<typeof createServerGame>[1]) =>
    createServerGame(commanderRules, setup, { random: () => 0.5 })

  const choose = (server: ReturnType<typeof createServerGame>, state: GameState, objectIds: string[]) => {
    const pick = pendingSelectionFor(state, 'p1')!
    return ok(server.rules(state, {
      type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'choose', count: pick.count, objectIds,
    }))
  }

  /** Moves the catalog source onto the battlefield and answers its typed pick, if any. */
  const enterCatalog = (server: ReturnType<typeof createServerGame>, sourceId: string, targetIds: string[]) => {
    const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: sourceId, to: 'battlefield' })))
    return pendingSelectionFor(state, 'p1') ? resolveStack(server.rules, choose(server, state, targetIds)) : state
  }

  test('catalog Fiend Hunter exiles on entry and its leave trigger returns the hostage under its owner after it dies', () => {
    const server = catalogGame({
      players: 2,
      hands: { p1: [cardTemplate('Fiend Hunter')] },
      battlefield: { p2: [hostage('Caged Prey', { power: 3, toughness: 3 })] },
    })
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Caged Prey').id

    let state = enterCatalog(server, hunterId, [preyId])
    expect(state.objects[preyId]).toMatchObject({ zone: 'exile', exiledWith: hunterId })

    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'graveyard' }))
    expect(state.stack).toHaveLength(1)
    expect(state.objects[preyId].zone).toBe('exile')
    state = resolveStack(server.rules, state)
    expect(state.objects[preyId]).toMatchObject({
      zone: 'battlefield',
      controller: state.objects[preyId].owner,
    })
  })

  test('catalog Fiend Hunter returns the hostage when it is bounced off the battlefield', () => {
    const server = catalogGame({
      players: 2,
      hands: { p1: [cardTemplate('Fiend Hunter')] },
      battlefield: { p2: [hostage('Blink Prey')] },
    })
    const hunterId = named(server.state, 'Fiend Hunter').id
    const preyId = named(server.state, 'Blink Prey').id

    let state = enterCatalog(server, hunterId, [preyId])
    state = ok(server.rules(state, { type: 'move', objectId: hunterId, to: 'hand' }))
    expect(state.stack).toHaveLength(1)
    expect(state.objects[preyId].zone).toBe('exile')
    state = resolveStack(server.rules, state)
    expect(state.objects[preyId].zone).toBe('battlefield')
  })

  test('catalog Banisher Priest cages on entry and the creature returns when the Priest is sacrificed', () => {
    const server = catalogGame({
      players: 2,
      hands: { p1: [cardTemplate('Banisher Priest')] },
      battlefield: { p2: [hostage('Opponent Bear')] },
    })
    const priestId = named(server.state, 'Banisher Priest').id
    const foeId = named(server.state, 'Opponent Bear').id

    let state = enterCatalog(server, priestId, [foeId])
    expect(state.objects[foeId].zone).toBe('exile')

    state = ok(server.rules(state, { type: 'sacrifice', objectId: priestId }))
    expect(state.objects[foeId].zone).toBe('battlefield')
  })

  /** Angel of Sanctions targets on announcement; "you may" is answered at resolution. */
  const sanctionsEntry = (server: ReturnType<typeof createServerGame>, angelId: string, relicId: string, accept: boolean) => {
    const entered = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: angelId, to: 'battlefield' })))
    const targeted = resolveStack(server.rules, choose(server, entered, [relicId]))
    const option = pendingOptionSelection(targeted, 'p1')!
    expect(option).toBeDefined()
    return resolveStack(server.rules, ok(server.rules(targeted, {
      type: 'selectOption', seat: 'p1', selectionId: option.id, optionId: option.options[accept ? 0 : 1].id,
    })))
  }

  test('catalog Angel of Sanctions optional entry may exile zero permanents', () => {
    const server = catalogGame({
      players: 2,
      hands: { p1: [cardTemplate('Angel of Sanctions')] },
      battlefield: { p2: [cardTemplate('Opponent Relic', { types: ['Artifact'] })] },
    })
    const angelId = named(server.state, 'Angel of Sanctions').id
    const relicId = named(server.state, 'Opponent Relic').id
    // The target is chosen when the trigger is put on the stack; declining "you may" exiles nothing.
    const entered = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: angelId, to: 'battlefield' })))
    expect(server.rules(entered, {
      type: 'selectCards', seat: 'p1', selectionId: pendingSelectionFor(entered, 'p1')!.id, kind: 'choose', count: 1, objectIds: [],
    }).ok).toBe(false)
    const state = sanctionsEntry(server, angelId, relicId, false)
    expect(state.objects[relicId].zone).toBe('battlefield')
    expect(state.objects[relicId].exiledWith).toBeUndefined()
  })

  test('catalog Angel of Sanctions cages a nonland permanent on entry and returns it when the Angel dies', () => {
    const server = catalogGame({
      players: 2,
      hands: { p1: [cardTemplate('Angel of Sanctions')] },
      battlefield: { p2: [cardTemplate('Sanctions Relic', { types: ['Artifact'] })] },
    })
    const angelId = named(server.state, 'Angel of Sanctions').id
    const relicId = named(server.state, 'Sanctions Relic').id
    let state = sanctionsEntry(server, angelId, relicId, true)
    expect(state.objects[relicId]).toMatchObject({ zone: 'exile', exiledWith: angelId })
    state = ok(server.rules(state, { type: 'move', objectId: angelId, to: 'graveyard' }))
    expect(state.objects[relicId].zone).toBe('battlefield')
  })

  test('catalog Glorious Protector exiles only your non-Angel creatures and returns them when it is bounced', () => {
    const server = catalogGame({
      hands: { p1: [cardTemplate('Glorious Protector')] },
      battlefield: { p1: [hostage('Protector Ally'), hostage('Protector Angel Buddy', { subtypes: ['Angel'] })] },
    })
    const protectorId = named(server.state, 'Glorious Protector').id
    const allyId = named(server.state, 'Protector Ally').id
    const angelId = named(server.state, 'Protector Angel Buddy').id

    let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: protectorId, to: 'battlefield' })))
    const candidates = pendingSelectionFor(state, 'p1')?.candidates ?? []
    expect(candidates).toContain(allyId)
    expect(candidates).not.toContain(angelId)
    state = resolveStack(server.rules, choose(server, state, [allyId]))
    expect(state.objects[allyId].zone).toBe('exile')
    expect(state.objects[angelId].zone).toBe('battlefield')

    state = ok(server.rules(state, { type: 'move', objectId: protectorId, to: 'hand' }))
    expect(state.objects[allyId].zone).toBe('battlefield')
  })

  // Formerly a GAP characterization (the legacy TargetFilter had no nontoken, so
  // the audited source asserted the token WAS a candidate). The canonical catalog
  // definition filters `token: false` since cadbdb5a, so the gap is closed and this
  // asserts the Oracle behavior instead.
  test('catalog Lumbering Battlement offers only nontoken creatures as link-exile candidates (former GAP closed)', () => {
    const server = catalogGame({
      hands: { p1: [cardTemplate('Lumbering Battlement')] },
      battlefield: { p1: [hostage('Battlement Token', { token: true }), hostage('Battlement Ally')] },
    })
    const battlementId = named(server.state, 'Lumbering Battlement').id
    const tokenId = named(server.state, 'Battlement Token').id
    const allyId = named(server.state, 'Battlement Ally').id
    const state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: battlementId, to: 'battlefield' })))
    const candidates = pendingSelectionFor(state, 'p1')?.candidates ?? []
    expect(candidates).toContain(allyId)
    expect(candidates).not.toContain(tokenId)
    expect(server.rules(state, {
      type: 'selectCards', seat: 'p1', selectionId: pendingSelectionFor(state, 'p1')!.id, kind: 'choose', count: 1, objectIds: [tokenId],
    }).ok).toBe(false)
  })

  test('catalog Lumbering Battlement grows +2/+2 per linked exile and releases it when sacrificed', () => {
    const server = catalogGame({
      hands: { p1: [cardTemplate('Lumbering Battlement', { power: 4, toughness: 5 })] },
      battlefield: { p1: [hostage('Battlement Ally')] },
    })
    const battlementId = named(server.state, 'Lumbering Battlement').id
    const allyId = named(server.state, 'Battlement Ally').id

    let state = enterCatalog(server, battlementId, [allyId])
    expect(state.objects[battlementId]).toMatchObject({ power: 6, toughness: 7 })

    state = ok(server.rules(state, { type: 'sacrifice', objectId: battlementId }))
    expect(state.objects[allyId].zone).toBe('battlefield')
  })

  test('catalog Werefox Bodyguard may exile zero non-Fox creatures', () => {
    const server = catalogGame({
      players: 2,
      hands: { p1: [cardTemplate('Werefox Bodyguard')] },
      battlefield: { p2: [hostage('Werefox Mark')] },
    })
    const foxId = named(server.state, 'Werefox Bodyguard').id
    const markId = named(server.state, 'Werefox Mark').id
    const state = choose(server, resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move', objectId: foxId, to: 'battlefield',
    }))), [])
    expect(state.objects[markId].zone).toBe('battlefield')
  })

  test('catalog All-Fates Stalker cages a non-Assassin until it is sacrificed', () => {
    const server = catalogGame({
      players: 3,
      hands: { p1: [cardTemplate('All-Fates Stalker')] },
      battlefield: { p2: [hostage('Caged Bear', { power: 3, toughness: 3 })] },
    })
    const stalkerId = named(server.state, 'All-Fates Stalker').id
    const bearId = named(server.state, 'Caged Bear').id
    const entered = ok(server.rules(server.state, { type: 'move', objectId: stalkerId, to: 'battlefield' }))
    const resolved = resolveStack(server.rules, choose(server, entered, [bearId]))
    expect(resolved.objects[bearId]).toMatchObject({ zone: 'exile', exiledWith: stalkerId })
    const sacrificed = resolveStack(server.rules, ok(server.rules(resolved, { type: 'sacrifice', objectId: stalkerId })))
    expect(sacrificed.objects[bearId].zone).toBe('battlefield')
  })

  test('catalog Alabaster Host Intercessor exiles an opponent creature until it leaves', () => {
    const server = catalogGame({
      players: 3,
      hands: { p1: [cardTemplate('Alabaster Host Intercessor')] },
      battlefield: { p2: [hostage('Fixture Hostage', { power: 2, toughness: 2 })] },
    })
    const intercessorId = named(server.state, 'Alabaster Host Intercessor').id
    const foeId = named(server.state, 'Fixture Hostage').id
    let state = resolveStack(server.rules, ok(server.rules(server.state, { type: 'move', objectId: intercessorId, to: 'battlefield' })))
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
    state = resolveStack(server.rules, choose(server, state, [foeId]))
    expect(state.objects[foeId]).toMatchObject({ zone: 'exile', exiledWith: intercessorId })
  })
})
