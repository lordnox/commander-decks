import { CREATURE_TYPES } from '../../../creatureTypes'
import { ZONE_IDS } from '../../../types'
import type {
  ResolvedRuleEffect,
  ActivatedAbilityDefinition,
  CreatureTypeReference,
  Amount,
  AmountCompareOperator,
  AmountInput,
  StatDeltaInput,
  RoundingMode,
  CardColor,
  CardRuleDefinitionInputV2,
  CardRuleDefinitionV2,
  RuleDslSchemaVersion,
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
  ChoiceRelation,
  CopyExcept,
  DecisionsInput,
  DecisionsSpec,
  DelayedPattern,
  DredgeAbilityDefinition,
  EffectDuration,
  DistributionSpec,
  Instruction,
  LibraryVisibility,
  Keyword,
  KeywordAbilityDefinition,
  LifeLostCombine,
  ManaValueParity,
  LifeTotalAmount,
  ManaId,
  ManaQueryBasis,
  ManaSpendRestriction,
  LinkedExileReturn,
  ModeDefinition,
  ModeInput,
  ReplacementEventPattern,
  ReplacementProgramInstruction,
  ModeSpec,
  NumericCharacteristic,
  ObjectNumericCharacteristic,
  SpellCastCost,
  SpellCastTiming,
  ObjectFilter,
  ObjectOccurrenceFilter,
  ObjectReference,
  ObjectRecipient,
  ObjectSelector,
  OccurrencePattern,
  PlayerOccurrenceFilter,
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
  SagaAbilityDefinition,
  StaticAbilityDefinition,
  TargetClause,
  TargetClauseInput,
  TargetConstraint,
  TargetReference,
  TokenDefinition,
  EmblemDefinition,
  TriggeredAbilityDefinition,
  VariableSpec,
  VoteSpec,
  WheneverConfiguration,
  WardCost,
  Zone,
} from '../schema/v2'
import {
  LIBRARY_VISIBILITY,
  CHOSEN_COLOR_BINDING,
  CHOSEN_CREATURE_TYPE_BINDING,
  DECLINE_LIFE_OPTION,
  ENTRY_PAYMENT_BINDING,
  PAY_LIFE_OPTION,
  RULE_DSL_SCHEMA_VERSION,
  SPELL_CAST_COSTS,
  UNLIMITED_PREVENTION,
} from '../schema/v2'
import { immutableData } from './immutable'
import { definitionRevisionFor } from './revision'
import type { RoomDoorId, StepId } from '../../../types'
import type { PlayerEffect, PlayerEffectDuration } from '../../../plugins/playerEffectConstants'

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

export const chooseRandom = (input: { filter: ObjectSelector; bindChoice: string }) =>
  immutableData({ kind: 'chooseRandom' as const, filter: input.filter, bindChoice: input.bindChoice })

export const repeat = (count: AmountInput, instructions: readonly Instruction[]) =>
  immutableData({ kind: 'repeat' as const, count: toAmount(count), instructions })

export const repeatWhile = (input: { condition: Condition; instructions: readonly Instruction[] }) =>
  immutableData({ kind: 'repeatWhile' as const, condition: input.condition, instructions: input.instructions })

export const repeatOnceIf = (input: { condition: Condition; instructions: readonly Instruction[] }) =>
  immutableData({ kind: 'repeatOnceIf' as const, condition: input.condition, instructions: input.instructions })

export const changeControl = (input: { targets: ObjectRecipient; controller: PlayerReference }) =>
  immutableData({ kind: 'changeControl' as const, targets: input.targets, controller: input.controller })

export const partitionPiles = (input: {
  cards: ObjectRecipient
  partitioner: PlayerReference
  visibility?: 'public' | 'facedown-faceup'
  chooser: PlayerReference
  bindChosen: string
  bindOther: string
}) => immutableData({ kind: 'partitionPiles' as const, ...input })

export const vote = (input: {
  prompt: string
  options: VoteSpec
  bindResult: string
  bindWinners?: string
  bindObjects?: string
  secret?: boolean
}) => immutableData({
  kind: 'vote' as const,
  prompt: input.prompt,
  options: input.options,
  bindResult: input.bindResult,
  ...(input.bindWinners !== undefined ? { bindWinners: input.bindWinners } : {}),
  ...(input.bindObjects !== undefined ? { bindObjects: input.bindObjects } : {}),
  ...(input.secret !== undefined ? { secret: input.secret } : {}),
})

