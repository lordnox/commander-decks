export const RULE_DSL_SCHEMA_VERSION = 1 as const

/** Binding stored on the entering object as `chosenColor` (CR 614.12). */
export const CHOSEN_COLOR_BINDING = 'chosenColor' as const

export type RuleDslSchemaVersion = typeof RULE_DSL_SCHEMA_VERSION

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command'

export const CARD_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type CardColor = typeof CARD_COLORS[number]

export type PlayerRelation = 'you' | 'opponent' | 'any'

export type PlayerFilter = {
  relation?: PlayerRelation
  all?: readonly PlayerFilter[]
  any?: readonly PlayerFilter[]
  not?: PlayerFilter
}

export type ContextBinding =
  | 'source'
  | 'controller'
  | 'event.player'
  | 'triggering.player'
  | 'triggering.object.before'
  | 'triggering.object.after'

export type ResultField = 'discarded' | 'discardedCount' | 'countered' | 'paid' | 'moved' | 'destroyed' | 'sacrificed' | 'created'

export type ContextReference = { kind: 'contextRef'; name: ContextBinding }
export type TargetReference = { kind: 'targetRef'; clauseIndex: number }
export type ChoiceReference = { kind: 'choiceRef'; binding: string }
export type ResultReference = { kind: 'resultRef'; binding: string; field: ResultField }
export type Reference = ContextReference | TargetReference | ChoiceReference | ResultReference

export type PlayerReference = ContextReference | TargetReference | ChoiceReference
export type ObjectReference = ContextReference | TargetReference | ChoiceReference
export type StackItemReference = TargetReference | ChoiceReference

export type ObjectFilter = {
  zone?: Zone
  type?: string
  subtypes?: readonly string[]
  supertypes?: readonly string[]
  controller?: 'you' | PlayerReference
  owner?: 'you' | PlayerReference
  token?: boolean
  name?: string
  attacking?: boolean
  all?: readonly ObjectFilter[]
  any?: readonly ObjectFilter[]
  not?: ObjectFilter
}

export type StackItemFilter = {
  kind?: 'spell' | 'ability'
  /** Card type of the stack object, for "instant or sorcery spell" and similar. */
  type?: string
  color?: CardColor
  other?: boolean
  controller?: 'you' | PlayerReference
  all?: readonly StackItemFilter[]
  any?: readonly StackItemFilter[]
  not?: StackItemFilter
}

export type PlayerSelector = { kind: 'players'; filter: PlayerFilter }
export type ObjectSelector = { kind: 'objects'; filter: ObjectFilter }
export type StackItemSelector = { kind: 'stackItems'; filter: StackItemFilter }
export type Selector = PlayerSelector | ObjectSelector | StackItemSelector

export type NumericCharacteristic = 'power' | 'toughness' | 'manaValue' | 'life'

export type Amount =
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; name: 'X' }
  | { kind: 'eventAmount' }
  | { kind: 'count'; of: Selector }
  | {
      kind: 'characteristic'
      of: Reference
      characteristic: NumericCharacteristic
      information: 'current' | 'currentOrLastKnown'
    }

export type AmountInput = number | Amount

export type ObjectOccurrenceFilter =
  | ObjectFilter
  | ObjectReference
  | { all: readonly ObjectOccurrenceFilter[] }
  | { any: readonly ObjectOccurrenceFilter[] }
  | { not: ObjectOccurrenceFilter }

export type OccurrencePattern =
  | { kind: 'enters'; filter: ObjectOccurrenceFilter }
  | { kind: 'dies'; filter: ObjectOccurrenceFilter }
  | { kind: 'leaves'; filter: ObjectOccurrenceFilter }
  | {
      kind: 'draw'
      filter: {
        player?: PlayerReference | PlayerSelector
        firstDrawInOwnDrawStep?: boolean
      }
    }
  | { kind: 'manaAdded' }
  | { kind: 'manaAbilityActivated' }
  | { kind: 'manaAbilityResolved' }

export type VariableSpec = {
  name: 'X'
  min: number
  max: number
}

export type TargetClause = {
  filter: Selector
  min: Amount
  max: Amount
  distinct: true
}

export type TargetClauseInput = {
  filter: Selector
  count?: AmountInput
  min?: AmountInput
  max?: AmountInput
  distinct?: true
}

