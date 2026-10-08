import type {
  ActivatedAbilityDefinition,
  Amount,
  AmountInput,
  CardRuleDefinitionInputV1,
  CardRuleDefinitionV1,
  ChoiceReference,
  Condition,
  ContinuousEffectDefinition,
  ContextBinding,
  ContextReference,
  Cost,
  DecisionsInput,
  DecisionsSpec,
  DistributionSpec,
  Instruction,
  Keyword,
  KeywordAbilityDefinition,
  ModeDefinition,
  ModeInput,
  ModeSpec,
  NumericCharacteristic,
  ObjectFilter,
  ObjectOccurrenceFilter,
  ObjectReference,
  ObjectSelector,
  OccurrencePattern,
  PlayerFilter,
  PlayerRecipient,
  PlayerSelector,
  Reference,
  ResolutionProgram,
  ResolutionProgramInput,
  ResultField,
  ResultReference,
  Selector,
  SpellAbilityDefinition,
  StackItemFilter,
  StackItemSelector,
  StaticAbilityDefinition,
  TargetClause,
  TargetClauseInput,
  TargetReference,
  TriggeredAbilityDefinition,
  VariableSpec,
  WheneverConfiguration,
  Zone,
} from '../schema/v1'
import { RULE_DSL_SCHEMA_VERSION } from '../schema/v1'
import { immutableData } from './immutable'
import { definitionRevisionFor } from './revision'

export const amount = (value: number): Amount => immutableData({ kind: 'constant', value })

export const toAmount = (value: AmountInput): Amount =>
  typeof value === 'number' ? amount(value) : immutableData(value)

export const variable = (name: 'X'): Amount => immutableData({ kind: 'variable', name })

export const eventAmount = (): Amount => immutableData({ kind: 'eventAmount' })

export const count = (of: Selector): Amount => immutableData({ kind: 'count', of })

export const characteristic = (
  of: Reference,
  numericCharacteristic: NumericCharacteristic,
  options: { information: 'current' | 'currentOrLastKnown' },
): Amount => immutableData({
  kind: 'characteristic',
  of,
  characteristic: numericCharacteristic,
  information: options.information,
})

export const ref = (name: ContextBinding | 'self'): ContextReference => immutableData({
  kind: 'contextRef',
  name: name === 'self' ? 'source' : name,
})

export const target = (clauseIndex: number): TargetReference =>
  immutableData({ kind: 'targetRef', clauseIndex })

export const choice = (binding: string): ChoiceReference =>
  immutableData({ kind: 'choiceRef', binding })

export const result = (binding: string, field: ResultField): ResultReference =>
  immutableData({ kind: 'resultRef', binding, field })

export const players = (filter: PlayerFilter = {}): PlayerSelector =>
  immutableData({ kind: 'players', filter })

export const objects = (filter: ObjectFilter = {}): ObjectSelector =>
  immutableData({ kind: 'objects', filter })

export const stackItems = (filter: StackItemFilter = {}): StackItemSelector =>
  immutableData({ kind: 'stackItems', filter })

export const select = (input: TargetClauseInput): TargetClause => {
  const hasCount = input.count !== undefined
  const hasBounds = input.min !== undefined || input.max !== undefined
  if (hasCount === hasBounds) {
    throw new TypeError('select requires either count or both min and max')
  }
  if (!hasCount && (input.min === undefined || input.max === undefined)) {
    throw new TypeError('select requires both min and max')
  }
  const min = toAmount(hasCount ? input.count as AmountInput : input.min as AmountInput)
  const max = toAmount(hasCount ? input.count as AmountInput : input.max as AmountInput)
  return immutableData({ filter: input.filter, min, max, distinct: true })
}

export const chooseX = (bounds: { min?: number; max?: number } = {}): VariableSpec =>
  immutableData({ name: 'X', min: bounds.min ?? 0, max: bounds.max ?? 1_000_000 })

export const chooseModes = (input: { count: AmountInput; repeatable?: boolean }): ModeSpec =>
  immutableData({ count: toAmount(input.count), repeatable: input.repeatable ?? false })

export const distribution = (input: {
  targetClauseIndex: number
  total: AmountInput
  minEach?: AmountInput
}): DistributionSpec => immutableData({
  targetClauseIndex: input.targetClauseIndex,
  total: toAmount(input.total),
  minEach: toAmount(input.minEach ?? 0),
})

