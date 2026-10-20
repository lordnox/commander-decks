import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { createJournal, restoreJournal } from '../../journal'
import { hasKeyword } from '../../keywords'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { effectsFor, effectsOf } from '../cardRules'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import { loadDefinitionSnapshot } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const handCount = (state: GameState, seat: 'p1' | 'p2' = 'p1') =>
  state.zoneOrder[seat].hand.length

describe('cardRuleCatalog — drawAndKeywords', () => {
  test('lookup is exact card name and pins a compiled snapshot at module load', () => {
    const wall = cardRuleDefinitionSnapshotFor('Wall of Omens')
    const wurm = cardRuleDefinitionSnapshotFor('Duskdale Wurm')
    const whisper = cardRuleDefinitionSnapshotFor("Night's Whisper")
    expect(wall).toBeDefined()
    expect(wurm).toBeDefined()
    expect(whisper).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('wall of omens')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Thunderfoot Baloth')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Lightning Bolt')).toBeDefined()
    expect(wall).toBe(cardRuleDefinitionSnapshotFor('Wall of Omens'))
    expect(wall!.definitionRevision).toMatch(/^v1-[0-9a-f]{16}$/)
    expect(wurm!.definitionRevision).not.toBe(wall!.definitionRevision)
    expect(loadDefinitionSnapshot(wall!).definitionRevision).toBe(wall!.definitionRevision)
  })

  test('newGame stamps the pinned snapshot and empty effects when the template omits ruleDefinition', () => {
    const wallSnapshot = cardRuleDefinitionSnapshotFor('Wall of Omens')!
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4 })],
      },
    }, { random: () => 0 })
    const wall = named(server.state, 'Wall of Omens')
    expect(wall.ruleDefinition).toEqual(wallSnapshot)
    expect(wall.ruleDefinition?.definitionRevision).toBe(wallSnapshot.definitionRevision)
    expect(wall.effects).toEqual([])
    expect(effectsOf(wall)).toEqual([])
    expect(hasKeyword(wall, 'defender', server.state)).toBe(true)
    expect(hasKeyword(wall, 'trample', server.state)).toBe(false)
  })

  test('an explicit template ruleDefinition is kept instead of the catalog snapshot', () => {
    const wurmSnapshot = cardRuleDefinitionSnapshotFor('Duskdale Wurm')!
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Wall of Omens', {
          types: ['Creature'],
          power: 0,
          toughness: 4,
          ruleDefinition: wurmSnapshot,
        })],
      },
    }, { random: () => 0 })
    const wall = named(server.state, 'Wall of Omens')
    expect(wall.ruleDefinition).toEqual(wurmSnapshot)
    expect(hasKeyword(wall, 'trample', server.state)).toBe(true)
    expect(hasKeyword(wall, 'defender', server.state)).toBe(false)
  })

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
    expect(hasKeyword(wurm, 'trample', server.state)).toBe(true)
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

  test('a catalog object and an unmigrated CARD_RULES object both work in the same game', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [
          cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4 }),
          cardTemplate('Mulldrifter', { types: ['Creature'], power: 2, toughness: 2 }),
        ],
      },
      libraries: {
        p1: ['Mixed One', 'Mixed Two', 'Mixed Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const wall = named(server.state, 'Wall of Omens')
    const mulldrifter = named(server.state, 'Mulldrifter')
    expect(wall.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Wall of Omens'))
    expect(mulldrifter.ruleDefinition).toBeUndefined()
    expect(mulldrifter.effects).toEqual(effectsFor('Mulldrifter'))
    expect(effectsOf(mulldrifter).length).toBeGreaterThan(0)

    const afterWall = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: wall.id,
      to: 'battlefield',
    })))
    expect(handCount(afterWall)).toBe(2)
    expect(named(afterWall, 'Mixed One').zone).toBe('hand')
    expect(hasKeyword(named(afterWall, 'Wall of Omens'), 'defender', afterWall)).toBe(true)

    const liveMulldrifter = named(afterWall, 'Mulldrifter')
    const afterBoth = resolveStack(server.rules, ok(server.rules(afterWall, {
      type: 'move',
      objectId: liveMulldrifter.id,
      to: 'battlefield',
    })))
    expect(afterBoth.objects[liveMulldrifter.id].zone).toBe('battlefield')
    expect(afterBoth.objects[liveMulldrifter.id].ruleDefinition).toBeUndefined()
    expect(handCount(afterBoth)).toBe(3)
    expect(['Mixed One', 'Mixed Two', 'Mixed Three'].every(
      (name) => named(afterBoth, name).zone === 'hand',
    )).toBe(true)
  })

  test('journal restore keeps the stamped definitionRevision', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Duskdale Wurm', { types: ['Creature'], power: 7, toughness: 7 })],
      },
    }, { random: () => 0 })
    const wurm = named(server.state, 'Duskdale Wurm')
    const revision = wurm.ruleDefinition!.definitionRevision
    const json = JSON.parse(JSON.stringify(wurm.ruleDefinition))
    expect(json.definitionRevision).toBe(revision)
    expect(loadDefinitionSnapshot(json).definitionRevision).toBe(revision)
    const restored = restoreJournal(createJournal(server.state), server.rules)
    expect(restored.current().objects[wurm.id].ruleDefinition?.definitionRevision).toBe(revision)
  })
})