/** A restriction that relates recipients chosen for more than one clause. */
export type TargetConstraint = {
  kind: 'different'
  clauseIndices: readonly number[]
}

export type ModeSpec = {
  count: Amount
  repeatable: boolean
}

export type DistributionSpec = {
  targetClauseIndex: number
  total: Amount
  minEach: Amount
}

export type DecisionsSpec = {
  targets: readonly TargetClause[]
  constraints?: readonly TargetConstraint[]
  modes?: ModeSpec
  variables?: readonly VariableSpec[]
  distributions?: readonly DistributionSpec[]
}

export type DecisionsInput = Omit<DecisionsSpec, 'targets'> & {
  targets?: readonly TargetClause[]
}

export type ManaCost = string
export type ManaId = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

export type Cost =
  | { kind: 'tapSource' }
  | { kind: 'discard'; filter: ObjectSelector; count: Amount }
  | { kind: 'sacrifice'; filter: ObjectRecipient; count: Amount }
  | { kind: 'draw'; count: Amount }
  | { kind: 'life'; amount: Amount }
  | { kind: 'mana'; amount: ManaCost }

export type CostIncrease = { amount: ManaCost; reason?: string }
export type CostReduction = { generic: number; reason?: string }

/** A duration is data, so a temporary effect survives persistence/resume. */
export type EffectDuration =
  | { kind: 'untilCleanup' }
  | { kind: 'permanent' }
  | { kind: 'untilStep'; step: string; active?: PlayerReference }
  | { kind: 'forTurns'; count: Amount }
  | { kind: 'whileSourceOnBattlefield' }

export type GeneratedAbility = {
  kind: 'triggered'
  on: OccurrencePattern | DelayedPattern
  capturedBindings?: TriggeredAbilityDefinition['capturedBindings']
  decisions?: DecisionsInput
  instructions: readonly Instruction[]
}

export type PreventionFilter = {
  recipient?: PlayerReference | PlayerSelector | ObjectReference | ObjectSelector
  source?: ObjectReference | ObjectSelector
}

export type PreventDamageTransform = { kind: 'preventDamage' }

export type PreventionEffectDefinition = {
  kind: 'prevention'
  filter: PreventionFilter
  capacity: Amount
  additionalEffects?: readonly Instruction[]
  transform: PreventDamageTransform
}

export type CreatedEffect =
  | { kind: 'setColors'; colors: readonly CardColor[] }
  | { kind: 'pump'; power: Amount; toughness: Amount }
  | { kind: 'grantKeyword'; keyword: Keyword }
  | { kind: 'grantAbility'; ability: GeneratedAbility }
  | {
      kind: 'prevention'
      filter: PreventionFilter
      capacity: Amount
      additionalEffects?: readonly Instruction[]
    }

export type Condition =
  | { kind: 'resultIsTrue'; value: ResultReference }
  | { kind: 'compareAmount'; left: Amount; operator: 'eq' | 'gte' | 'lte'; right: Amount }
  | { kind: 'all'; conditions: readonly Condition[] }
  | { kind: 'any'; conditions: readonly Condition[] }
  | { kind: 'not'; condition: Condition }

export type PlayerRecipient = PlayerReference | PlayerSelector
export type ObjectRecipient = ObjectReference | ObjectSelector
export type StackItemRecipient = StackItemReference | StackItemSelector
export type DamageRecipient = PlayerRecipient | ObjectRecipient

export type TokenDefinition = {
  name: string
  types: string[]
  subtypes?: string[]
  colors?: string[]
  power?: number | null
  toughness?: number | null
  oracleText?: string
}