export const discardCost = (filter: ObjectSelector, count: AmountInput): Cost =>
  immutableData({ kind: 'discard', filter, count: toAmount(count) })

export const sacrificeCost = (filter: ObjectSelector, count: AmountInput): Cost =>
  immutableData({ kind: 'sacrifice', filter, count: toAmount(count) })

export const lifeCost = (value: AmountInput): Cost =>
  immutableData({ kind: 'life', amount: toAmount(value) })

export const manaCost = (value: string): Cost =>
  immutableData({ kind: 'mana', amount: value })

export const compareAmount = (
  left: AmountInput,
  operator: 'eq' | 'gte' | 'lte',
  right: AmountInput,
): Condition => immutableData({
  kind: 'compareAmount',
  left: toAmount(left),
  operator,
  right: toAmount(right),
})

export const allConditions = (...conditions: readonly Condition[]): Condition =>
  immutableData({ kind: 'all', conditions })

export const anyCondition = (...conditions: readonly Condition[]): Condition =>
  immutableData({ kind: 'any', conditions })

export const notCondition = (condition: Condition): Condition =>
  immutableData({ kind: 'not', condition })

export const prohibitActivation = (
  filter: Extract<ContinuousEffectDefinition, { kind: 'prohibitActivation' }>['filter'],
): ContinuousEffectDefinition => immutableData({ kind: 'prohibitActivation', filter })

export const decisions = (input: DecisionsInput = {}): DecisionsSpec => immutableData({
  targets: input.targets ?? [],
  ...(input.modes ? { modes: input.modes } : {}),
  ...(input.variables ? { variables: input.variables } : {}),
  ...(input.distributions ? { distributions: input.distributions } : {}),
})

const normalizeProgram = (program: ResolutionProgramInput): ResolutionProgram => {
  const hasInstructions = program.instructions !== undefined
  const hasModes = program.modes !== undefined
  if (hasInstructions === hasModes) throw new TypeError('program requires exactly one of instructions or modes')
  if (hasInstructions) return immutableData({ instructions: program.instructions })
  return immutableData({
    modes: program.modes.map((entry): ModeDefinition => immutableData({
      decisions: decisions(entry.decisions),
      instructions: entry.instructions,
    })),
  })
}

export const spell = (input: {
  decisions?: DecisionsInput
  costs?: readonly Cost[]
} & ResolutionProgramInput): SpellAbilityDefinition => immutableData({
  kind: 'spell',
  decisions: decisions(input.decisions),
  costs: input.costs ?? [],
  ...normalizeProgram(input),
}) as SpellAbilityDefinition

export const activated = (input: {
  availableFrom?: readonly Zone[]
  timing?: ActivatedAbilityDefinition['timing']
  decisions?: DecisionsInput
  costs?: readonly Cost[]
} & ResolutionProgramInput): ActivatedAbilityDefinition => immutableData({
  kind: 'activated',
  availableFrom: input.availableFrom ?? ['battlefield'],
  timing: input.timing ?? 'anyTime',
  decisions: decisions(input.decisions),
  costs: input.costs ?? [],
  ...normalizeProgram(input),
}) as ActivatedAbilityDefinition

export const whenever = (
  on: OccurrencePattern,
  configuration: WheneverConfiguration,
): TriggeredAbilityDefinition => immutableData({
  kind: 'triggered',
  activeIn: configuration.activeIn ?? ['battlefield'],
  on,
  decisions: decisions(configuration.decisions),
  ...(configuration.triggerOnlyIf ? { triggerOnlyIf: configuration.triggerOnlyIf } : {}),
  ...(configuration.interveningIf ? { interveningIf: configuration.interveningIf } : {}),
  ...(configuration.frequency ? { frequency: configuration.frequency } : {}),
  ...normalizeProgram(configuration),
}) as TriggeredAbilityDefinition

export const staticAbility = (
  ...effects: StaticAbilityDefinition['effects']
): StaticAbilityDefinition => immutableData({
  kind: 'static',
  activeIn: ['battlefield'],
  effects,
})

export const keywordAbility = (keyword: Keyword): KeywordAbilityDefinition =>
  immutableData({ kind: 'keyword', keyword })

