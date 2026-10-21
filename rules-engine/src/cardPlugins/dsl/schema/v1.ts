import type { StepId } from '../../../types'

export const RULE_DSL_SCHEMA_VERSION = 1 as const

/** Binding stored on the entering object as `chosenColor` (CR 614.12). */
export const CHOSEN_COLOR_BINDING = 'chosenColor' as const

/** Binding for “as this enters, you may pay life” replacement choices. */
export const ENTRY_PAYMENT_BINDING = 'entryPayment' as const
export const PAY_LIFE_OPTION = 'pay' as const
export const DECLINE_LIFE_OPTION = 'decline' as const

export type RuleDslSchemaVersion = typeof RULE_DSL_SCHEMA_VERSION

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command'

export const CARD_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type CardColor = typeof CARD_COLORS[number]

export const PLAYER_RELATIONS = {
  you: 'you', opponent: 'opponent', anyone: 'any', teammate: 'teammate',
} as const
export type PlayerRelation = typeof PLAYER_RELATIONS[keyof typeof PLAYER_RELATIONS]
/** The same relation or specific-player reference is accepted in every player role. */
export type PlayerMatch = PlayerRelation | PlayerReference

export type PlayerFilter = {
  relation?: PlayerMatch
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
  | 'triggering.object.controller'

/** Player results store a seat ID; other action results remain boolean or numeric. */
export type InstructionResult = boolean | number | string

export type ResultField = 'player' | 'amount' | 'discarded' | 'discardedCount' | 'countered' | 'paid' | 'moved' | 'destroyed' | 'sacrificed' | 'created' | 'copied'

export type ContextReference = { kind: 'contextRef'; name: ContextBinding }
export type TargetReference = { kind: 'targetRef'; clauseIndex: number }
export type ChoiceReference = { kind: 'choiceRef'; binding: string }
export type ResultReference = { kind: 'resultRef'; binding: string; field: ResultField }
export type RelatedPlayerReference = { kind: 'relatedPlayer'; relation: 'controller' | 'owner'; of: ObjectReference | StackItemReference }
export type Reference = ContextReference | TargetReference | ChoiceReference | ResultReference | RelatedPlayerReference

export type PlayerReference = ContextReference | TargetReference | ChoiceReference | RelatedPlayerReference | (ResultReference & { field: 'player' })
export type ObjectReference = ContextReference | TargetReference | ChoiceReference
export type StackItemReference = TargetReference | ChoiceReference

export type ObjectFilter = {
  /** Exclude the executing source's captured object identity. False adds no restriction. */
  other?: boolean
  commander?: boolean
  manaAbility?: boolean
  sameNameAs?: ObjectReference
  /** Restrict matches to the current identities of a bound object reference. */
  among?: ObjectReference
  zone?: Zone
  type?: string
  subtypes?: readonly string[]
  supertypes?: readonly string[]
  controller?: PlayerMatch
  owner?: PlayerMatch
  token?: boolean
  name?: string
  tapped?: boolean
  attacking?: boolean
  powerAtLeast?: number
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
  controller?: PlayerMatch
  all?: readonly StackItemFilter[]
  any?: readonly StackItemFilter[]
  not?: StackItemFilter
}

export type PlayerSelector = { kind: 'players'; filter: PlayerFilter }
export type ObjectSelector = { kind: 'objects'; filter: ObjectFilter }
export type StackItemSelector = { kind: 'stackItems'; filter: StackItemFilter }
/** Single-target clause for a player, creature, planeswalker, or battle (CR 115.4). */
export type AnyTargetSelector = { kind: 'anyTarget' }
export const DAMAGEABLE_PERMANENT_TYPES = ['Creature', 'Planeswalker', 'Battle'] as const
export type Selector = PlayerSelector | ObjectSelector | StackItemSelector | AnyTargetSelector

export type NumericCharacteristic = 'power' | 'toughness' | 'manaValue' | 'life' | 'loyalty'

export const ROUNDING_MODES = { up: 'up', down: 'down' } as const
export type RoundingMode = typeof ROUNDING_MODES[keyof typeof ROUNDING_MODES]

export type Amount =
  | { kind: 'resultRef'; binding: string; field: 'amount' | 'discardedCount' | 'created' }
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; name: 'X' }
  | { kind: 'eventAmount' }
  | { kind: 'multiply' | 'minimum' | 'add'; left: Amount; right: Amount }
  | { kind: 'manaSpent'; color: CardColor }
  | { kind: 'divide'; value: Amount; by: number; rounding: RoundingMode }
  | { kind: 'count'; of: Selector }
  | { kind: 'countDistinctNames'; of: ObjectSelector }
  | {
      kind: 'greatest'
      of: ObjectSelector
      characteristic: NumericCharacteristic
      information: 'current' | 'currentOrLastKnown'
    }
  | {
      kind: 'characteristic'
      of: Reference
      characteristic: NumericCharacteristic
      information: 'current' | 'currentOrLastKnown'
      fallback?: number
    }

