import type {
  ActivatedAbilityDefinition,
  Amount,
  AmountCompareOperator,
  AmountInput,
  StatDeltaInput,
  RoundingMode,
  CardColor,
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
  CostReduction,
  DecisionsInput,
  DecisionsSpec,
  DelayedPattern,
  EffectDuration,
  DistributionSpec,
  Instruction,
  LibraryVisibility,
  Keyword,
  KeywordAbilityDefinition,
  LifeLostCombine,
  LifeTotalAmount,
  ManaQueryBasis,
  LinkedExileReturn,
  ModeDefinition,
  ModeInput,
  ReplacementEventPattern,
  ReplacementProgramInstruction,
  ModeSpec,
  NumericCharacteristic,
  ObjectNumericCharacteristic,
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
  PreventionCapacity,
  PreventionCapacityInput,
  PreventionFilter,
  Reference,
  ResolutionProgram,
  ResolutionProgramInput,
  ResultField,
  ResultReference,
  Selector,
  SpellAbilityDefinition,
  StackItemFilter,
  StackItemReference,
  StackItemSelector,
  StaticAbilityDefinition,
  TargetClause,
  TargetClauseInput,
  TargetConstraint,
  TargetReference,
  TokenDefinition,
  TriggeredAbilityDefinition,
  VariableSpec,
  VoteSpec,
  WheneverConfiguration,
  Zone,
} from '../schema/v1'
import {
  LIBRARY_VISIBILITY,
  CHOSEN_COLOR_BINDING,
  DECLINE_LIFE_OPTION,
  ENTRY_PAYMENT_BINDING,
  PAY_LIFE_OPTION,
  RULE_DSL_SCHEMA_VERSION,
  UNLIMITED_PREVENTION,
} from '../schema/v1'
import { immutableData } from './immutable'
import { definitionRevisionFor } from './revision'
import type { RoomDoorId, StepId } from '../../../types'

export const amount = (value: number): Amount => immutableData({ kind: 'constant', value })

export const toAmount = (value: AmountInput): Amount =>
  typeof value === 'number' ? amount(value) : immutableData(value)

export const unlimitedPrevention = () => immutableData(UNLIMITED_PREVENTION)

export const toPreventionCapacity = (value: PreventionCapacityInput): PreventionCapacity =>
  typeof value === 'object' && value.kind === 'unlimited' ? unlimitedPrevention() : toAmount(value)

export const divide = (input: { value: AmountInput; by: number; rounding: RoundingMode }) =>
  immutableData({ kind: 'divide' as const, value: toAmount(input.value), by: input.by, rounding: input.rounding })

export const multiply = (left: AmountInput, right: AmountInput) =>
  immutableData({ kind: 'multiply' as const, left: toAmount(left), right: toAmount(right) })

export const minimum = (left: AmountInput, right: AmountInput) =>
  immutableData({ kind: 'minimum' as const, left: toAmount(left), right: toAmount(right) })

export const addAmount = (left: AmountInput, right: AmountInput) =>
  immutableData({ kind: 'add' as const, left: toAmount(left), right: toAmount(right) })

export const counterCount = (of: ObjectReference, counter: string) =>
  immutableData({ kind: 'counterCount' as const, of, counter })

export const difference = (left: AmountInput, right: AmountInput) =>
  immutableData({ kind: 'difference' as const, left: toAmount(left), right: toAmount(right) })

export const greatest = (input: {
  of: ObjectSelector
  characteristic: ObjectNumericCharacteristic
  information: 'current' | 'currentOrLastKnown'
}) => immutableData({ kind: 'greatest' as const, ...input })

export const compareCharacteristic = (
  characteristic: ObjectNumericCharacteristic,
  operator: AmountCompareOperator,
  than: AmountInput,
) => immutableData({ characteristic, operator, than: toAmount(than) })

export const negate = (value: AmountInput) => immutableData({ kind: 'negate' as const, value: toAmount(value) })

const toStatDelta = (value: StatDeltaInput) => typeof value === 'number' ? amount(value) : immutableData(value)

export const resultAmount = (binding: string, field: Extract<Amount, { kind: 'resultRef' }>['field'] = 'amount') =>
  immutableData({ kind: 'resultRef' as const, binding, field })

export const inspectTop = (input: { player: PlayerReference; count: AmountInput; bindChoice: string; visibility?: LibraryVisibility }) =>
  immutableData({ kind: 'inspectTop' as const, ...input, count: toAmount(input.count), visibility: input.visibility ?? LIBRARY_VISIBILITY.private })

