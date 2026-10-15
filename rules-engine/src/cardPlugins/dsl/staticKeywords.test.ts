import { describe, expect, test } from 'bun:test'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, keyword } from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { hasKeyword } from '../../keywords'

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
    expect(hasKeyword(wurmObject, 'trample', server.state)).toBe(true)
    expect(hasKeyword(wallObject, 'defender', server.state)).toBe(true)
    expect(hasKeyword(wallObject, 'trample', server.state)).toBe(false)
  })
})