export type Instruction =
  /** Add the specified mana to each resolved player recipient's pool. */
  | { kind: 'addMana'; amount: Partial<Record<ManaId, Amount>>; targets: PlayerRecipient }
  /** Queue life loss for each resolved player recipient at this point in resolution. */
  | { kind: 'loseLife'; amount: Amount; targets: PlayerRecipient }
  /** Queue life gain for each resolved player recipient at this point in resolution. */
  | { kind: 'gainLife'; amount: Amount; targets: PlayerRecipient }
  /** Deal damage from the referenced source, allowing the normal damage pipeline to apply. */
  | { kind: 'damage'; amount: Amount; targets: DamageRecipient; source: ObjectReference }
  /** Have two current battlefield creatures deal simultaneous noncombat damage. */
  | { kind: 'fight'; left: ObjectReference; right: ObjectReference }
  /** Have each resolved player recipient draw the evaluated number of cards. */
  | { kind: 'draw'; count: Amount; targets: PlayerRecipient }
  /** Put the evaluated number of cards from each recipient's library into its graveyard. */
  | { kind: 'mill'; count: Amount; targets: PlayerRecipient }
  /** Shuffle each resolved player recipient's library (CR 701.19 after a search). */
  | { kind: 'shuffle'; targets: PlayerRecipient }
  /** Destroy each resolved object recipient and optionally bind the aggregate result. */
  | { kind: 'destroy'; targets: ObjectRecipient; bindResult?: string }
  /** Sacrifice each resolved object recipient and optionally bind the aggregate result. */
  | { kind: 'sacrifice'; targets: ObjectRecipient; bindResult?: string }
  /** Move each resolved object recipient to the requested zone and optionally bind the result. */
  | { kind: 'move'; targets: ObjectRecipient; to: Zone; tapped?: boolean; bindResult?: string }
  /** Inspect and order the top cards of each selected player's library. */
  | { kind: 'scry' | 'surveil'; targets: PlayerRecipient; count: Amount }
  /** Reveal each resolved object to every player through the ordinary visibility event. */
  | { kind: 'reveal'; targets: ObjectRecipient }
  /** Tap or untap each resolved object through the ordinary event pipeline. */
  | { kind: 'tap'; targets: ObjectRecipient }
  | { kind: 'untap'; targets: ObjectRecipient }
  /** Phase each resolved object out or in according to `out` during this resolution. */
  | { kind: 'phase'; targets: ObjectRecipient; out: boolean }
  /** Have each resolved player recipient choose permanents and players with counters to proliferate. */
  | { kind: 'proliferate'; targets: PlayerRecipient }
  /** Create the evaluated number of token objects under each resolved player recipient. */
  | { kind: 'createToken'; count: Amount; targets: PlayerRecipient; token: TokenDefinition; bindResult?: string }
  /** Copy each resolved object, optionally choosing a controller for the copy. */
  | { kind: 'copy'; targets: ObjectRecipient; controller?: PlayerRecipient; bindResult?: string }
  /** Copy a spell already on the stack; this creates a copy without casting a card. */
  | { kind: 'copySpell'; targets: StackItemRecipient; controller?: PlayerRecipient; retarget?: CopySpellRetargeting; bindResult?: string }
  /** Put the evaluated number of the named counter on each resolved object recipient. */
  | { kind: 'putCounters'; targets: ObjectRecipient; counter: string; count: Amount; bindResult?: string }
  /** Counter each resolved stack item before it can resolve. */
  | { kind: 'counter'; targets: StackItemRecipient; bindResult?: string }
  /** Apply the created effect to each resolved object for the supplied duration. */
  | {
      kind: 'createEffect'
      targets: ObjectRecipient
      effect: CreatedEffect
      duration: EffectDuration
    }
  /** Offer an optional cost; run ifPaid or ifDeclined after the decision, and queue whenPaid as a separate reflexive trigger on successful payment. */
  | {
      kind: 'payOptional'
      payer: PlayerReference
      cost: Cost
      bindResult: string
      whenPaidDecisions?: DecisionsInput
      ifPaid?: readonly Instruction[]
      ifDeclined?: readonly Instruction[]
      whenPaid?: readonly Instruction[]
    }
  /** Register instructions to run later when the delayed condition occurs. */
  | {
      kind: 'createDelayed'
      condition: DelayedPattern
      instructions: readonly Instruction[]
    }
  /** Discard the explicitly resolved object recipient on behalf of the named player. */
  | {
      kind: 'discard'
      targets: ObjectRecipient
      by: PlayerReference
      count?: never
      bindResult?: string
    }
  /** Prompt each resolved player recipient to choose the evaluated number of cards to discard. */
  | {
      kind: 'discard'
      targets: PlayerRecipient
      count: Amount
      by?: never
      bindResult?: string
    }
  /** Open a card choice for the chooser, binding the selected objects for later instructions. */
  | {
      kind: 'chooseCards'
      bindChoice: string
      chooser: PlayerReference
      filter: ObjectSelector
      /** Let the chooser inspect the full library while selecting matching cards. */
      viewLibrary?: true
      min: Amount
      max: Amount
      distinct: true
      whenInsufficient: 'chooseAvailable'
    }
  /** Reveal from the top of each recipient's library until a match is found. */
  | {
      kind: 'revealUntil'
      targets: PlayerRecipient
      match: ObjectSelector
      count?: Amount
      bindFound?: string
      bindRest?: string
      foundTo: Zone
      rest: 'orderBottom'
    }
  /** Run nested instructions in order, resuming after any player choice pauses resolution. */
  | { kind: 'sequence'; instructions: readonly Instruction[] }
  /** Let the chooser select one available option; continue without an option when none is available. */
  | {
      kind: 'chooseInstructions'
      /** Explicit optional action: option 0 accepts the program; option 1 declines with no instructions. */
      optional?: true
      chooser: PlayerReference
      prompt?: string
      count: { kind: 'constant'; value: 1 }
      options: readonly { label?: string; instructions: readonly Instruction[] }[]
      whenInsufficient: 'chooseAvailable'
    }
  /** Evaluate one branch immediately and continue with its resulting instruction sequence. */
  | {
      kind: 'if'
      condition: Condition
      then: readonly Instruction[]
      otherwise: readonly Instruction[]
    }