export type AmountInput = number | Amount

/** Sentinel for “prevent all” rather than a numeric shield. */
export const UNLIMITED_PREVENTION = { kind: 'unlimited' } as const
export type UnlimitedPreventionCapacity = typeof UNLIMITED_PREVENTION
export type PreventionCapacity = Amount | UnlimitedPreventionCapacity
export type PreventionCapacityInput = AmountInput | UnlimitedPreventionCapacity

/** Signed expressions are accepted only where a power/toughness delta is required. */
export type StatDelta = Amount | { kind: 'negate'; value: Amount }
export type StatDeltaInput = number | StatDelta

export type ObjectOccurrenceFilter =
  | ObjectFilter
  | ObjectReference
  | { all: readonly ObjectOccurrenceFilter[] }
  | { any: readonly ObjectOccurrenceFilter[] }
  | { not: ObjectOccurrenceFilter }

export type OccurrencePattern =
  | { kind: 'stepBegins'; step: StepId; player?: PlayerReference | PlayerSelector }
  | { kind: 'playLand'; filter: { player?: PlayerReference | PlayerSelector } }
  | { kind: 'discard'; filter: { player?: PlayerReference | PlayerSelector } }
  | { kind: 'cycle'; filter: { player?: PlayerReference | PlayerSelector; object?: ObjectOccurrenceFilter } }
  | { kind: 'cast'; filter: ObjectOccurrenceFilter }
  | { kind: 'attacks'; filter: ObjectOccurrenceFilter }
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
  manaColor?: ManaId
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
  | { kind: 'discard'; filter: ObjectRecipient; count: Amount }
  | { kind: 'sacrifice'; filter: ObjectRecipient; count: Amount }
  | { kind: 'draw'; count: Amount }
  | { kind: 'life'; amount: Amount }
  | { kind: 'mana'; amount: ManaCost }
  /** Exile chosen graveyard cards while paying to cover generic mana only. */
  | { kind: 'delve' }

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
  /** When true, match only combat damage. When false, match only noncombat damage. */
  combat?: boolean
}

export type PreventDamageTransform = { kind: 'preventDamage' }

export type PreventionEffectDefinition = {
  kind: 'prevention'
  filter: PreventionFilter
  capacity: PreventionCapacity
  additionalEffects?: readonly Instruction[]
  transform: PreventDamageTransform
}

export type CreatedEffect =
  | { kind: 'goad' }
  | { kind: 'setColors'; colors: readonly CardColor[] }
  | { kind: 'pump'; power: StatDelta; toughness: StatDelta }
  | { kind: 'grantKeyword'; keyword: Keyword }
  | { kind: 'grantAbility'; ability: GeneratedAbility }
  | {
      kind: 'prevention'
      filter: PreventionFilter
      capacity: PreventionCapacity
      additionalEffects?: readonly Instruction[]
    }

export const PLAYER_COMPARISON_METRICS = ['life', 'hand', 'lands', 'creatures'] as const
export type PlayerComparisonMetric = typeof PLAYER_COMPARISON_METRICS[number]

