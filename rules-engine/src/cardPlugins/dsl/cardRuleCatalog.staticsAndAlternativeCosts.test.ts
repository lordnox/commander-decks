import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const anthemCard = () => cardTemplate('Glorious Anthem', { types: ['Enchantment'] })
const restCard = () => cardTemplate('Rest in Peace', { types: ['Enchantment'] })
const foilCard = () => cardTemplate('Foil', { types: ['Instant'], manaCost: '{2}{U}{U}' })
const islandCard = () => cardTemplate('Island', { types: ['Land'], subtypes: ['Island'] })

describe('cardRuleCatalog — staticsAndAlternativeCosts', () => {
  test('Glorious Anthem pumps controlled creatures once and does not pump opponents', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          anthemCard(),
          cardTemplate('Your Bear', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
        p2: [cardTemplate('Their Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0 })
    const anthem = named(server.state, 'Glorious Anthem')
    const yours = named(server.state, 'Your Bear')
    const theirs = named(server.state, 'Their Bear')
    expect(anthem.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Glorious Anthem'))
    expect(anthem.effects).toEqual([])
    expect(yours.power).toBe(3)
    expect(yours.toughness).toBe(3)
    expect(theirs.power).toBe(2)
    expect(theirs.toughness).toBe(2)
    const left = ok(server.rules(server.state, { type: 'move', objectId: anthem.id, to: 'graveyard' }))
    expect(named(left, 'Your Bear').power).toBe(2)
    expect(named(left, 'Your Bear').toughness).toBe(2)
  })

  test('Rest in Peace exiles existing graveyards on entry and cards that would go to a graveyard', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Doomed Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
      hands: {
        p1: [restCard(), cardTemplate('Your Gy Card'), cardTemplate('Discarded Thought')],
        p2: [cardTemplate('Their Gy Card')],
      },
    }, { random: () => 0 })
    const rest = named(server.state, 'Rest in Peace')
    const yours = named(server.state, 'Your Gy Card')
    const theirs = named(server.state, 'Their Gy Card')
    const bear = named(server.state, 'Doomed Bear')
    const thought = named(server.state, 'Discarded Thought')
    expect(rest.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Rest in Peace'))
    expect(rest.effects).toEqual([])
    const yoursBuried = ok(server.rules(server.state, { type: 'move', objectId: yours.id, to: 'graveyard' }))
    const theirsBuried = ok(server.rules(yoursBuried, { type: 'move', objectId: theirs.id, to: 'graveyard' }))
    expect(theirsBuried.objects[yours.id].zone).toBe('graveyard')
    expect(theirsBuried.objects[theirs.id].zone).toBe('graveyard')
    const entered = ok(server.rules(theirsBuried, { type: 'move', objectId: rest.id, to: 'battlefield' }))
    expect(entered.stack).toHaveLength(1)
    const afterEtb = resolveStack(server.rules, entered)
    expect(afterEtb.objects[yours.id].zone).toBe('exile')
    expect(afterEtb.objects[theirs.id].zone).toBe('exile')
    expect(afterEtb.zoneOrder.p1.graveyard).toHaveLength(0)
    expect(afterEtb.zoneOrder.p2.graveyard).toHaveLength(0)
    const destroyed = ok(server.rules(afterEtb, { type: 'destroy', objectId: bear.id }))
    expect(destroyed.objects[bear.id].zone).toBe('exile')
    const discarded = ok(server.rules(destroyed, { type: 'move', objectId: thought.id, to: 'graveyard' }))
    expect(discarded.objects[thought.id].zone).toBe('exile')
    expect(discarded.zoneOrder.p1.graveyard).toHaveLength(0)
  })

  test("a family 1 catalog spell still charges its printed mana cost", () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate("Night's Whisper", { types: ['Sorcery'], manaCost: '{1}{B}' })] },
      libraries: {
        p1: ['Whisper One', 'Whisper Two'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const whisper = named(server.state, "Night's Whisper")
    expect(whisper.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor("Night's Whisper"))
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }).ok).toBe(false)
    server.state.players.p1.mana.B = 1
    expect(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }).ok).toBe(false)
    server.state.players.p1.mana.C = 1
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }))
    expect(cast.players.p1.mana.B).toBe(0)
    expect(cast.players.p1.mana.C).toBe(0)
  })

  test('Foil pays its Island discard alternative and counters a spell once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          foilCard(),
          islandCard(),
          cardTemplate('Extra Card'),
          cardTemplate('Target Spell', { types: ['Sorcery'], manaCost: '{0}' }),
        ],
      },
    }, { random: () => 0 })
    const foil = named(server.state, 'Foil')
    const island = named(server.state, 'Island')
    const extra = named(server.state, 'Extra Card')
    const targetSpell = named(server.state, 'Target Spell')
    expect(foil.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Foil'))
    expect(foil.effects).toEqual([])
    const stacked = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: targetSpell.id,
    }))
    const stackId = stacked.stack.find((item) => item.objectId === targetSpell.id)!.id
    expect(server.rules(stacked, {
      type: 'castSpell',
      seat: 'p1',
      objectId: foil.id,
      selectedAlternativeCost: 0,
      discard: [extra.id, island.id],
      targets: [{ kind: 'stackItem', stackId }],
    }).ok).toBe(false)
    const cast = ok(server.rules(stacked, {
      type: 'castSpell',
      seat: 'p1',
      objectId: foil.id,
      selectedAlternativeCost: 0,
      discard: [island.id, extra.id],
      targets: [{ kind: 'stackItem', stackId }],
    }))
    expect(cast.objects[island.id].zone).toBe('graveyard')
    expect(cast.objects[extra.id].zone).toBe('graveyard')
    expect(cast.stack).toHaveLength(2)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[targetSpell.id].zone).toBe('graveyard')
    expect(resolved.objects[foil.id].zone).toBe('graveyard')
    expect(resolved.stack).toHaveLength(0)
  })

})
