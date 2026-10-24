import type { RoomDoorId, StepId } from '../../../types'

export const ROOM_DOORS = ['left', 'right'] as const

export const RULE_DSL_SCHEMA_VERSION = 1 as const

/** Binding stored on the entering object as `chosenColor` (CR 614.12). */
export const CHOSEN_COLOR_BINDING = 'chosenColor' as const

/** Binding for “as this enters, you may pay life” replacement choices. */
export const ENTRY_PAYMENT_BINDING = 'entryPayment' as const
export const PAY_LIFE_OPTION = 'pay' as const
export const DECLINE_LIFE_OPTION = 'decline' as const

export type RuleDslSchemaVersion = typeof RULE_DSL_SCHEMA_VERSION

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command'

/** Destinations that can receive cards released from a linked exile. */
export const LINKED_EXILE_RETURN = ['battlefield', 'hand'] as const
export type LinkedExileReturn = typeof LINKED_EXILE_RETURN[number]

/** Cost policy for a temporary spell-cast permission (26-permission). */
export const SPELL_CAST_COSTS = { withoutPayingMana: 'withoutPayingMana' } as const
export type SpellCastCost = typeof SPELL_CAST_COSTS[keyof typeof SPELL_CAST_COSTS]

export const CARD_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type CardColor = typeof CARD_COLORS[number]

export const PLAYER_RELATIONS = {
  you: 'you', opponent: 'opponent', anyone: 'any', teammate: 'teammate',
} as const
export type PlayerRelation = typeof PLAYER_RELATIONS[keyof typeof PLAYER_RELATIONS]

export const AMOUNT_COMPARE_OPERATORS = { eq: 'eq', gte: 'gte', lte: 'lte' } as const
export type AmountCompareOperator = typeof AMOUNT_COMPARE_OPERATORS[keyof typeof AMOUNT_COMPARE_OPERATORS]

export const OBJECT_NUMERIC_CHARACTERISTICS = ['power', 'toughness', 'manaValue', 'loyalty'] as const
export type ObjectNumericCharacteristic = typeof OBJECT_NUMERIC_CHARACTERISTICS[number]
/** The same relation or specific-player reference is accepted in every player role. */
export type PlayerMatch = PlayerRelation | PlayerReference

export type PlayerFilter = {
  controls?: ObjectFilter
  enchantableBy?: ObjectReference
  relation?: PlayerMatch
  all?: readonly PlayerFilter[]
  any?: readonly PlayerFilter[]
  not?: PlayerFilter
}

export type ContextBinding =
  | 'source'
  | 'subject'
  | 'controller'
  | 'event.player'
  | 'triggering.player'
  | 'triggering.defender'
  | 'triggering.object.before'
  | 'triggering.object.after'
  | 'triggering.source'
  | 'triggering.ability'
  | 'triggering.object.controller'
  | 'grant.source'
  | 'enchanted.player'

/** Player results store a seat ID; other action results remain boolean or numeric. */
export const MANA_QUERY_BASIS = { production: 'production', colors: 'colors' } as const
export type ManaQueryBasis = typeof MANA_QUERY_BASIS[keyof typeof MANA_QUERY_BASIS]

export type InstructionResult = boolean | number | string

export const NUMERIC_RESULT_FIELDS = ['amount', 'discardedCount', 'created'] as const
export type NumericResultField = typeof NUMERIC_RESULT_FIELDS[number]

/** Collect a surviving maximum from each forEachPlayer iteration's numeric result. */
export type ResultMaxBinding = {
  from: string
  field: NumericResultField
  as: string
}

export type ResultField = 'player' | 'amount' | 'discarded' | 'discardedCount' | 'countered' | 'paid' | 'moved' | 'destroyed' | 'sacrificed' | 'created' | 'copied'

export type ContextReference = { kind: 'contextRef'; name: ContextBinding }
export type TargetReference = { kind: 'targetRef'; clauseIndex: number }
export type ChoiceReference = { kind: 'choiceRef'; binding: string }
export type ResultReference = { kind: 'resultRef'; binding: string; field: ResultField }
export type RelatedPlayerReference = { kind: 'relatedPlayer'; relation: 'controller' | 'owner'; information?: 'currentOrLastKnown'; of: ObjectReference | StackItemReference }
export type PaidCostPlayerReference = { kind: 'paidCostPlayer'; index: number }
export type Reference = PaidCostPlayerReference | ContextReference | TargetReference | ChoiceReference | ResultReference | RelatedPlayerReference

