export const RULE_DSL_SCHEMA_VERSION = 1 as const

export type RuleDslSchemaVersion = typeof RULE_DSL_SCHEMA_VERSION

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command'

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

export type ResultField = 'discarded' | 'discardedCount' | 'countered' | 'paid'

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
  controller?: 'you' | PlayerReference
  owner?: 'you' | PlayerReference
  token?: boolean
  name?: string
  all?: readonly ObjectFilter[]
  any?: readonly ObjectFilter[]
  not?: ObjectFilter
}

export type StackItemFilter = {
  kind?: 'spell' | 'ability'
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
  | {
      kind: 'draw'
      filter: {
        player?: PlayerReference | PlayerSelector
        firstDrawInOwnDrawStep?: boolean
      }
    }

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

export type Cost =
  | { kind: 'discard'; filter: ObjectSelector; count: Amount }
  | { kind: 'sacrifice'; filter: ObjectSelector; count: Amount }
  | { kind: 'life'; amount: Amount }
  | { kind: 'mana'; amount: ManaCost }

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

export type Instruction =
  | { kind: 'loseLife'; amount: Amount; targets: PlayerRecipient }
  | { kind: 'gainLife'; amount: Amount; targets: PlayerRecipient }
  | { kind: 'damage'; amount: Amount; targets: DamageRecipient; source: ObjectReference }
  | { kind: 'draw'; count: Amount; targets: PlayerRecipient }
  | { kind: 'mill'; count: Amount; targets: PlayerRecipient }
  | { kind: 'destroy'; targets: ObjectRecipient }
  | { kind: 'counter'; targets: StackItemRecipient; bindResult?: string }
  | {
      kind: 'discard'
      targets: ObjectRecipient
      by: PlayerReference
      count?: never
      bindResult?: string
    }
  | {
      kind: 'discard'
      targets: PlayerRecipient
      count: Amount
      by?: never
      bindResult?: string
    }
  | {
      kind: 'chooseCards'
      bindChoice: string
      chooser: PlayerReference
      filter: ObjectSelector
      min: Amount
      max: Amount
      distinct: true
      whenInsufficient: 'chooseAvailable'
    }
  | { kind: 'sequence'; instructions: readonly Instruction[] }
  | {
      kind: 'chooseInstructions'
      chooser: PlayerReference
      count: { kind: 'constant'; value: 1 }
      options: readonly { instructions: readonly Instruction[] }[]
      whenInsufficient: 'chooseAvailable'
    }
  | {
      kind: 'if'
      condition: Condition
      then: readonly Instruction[]
      otherwise: readonly Instruction[]
    }

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

export type ActivationTiming = 'anyTime' | 'sorcery'

export type TriggerFrequency =
  | { kind: 'onceEachTurn' }
  | { kind: 'firstMatchingEachTurn' }

export type ActivationFilter = {
  abilitySource?: ObjectFilter
  activator?: PlayerFilter
}

export type ContinuousEffectDefinition = {
  kind: 'prohibitActivation'
  filter: ActivationFilter
}

export type Keyword = 'defender' | 'trample'

export type SpellAbilityDefinition = {
  kind: 'spell'
  decisions: DecisionsSpec
  costs: readonly Cost[]
} & ResolutionProgram

export type ActivatedAbilityDefinition = {
  kind: 'activated'
  availableFrom: readonly Zone[]
  timing: ActivationTiming
  decisions: DecisionsSpec
  costs: readonly Cost[]
} & ResolutionProgram

export type TriggeredAbilityDefinition = {
  kind: 'triggered'
  activeIn: readonly Zone[]
  on: OccurrencePattern
  triggerOnlyIf?: Condition
  interveningIf?: Condition
  frequency?: TriggerFrequency
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
      abilityKinds: readonly ['spell']
      instructionKinds: readonly ['counter', 'damage', 'destroy', 'draw', 'gainLife', 'loseLife', 'sequence']
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