export const partitionPiles = (input: {
  cards: ObjectRecipient
  partitioner: PlayerReference
  chooser: PlayerReference
  bindChosen: string
  bindOther: string
}) => immutableData({ kind: 'partitionPiles' as const, ...input })

export const vote = (input: {
  prompt: string
  options: VoteSpec
  bindResult: string
  bindWinners?: string
}) => immutableData({
  kind: 'vote' as const,
  prompt: input.prompt,
  options: input.options,
  bindResult: input.bindResult,
  ...(input.bindWinners !== undefined ? { bindWinners: input.bindWinners } : {}),
})

export const voteLeads = (binding: string, option: string) =>
  immutableData({ kind: 'voteLeads' as const, binding, option })

export const voteTally = (binding: string, option: string) =>
  immutableData({ kind: 'voteTally' as const, binding, option })

export const capturePlayer = (input: { player: PlayerReference; bindResult: string }) =>
  immutableData({ kind: 'capturePlayer' as const, ...input })

export const captureCopy = (input: { targets: ObjectRecipient; bindResult: string }) =>
  immutableData({ kind: 'captureCopy' as const, ...input })

export const controllerOf = (of: ObjectReference | StackItemReference, options: { information?: 'currentOrLastKnown' } = {}) =>
  immutableData({ kind: 'relatedPlayer' as const, relation: 'controller' as const, of, ...(options.information ? { information: options.information } : {}) })

export const ownerOf = (of: ObjectReference) =>
  immutableData({ kind: 'relatedPlayer' as const, relation: 'owner' as const, of })

export const resultPlayer = (binding: string) =>
  immutableData({ kind: 'resultRef' as const, binding, field: 'player' as const })

export const captureAmount = (input: { amount: AmountInput; bindResult: string }) =>
  immutableData({ kind: 'captureAmount' as const, amount: toAmount(input.amount), bindResult: input.bindResult })

export const variable = (name: 'X'): Amount => immutableData({ kind: 'variable', name })

export const eventAmount = (): Amount => immutableData({ kind: 'eventAmount' })

export const manaSpent = (color: CardColor): Amount => immutableData({ kind: 'manaSpent', color })

export const sumCharacteristics = (of: ObjectSelector, characteristic: 'power' | 'toughness') =>
  immutableData({ kind: 'sumCharacteristics' as const, of, characteristic })

export const count = (of: Selector): Amount => immutableData({ kind: 'count', of })

export const characteristic = (
  of: Reference,
  numericCharacteristic: NumericCharacteristic,
  options: { information: 'current' | 'currentOrLastKnown'; fallback?: number },
): Amount => immutableData({
  kind: 'characteristic',
  of,
  characteristic: numericCharacteristic,
  information: options.information,
  ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
})