export type DelayedPattern =
  | { kind: 'event'; type: string; objectId?: ObjectReference; from?: Zone; to?: Zone }
  | { kind: 'step'; step: string; active?: PlayerReference }

export type ResolutionProgram =
  | { instructions: readonly Instruction[]; modes?: never }
  | { modes: readonly ModeDefinition[]; instructions?: never }

export type ResolutionProgramInput =
  | { instructions: readonly Instruction[]; modes?: never }
  | { modes: readonly ModeInput[]; instructions?: never }

export type ModeDefinition = {
  decisions: Omit<DecisionsSpec, 'modes'>
  instructions: readonly Instruction[]
}

export type ModeInput = {
  decisions?: Omit<DecisionsInput, 'modes'>
  instructions: readonly Instruction[]
}

/** Retargeting is an explicit procedure; `keep` preserves even now-illegal pins. */
export type CopySpellRetargeting =
  | { kind: 'keep' }
  | { kind: 'chooseNewTargets' }

export type ActivationTiming = 'anyTime' | 'sorcery'

export type TriggerFrequency =
  | { kind: 'onceEachTurn' }
  | { kind: 'firstMatchingEachTurn' }

export type ActivationFilter = {
  abilitySource?: ObjectFilter
  activator?: PlayerFilter
}

export type DrawReplacementFilter = {
  player?: PlayerReference | PlayerSelector
  firstDrawInOwnDrawStep?: boolean
}

export type DamageReplacementFilter = {
  recipient?: PlayerReference | PlayerSelector | ObjectReference | ObjectSelector
  source?: ObjectReference | ObjectSelector
}

export type ReplacementEventPattern =
  | { kind: 'draw'; filter: DrawReplacementFilter }
  | { kind: 'enterBattlefield'; filter: { object: ObjectFilter | ObjectReference } }
  | { kind: 'move'; filter: { object?: ObjectFilter | ObjectReference; to?: Zone } }
  | { kind: 'damage'; filter?: DamageReplacementFilter }

export type AmountFieldChange =
  | { kind: 'multiply'; factor: Amount }
  | { kind: 'add'; delta: Amount }

export type EventFieldChanges = {
  to?: Zone
  tapped?: boolean
  amount?: AmountFieldChange
}

export type ReplacementTransform =
  | { kind: 'replaceWith'; instructions: readonly Instruction[] }
  | { kind: 'modifyEvent'; changes: EventFieldChanges }
  | { kind: 'redirect'; to: Zone }
  | { kind: 'suppress' }

export type ReplacementProgramInstruction =
  | { kind: 'choose'; bindChoice: string; options: readonly { id: string; label: string }[] }
  | { kind: 'branch'; condition: Condition; then: readonly ReplacementProgramInstruction[]; otherwise?: readonly ReplacementProgramInstruction[] }
  | { kind: 'emit'; instructions: readonly Instruction[] }

export type ReplacementEffectDefinition = {
  kind: 'replacement'
  event: ReplacementEventPattern
  when?: Condition
  optional?: boolean
  transform: ReplacementTransform
  program?: readonly ReplacementProgramInstruction[]
}

