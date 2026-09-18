import { describe, expect, test } from 'bun:test'
import { createCatalog } from '../catalog'
import { commanderRules } from '../formats'
import { rules } from '../kernel'
import { cardTemplate, newGame } from '../newGame'
import { damage } from '../plugins/damage'
import { createAuthoritativeHiddenInformation } from '../plugins/hiddenInformation'
import { mana } from '../plugins/mana'
import { spells } from '../plugins/spells'
import { stateBased } from '../plugins/stateBased'
import { draw, selectCards, triggers } from '../rules/main'
import { ok } from '../testHelpers'
import type { GameState, ManaId, TargetRef } from '../types'
import { activated } from './activated'
import { evaCards } from './evaCards'

const hidden = createAuthoritativeHiddenInformation(() => 0.5)
const catalog = createCatalog([
  spells,
  activated,
  mana,
  damage,
  draw,
  selectCards,
  triggers,
  stateBased,
  evaCards,
  hidden,
])

const game = (options: Parameters<typeof newGame>[1]) =>
  newGame(commanderRules, {
    ...options,
    builtinRules: [
      'spells',
      'activated',
      'mana',
      'damage',
      'draw',
      'selectCards',
      'triggers',
      'stateBased',
      'evaCards',
      'hiddenInformation',
    ],
  })

const resolveSpell = (
  state: GameState,
  name: string,
  targets: TargetRef[] = [],
  extra: { x?: number; manaSpent?: ManaId[] } = {},
) => {
  const object = Object.values(state.objects).find((card) => card.name === name)!
  const oldZone = object.zone
  state.zoneOrder[object.owner][oldZone] = state.zoneOrder[object.owner][oldZone]
    .filter((objectId) => objectId !== object.id)
  state.zoneCounts[object.owner][oldZone] -= 1
  object.zone = 'stack'
  state.zoneOrder[object.owner].stack.unshift(object.id)
  state.zoneCounts[object.owner].stack += 1
  state.stack = [{
    id: `stack-${name}`,
    kind: 'spell',
    objectId: object.id,
    controller: object.controller,
    name,
    targets,
    ...extra,
  }]
  return ok(rules(state, { type: 'resolveTop' }, catalog))
}