export const cardRuleDefinition = (
  schemaVersion: 1,
  definition: CardRuleDefinitionInputV1,
): CardRuleDefinitionV1 => {
  if (schemaVersion !== RULE_DSL_SCHEMA_VERSION) {
    throw new TypeError(`unsupported Rule DSL schema version: ${String(schemaVersion)}`)
  }
  const authored = immutableData(definition)
  const body = immutableData({ schemaVersion, abilities: authored.abilities })
  return immutableData({
    ...body,
    definitionRevision: definitionRevisionFor(body),
  })
}

export const enters = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'enters', filter: input.filter })

export const dies = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'dies', filter: input.filter })

export const draws = (input: Extract<OccurrencePattern, { kind: 'draw' }>['filter'] = {}): OccurrencePattern =>
  immutableData({ kind: 'draw', filter: input })

export const draw = (input: { count: AmountInput; targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'draw', count: toAmount(input.count), targets: input.targets })

export const loseLife = (input: { amount: AmountInput; targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'loseLife', amount: toAmount(input.amount), targets: input.targets })

export const gainLife = (input: { amount: AmountInput; targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'gainLife', amount: toAmount(input.amount), targets: input.targets })

export const damage = (input: {
  amount: AmountInput
  targets: Extract<Instruction, { kind: 'damage' }>['targets']
  source: ObjectReference
}): Instruction => immutableData({
  kind: 'damage',
  amount: toAmount(input.amount),
  targets: input.targets,
  source: input.source,
})

export const mill = (input: { count: AmountInput; targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'mill', count: toAmount(input.count), targets: input.targets })

export const destroy = (input: { targets: Extract<Instruction, { kind: 'destroy' }>['targets'] }): Instruction =>
  immutableData({ kind: 'destroy', targets: input.targets })

export const counter = (input: {
  targets: Extract<Instruction, { kind: 'counter' }>['targets']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'counter',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const discard = (input:
  | {
      targets: Extract<Instruction, { kind: 'discard'; by: unknown }>['targets']
      by: Extract<Instruction, { kind: 'discard'; by: unknown }>['by']
      bindResult?: string
    }
  | {
      targets: PlayerRecipient
      count: AmountInput
      bindResult?: string
    },
): Instruction => 'by' in input
  ? immutableData({
      kind: 'discard',
      targets: input.targets,
      by: input.by,
      ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
    })
  : immutableData({
      kind: 'discard',
      targets: input.targets,
      count: toAmount(input.count),
      ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
    })

export const chooseCards = (input: {
  bindChoice: string
  chooser: Extract<Instruction, { kind: 'chooseCards' }>['chooser']
  filter: ObjectSelector
  count?: AmountInput
  min?: AmountInput
  max?: AmountInput
  whenInsufficient?: 'chooseAvailable'
}): Instruction => {
  if (input.count !== undefined && (input.min !== undefined || input.max !== undefined)) {
    throw new TypeError('chooseCards accepts either count or min/max, never both')
  }
  const clause = select({
    filter: input.filter,
    ...(input.count !== undefined ? { count: input.count } : { min: input.min, max: input.max }),
  } as TargetClauseInput)
  return immutableData({
    kind: 'chooseCards',
    bindChoice: input.bindChoice,
    chooser: input.chooser,
    filter: input.filter,
    min: clause.min,
    max: clause.max,
    distinct: true,
    whenInsufficient: input.whenInsufficient ?? 'chooseAvailable',
  })
}

export const sequence = (...instructions: readonly Instruction[]): Instruction =>
  immutableData({ kind: 'sequence', instructions })

export const chooseInstructions = (input: {
  chooser: Extract<Instruction, { kind: 'chooseInstructions' }>['chooser']
  options: Extract<Instruction, { kind: 'chooseInstructions' }>['options']
}): Instruction => immutableData({
  kind: 'chooseInstructions',
  chooser: input.chooser,
  count: amount(1),
  options: input.options,
  whenInsufficient: 'chooseAvailable',
}) as Instruction

export const resultIsTrue = (value: ResultReference): Condition =>
  immutableData({ kind: 'resultIsTrue', value })

export const ifThen = (
  condition: Condition | ResultReference,
  branches: { then: readonly Instruction[]; otherwise?: readonly Instruction[] },
): Instruction => immutableData({
  kind: 'if',
  condition: condition.kind === 'resultRef' ? resultIsTrue(condition) : condition,
  then: branches.then,
  otherwise: branches.otherwise ?? [],
})

export type { ModeInput }