export const lifeLostThisTurn = (input: { of: PlayerRecipient; combine?: LifeLostCombine }): Amount =>
  immutableData({
    kind: 'lifeLostThisTurn' as const,
    of: input.of,
    ...(input.combine !== undefined ? { combine: input.combine } : {}),
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

export const anyTarget = () => immutableData({ kind: 'anyTarget' as const })

export const players = (filter: PlayerFilter = {}): PlayerSelector =>
  immutableData({ kind: 'players', filter })

export const objects = (filter: ObjectFilter = {}): ObjectSelector =>
  immutableData({ kind: 'objects', filter })

/** Objects still matching `from` after excluding a later subset choice. */
export const remaining = (from: ObjectReference, except: ObjectReference) =>
  objects({ among: from, not: { among: except } })

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

export const chooseX = (bounds: { min?: number; max?: number; manaColor?: VariableSpec['manaColor'] } = {}): VariableSpec =>
  immutableData({ name: 'X', min: bounds.min ?? 0, max: bounds.max ?? 1_000_000, ...(bounds.manaColor ? { manaColor: bounds.manaColor } : {}) })

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

export const discardCost = (filter: ObjectRecipient, count: AmountInput): Cost =>
  immutableData({ kind: 'discard', filter, count: toAmount(count) })

export const sacrificeCost = (filter: ObjectRecipient, count: AmountInput): Cost =>
  immutableData({ kind: 'sacrifice', filter, count: toAmount(count) })

export const millCost = (count: AmountInput): Cost => immutableData({ kind: 'mill', count: toAmount(count) })

export const drawCost = (count: AmountInput): Cost =>
  immutableData({ kind: 'draw', count: toAmount(count) })

export const tapCost = () => immutableData({ kind: 'tapSource' as const }) satisfies Cost

export const lifeCost = (value: AmountInput): Cost =>
  immutableData({ kind: 'life', amount: toAmount(value) })

export const manaCost = (value: string): Cost =>
  immutableData({ kind: 'mana', amount: value })

export const delve = (): Cost =>
  immutableData({ kind: 'delve' as const }) satisfies Cost

export const untilCleanup = (): EffectDuration => immutableData({ kind: 'untilCleanup' })
export const permanentEffect = (): EffectDuration => immutableData({ kind: 'permanent' })
export const untilStep = (step: string, active?: PlayerReference): EffectDuration => immutableData({
  kind: 'untilStep', step, ...(active ? { active } : {}),
})
export const forTurns = (count: AmountInput): EffectDuration => immutableData({ kind: 'forTurns', count: toAmount(count) })
export const whileSourceOnBattlefield = (): EffectDuration => immutableData({ kind: 'whileSourceOnBattlefield' })

export const pumpEffect = (power: StatDeltaInput, toughness: StatDeltaInput): CreatedEffect => immutableData({
  kind: 'pump', power: toStatDelta(power), toughness: toStatDelta(toughness),
})
export const setColorsEffect = (colors: Extract<CreatedEffect, { kind: 'setColors' }>['colors']): CreatedEffect =>
  immutableData({ kind: 'setColors', colors })

export const grantKeywordEffect = (keyword: Keyword): CreatedEffect => immutableData({ kind: 'grantKeyword', keyword })
export const grantAbilityEffect = (ability: Extract<CreatedEffect, { kind: 'grantAbility' }>['ability']): CreatedEffect => immutableData({ kind: 'grantAbility', ability })
export const eventDelayed = (input: Omit<Extract<DelayedPattern, { kind: 'event' }>, 'kind'>): DelayedPattern => immutableData({ kind: 'event', ...input })
export const stepDelayed = (input: Omit<Extract<DelayedPattern, { kind: 'step' }>, 'kind'>): DelayedPattern => immutableData({ kind: 'step', ...input })

export const compareAmount = (
  left: AmountInput,
  operator: AmountCompareOperator,
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

export const activePlayer = (of: PlayerReference): Condition =>
  immutableData({ kind: 'activePlayer', of })

export const currentStep = (step: StepId | readonly StepId[]): Condition =>
  immutableData({ kind: 'currentStep', step })

export const prohibitActivation = (
  filter: Extract<ContinuousEffectDefinition, { kind: 'prohibitActivation' }>['filter'],
): ContinuousEffectDefinition => immutableData({ kind: 'prohibitActivation', filter })

export const grantKeyword = (input: Omit<Extract<ContinuousEffectDefinition, { kind: 'grantKeyword' }>, 'kind'>) =>
  immutableData({ kind: 'grantKeyword' as const, ...input })

export const suppressKeyword = (input: Omit<Extract<ContinuousEffectDefinition, { kind: 'suppressKeyword' }>, 'kind'>) =>
  immutableData({ kind: 'suppressKeyword' as const, ...input })

export const untapDuringOtherPlayersSteps = (targets: ObjectSelector) =>
  immutableData({ kind: 'untapDuringOthers' as const, targets })

export const noMaximumHandSize = (): ContinuousEffectDefinition =>
  immutableData({ kind: 'noMaximumHandSize' })

export const cannotBeCountered = (): ContinuousEffectDefinition =>
  immutableData({ kind: 'cannotBeCountered' })

export const extraLandPlays = (count: number): ContinuousEffectDefinition =>
  immutableData({ kind: 'extraLandPlays', count })

export const reduceActivationCost = (input: {
  targets: ObjectSelector
  generic: AmountInput
}): ContinuousEffectDefinition => immutableData({
  kind: 'reduceActivationCost',
  targets: input.targets,
  generic: toAmount(input.generic),
})

export const costReduction = (generic: AmountInput, reason?: string): CostReduction =>
  immutableData({ generic: toAmount(generic), ...(reason ? { reason } : {}) })

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
    capacity: PreventionCapacityInput
    additionalEffects?: readonly Instruction[]
  },
): Extract<ContinuousEffectDefinition, { kind: 'prevention' }> => immutableData({
  kind: 'prevention',
  filter,
  transform,
  capacity: toPreventionCapacity(options.capacity),
  ...(options.additionalEffects ? { additionalEffects: options.additionalEffects } : {}),
})

export const preventionCreatedEffect = (
  filter: Extract<CreatedEffect, { kind: 'prevention' }>['filter'],
  capacity: PreventionCapacityInput,
  additionalEffects?: readonly Instruction[],
): Extract<CreatedEffect, { kind: 'prevention' }> => immutableData({
  kind: 'prevention',
  filter,
  capacity: toPreventionCapacity(capacity),
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

export const chooseOption = (
  bindChoice: string,
  options: readonly { id: string; label: string }[],
  extras: { prompt?: string } = {},
) => immutableData({
  kind: 'choose' as const,
  bindChoice,
  options: options.map((option) => ({ id: option.id, label: option.label })),
  ...(extras.prompt ? { prompt: extras.prompt } : {}),
})

export const choiceIs = (binding: string, option: string): Condition =>
  immutableData({ kind: 'choiceIs', binding, option })

export const programBranch = (
  condition: Condition,
  then: readonly ReplacementProgramInstruction[],
  otherwise: readonly ReplacementProgramInstruction[] = [],
) => immutableData({
  kind: 'branch' as const,
  condition,
  then,
  ...(otherwise.length > 0 ? { otherwise } : {}),
})

export const payLife = (value: AmountInput) =>
  immutableData({ kind: 'payLife' as const, amount: toAmount(value) })

export const emit = (...instructions: Instruction[]) =>
  immutableData({ kind: 'emit' as const, instructions })

/** CR 702.83: as this creature enters, you may sacrifice any number of the given permanents. */
export const devour = (
  countersPer: AmountInput = 1,
  types: readonly string[] = ['Creature'],
) => {
  const eligible = objects({
    zone: 'battlefield',
    controller: 'you',
    other: true,
    ...(types.length === 1 ? { type: types[0] } : { any: types.map(type => ({ type })) }),
  })
  return replacement(wouldEnter(), modifyEvent({}), {
    program: [
      chooseCards({ chooser: ref('controller'), filter: eligible, bindChoice: 'devoured', min: 0, max: count(eligible) }),
      emit(sacrifice({ targets: choice('devoured'), bindCount: 'devouredCount' })),
      modifyEvent({ enterCounters: { '+1/+1': multiply(resultAmount('devouredCount'), countersPer) } }),
    ],
  })
}

/** "As this enters, choose a color." Self-entry replacement; the object still enters. */
export const asThisEntersChooseColor = () =>
  replacement(wouldEnter(), modifyEvent({}), { program: [chooseColor()] })

/** "As this land enters, you may pay N life. If you don't, it enters tapped." */
export const asThisEntersPayLifeOrTap = (life: number) =>
  replacement(wouldEnter(), modifyEvent({}), {
    program: [
      chooseOption(ENTRY_PAYMENT_BINDING, [
        { id: PAY_LIFE_OPTION, label: `Pay ${life} life` },
        { id: DECLINE_LIFE_OPTION, label: 'Enter tapped' },
      ], { prompt: `You may pay ${life} life. If you don't, this land enters tapped.` }),
      programBranch(
        allConditions(
          choiceIs(ENTRY_PAYMENT_BINDING, PAY_LIFE_OPTION),
          compareAmount(characteristic(ref('controller'), 'life', { information: 'current' }), 'gte', life),
        ),
        [payLife(life)],
        [modifyEvent({ tapped: true })],
      ),
    ],
  })

export const modifyStats = (
  input: Omit<Extract<ContinuousEffectDefinition, { kind: 'modifyStats' }>, 'kind'>,
): ContinuousEffectDefinition => immutableData({ kind: 'modifyStats', ...input })

export const grantAbilityTo = (
  input: Omit<Extract<ContinuousEffectDefinition, { kind: 'grantAbility' }>, 'kind'>,
): ContinuousEffectDefinition => immutableData({ kind: 'grantAbility', ...input })

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

type CostReductionInput = { generic: AmountInput; reason?: string }

type CostFieldsInput = Partial<Pick<
  SpellAbilityDefinition,
  'costs' | 'optionalCosts' | 'alternativeCosts' | 'costIncreases'
>> & {
  costReductions?: readonly CostReductionInput[]
}

const normalizeCostFields = (input: CostFieldsInput) => ({
  costs: input.costs ?? [],
  ...(input.optionalCosts ? { optionalCosts: input.optionalCosts } : {}),
  ...(input.alternativeCosts ? { alternativeCosts: input.alternativeCosts } : {}),
  ...(input.costIncreases ? { costIncreases: input.costIncreases } : {}),
  ...(input.costReductions ? {
    costReductions: input.costReductions.map((reduction) => costReduction(reduction.generic, reduction.reason)),
  } : {}),
})

export const spell = (input: {
  decisions?: DecisionsInput
  when?: Condition
  uncounterable?: true
} & CostFieldsInput & ResolutionProgramInput) => immutableData({
  kind: 'spell' as const,
  ...(input.when ? { when: input.when } : {}),
  ...(input.uncounterable ? { uncounterable: true as const } : {}),
  decisions: decisions(input.decisions),
  ...normalizeCostFields(input),
  ...normalizeProgram(input),
}) satisfies SpellAbilityDefinition

export const activated = (input: {
  availableFrom?: readonly Zone[]
  timing?: ActivatedAbilityDefinition['timing']
  decisions?: DecisionsInput
  cycling?: true
  when?: Condition
} & CostFieldsInput & ResolutionProgramInput) => immutableData({
  kind: 'activated' as const,
  availableFrom: input.availableFrom ?? ['battlefield'],
  timing: input.timing ?? 'anyTime',
  ...(input.when ? { when: input.when } : {}),
  decisions: decisions(input.decisions),
  ...(input.cycling ? { cycling: true as const } : {}),
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

export const keywordAbility = (keyword: Keyword, options: { when?: Condition } = {}): KeywordAbilityDefinition =>
  immutableData({ kind: 'keyword', keyword, ...(options.when ? { when: options.when } : {}) })

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

export const attacks = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'attacks', filter: input.filter })

export const dealtDamage = (
  filter: Extract<OccurrencePattern, { kind: 'dealtDamage' }>['filter'] = {},
): OccurrencePattern => immutableData({ kind: 'dealtDamage', filter })

export const playerAttacks = (
  filter: Extract<OccurrencePattern, { kind: 'playerAttacks' }>['filter'] = {},
): OccurrencePattern => immutableData({ kind: 'playerAttacks', filter })

export const stepBegins = (input: Omit<Extract<OccurrencePattern, { kind: 'stepBegins' }>, 'kind'>) =>
  immutableData({ kind: 'stepBegins' as const, ...input })

export const landPlayed = (filter: { player?: PlayerReference | PlayerSelector } = {}) =>
  immutableData({ kind: 'playLand' as const, filter })

export const cardDiscarded = (filter: { player?: PlayerReference | PlayerSelector } = {}) =>
  immutableData({ kind: 'discard' as const, filter })

export const cardCycled = (filter: { player?: PlayerReference | PlayerSelector; object?: ObjectOccurrenceFilter } = {}) =>
  immutableData({ kind: 'cycle' as const, filter })

export const spellCast = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'cast', filter: input.filter })

export const enters = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'enters', filter: input.filter })

