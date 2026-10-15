import type {
  ActivatedAbilityDefinition,
  Amount,
  AmountInput,
  CardRuleDefinitionInputV1,
  CardRuleDefinitionV1,
  ChoiceReference,
  Condition,
  ContinuousEffectDefinition,
  DrawReplacementFilter,
  EventFieldChanges,
  CreatedEffect,
  ContextBinding,
  ContextReference,
  Cost,
  DecisionsInput,
  DecisionsSpec,
  DelayedPattern,
  EffectDuration,
  DistributionSpec,
  Instruction,
  Keyword,
  KeywordAbilityDefinition,
  ModeDefinition,
  ModeInput,
  ReplacementEventPattern,
  ModeSpec,
  NumericCharacteristic,
  ObjectFilter,
  ObjectOccurrenceFilter,
  ObjectReference,
  ObjectRecipient,
  ObjectSelector,
  OccurrencePattern,
  PlayerFilter,
  PlayerReference,
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
  TargetConstraint,
  TargetReference,
  TokenDefinition,
  TriggeredAbilityDefinition,
  VariableSpec,
  WheneverConfiguration,
  Zone,
} from '../schema/v1'
import { CHOSEN_COLOR_BINDING, RULE_DSL_SCHEMA_VERSION } from '../schema/v1'
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

export const sacrificeCost = (filter: ObjectRecipient, count: AmountInput): Cost =>
  immutableData({ kind: 'sacrifice', filter, count: toAmount(count) })

export const drawCost = (count: AmountInput): Cost =>
  immutableData({ kind: 'draw', count: toAmount(count) })

export const lifeCost = (value: AmountInput): Cost =>
  immutableData({ kind: 'life', amount: toAmount(value) })

export const manaCost = (value: string): Cost =>
  immutableData({ kind: 'mana', amount: value })

export const untilCleanup = (): EffectDuration => immutableData({ kind: 'untilCleanup' })
export const permanentEffect = (): EffectDuration => immutableData({ kind: 'permanent' })
export const untilStep = (step: string, active?: PlayerReference): EffectDuration => immutableData({
  kind: 'untilStep', step, ...(active ? { active } : {}),
})
export const forTurns = (count: AmountInput): EffectDuration => immutableData({ kind: 'forTurns', count: toAmount(count) })
export const whileSourceOnBattlefield = (): EffectDuration => immutableData({ kind: 'whileSourceOnBattlefield' })

export const pumpEffect = (power: AmountInput, toughness: AmountInput): CreatedEffect => immutableData({
  kind: 'pump', power: toAmount(power), toughness: toAmount(toughness),
})
export const setColorsEffect = (colors: Extract<CreatedEffect, { kind: 'setColors' }>['colors']): CreatedEffect =>
  immutableData({ kind: 'setColors', colors })

export const grantKeywordEffect = (keyword: Keyword): CreatedEffect => immutableData({ kind: 'grantKeyword', keyword })
export const grantAbilityEffect = (ability: Extract<CreatedEffect, { kind: 'grantAbility' }>['ability']): CreatedEffect => immutableData({ kind: 'grantAbility', ability })
export const eventDelayed = (input: Omit<Extract<DelayedPattern, { kind: 'event' }>, 'kind'>): DelayedPattern => immutableData({ kind: 'event', ...input })
export const stepDelayed = (input: Omit<Extract<DelayedPattern, { kind: 'step' }>, 'kind'>): DelayedPattern => immutableData({ kind: 'step', ...input })

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

export const extraLandPlays = (count: number): ContinuousEffectDefinition =>
  immutableData({ kind: 'extraLandPlays', count })

export const replacement = (
  event: Extract<ContinuousEffectDefinition, { kind: 'replacement' }>['event'],
  transform: Extract<ContinuousEffectDefinition, { kind: 'replacement' }>['transform'],
  options: { when?: Condition; optional?: boolean; program?: Extract<ContinuousEffectDefinition, { kind: 'replacement' }>['program'] } = {},
): ContinuousEffectDefinition => immutableData({
  kind: 'replacement',
  event,
  transform,
  optional: options.optional ?? false,
  ...(options.when ? { when: options.when } : {}),
  ...(options.program ? { program: options.program } : {}),
})

