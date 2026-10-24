import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { hasKeyword } from '../../keywords'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { effectsFor } from '../cardRules'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const handCount = (state: GameState, seat: 'p1' | 'p2' = 'p1') =>
  state.zoneOrder[seat].hand.length

describe('cardRuleCatalog — drawAndKeywords', () => {
  test('Duskdale Wurm receives trample from the catalog without Oracle text or CARD_RULES', () => {
    expect(effectsFor('Duskdale Wurm')).toEqual([])
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Duskdale Wurm', { types: ['Creature'], power: 7, toughness: 7 })],
      },
    }, { random: () => 0 })
    const wurm = named(server.state, 'Duskdale Wurm')
    expect(wurm.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Duskdale Wurm'))
    expect(wurm.oracleText).toBe('')
    expect(hasKeyword(wurm, 'trample')).toBe(true)
  })

  test('Wall of Omens draws once on entry and does not double-fire', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4 })] },
      libraries: {
        p1: ['Draw One', 'Draw Two', 'Draw Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const wall = named(server.state, 'Wall of Omens')
    expect(wall.ruleDefinition?.definitionRevision).toBe(
      cardRuleDefinitionSnapshotFor('Wall of Omens')!.definitionRevision,
    )
    expect(wall.effects).toEqual([])
    const entered = ok(server.rules(server.state, { type: 'move', objectId: wall.id, to: 'battlefield' }))
    expect(entered.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, entered)
    expect(handCount(resolved)).toBe(1)
    expect(resolved.zoneOrder.p1.library).toHaveLength(2)
    expect(named(resolved, 'Draw One').zone).toBe('hand')
  })

  test("Night's Whisper draws two and loses two life once", () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [cardTemplate("Night's Whisper", { types: ['Sorcery'], manaCost: '{0}' })] },
      libraries: {
        p1: ['Whisper One', 'Whisper Two', 'Whisper Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const whisper = named(server.state, "Night's Whisper")
    expect(whisper.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor("Night's Whisper"))
    expect(whisper.effects).toEqual([])
    const cast = ok(server.rules(server.state, { type: 'castSpell', seat: 'p1', objectId: whisper.id }))
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.players.p1.life).toBe(38)
    expect(handCount(resolved)).toBe(2)
    expect(resolved.objects[whisper.id].zone).toBe('graveyard')
  })

})