export const voteLeads = (binding: string, option: string) =>
  immutableData({ kind: 'voteLeads' as const, binding, option })

export const voteTally = (binding: string, option: Extract<Amount, { kind: 'voteTally' }>['option']) =>
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

export const chooseModes = (input: { count: AmountInput; min?: AmountInput; repeatable?: boolean }): ModeSpec =>
  immutableData({ count: toAmount(input.count), ...(input.min !== undefined ? { min: toAmount(input.min) } : {}), repeatable: input.repeatable ?? false })

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

export const manaAndLifeCost = (mana: string, life: AmountInput) =>
  immutableData({ kind: 'manaAndLife' as const, mana, life: toAmount(life) })

export const millCost = (count: AmountInput): Cost => immutableData({ kind: 'mill', count: toAmount(count) })

export const drawCost = (count: AmountInput): Cost =>
  immutableData({ kind: 'draw', count: toAmount(count) })

export const tapCost = () => immutableData({ kind: 'tapSource' as const }) satisfies Cost

export const lifeCost = (value: AmountInput): Cost =>
  immutableData({ kind: 'life', amount: toAmount(value) })

export const plusLoyalty = (value: AmountInput): Cost =>
  immutableData({ kind: 'loyalty' as const, amount: toAmount(value) })

export const minusLoyalty = (value: AmountInput): Cost =>
  immutableData({ kind: 'loyalty' as const, amount: toAmount(value), minus: true as const })

export const manaCost = (value: string): Cost =>
  immutableData({ kind: 'mana', amount: value })

export const convoke = (): Cost => immutableData({ kind: 'convoke' as const })

export const delve = (): Cost =>
  immutableData({ kind: 'delve' as const }) satisfies Cost

export const untilCleanup = () => immutableData({ kind: 'untilCleanup' as const })

/** "Regenerate [permanent]" from a resolving spell or ability: a one-use shield for this turn (CR 701.19a). */
export const regenerate = (targets: Extract<Instruction, { kind: 'createEffect' }>['targets']) =>
  immutableData({ kind: 'createEffect' as const, targets, effect: { kind: 'regenerationShield' as const }, duration: untilCleanup() })

/** Static "regenerate" that replaces every destruction of matching permanents (CR 701.19b). */
export const staticRegeneration = (targets: ObjectSelector) =>
  immutableData({ kind: 'regenerate' as const, targets })
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
export const gainControlEffect = (player: PlayerReference): CreatedEffect =>
  immutableData({ kind: 'gainControl', player })
export const copyEffect = (input: { of: ObjectReference; except?: CopyExcept }): CreatedEffect =>
  immutableData({ kind: 'copy', of: input.of, ...(input.except ? { except: input.except } : {}) })
export const legendRuleOff = (): ContinuousEffectDefinition => immutableData({ kind: 'legendRuleOff' })
export const permanently = (): EffectDuration => immutableData({ kind: 'permanent' })
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

export const grantLandType = (input: Omit<Extract<ContinuousEffectDefinition, { kind: 'grantLandType' }>, 'kind'>) =>
  immutableData({ kind: 'grantLandType' as const, ...input })

export const suppressKeyword = (input: Omit<Extract<ContinuousEffectDefinition, { kind: 'suppressKeyword' }>, 'kind'>) =>
  immutableData({ kind: 'suppressKeyword' as const, ...input })

export const untapDuringOtherPlayersSteps = (targets: ObjectSelector) =>
  immutableData({ kind: 'untapDuringOthers' as const, targets })

export const drawDuringOtherPlayersSteps = (targets: PlayerSelector) =>
  immutableData({ kind: 'drawDuringOthers' as const, targets })

export const noMaximumHandSize = (): ContinuousEffectDefinition =>
  immutableData({ kind: 'noMaximumHandSize' })

export const cannotBeCountered = (): ContinuousEffectDefinition =>
  immutableData({ kind: 'cannotBeCountered' })

export const extraLandPlays = (count: number): ContinuousEffectDefinition =>
  immutableData({ kind: 'extraLandPlays', count })

export const attackTax = (amount: number, options: { whileUntapped?: true } = {}): ContinuousEffectDefinition =>
  immutableData({
    kind: 'attackTax',
    amount,
    ...(options.whileUntapped ? { whileUntapped: true as const } : {}),
  })