export const modifyEvent = (changes: EventFieldChanges) =>
  immutableData({ kind: 'modifyEvent' as const, changes })

export const replaceWith = (...instructions: Instruction[]) =>
  immutableData({ kind: 'replaceWith' as const, instructions })

export const suppressEvent = () => immutableData({ kind: 'suppress' as const })

export const redirectEvent = (to: Zone) => immutableData({ kind: 'redirect' as const, to })

export const preventDamage = () => immutableData({ kind: 'preventDamage' as const })

export const prevention = (
  filter: Extract<ContinuousEffectDefinition, { kind: 'prevention' }>['filter'],
  transform: Extract<ContinuousEffectDefinition, { kind: 'prevention' }>['transform'],
  options: {
    capacity: AmountInput
    additionalEffects?: readonly Instruction[]
  },
): Extract<ContinuousEffectDefinition, { kind: 'prevention' }> => immutableData({
  kind: 'prevention',
  filter,
  transform,
  capacity: toAmount(options.capacity),
  ...(options.additionalEffects ? { additionalEffects: options.additionalEffects } : {}),
})

export const preventionCreatedEffect = (
  filter: Extract<CreatedEffect, { kind: 'prevention' }>['filter'],
  capacity: AmountInput,
  additionalEffects?: readonly Instruction[],
): Extract<CreatedEffect, { kind: 'prevention' }> => immutableData({
  kind: 'prevention',
  filter,
  capacity: toAmount(capacity),
  ...(additionalEffects ? { additionalEffects } : {}),
})

export const wouldDealDamage = (filter: Extract<ReplacementEventPattern, { kind: 'damage' }>['filter'] = {}) =>
  immutableData({ kind: 'damage' as const, filter })

export const multiplyDamage = (factor: AmountInput) =>
  modifyEvent({ amount: { kind: 'multiply', factor: toAmount(factor) } })

export const wouldDraw = (filter: DrawReplacementFilter = {}) => immutableData({ kind: 'draw' as const, filter })

export const wouldEnter = (
  filter: Extract<ReplacementEventPattern, { kind: 'enterBattlefield' }>['filter'] = { object: ref('source') },
) => immutableData({ kind: 'enterBattlefield' as const, filter })

export const wouldMove = (
  filter: Extract<ReplacementEventPattern, { kind: 'move' }>['filter'] = {},
) => immutableData({ kind: 'move' as const, filter })

export const COLOR_CHOICE_OPTIONS = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
] as const

export const chooseColor = (bindChoice = CHOSEN_COLOR_BINDING) =>
  immutableData({
    kind: 'choose' as const,
    bindChoice,
    options: COLOR_CHOICE_OPTIONS.map((option) => ({ id: option.id, label: option.label })),
  })

/** "As this enters, choose a color." Self-entry replacement; the object still enters. */
export const asThisEntersChooseColor = () =>
  replacement(wouldEnter(), modifyEvent({}), { program: [chooseColor()] })

export const modifyStats = (
  input: Omit<Extract<ContinuousEffectDefinition, { kind: 'modifyStats' }>, 'kind'>,
): ContinuousEffectDefinition => immutableData({ kind: 'modifyStats', ...input })

export const decisions = (input: DecisionsInput = {}): DecisionsSpec => immutableData({
  targets: input.targets ?? [],
  ...(input.constraints ? { constraints: input.constraints } : {}),
  ...(input.modes ? { modes: input.modes } : {}),
  ...(input.variables ? { variables: input.variables } : {}),
  ...(input.distributions ? { distributions: input.distributions } : {}),
})

export const differentTargets = (...clauseIndices: readonly number[]) =>
  immutableData({ kind: 'different' as const, clauseIndices }) satisfies TargetConstraint

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

type CostFieldsInput = Partial<Pick<
  SpellAbilityDefinition,
  'costs' | 'optionalCosts' | 'alternativeCosts' | 'costIncreases' | 'costReductions'
>>

