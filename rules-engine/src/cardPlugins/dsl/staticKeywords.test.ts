import { describe, expect, test } from 'bun:test'
import { card, compileCardRuleDefinition, compareAmount, count, createDefinitionSnapshot, keyword, keywordAbility, KEYWORDS, objects, ref } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'
import { ok } from '../../testHelpers'

describe('staticKeywords', () => {

  test('Duskdale Wurm and Wall of Omens share defender and trample keyword semantics', () => {
    const wurm = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.trample])))
    const wall = createDefinitionSnapshot(compileCardRuleDefinition(card([keyword.defender])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Duskdale Wurm', { types: ['Creature'], power: 7, toughness: 7, ruleDefinition: wurm }),
          cardTemplate('Wall of Omens', { types: ['Creature'], power: 0, toughness: 4, ruleDefinition: wall }),
        ],
      },
    }, { random: () => 0 })
    const wurmObject = Object.values(server.state.objects).find((object) => object.name === 'Duskdale Wurm')!
    const wallObject = Object.values(server.state.objects).find((object) => object.name === 'Wall of Omens')!
    expect(hasKeyword(wurmObject, 'trample')).toBe(true)
    expect(hasKeyword(wallObject, 'defender')).toBe(true)
    expect(hasKeyword(wallObject, 'trample')).toBe(false)
  })

  test('keyword when conditions grant hexproof only while the source is untapped', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
      keywordAbility(KEYWORDS.hexproof, {
        when: compareAmount(count(objects({ among: ref('source'), tapped: false })), 'eq', 1),
      }),
    ])))
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Teacher', { types: ['Creature'], power: 0, toughness: 4, ruleDefinition: definition })],
      },
    }, { random: () => 0 })
    const teacher = Object.values(server.state.objects).find((object) => object.name === 'Teacher')!
    expect(hasKeyword(teacher, 'hexproof')).toBe(true)
    const tapped = ok(server.rules(server.state, { type: 'tap', objectId: teacher.id }))
    expect(hasKeyword(tapped.objects[teacher.id]!, 'hexproof')).toBe(false)
    const untapped = ok(server.rules(tapped, { type: 'untap', objectId: teacher.id }))
    expect(hasKeyword(untapped.objects[teacher.id]!, 'hexproof')).toBe(true)
  })
})