export const dies = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'dies', filter: input.filter })

export const leaves = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'leaves', filter: input.filter })

export const draws = (input: Extract<OccurrencePattern, { kind: 'draw' }>['filter'] = {}): OccurrencePattern =>
  immutableData({ kind: 'draw', filter: input })

export const manaAdded = (): OccurrencePattern => immutableData({ kind: 'manaAdded' })

export const unlockDoor = (
  input: { door?: RoomDoorId; filter?: ObjectOccurrenceFilter } = {},
): OccurrencePattern => immutableData({ kind: 'unlockDoor' as const, ...input })

export const fullyUnlock = (
  input: { filter?: ObjectOccurrenceFilter } = {},
): OccurrencePattern => immutableData({ kind: 'fullyUnlock' as const, ...input })

export const lockOrUnlockDoor = (input: { targets: ObjectRecipient }): Instruction =>
  immutableData({ kind: 'lockOrUnlockDoor' as const, ...input })

export const draw = (input: number | { count: AmountInput; targets: PlayerRecipient }) => {
  const { count, targets } = typeof input === 'number'
    ? { count: input, targets: ref('controller') }
    : input
  return immutableData({ kind: 'draw' as const, count: toAmount(count), targets })
}

export const loseLife = (input: { amount: AmountInput; targets: PlayerRecipient; bindResult?: string }): Instruction =>
  immutableData({ kind: 'loseLife', amount: toAmount(input.amount), targets: input.targets, ...(input.bindResult ? { bindResult: input.bindResult } : {}) })