const normalizeCostFields = (input: CostFieldsInput) => ({
  costs: input.costs ?? [],
  ...(input.optionalCosts ? { optionalCosts: input.optionalCosts } : {}),
  ...(input.alternativeCosts ? { alternativeCosts: input.alternativeCosts } : {}),
  ...(input.costIncreases ? { costIncreases: input.costIncreases } : {}),
  ...(input.costReductions ? { costReductions: input.costReductions } : {}),
})

export const spell = (input: {
  decisions?: DecisionsInput
} & CostFieldsInput & ResolutionProgramInput) => immutableData({
  kind: 'spell' as const,
  decisions: decisions(input.decisions),
  ...normalizeCostFields(input),
  ...normalizeProgram(input),
}) satisfies SpellAbilityDefinition

export const activated = (input: {
  availableFrom?: readonly Zone[]
  timing?: ActivatedAbilityDefinition['timing']
  decisions?: DecisionsInput
} & CostFieldsInput & ResolutionProgramInput) => immutableData({
  kind: 'activated' as const,
  availableFrom: input.availableFrom ?? ['battlefield'],
  timing: input.timing ?? 'anyTime',
  decisions: decisions(input.decisions),
  ...normalizeCostFields(input),
  ...normalizeProgram(input),
}) satisfies ActivatedAbilityDefinition

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
  ...(configuration.manaAbility ? { manaAbility: true as const } : {}),
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

export const leaves = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'leaves', filter: input.filter })

export const draws = (input: Extract<OccurrencePattern, { kind: 'draw' }>['filter'] = {}): OccurrencePattern =>
  immutableData({ kind: 'draw', filter: input })

export const manaAdded = (): OccurrencePattern => immutableData({ kind: 'manaAdded' })

export const draw = (input: number | { count: AmountInput; targets: PlayerRecipient }) => {
  const { count, targets } = typeof input === 'number'
    ? { count: input, targets: ref('controller') }
    : input
  return immutableData({ kind: 'draw' as const, count: toAmount(count), targets })
}

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

export const shuffle = (input: { targets: PlayerRecipient }) =>
  immutableData({ kind: 'shuffle' as const, targets: input.targets })

