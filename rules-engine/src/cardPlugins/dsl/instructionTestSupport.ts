import { cardTemplate } from '../../newGame'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, spell } from './v1'

export const instructionSpell = (program: Parameters<typeof spell>[0], manaCost = '{0}') =>
  cardTemplate('Instruction fixture', {
    types: ['Instant'], manaCost,
    ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(card([spell(program)]))),
  })