export const gainLife = (input: { amount: AmountInput; targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'gainLife', amount: toAmount(input.amount), targets: input.targets })

export const lowestLife = (of: PlayerSelector = players()) =>
  immutableData({ kind: 'lowestLife' as const, of })

export const setLife = (input: { amount: number | LifeTotalAmount; targets: PlayerRecipient; bindResult?: string }): Instruction =>
  immutableData({
    kind: 'setLife',
    amount: typeof input.amount === 'number' ? amount(input.amount) : immutableData(input.amount),
    targets: input.targets,
    ...(input.bindResult ? { bindResult: input.bindResult } : {}),
  })

export const exchangeLife = (input: {
  first: PlayerRecipient
  second: PlayerRecipient
  bindResult?: string
}): Instruction => immutableData({
  kind: 'exchangeLife',
  first: input.first,
  second: input.second,
  ...(input.bindResult ? { bindResult: input.bindResult } : {}),
})

export const winGame = (input: { targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'winGame', targets: input.targets })

export const damage = (input: {
  amount: AmountInput
  targets: Extract<Instruction, { kind: 'damage' }>['targets']
  source: ObjectReference
  bindResult?: string
}): Instruction => immutableData({
  kind: 'damage',
  amount: toAmount(input.amount),
  targets: input.targets,
  source: input.source,
  ...(input.bindResult ? { bindResult: input.bindResult } : {}),
})