export const blockTax = (amount: number, options: { whileAttacking?: true } = {}): ContinuousEffectDefinition =>
  immutableData({
    kind: 'blockTax',
    amount,
    ...(options.whileAttacking ? { whileAttacking: true as const } : {}),
  })

export const opponentsCantCast = (parity: ManaValueParity): ContinuousEffectDefinition =>
  immutableData({ kind: 'opponentsCantCast', parity })

export const opponentsCantBlock = (parity: ManaValueParity): ContinuousEffectDefinition =>
  immutableData({ kind: 'opponentsCantBlock', parity })

export const flagbearer = (): ContinuousEffectDefinition =>
  immutableData({ kind: 'targetingRequirement', requirement: 'flagbearer' })

export const ward = (cost: WardCost): ContinuousEffectDefinition =>
  immutableData({ kind: 'ward', cost })

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

export const redirectEvent = (to: Zone, options: { link?: true } = {}) =>
  immutableData({ kind: 'redirect' as const, to, ...(options.link ? { link: true as const } : {}) })

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

export const wouldGainLife = (player: PlayerReference | PlayerSelector = ref('controller')) =>
  immutableData({ kind: 'gainLife' as const, filter: { player } })

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

/** CR 706.14: you may have this enter as a copy, with optional copy exceptions and enter-with counters. */
export const copyAsEntry = (input: {
  filter: ObjectSelector
  except?: CopyExcept
  creatureCounters?: AmountInput
  planeswalkerCounters?: AmountInput
}) => {
  const chosen = objects({ among: choice('copied') })
  return replacement(wouldEnter(), modifyEvent({}), {
    program: [
      chooseCards({ chooser: ref('controller'), filter: input.filter, bindChoice: 'copied', min: 0, max: 1 }),
      programBranch(compareAmount(count(chosen), 'gte', 1), [
        modifyEvent({
          copyOf: choice('copied'),
          ...(input.except ? { copyExcept: input.except } : {}),
        }),
        ...(input.creatureCounters !== undefined ? [programBranch(
          compareAmount(count(objects({ among: choice('copied'), type: 'Creature' })), 'gte', 1),
          [modifyEvent({ enterCounters: { '+1/+1': toAmount(input.creatureCounters) } })],
        )] : []),
        ...(input.planeswalkerCounters !== undefined ? [programBranch(
          compareAmount(count(objects({ among: choice('copied'), type: 'Planeswalker' })), 'gte', 1),
          [modifyEvent({ enterCounters: { loyalty: toAmount(input.planeswalkerCounters) } })],
        )] : []),
      ]),
    ],
  })
}

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

type CostReductionInput = { generic: AmountInput; when?: Condition; reason?: string }

type CostFieldsInput = Partial<Pick<
  SpellAbilityDefinition,
  'costs' | 'costLabels' | 'additionalCosts' | 'costConditions' | 'optionalCostBounds' | 'optionalCosts' | 'repeatableOptionalCosts' | 'alternativeCosts' | 'costIncreases'
>> & {
  costReductions?: readonly CostReductionInput[]
}

