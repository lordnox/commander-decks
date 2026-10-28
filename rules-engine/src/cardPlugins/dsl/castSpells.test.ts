import { describe, expect, test } from 'bun:test'
import { availableActions, legalActsFor } from '../../actions'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { cardTemplate } from '../../newGame'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok } from '../../testHelpers'
import type { GameState } from '../../types'
import {
  activePlayer,
  card,
  castSpells,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  objects,
  players,
  playLands,
  redirectEvent,
  ref,
  replacement,
  SPELL_CAST_COSTS,
  staticAbility,
  wouldMove,
} from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find(object => object.name === name)!

const source = (abilities: Parameters<typeof card>[0]) =>
  cardTemplate('Permission source', {
    types: ['Artifact'],
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card(abilities))),
  })

const creature = (name: string, manaCost = '{1}{G}') =>
  cardTemplate(name, { types: ['Creature'], manaCost, manaValue: 2, power: 1, toughness: 1 })

describe('canonical spell permissions', () => {
  test('graveyard permission pays printed mana, survives restore, and disappears with its source', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [source([
        staticAbility(castSpells(players({ relation: 'you' }), objects({ zone: 'graveyard', owner: 'you' }))),
      ])] },
      libraries: { p1: [creature('Yard Bear')] },
    }, { random: () => 0.5 })
    const landSource = server.state.zoneOrder.p1.battlefield[0]
    const bear = server.state.zoneOrder.p1.library[0]
    const moved = ok(server.rules(server.state, { type: 'move', objectId: bear, to: 'graveyard' }))
    moved.players.p1.mana.G = 1
    moved.players.p1.mana.C = 1
    const restored = restoreJournal(createJournal(moved), server.rules).current()
    expect(legalActsFor(restored, 'p1').some(action =>
      action.kind === 'castSpell' && action.objectId === bear && !action.castOption)).toBe(true)
    const cast = ok(server.rules(restored, { type: 'castSpell', seat: 'p1', objectId: bear }))
    expect(cast.objects[bear].zone).toBe('stack')
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[bear].zone).toBe('battlefield')
    const removed = ok(server.rules(moved, { type: 'move', objectId: landSource, to: 'graveyard' }))
    expect(server.rules(removed, { type: 'castSpell', seat: 'p1', objectId: bear }).ok).toBe(false)
  })

  test('graveyard sorceries still need empty-stack main-phase timing', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [source([
        staticAbility(castSpells(players({ relation: 'you' }), objects({ zone: 'graveyard', owner: 'you' }))),
      ])] },
      hands: { p1: [cardTemplate('Yard Sorcery', { types: ['Sorcery'], manaCost: '{G}', manaValue: 1 })] },
    }, { random: () => 0.5 })
    const spell = named(server.state, 'Yard Sorcery').id
    const ready = ok(server.rules(server.state, { type: 'move', objectId: spell, to: 'graveyard' }))
    ready.players.p1.mana.G = 1
    expect(server.rules({ ...ready, active: 'p2' }, { type: 'castSpell', seat: 'p1', objectId: spell }).ok).toBe(false)
    expect(ok(server.rules(ready, { type: 'castSpell', seat: 'p1', objectId: spell })).objects[spell].zone).toBe('stack')
  })

  test('exile land play uses ordinary limits and the live selector', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [source([
        staticAbility(playLands(players({ relation: 'you' }), objects({ zone: 'exile', owner: 'you', type: 'Land' }))),
      ])] },
      libraries: { p1: [cardTemplate('Exiled Forest', { types: ['Land'] })] },
    }, { random: () => 0.5 })
    const land = server.state.zoneOrder.p1.library[0]
    const moved = ok(server.rules(server.state, { type: 'move', objectId: land, to: 'exile' }))
    expect(availableActions(moved, 'p1').some(action => action.kind === 'playLand' && action.objectId === land)).toBe(true)
    const played = ok(server.rules(moved, { type: 'playLand', seat: 'p1', objectId: land }))
    expect(played.objects[land].zone).toBe('battlefield')
    expect(played.players.p1.landsPlayed).toBe(1)
  })

  test('retrace is an additional land discard on graveyard permanents during your turn', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [source([
        staticAbility(castSpells(
          players({ relation: 'you' }),
          objects({
            zone: 'graveyard',
            owner: 'you',
            any: [{ type: 'Creature' }, { type: 'Artifact' }, { type: 'Enchantment' }, { type: 'Planeswalker' }, { type: 'Battle' }],
          }),
          {
            discardLand: true,
            when: activePlayer(ref('controller')),
            optionId: 'retrace',
            label: 'Retrace—Discard a land card.',
          },
        )),
      ])] },
      hands: {
        p1: [
          cardTemplate('Forest', { types: ['Land'] }),
          creature('Grizzly Bears'),
          cardTemplate('Graveyard Sorcery', { types: ['Sorcery'], manaCost: '{1}{G}', manaValue: 2 }),
        ],
        p2: [cardTemplate('Island', { types: ['Land'] })],
      },
    }, { random: () => 0.5 })
    const ready = structuredClone(server.state)
    for (const name of ['Grizzly Bears', 'Graveyard Sorcery']) {
      const object = named(ready, name)
      ready.zoneOrder.p1[object.zone] = ready.zoneOrder.p1[object.zone].filter(id => id !== object.id)
      ready.zoneCounts.p1[object.zone] -= 1
      ready.zoneOrder.p1.graveyard.push(object.id)
      ready.zoneCounts.p1.graveyard += 1
      object.zone = 'graveyard'
    }
    ready.players.p1.mana.G = 1
    ready.players.p1.mana.C = 1
    const bear = named(ready, 'Grizzly Bears')
    const forest = named(ready, 'Forest')
    const retrace = legalActsFor(ready, 'p1').find(action =>
      action.kind === 'castSpell' && action.objectId === bear.id && action.castOption === 'retrace')
    expect(retrace).toMatchObject({
      kind: 'castSpell',
      castLabel: 'Retrace—Discard a land card.',
      targetGroups: [{
        label: 'Land card to discard',
        purpose: 'cost',
        targets: [{ objectId: forest.id, name: 'Forest' }],
      }],
    })
    expect(legalActsFor(ready, 'p1').some(action =>
      action.kind === 'castSpell' && action.name === 'Graveyard Sorcery' && action.castOption === 'retrace')).toBe(false)
    const opponentView = projectForViewer(ready, 'p2')
    expect(opponentView.objects[forest.id]).toBeUndefined()
    expect(JSON.stringify(legalActsFor(opponentView, 'p2'))).not.toContain('Forest')
    expect(JSON.stringify(retrace)).not.toContain('Island')
    expect(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      castOption: 'retrace',
    }).ok).toBe(false)
    const wrongTurn = structuredClone(ready)
    wrongTurn.active = 'p2'
    expect(server.rules(wrongTurn, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      castOption: 'retrace',
      discard: [forest.id],
    }).ok).toBe(false)
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bear.id,
      castOption: 'retrace',
      discard: [forest.id],
    }))
    expect(cast.objects[forest.id].zone).toBe('graveyard')
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[bear.id].zone).toBe('battlefield')
  })

  test('life-equal-mana-value exile casts pay life instead of mana', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [source([
        staticAbility(castSpells(
          players({ relation: 'you' }),
          objects({ zone: 'exile', owner: 'you', not: { type: 'Land' } }),
          { cost: SPELL_CAST_COSTS.lifeEqualManaValue, when: activePlayer(ref('controller')), optionId: 'exiledWithLife' },
        )),
      ])] },
      hands: { p1: [cardTemplate('Exiled Bolt', { types: ['Instant'], manaCost: '{R}', manaValue: 1 })] },
    }, { random: () => 0.5 })
    const bolt = named(server.state, 'Exiled Bolt').id
    const ready = ok(server.rules(server.state, { type: 'move', objectId: bolt, to: 'exile' }))
    const action = availableActions(ready, 'p1').find(candidate =>
      candidate.kind === 'castSpell'
      && candidate.objectId === bolt
      && candidate.castOption === 'exiledWithLife')
    expect(action).toMatchObject({ castLabel: 'Cast for 1 life' })
    const unableToPay = structuredClone(ready)
    unableToPay.players.p1.life = 0
    expect(availableActions(unableToPay, 'p1').some(candidate =>
      candidate.kind === 'castSpell'
      && candidate.objectId === bolt
      && candidate.castOption === 'exiledWithLife')).toBe(false)
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt,
      castOption: 'exiledWithLife',
    }))
    expect(cast.players.p1.life).toBe(39)
    expect(cast.objects[bolt].zone).toBe('stack')
    const wrongTurn = { ...ready, active: 'p2', priority: 'p1' }
    expect(server.rules(wrongTurn, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt,
      castOption: 'exiledWithLife',
    }).ok).toBe(false)
  })

  test('a replacement-linked exile can be played with life while the source remains', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [source([
        staticAbility(replacement(
          wouldMove({ to: 'graveyard', object: { controller: 'opponent', owner: 'opponent' } }),
          redirectEvent('exile', { link: true }),
        )),
        staticAbility(playLands(players({ relation: 'you' }), objects({ zone: 'exile', exiledWith: ref('source'), type: 'Land' }))),
        staticAbility(castSpells(
          players({ relation: 'you' }),
          objects({ zone: 'exile', exiledWith: ref('source'), not: { type: 'Land' } }),
          { cost: SPELL_CAST_COSTS.lifeEqualManaValue, when: activePlayer(ref('controller')), optionId: 'exiledWithLife' },
        )),
      ])] },
      hands: { p2: [cardTemplate('Exiled Bolt', { types: ['Instant'], manaCost: '{R}', manaValue: 1 })] },
      libraries: { p1: [cardTemplate('Own Bear', { types: ['Creature'], manaCost: '{G}' })] },
    }, { random: () => 0.5 })
    const valgavoth = named(server.state, 'Permission source').id
    const bolt = named(server.state, 'Exiled Bolt').id
    const own = named(server.state, 'Own Bear').id
    const milled = ok(server.rules(server.state, { type: 'move', objectId: bolt, to: 'graveyard' }))
    expect(milled.objects[bolt]).toMatchObject({ zone: 'exile', exiledWith: valgavoth })
    const kept = ok(server.rules(milled, { type: 'move', objectId: own, to: 'graveyard' }))
    expect(kept.objects[own].zone).toBe('graveyard')
    const cast = ok(server.rules(kept, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt,
      castOption: 'exiledWithLife',
    }))
    expect(cast.players.p1.life).toBe(39)
    const removed = ok(server.rules(kept, { type: 'move', objectId: valgavoth, to: 'graveyard' }))
    expect(server.rules(removed, {
      type: 'castSpell',
      seat: 'p1',
      objectId: bolt,
      castOption: 'exiledWithLife',
    }).ok).toBe(false)
  })
})