export type PlayerReference = PaidCostPlayerReference | ContextReference | TargetReference | ChoiceReference | RelatedPlayerReference | (ResultReference & { field: 'player' })
export type ObjectReference = ContextReference | TargetReference | ChoiceReference
export type StackItemReference = TargetReference | ChoiceReference | { kind: 'eventStackItem' }

export const CHOSEN_CREATURE_TYPE_BINDING = 'chosenType' as const
export type CreatureTypeReference = string | { kind: 'typeChoice'; binding: string } | { kind: 'chosenCreatureType'; of: ObjectReference }

/** Spend filter and producer provenance for restricted mana (Cavern of Souls, Delighted Halfling). */
export type ManaSpendRestriction = {
  creatureType?: CreatureTypeReference
  legendary?: true
  uncounterable?: true
}

export type ObjectFilter = {
  when?: Condition
  enchantableBy?: ObjectReference
  creatureType?: CreatureTypeReference
  /** Exclude the executing source's captured object identity. False adds no restriction. */
  other?: boolean
  commander?: boolean
  manaAbility?: boolean
  /** True matches permanents with one or more colors; false matches colorless. */
  colored?: boolean
  enchantedBy?: ObjectReference
  /** Current cards exiled by the referenced source incarnation. */
  exiledWith?: ObjectReference
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
  keyword?: Keyword
  tapped?: boolean
  attacking?: boolean
  /** Zone the spell was cast from while this object is on the stack. */
  castFrom?: Zone
  powerAtLeast?: number
  compareCharacteristic?: {
    characteristic: ObjectNumericCharacteristic
    operator: AmountCompareOperator
    than: Amount
  }
  all?: readonly ObjectFilter[]
  any?: readonly ObjectFilter[]
  not?: ObjectFilter
}