export const destroy = (input: {
  targets: Extract<Instruction, { kind: 'destroy' }>['targets']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'destroy',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const sacrifice = (input: {
  targets: Extract<Instruction, { kind: 'sacrifice' }>['targets']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'sacrifice',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const move = (input: {
  targets: Extract<Instruction, { kind: 'move' }>['targets']
  to: Extract<Instruction, { kind: 'move' }>['to']
  tapped?: boolean
  bindResult?: string
}): Instruction => immutableData({
  kind: 'move',
  targets: input.targets,
  to: input.to,
  ...(input.tapped !== undefined ? { tapped: input.tapped } : {}),
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const phase = (input: {
  targets: Extract<Instruction, { kind: 'phase' }>['targets']
  out: boolean
}): Instruction => immutableData({ kind: 'phase', targets: input.targets, out: input.out })

export const proliferate = (input: {
  targets: Extract<Instruction, { kind: 'proliferate' }>['targets']
}): Instruction => immutableData({ kind: 'proliferate', targets: input.targets })

export const createToken = (input: {
  count: AmountInput
  targets: Extract<Instruction, { kind: 'createToken' }>['targets']
  token: TokenDefinition
  bindResult?: string
}): Instruction => immutableData({
  kind: 'createToken',
  count: toAmount(input.count),
  targets: input.targets,
  token: input.token,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const copy = (input: {
  targets: Extract<Instruction, { kind: 'copy' }>['targets']
  controller?: Extract<Instruction, { kind: 'copy' }>['controller']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'copy',
  targets: input.targets,
  ...(input.controller !== undefined ? { controller: input.controller } : {}),
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const copySpell = (input: {
  targets: Extract<Instruction, { kind: 'copySpell' }>['targets']
  controller?: Extract<Instruction, { kind: 'copySpell' }>['controller']
  retarget?: Extract<Instruction, { kind: 'copySpell' }>['retarget']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'copySpell',
  targets: input.targets,
  ...(input.controller !== undefined ? { controller: input.controller } : {}),
  ...(input.retarget !== undefined ? { retarget: input.retarget } : {}),
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const putCounters = (input: {
  targets: Extract<Instruction, { kind: 'putCounters' }>['targets']
  counter: string
  count: AmountInput
  bindResult?: string
}): Instruction => immutableData({
  kind: 'putCounters',
  targets: input.targets,
  counter: input.counter,
  count: toAmount(input.count),
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const counter = (input: {
  targets: Extract<Instruction, { kind: 'counter' }>['targets']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'counter',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const createEffect = (input: {
  targets: Extract<Instruction, { kind: 'createEffect' }>['targets']
  effect: CreatedEffect
  duration: EffectDuration
}): Instruction => immutableData({ kind: 'createEffect', ...input })

export const payOptional = (input: {
  payer: Extract<Instruction, { kind: 'payOptional' }>['payer']
  cost: Cost
  bindResult: string
  whenPaidDecisions?: DecisionsInput
  ifPaid?: readonly Instruction[]
  ifDeclined?: readonly Instruction[]
  whenPaid?: readonly Instruction[]
}): Instruction => immutableData({
  kind: 'payOptional', ...input,
  ...(input.whenPaidDecisions ? { whenPaidDecisions: decisions(input.whenPaidDecisions) } : {}),
  ...(input.ifPaid ? { ifPaid: input.ifPaid } : {}),
  ...(input.ifDeclined ? { ifDeclined: input.ifDeclined } : {}),
  ...(input.whenPaid ? { whenPaid: input.whenPaid } : {}),
})

export const createDelayed = (input: {
  condition: DelayedPattern
  instructions: readonly Instruction[]
}): Instruction => immutableData({ kind: 'createDelayed', ...input })

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
  viewLibrary?: true
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
    ...(input.viewLibrary ? { viewLibrary: true as const } : {}),
    min: clause.min,
    max: clause.max,
    distinct: true,
    whenInsufficient: input.whenInsufficient ?? 'chooseAvailable',
  })
}

export const sequence = (...instructions: readonly Instruction[]): Instruction =>
  immutableData({ kind: 'sequence', instructions })

/** Hidden-zone library search: typed `selectCards`, move the found cards, then shuffle. */
export const searchLibrary = (input: {
  bindChoice: string
  chooser: PlayerReference
  filter?: ObjectSelector
  count?: AmountInput
  min?: AmountInput
  max?: AmountInput
  to: Zone
}) => sequence(
  chooseCards({
    bindChoice: input.bindChoice,
    chooser: input.chooser,
    filter: input.filter ?? objects({ zone: 'library', owner: 'you' }),
    viewLibrary: true,
    ...(input.count !== undefined ? { count: input.count } : { min: input.min, max: input.max }),
  }),
  move({ targets: choice(input.bindChoice), to: input.to }),
  shuffle({ targets: input.chooser }),
)

export const chooseInstructions = (input: {
  optional?: true
  chooser: Extract<Instruction, { kind: 'chooseInstructions' }>['chooser']
  prompt?: string
  options: Extract<Instruction, { kind: 'chooseInstructions' }>['options']
}) => immutableData({
  kind: 'chooseInstructions' as const,
  ...(input.optional !== undefined ? { optional: input.optional } : {}),
  chooser: input.chooser,
  ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
  count: { kind: 'constant' as const, value: 1 as const },
  options: input.options,
  whenInsufficient: 'chooseAvailable' as const,
})

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

export const revealUntil = (input: {
  targets: PlayerRecipient
  match: ObjectSelector
  count?: AmountInput
  bindFound?: string
  bindRest?: string
  foundTo: Zone
  rest: 'orderBottom'
}): Instruction => immutableData({
  kind: 'revealUntil',
  targets: input.targets,
  match: input.match,
  ...(input.count !== undefined ? { count: toAmount(input.count) } : {}),
  ...(input.bindFound !== undefined ? { bindFound: input.bindFound } : {}),
  ...(input.bindRest !== undefined ? { bindRest: input.bindRest } : {}),
  foundTo: input.foundTo,
  rest: input.rest,
})

export type { ModeInput }