export type Condition =
  | { kind: 'somePlayerHasMore'; players: PlayerSelector; than: PlayerReference; metric: PlayerComparisonMetric }
  | { kind: 'resultIsTrue'; value: ResultReference }
  | { kind: 'compareAmount'; left: Amount; operator: 'eq' | 'gte' | 'lte'; right: Amount }
  | { kind: 'choiceIs'; binding: string; option: string }
  | { kind: 'all'; conditions: readonly Condition[] }
  | { kind: 'any'; conditions: readonly Condition[] }
  | { kind: 'not'; condition: Condition }

export type PlayerRecipient = PlayerReference | PlayerSelector
export type ObjectRecipient = ObjectReference | ObjectSelector
export type StackItemRecipient = StackItemReference | StackItemSelector
export type DamageRecipient = PlayerRecipient | ObjectRecipient

export const REVEAL_UNTIL_REST = { orderBottom: 'orderBottom', graveyard: 'graveyard', keep: 'keep' } as const
export type RevealUntilRest = typeof REVEAL_UNTIL_REST[keyof typeof REVEAL_UNTIL_REST]

export const LIBRARY_VISIBILITY = { private: 'private', public: 'public' } as const
export type LibraryVisibility = typeof LIBRARY_VISIBILITY[keyof typeof LIBRARY_VISIBILITY]

export type TokenDefinition = {
  name: string
  types: string[]
  subtypes?: string[]
  colors?: string[]
  power?: number | null
  toughness?: number | null
  oracleText?: string
  abilities?: readonly AbilityDefinition[]
}