export const grantLandPlays = (input: { count: AmountInput; targets: PlayerRecipient }) =>
  immutableData({ kind: 'grantLandPlays' as const, count: toAmount(input.count), targets: input.targets })

export const grantNoMaximumHandSize = (input: { targets: PlayerRecipient }) =>
  immutableData({ kind: 'grantNoMaximumHandSize' as const, targets: input.targets })

export const grantFlash = (input: { targets: PlayerRecipient; duration: EffectDuration }) =>
  immutableData({ kind: 'grantFlash' as const, targets: input.targets, duration: input.duration })

export const becomeMonarch = (targets: PlayerRecipient = ref('controller')) =>
  immutableData({ kind: 'becomeMonarch' as const, targets })

export const linkExile = (input: {
  targets: ObjectRecipient
  untilOpponentMonarch?: true
  untilSourceLeaves?: true
  returnTo?: LinkedExileReturn
}) => immutableData({
  kind: 'linkExile' as const,
  targets: input.targets,
  ...(input.untilOpponentMonarch ? { untilOpponentMonarch: true as const } : {}),
  ...(input.untilSourceLeaves ? { untilSourceLeaves: true as const } : {}),
  ...(input.returnTo ? { returnTo: input.returnTo } : {}),
})

export const returnLinkedExile = (input: { returnTo?: LinkedExileReturn } = {}) =>
  immutableData({
    kind: 'returnLinkedExile' as const,
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
  })

export const mill = (input: { count: AmountInput; targets: PlayerRecipient }): Instruction =>
  immutableData({ kind: 'mill', count: toAmount(input.count), targets: input.targets })

export const shuffle = (input: { targets: PlayerRecipient }) =>
  immutableData({ kind: 'shuffle' as const, targets: input.targets })

export const destroy = (input: {
  targets: Extract<Instruction, { kind: 'destroy' }>['targets']
  bindResult?: string
  bindChoice?: string
}): Instruction => immutableData({
  kind: 'destroy',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
  ...(input.bindChoice !== undefined ? { bindChoice: input.bindChoice } : {}),
})

export const sacrifice = (input: {
  targets: Extract<Instruction, { kind: 'sacrifice' }>['targets']
  bindCount?: string
  bindResult?: string
}): Instruction => immutableData({
  kind: 'sacrifice',
  targets: input.targets,
  ...(input.bindCount !== undefined ? { bindCount: input.bindCount } : {}),
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
})

export const scry = (input: { count: AmountInput; targets: PlayerRecipient }) => immutableData({ kind: 'scry' as const, targets: input.targets, count: toAmount(input.count) }) satisfies Instruction
export const surveil = (input: { count: AmountInput; targets: PlayerRecipient }) => immutableData({ kind: 'surveil' as const, targets: input.targets, count: toAmount(input.count) }) satisfies Instruction

export const blink = (input: Omit<Extract<Instruction, { kind: 'blink' }>, 'kind'>) => immutableData({ kind: 'blink' as const, ...input }) satisfies Instruction

export const fight = (input: { left: ObjectReference; right: ObjectReference }) => immutableData({ kind: 'fight' as const, ...input }) satisfies Instruction

export const reveal = (targets: ObjectRecipient) => immutableData({ kind: 'reveal' as const, targets }) satisfies Instruction

export const tap = (targets: ObjectRecipient) => immutableData({ kind: 'tap' as const, targets }) satisfies Instruction
export const untap = (targets: ObjectRecipient) => immutableData({ kind: 'untap' as const, targets }) satisfies Instruction