describe('Lady Evangela card rules', () => {
  test('Inkshield prevents combat damage and creates one Inkling per damage', () => {
    const state = game({
      hands: { p1: [cardTemplate('Inkshield', { types: ['Instant'] })] },
      battlefield: {
        p2: [cardTemplate('Attacker', { types: ['Creature'], power: 5, toughness: 5 })],
      },
    })
    const protectedState = resolveSpell(state, 'Inkshield')
    const attacker = protectedState.zoneOrder.p2.battlefield[0]
    const prevented = ok(rules(protectedState, {
      type: 'combatDamage',
      sourceId: attacker,
      target: { kind: 'player', player: 'p1' },
      amount: 5,
    }, catalog))

    expect(prevented.players.p1.life).toBe(40)
    expect(Object.values(prevented.objects).filter((object) => object.name === 'Inkling'))
      .toHaveLength(5)
  })

  test('Comeuppance redirects prevented creature damage to that creature', () => {
    const state = game({
      hands: { p1: [cardTemplate('Comeuppance', { types: ['Instant'] })] },
      battlefield: {
        p2: [cardTemplate('Attacker', { types: ['Creature'], power: 3, toughness: 3 })],
      },
    })
    const protectedState = resolveSpell(state, 'Comeuppance')
    const attacker = protectedState.zoneOrder.p2.battlefield[0]
    const redirected = ok(rules(protectedState, {
      type: 'dealDamage',
      sourceId: attacker,
      target: { kind: 'player', player: 'p1' },
      amount: 3,
    }, catalog))

    expect(redirected.players.p1.life).toBe(40)
    expect(redirected.objects[attacker].zone).toBe('graveyard')
  })

  test('Batwing Brume uses the colors spent for both halves', () => {
    const state = game({
      hands: { p1: [cardTemplate('Batwing Brume', { types: ['Instant'] })] },
      battlefield: {
        p2: [cardTemplate('Attacker', {
          types: ['Creature'],
          power: 4,
          toughness: 4,
          attacking: { kind: 'player', player: 'p1' },
        })],
      },
    })
    const protectedState = resolveSpell(state, 'Batwing Brume', [], {
      manaSpent: ['W', 'B'],
    })
    expect(protectedState.players.p2.life).toBe(39)
    const attacker = protectedState.zoneOrder.p2.battlefield[0]
    const prevented = ok(rules(protectedState, {
      type: 'combatDamage',
      sourceId: attacker,
      target: { kind: 'player', player: 'p1' },
      amount: 4,
    }, catalog))
    expect(prevented.players.p1.life).toBe(40)
  })

  test('Energy Arc untaps its targets and prevents combat damage to and from them', () => {
    const state = game({
      hands: { p1: [cardTemplate('Energy Arc', { types: ['Instant'] })] },
      battlefield: {
        p2: [cardTemplate('Attacker', {
          types: ['Creature'],
          power: 4,
          toughness: 4,
          tapped: true,
        })],
      },
    })
    const attacker = state.zoneOrder.p2.battlefield[0]
    const protectedState = resolveSpell(state, 'Energy Arc', [
      { kind: 'object', objectId: attacker },
    ])
    expect(protectedState.objects[attacker].tapped).toBe(false)
    const prevented = ok(rules(protectedState, {
      type: 'combatDamage',
      sourceId: attacker,
      target: { kind: 'player', player: 'p1' },
      amount: 4,
    }, catalog))
    expect(prevented.players.p1.life).toBe(40)
  })

  test('Everybody Lives prevents life loss and losing to zero life for the turn', () => {
    const state = game({
      hands: {
        p1: [
          cardTemplate('Everybody Lives!', { types: ['Instant'] }),
          cardTemplate('Test Spell', { types: ['Instant'] }),
        ],
      },
    })
    state.players.p2.life = 1
    const protectedState = resolveSpell(state, 'Everybody Lives!')
    const next = ok(rules(protectedState, {
      type: 'loseLife',
      seat: 'p2',
      amount: 10,
    }, catalog))

    expect(next.players.p2.life).toBe(1)
    expect(next.players.p2.lost).toBe(false)
    const targeted = rules(next, {
      type: 'castSpell',
      seat: 'p1',
      objectId: Object.values(next.objects).find((object) => object.name === 'Test Spell')!.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }, catalog)
    expect(targeted.ok).toBe(false)
  })

  test('Phial doubles an empty-hand draw and low-life gain', () => {
    const state = game({
      libraries: {
        p1: [cardTemplate('First'), cardTemplate('Second')],
      },
      battlefield: {
        p1: [cardTemplate('Phial of Galadriel', { types: ['Artifact'] })],
      },
    })
    state.players.p1.life = 5
    const drawn = ok(rules(state, { type: 'draw', seat: 'p1' }, catalog))
    expect(drawn.zoneOrder.p1.hand).toHaveLength(2)
    const healed = ok(rules(drawn, {
      type: 'gainLife',
      seat: 'p1',
      amount: 3,
      source: 'test',
    }, catalog))
    expect(healed.players.p1.life).toBe(11)
  })

  test('Debt to the Deathless drains each opponent for twice X', () => {
    const state = game({
      hands: { p1: [cardTemplate('Debt to the Deathless', { types: ['Sorcery'] })] },
    })
    const resolved = resolveSpell(state, 'Debt to the Deathless', [], { x: 3 })
    expect(resolved.players.p1.life).toBe(58)
    expect(resolved.players.p2.life).toBe(34)
    expect(resolved.players.p3.life).toBe(34)
    expect(resolved.players.p4.life).toBe(34)
  })

  test('Fractured Identity exiles the target and copies it for other players', () => {
    const target = cardTemplate('Useful Rock', { types: ['Artifact'] })
    const state = game({
      hands: { p1: [cardTemplate('Fractured Identity', { types: ['Sorcery'] })] },
      battlefield: { p2: [target] },
    })
    const targetId = state.zoneOrder.p2.battlefield[0]
    const resolved = resolveSpell(state, 'Fractured Identity', [
      { kind: 'object', objectId: targetId },
    ])
    expect(resolved.objects[targetId].zone).toBe('exile')
    expect(Object.values(resolved.objects).filter((object) =>
      object.name === 'Useful Rock' && object.zone === 'battlefield')).toHaveLength(3)
  })

  test('Settle exiles attackers and opens a typed basic-land search', () => {
    const basic = cardTemplate('Plains', {
      types: ['Land'],
      supertypes: ['Basic'],
      subtypes: ['Plains'],
    })
    const state = game({
      hands: { p1: [cardTemplate('Settle the Wreckage', { types: ['Instant'] })] },
      libraries: { p2: [basic] },
      battlefield: {
        p2: [cardTemplate('Attacker', {
          types: ['Creature'],
          attacking: { kind: 'player', player: 'p1' },
        })],
      },
    })
    const resolved = resolveSpell(state, 'Settle the Wreckage', [
      { kind: 'player', player: 'p2' },
    ])
    const selection = resolved.players.p2.data['kernel.pendingSelection'] as Array<{
      kind: string
      count: number
    }>
    expect(selection[0]).toMatchObject({ kind: 'search', count: 1 })
    expect(Object.values(resolved.objects).find((object) => object.name === 'Attacker')?.zone)
      .toBe('exile')
  })

  test('Council’s Judgment exiles every permanent tied for the most votes', () => {
    const state = game({
      hands: { p1: [cardTemplate("Council's Judgment", { types: ['Sorcery'] })] },
      battlefield: {
        p2: [cardTemplate('Left', { types: ['Artifact'] })],
        p3: [cardTemplate('Right', { types: ['Enchantment'] })],
      },
    })
    let current = resolveSpell(state, "Council's Judgment")
    const left = current.zoneOrder.p2.battlefield[0]
    const right = current.zoneOrder.p3.battlefield[0]
    for (const [seat, objectId] of [
      ['p1', left],
      ['p2', right],
      ['p3', left],
      ['p4', right],
    ] as const) {
      current = ok(rules(current, {
        type: 'vote',
        seat,
        sourceId: Object.values(current.objects).find(
          (object) => object.name === "Council's Judgment",
        )!.id,
        objectId,
      }, catalog))
    }
    expect(current.objects[left].zone).toBe('exile')
    expect(current.objects[right].zone).toBe('exile')
  })

  test('Ephemerate blinks its creature and retriggers battlefield entry', () => {
    const state = game({
      hands: { p1: [cardTemplate('Ephemerate', { types: ['Instant'] })] },
      battlefield: {
        p1: [cardTemplate('Creature', { types: ['Creature'], tapped: true })],
      },
    })
    const targetId = state.zoneOrder.p1.battlefield[0]
    const resolved = resolveSpell(state, 'Ephemerate', [{ kind: 'object', objectId: targetId }])
    expect(resolved.objects[targetId]).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
      tapped: false,
    })
  })

  test('Mirrorweave copies every other creature and restores them at cleanup', () => {
    const state = game({
      hands: { p1: [cardTemplate('Mirrorweave', { types: ['Instant'] })] },
      battlefield: {
        p1: [cardTemplate('Template', { types: ['Creature'], power: 5, toughness: 5 })],
        p2: [cardTemplate('Original', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    })
    const templateId = state.zoneOrder.p1.battlefield[0]
    const originalId = state.zoneOrder.p2.battlefield[0]
    const copied = resolveSpell(state, 'Mirrorweave', [
      { kind: 'object', objectId: templateId },
    ])
    expect(copied.objects[originalId]).toMatchObject({ name: 'Template', power: 5 })
    copied.step = 'cleanup'
    const restored = ok(rules(copied, {
      type: 'custom',
      name: 'advanceStep',
    }, catalog))
    expect(restored.objects[originalId]).toMatchObject({ name: 'Original', power: 2 })
  })

  test('Mister Negative exchanges life totals and draws the life its controller lost', () => {
    const state = game({
      hands: {
        p1: [cardTemplate('Mister Negative', { types: ['Creature'] })],
      },
      libraries: {
        p1: Array.from({ length: 10 }, (_, index) => cardTemplate(`Card ${index}`)),
      },
    })
    state.players.p1.life = 30
    state.players.p2.life = 20
    const resolved = resolveSpell(state, 'Mister Negative', [
      { kind: 'player', player: 'p2' },
    ])
    expect(resolved.players.p1.life).toBe(20)
    expect(resolved.players.p2.life).toBe(30)
    expect(resolved.zoneOrder.p1.library).toHaveLength(0)
  })

  test('Sokrates replaces combat damage with half as many draws for both players', () => {
    const state = game({
      libraries: {
        p1: [cardTemplate('A'), cardTemplate('B')],
        p2: [cardTemplate('C'), cardTemplate('D')],
      },
      battlefield: {
        p1: [cardTemplate('Sokrates, Athenian Teacher', { types: ['Creature'] })],
        p2: [cardTemplate('Attacker', { types: ['Creature'], power: 5, toughness: 5 })],
      },
    })
    const sokrates = state.zoneOrder.p1.battlefield[0]
    const attacker = state.zoneOrder.p2.battlefield[0]
    state.stack = [{
      id: 'sokrates-ability',
      kind: 'ability',
      abilityId: 'eva.sokrates',
      objectId: sokrates,
      controller: 'p1',
      name: 'Sokrates, Athenian Teacher',
      targets: [{ kind: 'object', objectId: attacker }],
    }]
    const dialogue = ok(rules(state, { type: 'resolveTop' }, catalog))
    const prevented = ok(rules(dialogue, {
      type: 'combatDamage',
      sourceId: attacker,
      target: { kind: 'player', player: 'p1' },
      amount: 5,
    }, catalog))
    expect(prevented.players.p1.life).toBe(40)
    expect(prevented.zoneOrder.p1.hand).toHaveLength(2)
    expect(prevented.zoneOrder.p2.hand).toHaveLength(2)
  })

  test('Queza puts a drain trigger on the stack for each draw', () => {
    const state = game({
      libraries: { p1: [cardTemplate('Card')] },
      battlefield: {
        p1: [cardTemplate('Queza, Augur of Agonies', { types: ['Creature'] })],
      },
    })
    const drawn = ok(rules(state, { type: 'draw', seat: 'p1' }, catalog))
    expect(drawn.stack[0]?.name).toBe('Queza, Augur of Agonies')
    const resolved = ok(rules(drawn, { type: 'resolveTop' }, catalog))
    expect(resolved.players.p1.life).toBe(41)
    expect(resolved.players.p2.life).toBe(39)
  })

  test('Lotho triggers on each player’s second spell and extort drains the table', () => {
    const state = game({
      hands: {
        p1: [
          cardTemplate('First', { types: ['Instant'] }),
          cardTemplate('Second', { types: ['Instant'] }),
        ],
      },
      battlefield: {
        p2: [cardTemplate('Lotho, Corrupt Shirriff', { types: ['Creature'] })],
        p1: [cardTemplate('Crypt Ghast', { types: ['Creature'] })],
      },
    })
    state.players.p1.mana.W = 1
    const [first, second] = state.zoneOrder.p1.hand
    let current = ok(rules(state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: first,
      payExtort: true,
    }, catalog))
    current = ok(rules(current, {
      type: 'castSpell',
      seat: 'p1',
      objectId: second,
    }, catalog))
    expect(current.stack.some((item) => item.name === 'Lotho, Corrupt Shirriff')).toBe(true)
    expect(current.players.p1.life).toBe(43)
    expect(current.players.p2.life).toBe(39)
    expect(current.players.p3.life).toBe(39)
    expect(current.players.p4.life).toBe(39)
  })

  test('Rings pays two and copies a nonmana activated ability', () => {
    const sokrates = cardTemplate('Sokrates, Athenian Teacher', {
      types: ['Creature'],
      effects: undefined,
    })
    const state = game({
      battlefield: {
        p1: [
          sokrates,
          cardTemplate('Rings of Brighthearth', { types: ['Artifact'] }),
          cardTemplate('Target', { types: ['Creature'] }),
        ],
      },
    })
    state.players.p1.mana.C = 2
    const [sourceId, , targetId] = state.zoneOrder.p1.battlefield
    const activatedState = ok(rules(state, {
      type: 'activateAbility',
      abilityId: 'eva.sokrates',
      seat: 'p1',
      objectId: sourceId,
      targets: [{ kind: 'object', objectId: targetId }],
      copyWithRings: true,
    }, catalog))
    expect(activatedState.stack).toHaveLength(2)
    expect(activatedState.players.p1.mana.C).toBe(0)
  })
})