export type Instruction =
  | { kind: 'choosePlayer'; chooser: PlayerReference; filter: PlayerSelector; bindChoice: string }
  | { kind: 'forEachPlayer'; of: PlayerRecipient; instructions: readonly Instruction[] }
  /** Bind a bounded top-library segment without moving those objects. */
  | { kind: 'inspectTop'; player: PlayerReference; count: Amount; bindChoice: string; visibility: LibraryVisibility }
  /** Evaluate an amount now, preserving it for later instructions and continuations. */
  | { kind: 'capturePlayer'; player: PlayerReference; bindResult: string }
  | { kind: 'captureAmount'; amount: Amount; bindResult: string }
  /** Persist copiable characteristics before the source leaves its current zone. */
  | { kind: 'captureCopy'; targets: ObjectRecipient; bindResult: string }
  /** Add the specified mana to each resolved player recipient's pool. */
  | { kind: 'addMana'; amount: Partial<Record<ManaId, Amount>>; targets: PlayerRecipient }
  /** Queue life loss for each resolved player recipient at this point in resolution. */
  | { kind: 'loseLife'; amount: Amount; targets: PlayerRecipient; bindResult?: string }
  /** Queue life gain for each resolved player recipient at this point in resolution. */
  | { kind: 'gainLife'; amount: Amount; targets: PlayerRecipient }
  /** Deal damage from the referenced source, allowing the normal damage pipeline to apply. */
  | { kind: 'damage'; amount: Amount; targets: DamageRecipient; source: ObjectReference; bindResult?: string }
  /** Have two current battlefield creatures deal simultaneous noncombat damage. */
  | { kind: 'fight'; left: ObjectReference; right: ObjectReference }
  /** Exile permanents, then return the resulting cards as new objects (CR 400.7j). */
  | { kind: 'blink'; targets: ObjectRecipient; returnController?: 'owner' | PlayerReference; tapped?: boolean }
  /** Have each resolved player recipient draw the evaluated number of cards. */
  | { kind: 'draw'; count: Amount; targets: PlayerRecipient }
  /** Grant each recipient additional land plays for the rest of this turn. */
  | { kind: 'grantLandPlays'; count: Amount; targets: PlayerRecipient }
  /** Grant unlimited hand size for the rest of the game independently of the resolving source. */
  | { kind: 'grantNoMaximumHandSize'; targets: PlayerRecipient }
  /** Put the evaluated number of cards from each recipient's library into its graveyard. */
  | { kind: 'mill'; count: Amount; targets: PlayerRecipient }
  /** Shuffle each resolved player recipient's library (CR 701.19 after a search). */
  | { kind: 'shuffle'; targets: PlayerRecipient }
  /** Destroy each resolved object recipient and optionally bind the aggregate result. */
  | { kind: 'destroy'; targets: ObjectRecipient; bindResult?: string; bindChoice?: string }
  /** Sacrifice each resolved object recipient and optionally bind the aggregate result. */
  | { kind: 'sacrifice'; targets: ObjectRecipient; bindResult?: string; bindCount?: string }
  /** Move each resolved object recipient to the requested zone and optionally bind the result. */
  | { kind: 'move'; targets: ObjectRecipient; to: Zone; position?: 'top' | 'bottom'; order?: 'random'; controller?: PlayerReference; tapped?: boolean; enterCounters?: Readonly<Record<string, Amount>>; bindResult?: string; bindChoice?: string }
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
  /** Copy each resolved object or a captured snapshot, optionally choosing a controller for the copy. */
  | { kind: 'copy'; targets?: ObjectRecipient; snapshot?: string; controller?: PlayerRecipient; bindResult?: string }
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
      /** Ignore matching occurrences until the current turn has ended. */
      notThisTurn?: true
      /** Omit the parent's target clauses for a non-targeting delayed program. Defaults to true. */
      inheritTargets?: boolean
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
      viewCards?: ObjectReference
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
      rest: RevealUntilRest
    }
  /** Assign each permanent to a chosen recipient, then change control simultaneously. */
  | { kind: 'distributeControl'; targets: ObjectRecipient; chooser: PlayerReference; recipients: PlayerRecipient; distinct: boolean }
  /** Run nested instructions in order, resuming after any player choice pauses resolution. */
  | { kind: 'sequence'; instructions: readonly Instruction[] }
  /** Run nested instructions once per resolved object, exposing that object's controller as event.player. */
  | { kind: 'forEach'; of: ObjectRecipient; instructions: readonly Instruction[] }
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
  | { kind: 'step'; step: StepId | readonly StepId[]; active?: PlayerReference }

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
  | { kind: 'choose'; bindChoice: string; options: readonly { id: string; label: string }[]; prompt?: string }
  | { kind: 'branch'; condition: Condition; then: readonly ReplacementProgramInstruction[]; otherwise?: readonly ReplacementProgramInstruction[] }
  | { kind: 'modifyEvent'; changes: EventFieldChanges }
  | { kind: 'payLife'; amount: Amount }
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
  | { kind: 'noMaximumHandSize' }
  | {
      kind: 'modifyStats'
      targets: ObjectSelector
      power: StatDelta
      toughness: StatDelta
      /** Layer 7b set-P/T when true; otherwise layer 7c +N/+N. */
      set?: true
    }
  | ReplacementEffectDefinition
  | PreventionEffectDefinition

export const KEYWORDS = {
  deathtouch: 'deathtouch', defender: 'defender', trample: 'trample', flying: 'flying', flash: 'flash', haste: 'haste', vigilance: 'vigilance',
  hexproof: 'hexproof', indestructible: 'indestructible',
} as const
export type Keyword = typeof KEYWORDS[keyof typeof KEYWORDS]

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
  /** CR 702.89 — emit a `cycle` event after this hand activation fully resolves. */
  cycling?: true
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
    playerChoices?: readonly string[]
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
  when?: Condition
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
  result?: (reference: Extract<Amount, { kind: 'resultRef' }>) => number | undefined
  variables?: Readonly<Partial<Record<'X', number>>>
  eventAmount?: number
  manaSpent?: (color: CardColor) => number
  count: (selector: Selector, distinctNames?: true) => number
  greatest: (
    selector: ObjectSelector,
    characteristic: NumericCharacteristic,
    information: 'current' | 'currentOrLastKnown',
  ) => number
  characteristic: (
    reference: Reference,
    characteristic: NumericCharacteristic,
    information: 'current' | 'currentOrLastKnown',
    fallback?: number,
  ) => number
}