export const move = (input: {
  targets: Extract<Instruction, { kind: 'move' }>['targets']
  to: Extract<Instruction, { kind: 'move' }>['to']
  position?: 'top' | 'bottom'
  order?: 'random'
  controller?: Extract<Instruction, { kind: 'move' }>['controller']
  tapped?: boolean
  enterCounters?: Readonly<Record<string, AmountInput>>
  bindResult?: string
  bindChoice?: string
}): Instruction => immutableData({
  kind: 'move',
  ...(input.bindChoice !== undefined ? { bindChoice: input.bindChoice } : {}),
  targets: input.targets,
  to: input.to,
  ...(input.position !== undefined ? { position: input.position } : {}),
  ...(input.order !== undefined ? { order: input.order } : {}),
  ...(input.controller !== undefined ? { controller: input.controller } : {}),
  ...(input.tapped !== undefined ? { tapped: input.tapped } : {}),
  ...(input.enterCounters !== undefined ? { enterCounters: Object.fromEntries(Object.entries(input.enterCounters).map(([counter, count]) => [counter, toAmount(count)])) } : {}),
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
  targets?: ObjectRecipient
  snapshot?: string
  controller?: Extract<Instruction, { kind: 'copy' }>['controller']
  bindResult?: string
}): Instruction => immutableData({
  kind: 'copy',
  ...(input.targets !== undefined ? { targets: input.targets } : {}),
  ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
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
  destination?: Extract<Instruction, { kind: 'counter' }>['destination']
}): Instruction => immutableData({
  kind: 'counter',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
  ...(input.destination ? { destination: input.destination } : {}),
})

export const createEffect = (input: {
  targets: Extract<Instruction, { kind: 'createEffect' }>['targets']
  effect: CreatedEffect
  duration: EffectDuration
}): Instruction => immutableData({ kind: 'createEffect', ...input })

/** Prevent all combat damage that would be dealt this turn. Optional source or recipient filters stay. */
export const preventAllCombatDamageThisTurn = (filter: Omit<PreventionFilter, 'combat'> = {}) =>
  createEffect({
    targets: ref('source'),
    duration: untilCleanup(),
    effect: preventionCreatedEffect({ combat: true, ...filter }, unlimitedPrevention()),
  })

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

/** Counter a single stack item unless its current controller pays during resolution. */
export const counterUnlessPay = (input: { targets: StackItemReference; cost: string; bindResult: string }) =>
  payOptional({
    payer: controllerOf(input.targets),
    cost: manaCost(input.cost),
    bindResult: input.bindResult,
    ifDeclined: [counter({ targets: input.targets })],
  })