export type ContinuousEffectDefinition =
  | { kind: 'prohibitActivation'; filter: ActivationFilter }
  | { kind: 'extraLandPlays'; count: number }
  | {
      kind: 'modifyStats'
      targets: ObjectSelector
      power: Amount
      toughness: Amount
      /** Layer 7b set-P/T when true; otherwise layer 7c +N/+N. */
      set?: true
    }
  | ReplacementEffectDefinition
  | PreventionEffectDefinition

export type Keyword = 'defender' | 'trample'

export type SpellAbilityDefinition = {
  kind: 'spell'
  decisions: DecisionsSpec
  costs: readonly Cost[]
  optionalCosts?: readonly Cost[]
  alternativeCosts?: readonly (readonly Cost[])[]
  costIncreases?: readonly CostIncrease[]
  costReductions?: readonly CostReduction[]
} & ResolutionProgram

export type ActivatedAbilityDefinition = {
  kind: 'activated'
  availableFrom: readonly Zone[]
  timing: ActivationTiming
  decisions: DecisionsSpec
  costs: readonly Cost[]
  optionalCosts?: readonly Cost[]
  alternativeCosts?: readonly (readonly Cost[])[]
  costIncreases?: readonly CostIncrease[]
  costReductions?: readonly CostReduction[]
} & ResolutionProgram

export type TriggeredAbilityDefinition = {
  kind: 'triggered'
  /** Internal marker used only by canonical generated-program snapshots. */
  generated?: true
  /** Lexical declarations captured by a generated snapshot before its occurrence is matched. */
  capturedBindings?: {
    choices?: readonly string[]
    results?: Readonly<Record<string, readonly ResultField[]>>
    occurrence?: readonly ('player' | 'object.before' | 'object.after')[]
  }
  activeIn: readonly Zone[]
  on: OccurrencePattern
  triggerOnlyIf?: Condition
  interveningIf?: Condition
  frequency?: TriggerFrequency
  manaAbility?: true
  decisions: DecisionsSpec
} & ResolutionProgram

export type StaticAbilityDefinition = {
  kind: 'static'
  activeIn: readonly Zone[]
  effects: readonly ContinuousEffectDefinition[]
}

export type KeywordAbilityDefinition = {
  kind: 'keyword'
  keyword: Keyword
}

export type AbilityDefinition =
  | SpellAbilityDefinition
  | ActivatedAbilityDefinition
  | TriggeredAbilityDefinition
  | StaticAbilityDefinition
  | KeywordAbilityDefinition

export type CardRuleDefinitionV1 = {
  schemaVersion: RuleDslSchemaVersion
  definitionRevision: string
  abilities: readonly AbilityDefinition[]
}

export type CardRuleDefinitionInputV1 = {
  abilities: readonly AbilityDefinition[]
}

export type WheneverConfiguration = {
  activeIn?: readonly Zone[]
  decisions?: DecisionsInput
  triggerOnlyIf?: Condition
  interveningIf?: Condition
  frequency?: TriggerFrequency
  manaAbility?: true
} & ResolutionProgramInput

export type DefinitionDeclaration = {
  path: string
  kind: string
}

export type CompiledCardRuleDefinitionV1 = {
  schemaVersion: RuleDslSchemaVersion
  definitionRevision: string
  definition: CardRuleDefinitionV1
  declarations: readonly DefinitionDeclaration[]
  capabilities: {
    canonicalLoad: true
    serialization: true
    runtimeExecution: {
      abilitiesWithSuppliedContext: readonly ['activated', 'spell', 'triggered']
      instructionKinds: readonly string[]
      decisions: 'fullySuppliedTargets'
    }
  }
}

/**
 * Replays retain the exact canonical definition rather than consulting a mutable
 * process catalogue. Both version pins are repeated outside the payload so a
 * corrupt or mismatched snapshot fails before a frame is restored.
 */
export type CardRuleDefinitionSnapshotV1 = {
  schemaVersion: RuleDslSchemaVersion
  definitionRevision: string
  definition: CardRuleDefinitionV1
}

export type AmountEvaluationContext = {
  variables?: Readonly<Partial<Record<'X', number>>>
  eventAmount?: number
  count: (selector: Selector) => number
  characteristic: (
    reference: Reference,
    characteristic: NumericCharacteristic,
    information: 'current' | 'currentOrLastKnown',
  ) => number
}