const normalizeCostFields = (input: CostFieldsInput) => ({
  costs: input.costs ?? [],
  ...(input.costLabels ? { costLabels: input.costLabels } : {}),
  ...(input.additionalCosts ? { additionalCosts: input.additionalCosts } : {}),
  ...(input.costConditions ? { costConditions: input.costConditions } : {}),
  ...(input.repeatableOptionalCosts ? { repeatableOptionalCosts: input.repeatableOptionalCosts } : {}),
  ...(input.optionalCostBounds ? { optionalCostBounds: input.optionalCostBounds } : {}),
  ...(input.optionalCosts ? { optionalCosts: input.optionalCosts } : {}),
  ...(input.alternativeCosts ? { alternativeCosts: input.alternativeCosts } : {}),
  ...(input.costIncreases ? { costIncreases: input.costIncreases } : {}),
  ...(input.costReductions ? {
    costReductions: input.costReductions.map((reduction) => ({ ...costReduction(reduction.generic, reduction.reason), ...(reduction.when ? { when: reduction.when } : {}) })),
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
  activeIn: configuration.activeIn ?? (on.kind === 'cycle' && on.filter.object && 'kind' in on.filter.object && on.filter.object.kind === 'contextRef' && on.filter.object.name === 'source' ? ZONE_IDS : ['battlefield']),
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

export const dredgeAbility = (count: number): DredgeAbilityDefinition =>
  immutableData({ kind: 'dredge', count })

export const saga = (input: {
  readAhead?: true
  chapters: readonly {
    numbers: readonly number[]
    decisions?: DecisionsInput
    instructions: readonly Instruction[]
  }[]
}): SagaAbilityDefinition => immutableData({
  kind: 'saga',
  ...(input.readAhead ? { readAhead: true as const } : {}),
  chapters: input.chapters.map((chapter) => immutableData({
    numbers: [...chapter.numbers],
    ...(chapter.decisions ? { decisions: decisions(chapter.decisions) } : {}),
    instructions: chapter.instructions,
  })),
})

export const cardRuleDefinition = (
  schemaVersion: RuleDslSchemaVersion,
  definition: CardRuleDefinitionInputV2,
): CardRuleDefinitionV2 => {
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

export const spellCast = (input: { filter: ObjectOccurrenceFilter; nthThisTurn?: number }): OccurrencePattern =>
  immutableData({ kind: 'cast', filter: input.filter, ...(input.nthThisTurn !== undefined ? { nthThisTurn: input.nthThisTurn } : {}) })

export const enters = (input: { filter: ObjectOccurrenceFilter; fromSpell?: boolean }): OccurrencePattern =>
  immutableData({
    kind: 'enters',
    filter: input.filter,
    ...(input.fromSpell ? { fromSpell: true as const } : {}),
  })

export const tokenCreated = (filter: ObjectOccurrenceFilter = {}) => immutableData({ kind: 'tokenCreated' as const, filter })

export const sacrificed = (filter: ObjectOccurrenceFilter = {}) => immutableData({ kind: 'sacrificed' as const, filter })

export const dies = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'dies', filter: input.filter })

export const leaves = (input: { filter: ObjectOccurrenceFilter }): OccurrencePattern =>
  immutableData({ kind: 'leaves', filter: input.filter })

export const draws = (input: Extract<OccurrencePattern, { kind: 'draw' }>['filter'] = {}): OccurrencePattern =>
  immutableData({ kind: 'draw', filter: input })

export const gainedLife = (filter: PlayerOccurrenceFilter = {}): OccurrencePattern =>
  immutableData({ kind: 'gainedLife' as const, filter })

export const moved = (input: {
  filter: ObjectOccurrenceFilter
  to: Zone
  from?: Zone
  group?: true
}): OccurrencePattern =>
  immutableData({
    kind: 'moved' as const,
    filter: input.filter,
    to: input.to,
    ...(input.from ? { from: input.from } : {}),
    ...(input.group ? { group: true as const } : {}),
  })

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

export const exchangeControl = (input: {
  first: PlayerRecipient
  second: PlayerRecipient
  permanents: ObjectSelector
  duration: EffectDuration
  haste?: true
  untap?: true
}): Instruction => immutableData({
  kind: 'exchangeControl',
  first: input.first,
  second: input.second,
  permanents: input.permanents,
  duration: input.duration,
  ...(input.haste ? { haste: true as const } : {}),
  ...(input.untap ? { untap: true as const } : {}),
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

export const createPlayerEffect = (input: { targets: PlayerRecipient; playerEffect: PlayerEffect; duration: PlayerEffectDuration }) =>
  immutableData({ kind: 'createPlayerEffect' as const, targets: input.targets, playerEffect: input.playerEffect, duration: input.duration })

export const takeExtraTurn = (targets: PlayerRecipient) =>
  immutableData({ kind: 'takeExtraTurn' as const, targets })

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

export const mill = (input: { count: AmountInput; targets: PlayerRecipient; bindChoice?: string }): Instruction =>
  immutableData({ kind: 'mill', ...input, count: toAmount(input.count) })

export const shuffle = (input: { targets: PlayerRecipient }) =>
  immutableData({ kind: 'shuffle' as const, targets: input.targets })

export const destroy = (input: {
  targets: Extract<Instruction, { kind: 'destroy' }>['targets']
  bindResult?: string
  bindChoice?: string
  /** "It can't be regenerated" (CR 701.19c). */
  cannotRegenerate?: true
}): Instruction => immutableData({
  kind: 'destroy',
  targets: input.targets,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
  ...(input.bindChoice !== undefined ? { bindChoice: input.bindChoice } : {}),
  ...(input.cannotRegenerate ? { cannotRegenerate: true as const } : {}),
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

export const reveal = (targets: ObjectRecipient, options: { turnFaceUp?: true } = {}) => immutableData({ kind: 'reveal' as const, targets, ...options }) satisfies Instruction

export const tap = (targets: ObjectRecipient, extra: { skipNextUntap?: true } = {}) =>
  immutableData({
    kind: 'tap' as const,
    targets,
    ...(extra.skipNextUntap ? { skipNextUntap: true as const } : {}),
  }) satisfies Instruction
export const untap = (targets: ObjectRecipient) => immutableData({ kind: 'untap' as const, targets }) satisfies Instruction

export const move = (input: {
  targets: Extract<Instruction, { kind: 'move' }>['targets']
  to: Extract<Instruction, { kind: 'move' }>['to']
  position?: 'top' | 'bottom'
  order?: 'random'
  controller?: Extract<Instruction, { kind: 'move' }>['controller']
  tapped?: boolean
  faceDown?: boolean
  enterCounters?: Readonly<Record<string, AmountInput>>
  bindResult?: string
  bindChoice?: string
}): Instruction => immutableData({
  kind: 'move',
  ...(input.faceDown !== undefined ? { faceDown: input.faceDown } : {}),
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
  tapped?: boolean
  count: AmountInput
  targets: Extract<Instruction, { kind: 'createToken' }>['targets']
  token: TokenDefinition
  bindResult?: string
  bindChoice?: string
}): Instruction => immutableData({
  kind: 'createToken',
  ...(input.tapped !== undefined ? { tapped: input.tapped } : {}),
  count: toAmount(input.count),
  targets: input.targets,
  token: input.token,
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
  ...(input.bindChoice !== undefined ? { bindChoice: input.bindChoice } : {}),
})

export const createEmblem = (input: {
  targets: Extract<Instruction, { kind: 'createEmblem' }>['targets']
  emblem: EmblemDefinition
}): Instruction => immutableData({
  kind: 'createEmblem',
  targets: input.targets,
  emblem: input.emblem,
})

export const banAttacks = (input: {
  attackers: Extract<Instruction, { kind: 'banAttacks' }>['attackers']
  defenders: ObjectSelector
}): Instruction => immutableData({
  kind: 'banAttacks',
  attackers: input.attackers,
  defenders: input.defenders,
})

export const copy = (input: {
  information?: 'current' | 'currentOrLastKnown'
  targets?: ObjectRecipient
  snapshot?: string
  controller?: Extract<Instruction, { kind: 'copy' }>['controller']
  tapped?: boolean
  except?: CopyExcept
  bindResult?: string
  bindChoice?: string
}): Instruction => immutableData({
  kind: 'copy',
  ...(input.information !== undefined ? { information: input.information } : {}),
  ...(input.targets !== undefined ? { targets: input.targets } : {}),
  ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
  ...(input.controller !== undefined ? { controller: input.controller } : {}),
  ...(input.tapped !== undefined ? { tapped: input.tapped } : {}),
  ...(input.except !== undefined ? { except: input.except } : {}),
  ...(input.bindResult !== undefined ? { bindResult: input.bindResult } : {}),
  ...(input.bindChoice !== undefined ? { bindChoice: input.bindChoice } : {}),
})

export const copySpell = (input: {
  targets: Extract<Instruction, { kind: 'copySpell' | 'copyAbility' }>['targets']
  controller?: Extract<Instruction, { kind: 'copySpell' | 'copyAbility' }>['controller']
  retarget?: Extract<Instruction, { kind: 'copySpell' | 'copyAbility' }>['retarget']
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
  cost: Extract<Instruction, { kind: 'payOptional' }>['cost']
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
  related?: ChoiceRelation
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
    ...(input.related ? { related: input.related } : {}),
    min: clause.min,
    max: clause.max,
    distinct: true as const,
    whenInsufficient: input.whenInsufficient ?? 'chooseAvailable',
  }) satisfies Extract<Instruction, { kind: 'chooseCards' }>
}

/** CR 702.86: whenever this attacks, the defending player sacrifices N permanents. */
export const annihilator = (count: number) => whenever(attacks({ filter: ref('self') }), {
  instructions: [
    chooseCards({
      chooser: ref('triggering.defender'),
      filter: objects({ zone: 'battlefield', controller: ref('triggering.defender') }),
      min: count,
      max: count,
      bindChoice: 'annihilated',
    }),
    sacrifice({ targets: choice('annihilated') }),
  ],
})

/** CR 702.79: when this dies, if it had no -1/-1 counters on it, return it under its owner's control with a -1/-1 counter. The intervening if reads last-known battlefield counters. */
export const persist = () => whenever(dies({ filter: ref('self') }), {
  interveningIf: compareAmount(counterCount(ref('triggering.object.before'), '-1/-1'), 'eq', 0),
  instructions: [
    move({
      targets: ref('triggering.object.after'),
      to: 'battlefield',
      controller: ownerOf(ref('triggering.object.after')),
      enterCounters: { '-1/-1': 1 },
    }),
  ],
})

/** If this would be put into a graveyard from anywhere, reveal it and shuffle it into its owner's library instead (CR 614.6). Tokens and cards already in a graveyard are skipped. Reveal and shuffle run after the redirected library move. */
export const shuffleIntoOwnerLibrary = () => ({
  ...staticAbility(replacement(
    wouldMove({
      object: { among: ref('source'), token: false, not: { zone: 'graveyard' } },
      to: 'graveyard',
    }),
    redirectEvent('library'),
    { program: [reveal(ref('source')), shuffle({ targets: ownerOf(ref('source')) })] },
  )),
  activeIn: ZONE_IDS,
})

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
  related?: ChoiceRelation
  shuffle?: true | 'ifLibraryChosen'
}) => {
  const found = input.bindChoice
  const choose = chooseCards({
    bindChoice: found,
    chooser: input.chooser,
    filter: input.filter ?? objects({ zone: 'library', owner: 'you' }),
    viewLibrary: true,
    ...(input.related ? { related: input.related } : {}),
    ...(input.count !== undefined ? { count: input.count } : { min: input.min, max: input.max }),
  })
  const moved = move({ targets: choice(found), to: input.to, ...(input.tapped !== undefined ? { tapped: input.tapped } : {}) })
  const shuffled = shuffle({ targets: input.chooser })
  if (input.shuffle === 'ifLibraryChosen') {
    const fromLibrary = `${found}FromLibrary`
    return sequence(
      choose,
      captureAmount({ amount: count(objects({ among: choice(found), zone: 'library' })), bindResult: fromLibrary }),
      ...(input.reveal ? [reveal(choice(found))] : []),
      moved,
      ifThen(compareAmount(resultAmount(fromLibrary), 'gte', 1), { then: [shuffled] }),
    )
  }
  return sequence(
    choose,
    ...(input.reveal ? [reveal(choice(found))] : []),
    moved,
    shuffled,
  )
}

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

export const addMana = (input: {
  amount: Partial<Record<ManaId, AmountInput>>
  targets?: PlayerRecipient
  restriction?: ManaSpendRestriction
}) => immutableData({
  kind: 'addMana' as const,
  amount: Object.fromEntries(
    Object.entries(input.amount).flatMap(([symbol, value]) => value === undefined ? [] : [[symbol, toAmount(value)]]),
  ) as Partial<Record<ManaId, Amount>>,
  targets: input.targets ?? ref('controller'),
  ...(input.restriction ? { restriction: immutableData(input.restriction) } : {}),
})

export const becomesTapped = (filter: ObjectOccurrenceFilter) => immutableData({ kind: 'becomesTapped' as const, filter })
export const tappedForMana = (filter: ObjectOccurrenceFilter) => immutableData({ kind: 'tappedForMana' as const, filter })

export const exileThisSpell = () => immutableData({ kind: 'exileThisSpell' as const })

export const chooseParticipants = (input: Omit<Extract<Instruction, { kind: 'chooseParticipants' }>, 'kind'>) => immutableData({ kind: 'chooseParticipants' as const, ...input })

export const chooseCardsForEachPlayer = (input: Omit<Extract<Instruction, { kind: 'chooseCardsForEachPlayer' }>, 'kind' | 'min' | 'max'> & { min: AmountInput; max: AmountInput }) => immutableData({ kind: 'chooseCardsForEachPlayer' as const, ...input, min: toAmount(input.min), max: toAmount(input.max) })

export const discardHands = (input: { targets: PlayerRecipient }) => immutableData({ kind: 'discardHands' as const, ...input })

export const addTypesEffect = (input: Omit<Extract<CreatedEffect, { kind: 'addTypes' }>, 'kind'>) => immutableData({ kind: 'addTypes' as const, ...input })
export const addTypesTo = (input: Omit<Extract<ContinuousEffectDefinition, { kind: 'addTypes' }>, 'kind'>) => immutableData({ kind: 'addTypes' as const, ...input })

export const removeAbilitiesEffect = () => immutableData({ kind: 'removeAbilities' as const })
export const setStatsEffect = (power: StatDeltaInput, toughness: StatDeltaInput) => immutableData({ kind: 'setStats' as const, power: toStatDelta(power), toughness: toStatDelta(toughness) })

export const chooseCreatureType = (bindResult: string, chooser: PlayerReference = ref('controller')) => immutableData({ kind: 'chooseCreatureType' as const, bindResult, chooser })
export const chosenCreatureType = (of: ObjectReference = ref('source')): CreatureTypeReference => immutableData({ kind: 'chosenCreatureType', of })
export const creatureTypeChoice = (binding: string): CreatureTypeReference => immutableData({ kind: 'typeChoice', binding })
export const chooseCreatureTypeAsEnters = () => replacement(wouldEnter(), modifyEvent({}), { program: [
  { kind: 'choose', bindChoice: CHOSEN_CREATURE_TYPE_BINDING, options: CREATURE_TYPES.map(type => ({ id: type, label: type })) },
  { kind: 'modifyEvent', changes: {} },
] })

export const grantActivatedAbilityEffect = (ability: ActivatedAbilityDefinition) => immutableData({ kind: 'grantActivatedAbility' as const, ability })

/** Zone permission only: ordinary land timing and play limits still apply. */
export const playLands = (players: PlayerSelector, cards: ObjectSelector, options: { topOnly?: true } = {}): ContinuousEffectDefinition =>
  immutableData({ kind: 'playLands', players, cards, ...options })

/** Live spell announcement from a selected zone, keeping printed/alternate/additional costs. */
export const castSpells = (
  players: PlayerSelector,
  cards: ObjectSelector,
  options: {
    cost?: SpellCastCost
    asThoughFlash?: true
    laterTurn?: true
    discardLand?: true
    when?: Condition
    optionId?: string
    label?: string
  } = {},
) =>
  immutableData({
    kind: 'castSpells' as const,
    players,
    cards,
    cost: options.cost ?? SPELL_CAST_COSTS.printed,
    ...(options.asThoughFlash ? { asThoughFlash: true as const } : {}),
    ...(options.laterTurn ? { laterTurn: true as const } : {}),
    ...(options.discardLand ? { discardLand: true as const } : {}),
    ...(options.when ? { when: options.when } : {}),
    ...(options.optionId ? { optionId: options.optionId } : {}),
    ...(options.label ? { label: options.label } : {}),
  })

/** One-shot cast from a private zone; announcement uses the stored cost policy. */
export const offerCast = (input: {
  chooser?: PlayerReference
  from?: PlayerReference
  zone?: Zone
  cost?: SpellCastCost
  maxManaValue?: AmountInput
  notLand?: true
  takeControl?: true
  inspect?: true
  laterTurn?: true
  grantHaste?: true
  timing?: SpellCastTiming
  object?: ObjectReference
}) => immutableData({
  kind: 'offerCast' as const,
  chooser: input.chooser ?? ref('controller'),
  from: input.from ?? input.chooser ?? ref('controller'),
  zone: input.zone ?? 'hand',
  cost: input.cost ?? SPELL_CAST_COSTS.withoutPayingMana,
  ...(input.maxManaValue !== undefined ? { maxManaValue: toAmount(input.maxManaValue) } : {}),
  ...(input.notLand ? { notLand: true as const } : {}),
  ...(input.takeControl ? { takeControl: true as const } : {}),
  ...(input.inspect ? { inspect: true as const } : {}),
  ...(input.laterTurn ? { laterTurn: true as const } : {}),
  ...(input.grantHaste ? { grantHaste: true as const } : {}),
  ...(input.timing ? { timing: input.timing } : {}),
  ...(input.object ? { object: input.object } : {}),
})

export const revealLibraryTop = (players: PlayerSelector): ContinuousEffectDefinition =>
  immutableData({ kind: 'revealLibraryTop', players })

export const paidCostCount = (cost: 'optional' | 'alternative', index: number): Amount =>
  immutableData({ kind: 'paidCostCount', cost, index })

export const bestowEffect = (cost: string): ContinuousEffectDefinition =>
  immutableData({ kind: 'bestow', cost })

export const flashbackEffect = (input: {
  label: string
  manaCost?: string
  sacrifice?: { type: string; count: number }
}): ContinuousEffectDefinition =>
  immutableData({
    kind: 'flashback',
    manaCost: input.manaCost ?? '',
    label: input.label,
    ...(input.sacrifice ? { sacrifice: input.sacrifice } : {}),
  })

export const escapeEffect = (manaCost: string, exileCount: number): ContinuousEffectDefinition =>
  immutableData({ kind: 'escape', manaCost, exileCount })

export const flashback = (input: {
  label: string
  manaCost?: string
  sacrifice?: { type: string; count: number }
}) => ({
  ...staticAbility(flashbackEffect(input)),
  activeIn: ['graveyard'] as const,
})

export const escape = (manaCost: string, exileCount: number) => ({
  ...staticAbility(escapeEffect(manaCost, exileCount)),
  activeIn: ['graveyard'] as const,
})

export const countDistinctCardTypes = (of: ObjectSelector): Amount => immutableData({ kind: 'countDistinctCardTypes', of })

export const hasGreatestCharacteristic = (of: ObjectReference, among: ObjectSelector, characteristic: ObjectNumericCharacteristic): Condition =>
  immutableData({ kind: 'hasGreatestCharacteristic', of, among, characteristic })

export const paidCostPlayer = (index: number) => immutableData({ kind: 'paidCostPlayer' as const, index })
export const choosePlayerCost = (players: PlayerSelector) => immutableData({ kind: 'choosePlayer' as const, players })

export const copyAbility = (input: Omit<Extract<Instruction, { kind: 'copySpell' }>, 'kind'>) => immutableData({ kind: 'copyAbility' as const, ...input })

export const abilityActivated = (filter: PlayerSelector) => immutableData({ kind: 'abilityActivated' as const, filter })
export const eventStackItem = () => immutableData({ kind: 'eventStackItem' as const })

export const multiplyTriggers = (input: Omit<Extract<ContinuousEffectDefinition, { kind: 'multiplyTriggers' }>, 'kind'>) => immutableData({ kind: 'multiplyTriggers' as const, ...input })

export const votesFinished = (bindResult: string) => immutableData({ kind: 'votesFinished' as const, bindResult })
export const modifyVotes = (input: Omit<Extract<Instruction, { kind: 'modifyVotes' }>, 'kind'>) => immutableData({ kind: 'modifyVotes' as const, ...input })

export const lookAt = (input: Omit<Extract<Instruction, { kind: 'lookAt' }>, 'kind'>) => immutableData({ kind: 'lookAt' as const, ...input })
export const choosePile = (input: Omit<Extract<Instruction, { kind: 'choosePile' }>, 'kind'>) => immutableData({ kind: 'choosePile' as const, ...input })

/** CR 701.59: exile graveyard cards with at least the stated total mana value. */
export const collectEvidence = (amount: AmountInput): Cost => immutableData({ kind: 'collectEvidence', amount: toAmount(amount) })

export const exileSourceCost = (from: Zone): Cost => immutableData({ kind: 'exileSource', from })

export const foretell = (manaCost: string) => immutableData({ kind: 'static' as const, activeIn: ['hand', 'exile'] as const, effects: [{ kind: 'foretell' as const, manaCost }] })
export const plot = (manaCost: string) => immutableData({ kind: 'static' as const, activeIn: ['hand', 'exile'] as const, effects: [{ kind: 'plot' as const, manaCost }] })
export const warp = (manaCost: string) => immutableData({ kind: 'static' as const, activeIn: ['hand', 'stack'] as const, effects: [{ kind: 'warp' as const, manaCost }] })
export const suspendEffect = (counters: number, manaCost: string) => immutableData({ kind: 'static' as const, activeIn: ['hand', 'exile'] as const, effects: [{ kind: 'suspend' as const, counters, manaCost }] })

export const removeCounters = (input: { targets: ObjectRecipient; counter: string; count: AmountInput }) => immutableData({ ...input, kind: 'removeCounters' as const, count: toAmount(input.count) })
export const countersRemoved = (input: Omit<Extract<OccurrencePattern, { kind: 'countersRemoved' }>, 'kind'>) => immutableData({ kind: 'countersRemoved' as const, ...input })

/** A rule change created by resolution, independent of its source until cleanup. */
export const createRuleEffect = (input: { effect: ResolvedRuleEffect; duration: { kind: 'untilCleanup' } }) =>
  immutableData({ kind: 'createRuleEffect' as const, ...input })