export const createDelayed = (input: {
  repeatUntilCleanup?: true
  notThisTurn?: true
  inheritTargets?: boolean
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

/** Discard each card currently in the named player's hand without a choice. */
export const discardHand = (input: { by: PlayerReference; bindResult?: string }) =>
  discard({
    targets: objects({ zone: 'hand', owner: input.by }),
    by: input.by,
    ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
  })

export const chooseCards = (input: {
  bindChoice: string
  chooser: Extract<Instruction, { kind: 'chooseCards' }>['chooser']
  filter: ObjectSelector
  viewLibrary?: true
  viewCards?: ObjectReference
  count?: AmountInput
  min?: AmountInput
  max?: AmountInput
  whenInsufficient?: 'chooseAvailable'
}) => {
  if (input.count !== undefined && (input.min !== undefined || input.max !== undefined)) {
    throw new TypeError('chooseCards accepts either count or min/max, never both')
  }
  const clause = select({
    filter: input.filter,
    ...(input.count !== undefined ? { count: input.count } : { min: input.min, max: input.max }),
  } as TargetClauseInput)
  return immutableData({
    kind: 'chooseCards' as const,
    bindChoice: input.bindChoice,
    chooser: input.chooser,
    filter: input.filter,
    ...(input.viewLibrary ? { viewLibrary: true as const } : {}),
    ...(input.viewCards ? { viewCards: input.viewCards } : {}),
    min: clause.min,
    max: clause.max,
    distinct: true as const,
    whenInsufficient: input.whenInsufficient ?? 'chooseAvailable',
  }) satisfies Extract<Instruction, { kind: 'chooseCards' }>
}

export const sequence = (...instructions: readonly Instruction[]): Instruction =>
  immutableData({ kind: 'sequence', instructions })

export const forEach = (input: { of: ObjectRecipient; instructions: readonly Instruction[] }): Instruction =>
  immutableData({ kind: 'forEach', of: input.of, instructions: input.instructions })

/** Hidden-zone library search: typed `selectCards`, move the found cards, then shuffle. */
export const searchLibrary = (input: {
  bindChoice: string
  chooser: PlayerReference
  filter?: ObjectSelector
  count?: AmountInput
  min?: AmountInput
  max?: AmountInput
  to: Zone
  tapped?: boolean
  reveal?: boolean
}) => sequence(
  chooseCards({
    bindChoice: input.bindChoice,
    chooser: input.chooser,
    filter: input.filter ?? objects({ zone: 'library', owner: 'you' }),
    viewLibrary: true,
    ...(input.count !== undefined ? { count: input.count } : { min: input.min, max: input.max }),
  }),
  ...(input.reveal ? [reveal(choice(input.bindChoice))] : []),
  move({ targets: choice(input.bindChoice), to: input.to, ...(input.tapped !== undefined ? { tapped: input.tapped } : {}) }),
  shuffle({ targets: input.chooser }),
)

/** Search, reveal, choose a subset destination, then move the remaining identities. */
export const splitSearchLibrary = (input: {
  bindChoice: string
  subsetBindChoice: string
  chooser: PlayerReference
  filter?: ObjectSelector
  count?: AmountInput
  min?: AmountInput
  max?: AmountInput
  subset: { min?: AmountInput, max?: AmountInput, to: Zone, tapped?: boolean }
  remainderTo: Zone
}) => sequence(
  chooseCards({
    bindChoice: input.bindChoice,
    chooser: input.chooser,
    filter: input.filter ?? objects({ zone: 'library', owner: 'you' }),
    viewLibrary: true,
    ...(input.count !== undefined ? { count: input.count } : { min: input.min, max: input.max }),
  }),
  reveal(choice(input.bindChoice)),
  chooseCards({
    bindChoice: input.subsetBindChoice,
    chooser: input.chooser,
    filter: objects({ among: choice(input.bindChoice) }),
    ...(input.subset.min !== undefined || input.subset.max !== undefined
      ? { min: input.subset.min, max: input.subset.max }
      : { count: 1 }),
  }),
  move({
    targets: choice(input.subsetBindChoice),
    to: input.subset.to,
    ...(input.subset.tapped !== undefined ? { tapped: input.subset.tapped } : {}),
  }),
  move({
    targets: remaining(choice(input.bindChoice), choice(input.subsetBindChoice)),
    to: input.remainderTo,
  }),
  shuffle({ targets: input.chooser }),
)

/** Cycling from hand: pay mana, discard this card, then draw or a supplied program (CR 702.89). */
export const cycleFromHand = (input: { mana: string; instructions?: readonly Instruction[] }) =>
  activated({
    availableFrom: ['hand'],
    cycling: true,
    costs: [manaCost(input.mana), discardCost(ref('source'), 1)],
    instructions: input.instructions ? [...input.instructions] : [draw(1)],
  })

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

export const distributeControl = (input: Omit<Extract<Instruction, { kind: 'distributeControl' }>, 'kind'>): Instruction =>
  immutableData({ kind: 'distributeControl', ...input })

export const revealUntil = (input: {
  targets: PlayerRecipient
  match: ObjectSelector
  count?: AmountInput
  bindFound?: string
  bindRest?: string
  foundTo: Zone
  rest: Extract<Instruction, { kind: 'revealUntil' }>['rest']
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

export const choosePlayer = (input: Omit<Extract<Instruction, { kind: 'choosePlayer' }>, 'kind'>) => immutableData({ kind: 'choosePlayer' as const, ...input })
export const forEachPlayer = (input: Omit<Extract<Instruction, { kind: 'forEachPlayer' }>, 'kind'>) => immutableData({ kind: 'forEachPlayer' as const, ...input })

export const countDistinctNames = (of: ObjectSelector) => immutableData({ kind: 'countDistinctNames' as const, of })
export const somePlayerHasMore = (input: Omit<Extract<Condition, { kind: 'somePlayerHasMore' }>, 'kind'>) => immutableData({ kind: 'somePlayerHasMore' as const, ...input })
export const somePlayerHasLess = (input: Omit<Extract<Condition, { kind: 'somePlayerHasLess' }>, 'kind'>) => immutableData({ kind: 'somePlayerHasLess' as const, ...input })
export const combatDamageThisTurn = (
  input: Omit<Extract<Condition, { kind: 'combatDamageThisTurn' }>, 'kind'>,
) => immutableData({ kind: 'combatDamageThisTurn' as const, ...input })
export const damageDealtThisTurn = (
  input: Omit<Extract<Amount, { kind: 'damageDealtThisTurn' }>, 'kind'>,
) => immutableData({ kind: 'damageDealtThisTurn' as const, ...input })

export const addManaFrom = (input: { of: ObjectSelector; basis?: ManaQueryBasis; colorsOnly?: boolean; amount?: AmountInput; targets?: PlayerRecipient }) => immutableData({ kind: 'addManaFrom' as const, ...(input.basis !== undefined ? { basis: input.basis } : {}), of: input.of, colorsOnly: input.colorsOnly ?? false, amount: toAmount(input.amount ?? 1), targets: input.targets ?? ref('controller') })

export const becomesTapped = (filter: ObjectOccurrenceFilter) => immutableData({ kind: 'becomesTapped' as const, filter })
export const tappedForMana = (filter: ObjectOccurrenceFilter) => immutableData({ kind: 'tappedForMana' as const, filter })