export type StackItemFilter = {
  when?: Condition
  kind?: 'spell' | 'ability'
  /** Card type of the stack object, for "instant or sorcery spell" and similar. */
  type?: string
  color?: CardColor
  other?: boolean
  controller?: PlayerMatch
  owner?: PlayerMatch
  /** Zone the spell or ability was cast or activated from. */
  castFrom?: Zone
  /** At least one announced target matches this object/player selector. */
  targets?: ObjectSelector | PlayerSelector
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

export const LIFE_LOST_COMBINE = { sum: 'sum', greatest: 'greatest' } as const
export type LifeLostCombine = typeof LIFE_LOST_COMBINE[keyof typeof LIFE_LOST_COMBINE]

export type Amount =
  | { kind: 'resultRef'; binding: string; field: 'amount' | 'discardedCount' | 'created' }
  | { kind: 'constant'; value: number }
  | { kind: 'variable'; name: 'X' }
  | { kind: 'paidCostCount'; cost: 'optional' | 'alternative'; index: number }
  | { kind: 'eventAmount' }
  | { kind: 'multiply' | 'minimum' | 'add' | 'difference'; left: Amount; right: Amount }
  | { kind: 'manaSpent'; color: CardColor }
  | { kind: 'divide'; value: Amount; by: number; rounding: RoundingMode }
  | { kind: 'count'; of: Selector }
  | { kind: 'counterCount'; of: ObjectReference; counter: string }
  | { kind: 'countDistinctNames'; of: ObjectSelector }
  | { kind: 'countDistinctCardTypes'; of: ObjectSelector }
  | {
      kind: 'greatest'
      of: ObjectSelector
      characteristic: ObjectNumericCharacteristic
      information: 'current' | 'currentOrLastKnown'
    }
  | {
      kind: 'characteristic'
      of: Reference
      characteristic: NumericCharacteristic
      information: 'current' | 'currentOrLastKnown'
      fallback?: number
    }
  | { kind: 'lifeLostThisTurn'; of: PlayerRecipient; combine?: LifeLostCombine }
  | { kind: 'damageDealtThisTurn'; to: ObjectReference; by?: PlayerRecipient }
  /** Count of recorded ballots for one option of a finished public vote. */
  | { kind: 'voteTally'; binding: string; option: string }

export type AmountInput = number | Amount

/** Signed expressions are limited to consumers that set life totals. */
export type LifeTotalAmount = Amount | { kind: 'lowestLife'; of: PlayerSelector }

/** Sentinel for “prevent all” rather than a numeric shield. */
export const UNLIMITED_PREVENTION = { kind: 'unlimited' } as const
export type UnlimitedPreventionCapacity = typeof UNLIMITED_PREVENTION
export type PreventionCapacity = Amount | UnlimitedPreventionCapacity
export type PreventionCapacityInput = AmountInput | UnlimitedPreventionCapacity

/** Signed expressions are accepted only where a power/toughness delta is required. */
export type StatDelta = Amount | { kind: 'negate'; value: Amount }
  | { kind: 'sumCharacteristics'; of: ObjectSelector; characteristic: 'power' | 'toughness' }
export type StatDeltaInput = number | StatDelta

export type ObjectOccurrenceFilter =
  | ObjectFilter
  | ObjectReference
  | { all: readonly ObjectOccurrenceFilter[] }
  | { any: readonly ObjectOccurrenceFilter[] }
  | { not: ObjectOccurrenceFilter }

export type PlayerOccurrenceFilter = {
  player?: PlayerReference | PlayerSelector
  /** True when the occurrence's player is the active player. */
  duringOwnTurn?: boolean
  /** 1-based count of matching events by that player this turn. */
  nthThisTurn?: number
}

export type OccurrencePattern =
  | { kind: 'abilityActivated'; filter: PlayerSelector }
  | { kind: 'stepBegins'; step: StepId; player?: PlayerReference | PlayerSelector }
  | { kind: 'playLand'; filter: { player?: PlayerReference | PlayerSelector } }
  | { kind: 'discard'; filter: { player?: PlayerReference | PlayerSelector } }
  | { kind: 'cycle'; filter: { player?: PlayerReference | PlayerSelector; object?: ObjectOccurrenceFilter } }
  | { kind: 'cast'; filter: ObjectOccurrenceFilter; nthThisTurn?: number }
  | { kind: 'becomesTapped' | 'tappedForMana'; filter: ObjectOccurrenceFilter }
  | { kind: 'attacks'; filter: ObjectOccurrenceFilter }
  | {
      kind: 'dealtDamage'
      filter: {
        recipient?: ObjectOccurrenceFilter
        source?: ObjectOccurrenceFilter
        combat?: boolean
        /** True matches damage to a player; false matches damage to an object. */
        player?: boolean
      }
    }
  | {
      kind: 'playerAttacks'
      filter: {
        attacker?: PlayerReference | PlayerSelector
        defender?: PlayerReference | PlayerSelector
      }
    }
  | { kind: 'tokenCreated' | 'sacrificed'; filter: ObjectOccurrenceFilter }
  | { kind: 'enters'; filter: ObjectOccurrenceFilter; fromSpell?: boolean }
  | { kind: 'dies'; filter: ObjectOccurrenceFilter }
  | { kind: 'leaves'; filter: ObjectOccurrenceFilter }
  | {
      kind: 'moved'
      filter: ObjectOccurrenceFilter
      to: Zone
      from?: Zone
      /** One-or-more simultaneous matches become a single occurrence. */
      group?: true
    }
  | {
      kind: 'gainedLife'
      filter: PlayerOccurrenceFilter
    }
  | {
      kind: 'draw'
      filter: PlayerOccurrenceFilter & {
        firstDrawInOwnDrawStep?: boolean
      }
    }
  | { kind: 'manaAdded' }
  | { kind: 'manaAbilityActivated' }
  | { kind: 'manaAbilityResolved' }
  | { kind: 'unlockDoor'; door?: RoomDoorId; filter?: ObjectOccurrenceFilter }
  | { kind: 'fullyUnlock'; filter?: ObjectOccurrenceFilter }

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
  /** Exact count unless min is supplied, in which case this is the maximum. */
  count: Amount
  min?: Amount
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
  | { kind: 'crew'; power: Amount }
  | { kind: 'choosePlayer'; players: PlayerSelector }
  | { kind: 'tapSource' }
  | { kind: 'discard'; filter: ObjectRecipient; count: Amount }
  | { kind: 'sacrifice'; filter: ObjectRecipient; count: Amount }
  | { kind: 'mill'; count: Amount }
  | { kind: 'draw'; count: Amount }
  | { kind: 'life'; amount: Amount }
  | { kind: 'mana'; amount: ManaCost }
  /** Add or remove loyalty counters as an activation cost (CR 606.4). `minus` pays the amount. */
  | { kind: 'loyalty'; amount: Amount; minus?: true }
  /** Exile chosen graveyard cards while paying to cover generic mana only. */
  | { kind: 'delve' }
  /** Tap creatures as contributions after the total spell cost is locked. */
  | { kind: 'convoke' }

/** A resolution payment may combine mana and life into one optional decision. */
export type ResolutionCost = Cost | { kind: 'manaAndLife'; mana: ManaCost; life: Amount }

export type CostIncrease = { amount: ManaCost; reason?: string }
export type CostReduction = { generic: Amount; when?: Condition; reason?: string }
export type CostOptionCondition = { cost: 'optional' | 'alternative'; index: number; when: Condition }

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

export type TypeAdditions = { creatureType?: CreatureTypeReference; allCreatureTypes?: true; types?: readonly string[]; subtypes?: readonly string[] }

export type CreatedEffect =
  | { kind: 'grantWard'; cost: WardCost }
  | { kind: 'grantActivatedAbility'; ability: ActivatedAbilityDefinition }
  | { kind: 'removeAbilities' }
  | { kind: 'setStats'; power: StatDelta; toughness: StatDelta }
  | ({ kind: 'addTypes' } & TypeAdditions)
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
  | { kind: 'somePlayerHasLess'; players: PlayerSelector; than: PlayerReference; metric: PlayerComparisonMetric }
  | {
      kind: 'combatDamageThisTurn'
      recipient: PlayerMatch
      legendary?: true
    }
  | { kind: 'resultIsTrue'; value: ResultReference }
  | { kind: 'hasGreatestCharacteristic'; of: ObjectReference; among: ObjectSelector; characteristic: ObjectNumericCharacteristic }
  | { kind: 'compareAmount'; left: Amount; operator: AmountCompareOperator; right: Amount }
  | { kind: 'choiceIs'; binding: string; option: string }
  | { kind: 'activePlayer'; of: PlayerReference }
  | { kind: 'currentStep'; step: StepId | readonly StepId[] }
  | { kind: 'all'; conditions: readonly Condition[] }
  | { kind: 'any'; conditions: readonly Condition[] }
  | { kind: 'not'; condition: Condition }
  /** The named option has strictly more votes than every other option. Ties are false. */
  | { kind: 'voteLeads'; binding: string; option: string }

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

/** Source-independent command-zone program created by a loyalty ability (CR 113). */
export type EmblemDefinition = {
  name: string
  subtypes?: string[]
  oracleText?: string
  abilities: readonly AbilityDefinition[]
}

export type NamedVoteOption = { id: string; label: string }

/** Public vote options. Secret ballots and extra-vote control stay on later 39 slices. */
export type VoteSpec =
  | { kind: 'named'; options: readonly NamedVoteOption[] }
  | { kind: 'objects'; filter: ObjectSelector }
  | { kind: 'players'; filter?: PlayerFilter }

export type Instruction =
  | { kind: 'chooseCreatureType'; chooser: PlayerReference; bindResult: string }
  | { kind: 'discardHands'; targets: PlayerRecipient }
  | { kind: 'chooseParticipants'; of: PlayerRecipient; bindChoice: string; prompt?: string }
  | { kind: 'chooseCardsForEachPlayer'; of: PlayerRecipient; filter: ObjectSelector; min: Amount; max: Amount; bindChoice: string }
  | { kind: 'choosePlayer'; chooser: PlayerReference; filter: PlayerSelector; bindChoice: string }
  | { kind: 'forEachPlayer'; of: PlayerRecipient; instructions: readonly Instruction[]; bindMax?: ResultMaxBinding }
  /** Bind a bounded top-library segment without moving those objects. */
  | { kind: 'inspectTop'; player: PlayerReference; count: Amount; bindChoice: string; visibility: LibraryVisibility }
  /** Persist an authoritative random pick from a current object set. */
  | { kind: 'chooseRandom'; filter: ObjectSelector; bindChoice: string }
  /** Run the body once, then again while the latest bound result still qualifies. */
  | { kind: 'repeat'; count: Amount; instructions: readonly Instruction[] }
  | { kind: 'repeatWhile'; condition: Condition; instructions: readonly Instruction[] }
  /** Run the body once, then once more if the condition holds after that first pass. */
  | { kind: 'repeatOnceIf'; condition: Condition; instructions: readonly Instruction[] }
  /** Give control of resolved permanents to one player without a further assignment. */
  | { kind: 'changeControl'; targets: ObjectRecipient; controller: PlayerReference }
  /** Public sequential votes; bind the result and continue after every ballot is in. */
  | {
      kind: 'vote'
      prompt: string
      options: VoteSpec
      bindResult: string
      /** Object identities of the winning option ids when voting for permanents. */
      bindWinners?: string
    }
  /** An opponent partitions bound cards; the chooser picks a pile; both piles stay bound. */
  | {
      kind: 'partitionPiles'
      cards: ObjectRecipient
      partitioner: PlayerReference
      chooser: PlayerReference
      bindChosen: string
      bindOther: string
    }
  /** Evaluate an amount now, preserving it for later instructions and continuations. */
  | { kind: 'capturePlayer'; player: PlayerReference; bindResult: string }
  | { kind: 'captureAmount'; amount: Amount; bindResult: string }
  /** Persist copiable characteristics before the source leaves its current zone. */
  | { kind: 'captureCopy'; targets: ObjectRecipient; bindResult: string }
  /** Add the specified mana to each resolved player recipient's pool. */
  | { kind: 'addManaChosenColor'; of: ObjectReference; amount: Amount; targets: PlayerRecipient }
  | { kind: 'addManaFrom'; basis?: ManaQueryBasis; of: ObjectSelector; colorsOnly: boolean; amount: Amount; targets: PlayerRecipient }
  | { kind: 'addMana'; amount: Partial<Record<ManaId, Amount>>; targets: PlayerRecipient; restriction?: ManaSpendRestriction }
  /** Lock an unlocked door or unlock a locked door of the targeted Room, using the activating item's door. */
  | { kind: 'lockOrUnlockDoor'; targets: ObjectRecipient }
  /** Queue life loss for each resolved player recipient at this point in resolution. */
  | { kind: 'loseLife'; amount: Amount; targets: PlayerRecipient; bindResult?: string }
  /** Queue life gain for each resolved player recipient at this point in resolution. */
  | { kind: 'gainLife'; amount: Amount; targets: PlayerRecipient }
  /** Set each recipient's life total; actual loss still flows through loseLife. */
  | { kind: 'setLife'; amount: LifeTotalAmount; targets: PlayerRecipient; bindResult?: string }
  /** Exchange two players' life totals as one action and optionally bind the first player's actual loss. */
  | { kind: 'exchangeLife'; first: PlayerRecipient; second: PlayerRecipient; bindResult?: string }
  /** Apply a win through the game-result event pipeline. */
  | { kind: 'winGame'; targets: PlayerRecipient }
  /** Deal damage from the referenced source, allowing the normal damage pipeline to apply. */
  | { kind: 'damage'; amount: Amount; targets: DamageRecipient; source: ObjectReference; bindResult?: string }
  /** Have two current battlefield creatures deal simultaneous noncombat damage. */
  | { kind: 'fight'; left: ObjectReference; right: ObjectReference }
  /** Exile permanents, then return the resulting cards as new objects (CR 400.7j). */
  | { kind: 'blink'; targets: ObjectRecipient; returnController?: 'owner' | PlayerReference; tapped?: boolean }
  /** Exile chosen permanents linked to the source; until-leaves stamps an immediate return. */
  | { kind: 'linkExile'; targets: ObjectRecipient; untilOpponentMonarch?: true; untilSourceLeaves?: true; returnTo?: LinkedExileReturn }
  /** Return cards currently linked to the executing source, typically from a separate leave trigger. */
  | { kind: 'returnLinkedExile'; returnTo?: LinkedExileReturn }
  /** Have each resolved player recipient draw the evaluated number of cards. */
  | { kind: 'draw'; count: Amount; targets: PlayerRecipient }
  /** Grant each recipient additional land plays for the rest of this turn. */
  | { kind: 'grantLandPlays'; count: Amount; targets: PlayerRecipient }
  /** Grant unlimited hand size for the rest of the game independently of the resolving source. */
  | { kind: 'grantNoMaximumHandSize'; targets: PlayerRecipient }
  | { kind: 'becomeMonarch'; targets: PlayerRecipient }
  /** Exile this resolving spell, preserving the resolution cursor for remaining instructions. */
  | { kind: 'exileThisSpell' }
  /** Grant as-though-flash to each resolved player until the duration ends. */
  | { kind: 'grantFlash'; targets: PlayerRecipient; duration: EffectDuration }
  /** One-shot permission to cast from a private zone without ordinary priority. */
  | {
      kind: 'offerCast'
      chooser: PlayerReference
      from: PlayerReference
      zone: Zone
      cost: SpellCastCost
      maxManaValue?: Amount
      notLand?: true
      takeControl?: true
      inspect?: true
    }
  /** Put the evaluated number of cards from each recipient's library into its graveyard. */
  | { kind: 'mill'; count: Amount; targets: PlayerRecipient; bindChoice?: string }
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
  | { kind: 'tap'; targets: ObjectRecipient; skipNextUntap?: true }
  | { kind: 'untap'; targets: ObjectRecipient }
  /** Phase each resolved object out or in according to `out` during this resolution. */
  | { kind: 'phase'; targets: ObjectRecipient; out: boolean }
  /** Have each resolved player recipient choose permanents and players with counters to proliferate. */
  | { kind: 'proliferate'; targets: PlayerRecipient }
  /** Create the evaluated number of token objects under each resolved player recipient. */
  | { kind: 'createToken'; tapped?: boolean; count: Amount; targets: PlayerRecipient; token: TokenDefinition; bindResult?: string; bindChoice?: string }
  /** Place a source-independent emblem in each recipient's command zone. */
  | { kind: 'createEmblem'; targets: PlayerRecipient; emblem: EmblemDefinition }
  /** Creatures the chosen attackers control cannot attack matching defenders this turn. */
  | { kind: 'banAttacks'; attackers: PlayerRecipient; defenders: ObjectSelector }
  /** Copy each resolved object or a captured snapshot, optionally choosing a controller for the copy. */
  | { kind: 'copy'; targets?: ObjectRecipient; snapshot?: string; controller?: PlayerRecipient; tapped?: boolean; bindResult?: string; bindChoice?: string }
  /** Copy a spell already on the stack without casting a card. */
  | { kind: 'copySpell'; targets: StackItemRecipient; controller?: PlayerRecipient; retarget?: CopySpellRetargeting; bindResult?: string }
  /** Copy an activated or triggered ability without activating or triggering it again. */
  | { kind: 'copyAbility'; targets: StackItemRecipient; controller?: PlayerRecipient; retarget?: CopySpellRetargeting; bindResult?: string }
  /** Put the evaluated number of the named counter on each resolved object recipient. */
  | { kind: 'putCounters'; targets: ObjectRecipient; counter: string; count: Amount; bindResult?: string }
  /** Counter each resolved stack item before it can resolve. */
  | {
      kind: 'counter'
      targets: StackItemRecipient
      bindResult?: string
      /** On a successful counter, send matching original spells here instead of the graveyard. */
      destination?: CounterDestination
    }
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
      cost: ResolutionCost
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
      repeatUntilCleanup?: true
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
      related?: ChoiceRelation
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
  | { kind: 'tappedForMana'; filter: ObjectOccurrenceFilter }
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

export type ActivationTiming = 'anyTime' | 'instant' | 'sorcery'

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
  | { kind: 'gainLife'; filter: { player: PlayerReference | PlayerSelector } }
  | { kind: 'enterBattlefield'; filter: { object: ObjectFilter | ObjectReference } }
  | { kind: 'move'; filter: { object?: ObjectFilter | ObjectReference; to?: Zone } }
  | { kind: 'damage'; filter?: DamageReplacementFilter }

export type AmountFieldChange =
  | { kind: 'multiply'; factor: Amount }
  | { kind: 'add'; delta: Amount }

export type EventFieldChanges = {
  attachTo?: ObjectReference | PlayerReference
  /** Additional counters placed before the permanent is considered to have entered. */
  enterCounters?: Readonly<Record<string, Amount>>
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
  | Extract<Instruction, { kind: 'chooseCards' | 'choosePlayer' | 'reveal' | 'captureAmount' | 'shuffle' }>
  | { kind: 'choose'; bindChoice: string; options: readonly { id: string; label: string }[]; prompt?: string }
  | { kind: 'branch'; condition: Condition; then: readonly ReplacementProgramInstruction[]; otherwise?: readonly ReplacementProgramInstruction[] }
  | { kind: 'modifyEvent'; changes: EventFieldChanges }
  | { kind: 'payLife'; amount: Amount }
  /** Run inner instructions as the replacement applies; sacrifice results bind before later program steps. */
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
  | { kind: 'multiplyTriggers'; sources: ObjectSelector; additional: Amount; cause?: { enters: ObjectFilter } }
  | { kind: 'playLands'; players: PlayerSelector; cards: ObjectSelector; topOnly?: true }
  | { kind: 'grantActivatedAbility'; targets: ObjectSelector; ability: ActivatedAbilityDefinition }
  | ({ kind: 'addTypes'; targets: ObjectSelector; when?: Condition } & TypeAdditions)
  | { kind: 'prohibitActivation'; filter: ActivationFilter }
  | { kind: 'extraLandPlays'; count: number }
  | { kind: 'revealLibraryTop'; players: PlayerSelector }
  | { kind: 'noMaximumHandSize' }
  /** Marker for “this spell can’t be countered”; inspected at cast, not as a layer. */
  | { kind: 'cannotBeCountered' }
  /** Creatures attacking this controller (or their planeswalkers) cost {N} each. */
  | { kind: 'attackTax'; amount: number; whileUntapped?: true }
  /** Creatures blocking while this source is attacking cost {N} each. */
  | { kind: 'blockTax'; amount: number; whileAttacking?: true }
  /** Opponents can’t cast spells whose mana value has this parity. Zero is even. */
  | { kind: 'opponentsCantCast'; parity: ManaValueParity }
  /** Opponents can’t block with creatures whose mana value has this parity. Zero is even. */
  | { kind: 'opponentsCantBlock'; parity: ManaValueParity }
  /** Flagbearer-style obligation while an opponent announces targets. */
  | { kind: 'targetingRequirement'; requirement: 'flagbearer' }
  /** CR 702.21: counter an opponent’s targeted spell or ability unless its controller pays. */
  | { kind: 'ward'; cost: WardCost }
  | { kind: 'untapDuringOthers'; targets: ObjectSelector }
  /** Controller draws during each other player's draw step. */
  | { kind: 'drawDuringOthers'; targets: PlayerSelector }
  | { kind: 'loseLifeOnManaLoss' }
  | { kind: 'enchant'; filter: ObjectSelector | PlayerSelector }
  | { kind: 'bestow'; cost: string }
  | {
      kind: 'modifyStats'
      targets: ObjectSelector
      when?: Condition
      power: StatDelta
      toughness: StatDelta
      /** Layer 7b set-P/T when true; otherwise layer 7c +N/+N. */
      set?: true
      characteristicDefining?: true
    }
  | { kind: 'grantKeyword'; targets: ObjectSelector; keyword: Keyword; when?: Condition }
  /** Layer 4: add a basic land type in addition to existing types, with CR 305.6 mana. */
  | { kind: 'grantLandType'; targets: ObjectSelector; landType: BasicLandType; when?: Condition }
  /** Remove the keyword and prohibit gaining it while this modifier applies (CR 113.11). */
  | { kind: 'suppressKeyword'; targets: ObjectSelector; keyword: Keyword; when?: Condition }
  | { kind: 'grantAbility'; targets: ObjectSelector; ability: GeneratedAbility }
  | { kind: 'reduceActivationCost'; targets: ObjectSelector; generic: Amount }
  | ReplacementEffectDefinition
  | PreventionEffectDefinition

export const KEYWORDS = {
  changeling: 'changeling', deathtouch: 'deathtouch', defender: 'defender', trample: 'trample', flying: 'flying', flash: 'flash', haste: 'haste', vigilance: 'vigilance',
  hexproof: 'hexproof', indestructible: 'indestructible', reach: 'reach', fear: 'fear', lifelink: 'lifelink', menace: 'menace', firstStrike: 'first strike',
  infect: 'infect',
} as const
export type Keyword = typeof KEYWORDS[keyof typeof KEYWORDS]

export const MANA_VALUE_PARITIES = { even: 'even', odd: 'odd' } as const
export type ManaValueParity = typeof MANA_VALUE_PARITIES[keyof typeof MANA_VALUE_PARITIES]

export type WardCost =
  | { kind: 'mana'; generic: number }
  | { kind: 'life'; amount: number }
  | { kind: 'sacrifice'; count: number; nonland?: true }

export const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const
export type BasicLandType = typeof BASIC_LAND_TYPES[number]

export const CHOICE_RELATIONS = { shareLandType: 'shareLandType' } as const
export type ChoiceRelation = typeof CHOICE_RELATIONS[keyof typeof CHOICE_RELATIONS]

export type CounterDestination = {
  to: Zone
  controller?: PlayerReference
  types?: readonly string[]
}

export type SpellAbilityDefinition = {
  kind: 'spell'
  /** This spell can't be countered while it is on the stack. */
  uncounterable?: true
  /** Cast restriction evaluated at announcement; not a triggered ability. */
  when?: Condition
  decisions: DecisionsSpec
  costs: readonly Cost[]
  costLabels?: { optional?: readonly string[]; alternative?: readonly string[] }
  additionalCosts?: readonly Cost[]
  costConditions?: readonly CostOptionCondition[]
  optionalCostBounds?: { min: number; max?: number }
  optionalCosts?: readonly Cost[]
  repeatableOptionalCosts?: readonly number[]
  alternativeCosts?: readonly (readonly Cost[])[]
  costIncreases?: readonly CostIncrease[]
  costReductions?: readonly CostReduction[]
} & ResolutionProgram

export type ActivatedAbilityDefinition = {
  generated?: true
  capturedBindings?: TriggeredAbilityDefinition['capturedBindings']
  kind: 'activated'
  availableFrom: readonly Zone[]
  timing: ActivationTiming
  /** Activation restriction evaluated at permission time; not an intervening-if. */
  when?: Condition
  /** CR 702.89 — emit a `cycle` event after this hand activation fully resolves. */
  cycling?: true
  decisions: DecisionsSpec
  costs: readonly Cost[]
  costLabels?: { optional?: readonly string[]; alternative?: readonly string[] }
  additionalCosts?: readonly Cost[]
  costConditions?: readonly CostOptionCondition[]
  optionalCostBounds?: { min: number; max?: number }
  optionalCosts?: readonly Cost[]
  repeatableOptionalCosts?: readonly number[]
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
    occurrence?: readonly ('player' | 'object.before' | 'object.after' | 'source')[]
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

/** CR 702.51: optional draw replacement that functions in a graveyard. */
export type DredgeAbilityDefinition = {
  kind: 'dredge'
  count: number
}

export type SagaChapterDefinition = {
  numbers: readonly number[]
  decisions?: DecisionsSpec
  instructions: readonly Instruction[]
}

export type SagaAbilityDefinition = {
  kind: 'saga'
  readAhead?: true
  chapters: readonly SagaChapterDefinition[]
}

export type AbilityDefinition =
  | SpellAbilityDefinition
  | ActivatedAbilityDefinition
  | TriggeredAbilityDefinition
  | StaticAbilityDefinition
  | KeywordAbilityDefinition
  | DredgeAbilityDefinition
  | SagaAbilityDefinition

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
  paidCostCount?: (cost: 'optional' | 'alternative', index: number) => number
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
  sumCharacteristics?: (of: ObjectSelector, characteristic: 'power' | 'toughness') => number
  lowestLife?: (of: PlayerSelector) => number
  countDistinctCardTypes?: (of: ObjectSelector) => number
  counterCount?: (of: ObjectReference, counter: string) => number
  lifeLostThisTurn?: (of: PlayerRecipient, combine?: LifeLostCombine) => number
  damageDealtThisTurn?: (to: ObjectReference, by?: PlayerRecipient) => number
  voteTally?: (binding: string, option: string) => number
}
