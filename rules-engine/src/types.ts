import type { CollectedPlayerChoices } from './cardPlugins/dsl/collectedChoices'
import type { CONTROL_EVENT } from './cardPlugins/dsl/controlConstants'
import type PluginCatalog from './catalog'
import type Draft from './draft'
import type { CardEffect, CardInstruction } from './cardPlugins/effects'
import type { AnnouncementTransaction } from './cardPlugins/dsl/compiler/announcement'
import type { DistributionAllocation } from './cardPlugins/dsl/compiler/modes'
import type { ObjectCollectionBinding, ResolvedRuleEffect, ActivatedAbilityDefinition, WardCost, InstructionResult, ObjectOccurrenceFilter, ObjectSelector, ActivationFilter, CardRuleDefinitionSnapshotV1, Cost, ResolutionCost, CreatedEffect, DecisionsInput, EffectDuration as DslEffectDuration, GeneratedAbility, Instruction, PreventionEffectDefinition, PreventionFilter, ReplacementEffectDefinition, ReplacementProgramInstruction, ReplacementTransform, ResultMaxBinding } from './cardPlugins/dsl/schema/v1'
import type { ResolutionPaymentBindings } from './cardPlugins/dsl/resolutionPayment'

/** Seat key. Arbitrary string; generated games use `p1`…`pN`. */
export type PlayerId = string

/** Format-owned, serialized opponent relation used by rules queries. */
export type OpponentRelations = Record<PlayerId, PlayerId[]>

/** Zones an object can occupy. Command exists only in Commander-format games. */
export const ZONE_IDS = [
  'battlefield',
  'stack',
  'hand',
  'library',
  'graveyard',
  'exile',
  'command',
] as const
export type ZoneId = (typeof ZONE_IDS)[number]

/**
 * One step of a player-turn. `turn` counts these player-turns, not table rounds.
 * Empty-stack priority passes enqueue `advanceStep`; combat steps are skipped
 * unless attackers are declared.
 */
export const STEP_IDS = [
  'untap', 'upkeep', 'draw', 'precombatMain', 'beginCombat', 'declareAttackers',
  'declareBlockers', 'firstStrikeDamage', 'combatDamage', 'endCombat',
  'postcombatMain', 'end', 'cleanup',
] as const
export type StepId = typeof STEP_IDS[number]

/** WUBRG plus colorless `{C}`. Generic `{N}` is paid from leftover pool, not stored as `C`. */
export type ManaId = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

export type ManaPool = Record<ManaId, number>

export type RestrictedMana = {
  mana: ManaId
  sourceId: string
  creatureType?: string
  /** Spend this mana only to cast a legendary spell. */
  legendary?: boolean
  uncounterable?: boolean
}

export type FaceCharacteristics = {
  ruleDefinition?: CardRuleDefinitionSnapshotV1
  types: string[]
  subtypes: string[]
  supertypes: string[]
  manaCost: string
  manaValue: number
  colors: string[]
  power?: number | null
  toughness?: number | null
  printedDefense?: number | null
  oracleText?: string
}

export type RoomDoorId = 'left' | 'right'

export type RoomDoorCharacteristics = FaceCharacteristics & {
  name: string
  oracleText: string
  grantedRules?: string[]
  effects?: CardEffect[]
}

export type CopySnapshot = {
  name: string
  printedName?: string
  types: string[]
  subtypes: string[]
  supertypes: string[]
  manaCost: string
  manaValue: number
  colors: string[]
  power: number | null
  toughness: number | null
  printedLoyalty: number | null
  oracleText: string
  grantedRules: string[]
  tapProduces?: Partial<ManaPool>
  effects?: GameObject['effects']
  ruleDefinition?: GameObject['ruleDefinition']
}

export type ReversibleEffect =
  | { kind: 'redirectDeparture'; to: ZoneId; incarnation: number; timestamp: number }
  | { kind: 'ward'; cost: WardCost }
  | { kind: 'colorChange'; before: string[]; after: string[]; incarnation: number }
  | { kind: 'pump'; power: number; toughness: number }
  /**
   * `after` is the layer 7b base set and `before` the pre-animation values.
   * Neither includes the +1/+1 counter contribution (CR 613.4c); it is
   * re-derived from the live counter map on both apply and revert.
   */
  | {
      kind: 'animation'
      before: { types: string[]; power: number | null; toughness: number | null }
      after: { types: string[]; power: number; toughness: number }
    }
  | { kind: 'oracleLine'; line: string }
  | { kind: 'typeChange'; before: string[]; after: string[] }
  | {
      kind: 'bestowAura'
      before: { types: string[]; subtypes: string[]; power: number | null; toughness: number | null }
    }
  | { kind: 'removeAbilities'; timestamp?: number; before: { oracleText: string; grantedRules: string[]; effects?: CardEffect[] } }
  | { kind: 'addTypes'; before: { types: string[]; subtypes: string[] }; types: string[]; subtypes: string[] }
  | { kind: 'copy'; before: CopySnapshot; after: CopySnapshot }
  | { kind: 'controller'; controller: PlayerId; base: PlayerId }
  /** CR 701.38: attacks each combat if able; prefers non-goading players. */
  | { kind: 'goad'; sourceController: PlayerId }
  | { kind: 'protectionFromEverything' }
  /** Static-layer keywords: `suppress` ("can't have or gain") beats `grant`; read by `hasKeyword`. */
  | { kind: 'staticKeywords'; grant: string[]; suppress: string[]; incarnation?: number }
  /** Layer 4: this object has the named basic land type in addition to its other types. */
  | { kind: 'subtypeGrant'; subtype: string }
  /** Encore tokens must attack this player this turn if able. */
  | { kind: 'encoreAttack'; defender: PlayerId }
  /** An attack requirement, not a restriction; competing requirements use CR 508.1d. */
  | { kind: 'mustAttackPlayer'; defender: PlayerId }
  /**
   * Layer 7a CDA: base power and toughness each equal a computed value
   * (life total, counted permanents, …). `after` is the 7a set; +1/+1
   * counters apply on top (CR 613.4c). `who` is stored for life CDAs.
   */
  | {
      kind: 'cdaLifePt'
      who?: 'controller' | 'owner'
      before: { power: number | null; toughness: number | null }
      after: { power: number; toughness: number }
    }
  /**
   * Layer 7b set-P/T: `after` holds independent power and toughness
   * (CR 613.4b). Counters still apply on top (CR 613.4c).
   */
  | {
      kind: 'setPt'
      cda?: true
      before: { power: number | null; toughness: number | null }
      after: { power: number; toughness: number }
    }
  | {
      kind: 'triggerGrant'
      sourceId: string
      grantId: string
      trigger: CardEffect
    }
  | {
      kind: 'loseAbilitiesBecome'
      before: {
        oracleText: string
        grantedRules: string[]
        effects?: GameObject['effects']
        subtypes: string[]
        power: number | null
        toughness: number | null
      }
      extraSubtype: string
      power: number
      toughness: number
    }
  | {
      kind: 'pumpPerLinkedExile'
      before: { power: number | null; toughness: number | null }
      after: { power: number; toughness: number }
    }

export type EffectDuration =
  | { kind: 'whileControlUnchanged'; controller: PlayerId }
  | { kind: 'untilCleanup' }
  | { kind: 'permanent' }
  | { kind: 'untilStep'; step: StepId; active?: PlayerId; turn: number; notBeforeTurn?: number }
  | { kind: 'forTurns'; untilTurn: number }
  | { kind: 'whileSourceOnBattlefield'; sourceId: string; sourceIncarnation?: number }
  | { kind: 'whileSourceTappedAndPowerAtMost'; sourceId: string }
  | { kind: 'cdaLifePt' }
  | { kind: 'pumpPerLinkedExile' }
  /** `index` is the spec's position among the source's `staticBoardPump` effects. */
  | { kind: 'staticBoardPump'; sourceId: string; index: number }
  /** Printed static ability from a canonical `ruleDefinition`; timestamp is fixed at first compile. */
  | {
      kind: 'printedStatic'
      sourceId: string
      sourceIncarnation: number
      abilityIndex: number
      effectIndex: number
      timestamp: number
    }

export type ContinuousEffect = {
  effect: ReversibleEffect
  duration: EffectDuration
}

type PrintedStaticModifierBase = {
  abilityIndex: number
  effectIndex: number
  /** CR 613.7a timestamp; preserved when the modifier is recomputed. */
  timestamp: number
  sourceRef: ObjectIdentity
  activeIn: readonly ZoneId[]
}

/** Runtime instance of a printed static compiled from canonical data. */
export type PrintedStaticModifier =
  | (PrintedStaticModifierBase & {
    kind: 'prohibitActivation'
    filter: ActivationFilter
  })
  | (PrintedStaticModifierBase & {
    kind: 'replacement'
    effect: ReplacementEffectDefinition
  })
  | (PrintedStaticModifierBase & {
    kind: 'prevention'
    effect: PreventionEffectDefinition
  })

/** Consumable damage-prevention shield tracked outside replacement lineage. */
export type PreventionInstance = {
  id: string
  remaining: number | 'unlimited'
  capacity: number | 'unlimited'
  duration: EffectDuration
  hostSourceId: string
  hostSourceIncarnation: number
  controller: PlayerId
  filter: PreventionFilter
  /** Announcement-time targets/choices used when the filter names `targetRef` or `choiceRef`. */
  capturedBindings?: {
    results?: Readonly<Record<string, InstructionResult>>
    targets?: Readonly<Record<number, readonly (
      | { kind: 'player'; playerId: PlayerId }
      | ({ kind: 'object' } & ObjectIdentity)
      | { kind: 'stackItem'; stackId: string }
    )[]>>
    targetLegality?: Readonly<Record<number, readonly boolean[]>>
    choices?: Readonly<Record<string, readonly (
      | { kind: 'player'; playerId: PlayerId }
      | ({ kind: 'object' } & ObjectIdentity)
      | { kind: 'stackItem'; stackId: string }
    )[]>>
  }
  /** Host snapshot used when the live object has left `state.objects`. */
  capturedSource?: CapturedObject
  /** Stable key for static abilities: `${sourceId}:${abilityIndex}:${effectIndex}`. */
  staticKey?: string
  additionalEffects?: readonly Instruction[]
  createdTurn: number
  untilTurn?: number
  untilStepTurn?: number
  untilStepNotBeforeTurn?: number
  untilStepActive?: PlayerId
}

/** Spell or ability target. Player targets use seat ids; object targets use object ids. */
export type ObjectIdentity = {
  objectId: string
  incarnation: number
  zone: ZoneId
}

export type ObjectTargetRef = {
  kind: 'object'
  objectId: string
  /** Pinned when the target is put on the stack. Omitted only on legacy inputs. */
  incarnation?: number
  /** Zone in which this target was chosen. Omitted only on legacy inputs. */
  zone?: ZoneId
}

export type TargetRef =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'stackItem'; stackId: string }
  | ObjectTargetRef

/** A canonical target binding retains its generated scope and clause slot. */
export type CanonicalTargetBinding = {
  scopeId: string
  clauseIndex: number
  recipients: TargetRef[]
  /** Mode declaration that owns this local clause, when the program is modal. */
  modeIndex?: number
}

/**
 * One card or token in the game. Identity is `id`; `name` is Oracle for fixtures.
 * Zone membership is duplicated in `zone` and in the owner's `zoneOrder` lists.
 * `grantedRules` are plugin ids installed while this object is on the battlefield.
 * `tags` carry format roles such as `commander`. `tapProduces` is the mana ability.
 */
export type GameObject = {
  id: string
  /** CR 400.7 identity generation. Increments whenever this card becomes a new object. */
  incarnation: number
  name: string
  owner: PlayerId
  controller: PlayerId
  zone: ZoneId
  tapped: boolean
  summoningSickness: boolean
  /** "Doesn't untap during its controller's next untap step"; cleared by that step. */
  skipNextUntap?: true
  damageMarked: number
  /** Dealt damage by a deathtouch source this turn, so any of it is lethal. */
  deathtouched?: boolean
  /**
   * Damage dealt to this object this turn, totalled by the controller of the
   * source. Survives leaving the battlefield (last-known information) and is
   * cleared at cleanup or when the object next enters the battlefield.
   */
  damageDealtBy?: Record<PlayerId, number>
  counters: Record<string, number>
  /** Monstrosity marker; lost when the object changes zones (CR 701.109). */
  monstrous?: boolean
  types: string[]
  subtypes: string[]
  supertypes: string[]
  manaCost: string
  /** An absent printed mana cost is unpayable, unlike {0}. */
  manaCostAbsent?: true
  manaValue: number
  colors: string[]
  /**
   * Printed characteristics of the front face. In the library, only this face
   * exists for a transforming or modal double-faced card (CR 712.8a).
   */
  frontFace?: FaceCharacteristics
  /** Printed characteristics of the second face of a double-faced card. */
  backFace?: FaceCharacteristics
  /** Set when the Adventure half has resolved and the card may be cast from exile. */
  adventured?: boolean
  /** The two halves of a split permanent with the shared Room type line. */
  roomDoors?: [RoomDoorCharacteristics, RoomDoorCharacteristics]
  /** Battlefield-only unlocked designations (CR 709.5c). */
  unlockedDoors?: RoomDoorId[]
  power: number | null
  toughness: number | null
  printedLoyalty: number | null
  printedDefense: number | null
  /** Player currently designated to protect this battle (CR 310.9). */
  protector?: PlayerId
  loyaltyActivatedTurn: number | null
  oracleText: string
  attachedToRef?: ObjectIdentity
  attachedTo: string | null
  /** Phased-out permanents are treated as though they do not exist (CR 702.26). */
  phasedOut?: boolean
  attacking: TargetRef | PlayerId | null
  /** Set once an attacker is blocked; it stays blocked after every blocker leaves (CR 509.1h). */
  blocked?: true
  blocking: string | null
  grantedRules: string[]
  token: boolean
  /** A copy of a spell that ceases to exist after leaving the stack. */
  spellCopy?: boolean
  tags: string[]
  tapProduces?: Partial<ManaPool>
  /** Chosen creature type, for example Roaming Throne. */
  chosenType?: string
  /** Chosen color of a permanent that says "choose a color" as it enters. */
  chosenColor?: ManaId
  /** The card this permanent is printed as, once a copy effect renamed it. */
  printedName?: string
  /** Object ids currently linked to this permanent by an "exiled with" ability. */
  exiledCards?: string[]
  /** Object id of the permanent whose ability exiled this card. */
  exiledWith?: string
  /** Immediate return destination when this source leaves the battlefield. */
  returnLinkedExile?: 'battlefield' | 'hand'
  /** Exiled until an opponent becomes the monarch (Palace Jailer shape). */
  exiledUntilOpponentMonarch?: boolean
  /** Stamped from the name-keyed card-rule table when the object is created. */
  effects?: CardEffect[]
  /** Version-pinned abilities granted by a canonical temporary effect. */
  canonicalGrantedAbilities?: Array<{
    ability: GeneratedAbility
    /** The recipient is the ability's source; these identify the grant effect. */
    sourceId: string
    sourceIncarnation: number
    definitionRevision: string
    duration: DslEffectDuration
    createdTurn: number
    timestamp?: number
    execution?: StackExecutionContext
    untilTurn?: number
    untilStepTurn?: number
    untilStepNotBeforeTurn?: number
    untilStepActive?: PlayerId
    printedStatic?: { abilityIndex: number; effectIndex: number }
  }>
  canonicalGrantedActivations?: Array<Omit<NonNullable<GameObject['canonicalGrantedAbilities']>[number], 'ability'> & { ability: ActivatedAbilityDefinition }>
  /** Optional canonical rules pinned onto this object by the versioned registry. */
  ruleDefinition?: CardRuleDefinitionSnapshotV1
  /** CR 613.7a rules timestamp for printed static abilities on this object. */
  staticRulesTimestamp?: number
  /** Active printed static restrictions emitted by this object (for example Stony Silence). */
  printedStaticModifiers?: PrintedStaticModifier[]
  /** Alternative casting option used for the current battlefield entry. */
  enteredWithCastOption?: string
  /** CR 702.103e–g: a bestowed Aura that has already ceased to be bestowed. */
  bestowedCeased?: true
  castCostChoices?: PaidCostChoices
  /** Multikicker count stamped when this permanent entered from a resolving spell. */
  enteredWithTimesKicked?: number
  /** Turn this object most recently entered the battlefield. */
  enteredBattlefieldTurn?: number
  /** CR 613.7d timestamp of this permanent's latest battlefield entry; absent for setup permanents. */
  battlefieldTimestamp?: number
  /** Per-ability trigger and resolve counts for generic trigger frequency flags. */
  triggerFrequency?: Record<
    string,
    {
      triggeredTurn?: number
      resolveCountTurn?: number
      resolveCount?: number
    }
  >
  /** Turn this card was exiled by its warp delayed trigger; enables warp-from-exile casting. */
  warpExiledTurn?: number
  /** Set when this object moves from the battlefield to a graveyard; cleared on untap. */
  putIntoGraveyardFromBattlefieldThisTurn?: true
  /** Seats that may see this card's face while it is in a hidden zone. */
  knownTo?: PlayerId[]
  /** Face-down foretell exile (CR 702.143). */
  foretold?: boolean
  /** Turn this card was foretold; same-turn foretell casts are illegal. */
  foretoldTurn?: number
  plotted?: { turn: number; incarnation: number }
  castHasteController?: PlayerId
  foretoldIncarnation?: number
  /** A face-down card in a normally public zone. */
  faceDown?: boolean
  /** An Adventure card exiled by its Adventure spell may be played from exile. */
  adventureReady?: boolean
  continuousEffects?: ContinuousEffect[]
}

/**
 * Spell, triggered/activated ability, or action on the stack (CR 405).
 * `id` is allocated once via `draft.allocId('stack')` and never regenerated —
 * stable for `continueAction`, replay, and client round-trips.
 */
export type PaidCostChoices = { optional: readonly number[]; alternative?: number; players?: Readonly<Record<number, PlayerId>> }

export type StackItem = {
  id: string
  kind: 'spell' | 'ability' | 'action'
  objectId: string
  /** An inherent game ability has no card/permanent source. */
  sourceLess?: true
  controller: PlayerId
  name: string
  targets: TargetRef[]
  abilityId?: string
  x?: number
  choices?: string[]
  /** Mana actually removed from the pool while casting, by symbol. */
  manaSpent?: Partial<ManaPool>
  kicked?: boolean
  giftPromised?: boolean
  giftRecipient?: PlayerId
  spreeModes?: string[]
  /** Times the multikicker cost was paid; 0 is explicit for multikicker spells. */
  timesKicked?: number
  castOption?: string
  exileAfterUse?: boolean
  /** Read ahead choice carried from casting through battlefield entry. */
  sagaChapter?: number
  door?: RoomDoorId
  /** The Adventure half was cast; the card exiles on resolution instead of going to the graveyard. */
  adventureCast?: boolean
  uncounterable?: boolean
  sacrificed?: number
  castFrom?: ZoneId
  /** Builtin action kind when `kind === 'action'` (for example `'discard'`, `'draw'`). */
  actionId?: string
  /** Client input required before resolution continues; omitted when not waiting. */
  waiting?: 'choice' | 'targets' | null
  /** Action parameters and in-flight resolution state. */
  payload?: Record<string, unknown>
  /** A stack copy is not represented by another card and never changes the source object's zone. */
  copy?: boolean
  /** Object ids whose ward cost has been paid or declined for this item (CR 702.21). */
  wardSettled?: string[]
  /**
   * Authoritative serializable context. It is removed from every client projection.
   * Source-backed stack items created through Draft.addToStack carry this context.
   */
  execution?: StackExecutionContext
}

export type ObjectSnapshot = GameObject

export type CapturedObject = {
  ref: ObjectIdentity
  snapshot: ObjectSnapshot
  information: 'current' | 'lastKnown'
}

export type OccurrenceSnapshot = {
  kind: 'event'
  eventType: string
  stackItemId?: string
  vote?: VoteResult
  player?: PlayerId
  defender?: PlayerId
  amount?: number
  object?: {
    before?: ObjectSnapshot
    after?: ObjectSnapshot
  }
  /** Simultaneous one-or-more zone changes captured as a single occurrence. */
  objects?: {
    before?: ObjectSnapshot
    after?: ObjectSnapshot
  }[]
  source?: CapturedObject
}

export type StackExecutionContext = {
  /** Internal execution anchor is never a game object or legal source reference. */
  sourceLess?: true
  monarchRevision?: number
  /** Independent LKI watches for referenced objects, never the source of this ability. */
  referencedObjects?: CapturedObject[]
  controller: PlayerId
  source: CapturedObject
  occurrence?: OccurrenceSnapshot
  /** Parent occurrence context captured by a generated callback. */
  capturedOccurrence?: OccurrenceSnapshot
  /** Which occurrence fields belong to the captured parent lexical scope. */
  capturedOccurrenceBindings?: readonly ('player' | 'object.before' | 'object.after' | 'source')[]
  /** Captured bindings inherited by a delayed/reflexive program. */
  variables?: Readonly<Partial<Record<'X', number>>>
  results?: Record<string, InstructionResult>
  scopeId?: string
  /** Exact canonical program pin; execution support remains disabled until Part 03. */
  definitionSnapshot?: CardRuleDefinitionSnapshotV1
  /** Supplied canonical targets, grouped by generated scope and clause. */
  targetBindings?: CanonicalTargetBinding[]
  choices?: Record<string, CanonicalChoiceRecipient[]>
  /** Generated-program aliases for parent lexical choice bindings. */
  capturedChoiceAliases?: Record<string, string>
  /** Generated-program aliases for parent lexical result bindings. */
  capturedResultAliases?: Record<string, string>
  /** Granter identity for a stamped canonical grant (`grant.source`). */
  grantSource?: { objectId: string; incarnation: number }
  /** Chapter number for a Saga ability waiting on the stack or a targeting choice. */
  sagaChapter?: number
  /** Definition-local ability index for canonical activated/triggered stack items. */
  abilityIndex?: number
  /** Chosen modal branches, captured before priority is returned. */
  modeIndices?: number[]
  /** Mode cardinality evaluated and locked during announcement. */
  modeCount?: number
  /** Stable scope for each selected mode occurrence; repeated modes get distinct scopes. */
  modeScopeIds?: string[]
  /** Announcement-time allocations, keyed by each mode scope and local clause. */
  distributionBindings?: DistributionAllocation[]
  distributionBounds?: readonly { total: number; minEach: number }[]
  declarationPath?: string
  /** Server-authoritative announcement record captured before cost components commit. */
  announcement?: {
    id: string
    sourceId: string
    phase: 'committed'
    costChoices?: PaidCostChoices
    lockedCost: {
      mana?: string
      nonMana: readonly Cost[]
      x?: number
    }
    payment: readonly { sourceId: string; mana: ManaId; amount?: number; restricted?: boolean }[]
  }
}

/**
 * Serializable cursor for one nested instruction list. The outer program is
 * scope 0; sequence instructions push a child scope instead of recursing on the
 * JavaScript stack, so a saved game can resume at the exact instruction.
 */
export type CanonicalChoiceRecipient = ({ kind: 'object' } & ObjectIdentity) | { kind: 'player'; playerId: PlayerId }

export type ProgramScopeFrame = {
  iterationPlayer?: PlayerId
  restoreBindings?: Pick<CanonicalResolutionFrame, 'choices' | 'results' | 'voteResults' | 'choiceSnapshots' | 'capturedCopies' | 'playerChoiceBindings'>
  collectObjects?: ObjectCollectionBinding & { key: string }
  collectMax?: ResultMaxBinding
  path: string
  /** Target binding scope used by instructions in this frame. */
  scopeId?: string
  instructions: readonly Instruction[]
  cursor: number
  /** Overlay for nested iteration, such as forEach over destroyed permanents. */
  occurrence?: OccurrenceSnapshot
  /** Trailing repeatWhile re-entry checks the condition before running the body again. */
  repeatRemaining?: number
  continueWhile?: true
  /** Trailing repeatOnceIf re-entry checks the condition before a single extra pass. */
  repeatOncePending?: true
}

/** Authoritative, private state for the one resolution currently in progress. */
export type CanonicalResolutionFrame = {
  version: 1
  kind: 'canonicalSpell'
  sourceLess?: true
  referencedObjects?: CapturedObject[]
  monarchRevision?: number
  stackId: string
  /** A canonical ability resolving inline (for example a mana ability) has no public stack item. */
  inlineItem?: StackItem
  /** The resolution and priority that must resume after an inline frame completes. */
  parentResolution?: ResolutionFrame
  parentPriority?: PlayerId | null
  controller: PlayerId
  intendedPriority: PlayerId
  definitionSnapshot: CardRuleDefinitionSnapshotV1
  declarationPath: string
  source: CapturedObject
  scopeId?: string
  targetBindings?: CanonicalTargetBinding[]
  variables?: Readonly<Partial<Record<'X', number>>>
  /** Current legality for each bound slot; missing/false slots are withheld. */
  targetLegality?: Record<number, boolean[]>
  /** Target legality keyed by the local scope and clause index. */
  targetLegalityByScope?: Record<string, Record<number, boolean[]>>
  /** Validated announcement-time allocations retained across resolution suspension. */
  distributionBindings?: DistributionAllocation[]
  playerChoiceBindings?: string[]
  choices?: Record<string, CanonicalChoiceRecipient[]>
  results?: Record<string, InstructionResult>
  /** Finished public votes keyed by the instruction bindResult. */
  voteResults?: Record<string, VoteResult>
  /** Maxima collected across forEachPlayer iterations; restore does not rewind them. */
  resultMaxima?: Record<string, number>
  /** Object identities collected by lexical loop path; nested loops cannot overwrite each other. */
  objectCollections?: Record<string, CanonicalChoiceRecipient[]>
  pendingResult?: {
    binding: string
    kind: 'counter' | 'action' | 'amount'
    stackId?: string
    value?: boolean | number
    eventType?: GameEvent['type']
    destination?: ZoneId
    /** Sacrifice outcomes retain both the numeric total and optional success result. */
    booleanBinding?: string
    expectedObjects?: ObjectIdentity[]
    expectedSeats?: PlayerId[]
  }
  /** Copiable characteristics captured before a source left its zone. */
  capturedCopies?: Record<string, NonNullable<Extract<GameEvent, { type: 'copyPermanent' }>['token']>>
  /** Last-known objects aligned with a bound choice, including tokens that later ceased. */
  choiceSnapshots?: Record<string, ObjectSnapshot[]>
  outcome?: 'resolved' | 'didNotResolve:interveningIf' | 'didNotResolve:allTargetsIllegal'
  scopes: ProgramScopeFrame[]
  phase: 'running' | 'committing' | 'waiting'
  /** Events for the current instruction, persisted before the cursor may continue. */
  pendingEvents?: GameEvent[]
  /** Ordered private discard choices gathered before their action group commits. */
  /** Simultaneous top-library choices wait for every player before moving cards. */
  pendingTopDeck?: { seats: PlayerId[]; events: GameEvent[]; completions: GameEvent[] }
  /** New identities to bind after the current move instruction commits. */
  collectedPlayerChoices?: CollectedPlayerChoices
  pendingMovedChoice?: { binding: string; objects: ObjectIdentity[] }
  /** Token identities created by the current createToken or copy instruction. */
  pendingCreatedChoice?: { binding: string; beforeIds: string[] }
  /** Library identities whose first public destinations belong to this mill action (CR 701.17c). */
  pendingMilledChoice?: { binding: string; objects: ObjectIdentity[] }
  /** Last-known objects to bind after destroy events commit and tokens cease. */
  pendingDestroyedChoice?: {
    binding: string
    entries: Array<{ objectId: string; incarnation: number; snapshot: ObjectSnapshot }>
  }
  /** Cards expected in exile after the first half of an immediate blink. */
  pendingBlink?: Array<{ ref: ObjectIdentity; controller: PlayerId; tapped?: boolean }>
  pendingProliferate?: { objectIds: string[]; binding?: string }
  pendingDiscard?: { scopeId?: string; seats: PlayerId[]; index: number; amount: number; selected: Array<{ seat: PlayerId; objectId: string }>; binding?: string }
  /** Instruction continuations blocked on a typed choice. */
  afterChoiceEvents?: GameEvent[]
  /** Copies awaiting ordered keep/retarget answers before the parent resumes. */
  pendingCopyTargets?: {
    originalStackId: string
    controller: PlayerId
    targets: TargetRef[]
    slotCursor?: number
    changedIndices?: number[]
    answers?: TargetRef[]
  }[]
  /** Resolution-time optional cost cursor, retained while a payer chooses cards. */
  pendingResolutionPayment?: {
    scopeId?: string
    payer: PlayerId
    amount: number
    cost: ResolutionCost
    manaSpent?: ManaPool
    lifePaymentApplied?: true
    lifeLossApplied?: true
    resultBinding: string
    source: CapturedObject
    controller: PlayerId
    ifPaid: readonly Instruction[]
    ifDeclined: readonly Instruction[]
    whenPaid: readonly Instruction[]
    whenPaidDecisions?: DecisionsInput
    bindings?: ResolutionPaymentBindings
    selected?: ObjectIdentity[]
    paymentEvents?: GameEvent[]
  }
}

/** Temporary durable wrapper for legacy programs until their card is migrated. */
export type LegacyResolutionFrame = {
  version: 1
  kind: 'legacy'
  stackId: string
  controller: PlayerId
  intendedPriority: PlayerId
  item: StackItem
  phase: 'running' | 'committing' | 'waiting' | 'completing'
  pendingEvents: GameEvent[]
  /** Instruction continuations blocked on a typed choice. */
  afterChoiceEvents?: GameEvent[]
}

export type ResolutionFrame = CanonicalResolutionFrame | LegacyResolutionFrame

/**
 * Trigger instances are captured when their occurrence happens and placed only
 * at the next explicit checkpoint. Part 06 replaces deterministic same-seat
 * ordering with the full typed APNAP ordering request.
 */
export type PendingTrigger = {
  /** Stable identity for this occurrence/ability pair while it waits for a checkpoint. */
  id: string
  source: GameObject
  instructions: CardInstruction[]
  effect: Pick<Extract<CardEffect, { op: 'trigger' }>, 'do' | 'if' | 'targets' | 'onceEachTurn' | 'whenResolvedNth'>
  execution: StackExecutionContext
  /** Canonical DSL triggered ability pinned at the occurrence. */
  canonical?: {
    definitionSnapshot: CardRuleDefinitionSnapshotV1
    abilityIndex: number
    /** The delayed program reuses bindings captured by its parent resolution. */
    inheritedTargets?: boolean
  }
  /** CR 603.3b second-pass marker: this occurrence was caused by an ability triggering. */
  triggeredByAbility?: boolean
  triggerEffectKey?: string
  triggeringObjectId?: string
  triggeringPlayer: PlayerId
  triggerAmount?: number
  payload?: Record<string, unknown>
}

/** Serializable cursor for the two APNAP placement passes in CR 603.3b. */
export type TriggerPlacementFrame = {
  version: 1
  pass: 1 | 2
  controller?: PlayerId
  orderIds?: string[]
}

/** Lineage for one replaceable event opportunity and its modified descendants. */
export type ReplacementLineage = {
  id: string
  usedInstanceIds: string[]
  settledOptionalDeclines?: string[]
  /** Legacy plugin ids already applied; mirrors used instances for unmigrated hooks. */
  legacyPluginIdsUsed?: string[]
  simultaneityGroupId?: string
  parentActionId?: string
}

/** Additional prevention program pinned to its host until the replacement chain settles. */
export type PreventionFollowUpProgram = {
  hostSourceId: string
  controller: PlayerId
  instructions: readonly Instruction[]
  occurrence?: OccurrenceSnapshot
}

/** Private durable replacement cursor; removed from client projections. */
export type EventProcessingFrame = {
  version: 1
  id: string
  originalEvent: GameEvent
  pendingEvent: GameEvent
  lineage: ReplacementLineage
  awaitingCandidateIds: readonly string[]
  chooser?: PlayerId
  announcementTransactionId?: string
  followUp?: GameEvent[]
  followUpPrograms?: PreventionFollowUpProgram[]
  program?: ReplacementInstructionProgramState
  /** Choose/branch/pay application procedure for a canonical replacement (not replaceWith). */
  applicationProgram?: ReplacementProgramCursor
}

/** Durable choices and results for a replacement's application procedure. */
export type ReplacementProgramCursor = {
  choices?: Record<string, (({ kind: 'object' } & ObjectIdentity) | { kind: 'player'; playerId: PlayerId })[]>
  results?: Record<string, InstructionResult>
  instructions: readonly ReplacementProgramInstruction[]
  index: number
  bindings: Record<string, string>
  transform: ReplacementTransform
  sourceId: string
  controller: PlayerId
  /** In-flight emit sacrifices waiting on nested replacements. */
  pendingEmit?: {
    remaining: GameEvent[]
    counted: number
    pendingIdentity?: ObjectIdentity
    bindCount?: string
    bindResult?: string
  }
}

export type ReplacementInstructionProgramState = {
  instructions: readonly Instruction[]
  scopes: Array<{ path: string; instructions: readonly Instruction[]; cursor: number }>
  results?: Record<string, InstructionResult>
  choices?: Record<string, readonly { kind: 'object'; objectId: string }[]>
  pendingDiscard?: {
    seats: PlayerId[]
    index: number
    amount: number
    selected: Array<{ seat: PlayerId; objectId: string }>
    binding?: string
    settling?: boolean
    identities?: ObjectIdentity[]
  }
  sourceId: string
  controller: PlayerId
  occurrencePlayer: PlayerId
  emittedEvents: GameEvent[]
}

/**
 * A live plugin binding. Catalog entries are code; these instances are state.
 * `timestamp` orders replace/legal/apply. `sourceId` ties the instance to a
 * permanent so leaving the battlefield can remove it.
 */
export type RuleInstance = {
  instanceId: string
  pluginId: string
  sourceId: string | null
  timestamp: number
  params: Record<string, unknown>
}

/**
 * Per-seat totals the kernel always knows. Format extras (commander tax,
 * commander damage) live in untyped `data`, keyed however that format chooses.
 */
export type PlayerState = {
  id: PlayerId
  life: number
  poison: number
  /** Player-owned energy counters ({E}); public and persist across turns. */
  energy: number
  mana: ManaPool
  /** Mana with spending restrictions, tracked separately from the ordinary pool. */
  restrictedMana?: RestrictedMana[]
  lost: boolean
  landsPlayed: number
  landPlaysAllowed: number
  data: Record<string, unknown>
}

/**
 * Frozen game after a reduce. History is not stored here.
 * `knowledge` chooses the hidden-info profile: authoritative owns library
 * identities; a replica is a viewer projection and must not leak them.
 * `zoneCounts` stay public even when `zoneOrder.library` is emptied for a client.
 * `rules` is the active plugin list. `log` is a human-readable apply trace.
 */
export type LinkedExileSet = {
  untilOpponentMonarch?: { player: PlayerId; since: number }
  source: ObjectIdentity
  cards: ObjectIdentity[]
  untilSourceLeaves?: true
  returnTo?: 'battlefield' | 'hand'
}

/** Identity, cost, and remaining uses for a temporary spell-cast permission. */
export type SpellCastPermission = {
  id: string
  sourceId: string
  sourceName: string
  seat: PlayerId
  cost: 'withoutPayingMana' | 'printed' | 'lifeEqualManaValue'
  asThoughFlash?: true
  remainingUses: number
  grantHaste?: true
  /** Cast this specific object (rebound exile / later-turn exile). */
  objectId?: string
  objectIncarnation?: number
  /** Live zone query (offered hand, exile, or graveyard). */
  zone?: ZoneId
  fromSeat?: PlayerId
  maxManaValue?: number
  notLand?: true
  takeControl?: true
  inspect?: true
  /** First turn the permission may be used (later-turn exile play). */
  availableFromTurn?: number
}

export type GameState = {
  format: string
  /** Opponent relationships are defined by the format, then stored for deterministic replay. */
  opponents: OpponentRelations
  knowledge: {
    mode: 'authoritative' | 'replica'
    viewer: PlayerId | null
  }
  playerOrder: PlayerId[]
  castableZones: ZoneId[]
  players: Record<PlayerId, PlayerState>
  objects: Record<string, GameObject>
  zoneOrder: Record<PlayerId, Record<ZoneId, string[]>>
  zoneCounts: Record<PlayerId, Record<ZoneId, number>>
  stack: StackItem[]
  /** Private durable resolution cursor; removed from every client projection. */
  resolution?: ResolutionFrame
  /** Server-owned provisional announcement isolated from public priority. */
  provisionalAnnouncement?: ProvisionalAnnouncementFrame
  /** Captured triggers waiting for the next explicit checkpoint. */
  pendingTriggers?: PendingTrigger[]
  /** Private placement cursor; removed from client projections with pending triggers. */
  triggerPlacement?: TriggerPlacementFrame
  /** Private replacement processing cursor while a modifier choice or program is open. */
  eventProcessing?: EventProcessingFrame
  /** Additional suspended replacement frames; independent of the active cursor. */
  deferredEventProcessing?: EventProcessingFrame[]
  /** Authoritative resolved rule changes; captured source contexts never enter replicas. */
  resolvedRuleEffects?: {
    id: string
    timestamp: number
    controller: PlayerId
    source: CapturedObject
    effect: ResolvedRuleEffect
  }[]
  delayedTriggers: DelayedTrigger[]
  active: PlayerId
  priority: PlayerId | null
  turn: number
  step: StepId
  /** Combatants with first/double strike as the first damage step began (CR 510.4). */
  firstStrikeCombatants?: ObjectIdentity[]
  passedInRow: PlayerId[]
  /** Extra turns queued to begin after the current turn ends; the next one taken is first (CR 500.7). */
  extraTurns?: PlayerId[]
  /** Player whose ordinary turn preceded the running extra-turn chain; normal order resumes after them. */
  extraTurnsResumeAfter?: PlayerId
  rules: RuleInstance[]
  /** Active prevention shields with remaining capacity. */
  preventionInstances?: PreventionInstance[]
  /** Per draw-step instance: actual cards drawn for first-draw replacement history. */
  drawStepTracking?: {
    instanceId: number
    stepPlayer: PlayerId
    actualDraws: Partial<Record<PlayerId, number>>
  }
  nextId: number
  nextTimestamp: number
  ended: boolean
  prevented?: boolean
  /** At most one monarch; `null` when the crown is vacant. */
  monarch: PlayerId | null
  /** Canonical exiled-card identities, keyed by the original source incarnation. */
  linkedExileSets?: LinkedExileSet[]
  /** Temporary one-shot or uses-limited spell-cast permissions (26-permission). */
  spellPermissions?: SpellCastPermission[]
  voteModifiers?: { players: PlayerId[]; controller?: PlayerId; additional?: number; expiresTurn?: number }[]
  monarchRevision?: number
  /** Latest actual crown acquisition for each seat; retained through elimination. */
  monarchAcquiredAt?: Record<PlayerId, number>
  log: string[]
}

export type NestedManaPaymentFrame = {
  transaction: AnnouncementTransaction
  pendingActivation: Omit<StackItem, 'id'> & { id?: string }
  plannedPaymentCursor: number
  source?: CapturedObject
  definitionSnapshot?: CardRuleDefinitionSnapshotV1
}

export type ProvisionalAnnouncementFrame = {
  id: string
  payer: PlayerId
  transaction: AnnouncementTransaction
  baseline: GameState
  continuation?: Extract<GameEvent, { type: 'castSpell' }>
  plannedManaActivations?: Array<Extract<GameEvent, { type: 'activateAbility' }>>
  plannedManaCursor?: number
  plannedPaymentCursor?: number
  pendingActivation?: Omit<StackItem, 'id'> & { id?: string }
  inlineManaAbility?: boolean
  nestedManaPayment?: NestedManaPaymentFrame
  source?: CapturedObject
  definitionSnapshot?: CardRuleDefinitionSnapshotV1
}

export type AttackerDecl = { objectId: string; defender: TargetRef | PlayerId }
export type BlockerDecl = { blockerId: string; attackerId: string }
export type ManaPayment = { objectId: string; mana?: ManaId }

/**
 * A finished vote. `votes` is the revealed `{ voter: optionId }` map and
 * `tallies` counts every offered option, zero included. `winners` share the
 * highest nonzero tally; `tied` says several do.
 */
export type VoteResult = {
  /** Full ballots when an effect grants additional votes; votes retains each first ballot. */
  ballots?: Record<PlayerId, string[]>
  votes: Record<PlayerId, string>
  tallies: Record<string, number>
  winners: string[]
  tied: boolean
}

/**
 * Optional predicate on a declarative trigger. `seat` compares the triggering
 * event's involved seat to the trigger source's controller.
 */
export type TriggerBindingIf = {
  seat?: 'opponent' | 'controller' | 'triggeringPlayer'
  /** After a draw event, the drawer's cards-drawn-this-turn total. */
  cardsDrawnThisTurn?: number
} & Record<string, unknown>

/**
 * Declarative card trigger: when event `on` fires, put an ability on the stack
 * that runs `do` when it resolves. Multiple triggers from one player in v1 use
 * timestamp / card-rules order; later phases may add player-chosen ordering
 * (`orderTriggers`) without changing this shape.
 */
export type TriggerBinding = {
  on: string
  if?: TriggerBindingIf
  do: CardInstruction[]
}

/**
 * CR 603.7 — a delayed triggered ability exists independently of its source
 * and, without a stated duration, triggers only the next time its event occurs.
 * `recurring` represents an explicit "for the rest of the game" duration.
 */
export type DelayedTriggerCondition =
  | { kind: 'tappedForMana'; filter: ObjectOccurrenceFilter }
  | {
      kind: 'event'
      type: GameEvent['type']
      objectId?: string
      from?: ZoneId
      to?: ZoneId
    }
  /** Omit `active` for "the next upkeep"; name a seat for "your next upkeep". */
  | { kind: 'step'; step: StepId | StepId[]; active?: PlayerId }

export type DelayedTrigger = {
  id: string
  sourceId: string
  sourceName: string
  controller: PlayerId
  sourceIncarnation?: number
  sourceDefinitionRevision?: string
  objectRef?: ObjectIdentity
  execution?: StackExecutionContext
  canonical?: {
    definitionSnapshot: CardRuleDefinitionSnapshotV1
    abilityIndex: number
    /** The delayed program reuses bindings captured by its parent resolution. */
    inheritedTargets?: boolean
  }
  condition: DelayedTriggerCondition
  /** Earliest player-turn in which this delayed ability can trigger. */
  notBeforeTurn?: number
  instructions: CardInstruction[]
  timestamp: number
  recurring?: boolean
  payload?: Record<string, unknown>
  /** Dropped at cleanup without firing — "this turn" delayed triggers. */
  untilCleanup?: boolean
}

/**
 * Input to `rules(state, event)`. Plugins ignore types they do not handle.
 * Replacement can rewrite one event, split it into an array, or return `null`
 * to prevent it. Apply may `draft.enqueue` follow-up events that drain after.
 *
 * Damage is a chain: `assignCombatDamage` → `combatDamage` → `dealDamage` →
 * `loseLife`. Fog prevents at `combatDamage`; "prevent damage" at `dealDamage`.
 */
export type GameEvent =
  | { type: 'abilityActivated'; objectId: string; stackId: string; seat: PlayerId; sourceSnapshot: CapturedObject }
  /** Internal canonical rule change; expires at cleanup independently of its source. */
  | { type: 'createRuleEffect'; controller: PlayerId; source: CapturedObject; effect: ResolvedRuleEffect }
  /** Internal canonical player allowance; expires at cleanup. */
  | { type: 'grantLandPlays'; seat: PlayerId; count: number }
  /** Internal canonical player grant; lasts for the rest of the game. */
  | { type: 'grantNoMaximumHandSize'; seat: PlayerId }
  /** Exile chosen permanents and stamp them as linked to the source. */
  | { type: 'linkExile'; sourceId: string; objectIds: string[]; sourceRef?: ObjectIdentity; targetRefs?: ObjectIdentity[]; untilOpponentMonarch?: { player: PlayerId; since: number }; untilSourceLeaves?: true; returnTo?: 'battlefield' | 'hand' }
  /** Return cards currently linked to the named source. */
  | { type: 'returnLinkedExile'; sourceId: string; sourceRef?: ObjectIdentity; returnTo?: 'battlefield' | 'hand' }
  // — Priority / structure —
  | { type: 'passPriority'; seat: PlayerId }
  | { type: 'resolveTop' }
  /** Internal canonical instruction event; never offered as a player action. */
  | {
      type: 'counterStackItem'
      stackId: string
      sourceId?: string
      objectRef?: ObjectIdentity
      destination?: ZoneId
      controller?: PlayerId
    }
  /** Internal canonical instruction group; all members share one before-state. */
  | { type: 'actionGroup'; events: GameEvent[]; atomic?: boolean }
  /** A resolved control-changing effect, guarded against a replacement incarnation. */
  | { type: typeof CONTROL_EVENT.change; objectRef: ObjectIdentity; controller: PlayerId }
  /** Canonical semantic destruction; the kernel applies indestructible and replacement rules. */
  /** `noRegeneration` records CR 701.19c "can't be regenerated" for any regeneration replacement. */
  | { type: 'destroy'; objectId: string; sourceId?: string; noRegeneration?: true }
  /** Canonical copy action; resolves from the source snapshot at commit time. */
  | { type: 'copyPermanent'; objectId: string; controller: PlayerId; token?: Extract<GameEvent, { type: 'createToken' }>['token']; sourceId?: string }
  /** Canonical stack-copy action; creates no cast or activation occurrence. */
  | { type: 'copySpell' | 'copyAbility'; stackId: string; controller: PlayerId; targets: TargetRef[]; retarget?: boolean; sourceId?: string }
  /** Canonical temporary effect; the event carries evaluated recipients and pinned source data. */
  | {
      type: 'canonicalEffect'
      objectId: string
      effect: CreatedEffect
      effectPlayer?: PlayerId
      copySourceId?: string
      duration: DslEffectDuration
      sourceId?: string
      sourceRef?: ObjectIdentity
      sourceRevision?: string
      execution?: StackExecutionContext
      createdTurn?: number
      durationUntilTurn?: number
      durationUntilStepTurn?: number
  durationUntilStepNotBeforeTurn?: number
      durationUntilStepActive?: PlayerId
    }
  /** Restore a persisted non-waiting execution cursor and continue its driver. */
  | { type: 'resumeResolution' }
  | { type: 'cancelAnnouncement'; seat: PlayerId; announcementId: string }
  | { type: 'advanceStep' }
  // — Zone & card motion —
  /** `face` picks a face of a double-faced land card; omitted, the first land face is played. */
  | { type: 'playLand'; seat: PlayerId; objectId: string; face?: 'front' | 'back' }
  | {
      type: 'castSpell'
      seat: PlayerId
      objectId: string
      targets?: TargetRef[]
      /** Canonical DSL targets grouped by generated clause index. */
      targetClauses?: TargetRef[][]
      /** Announcement-time selected modal occurrences, in answer order. */
      modeIndices?: number[]
      /** Announcement-time distribution allocations keyed by modal scope. */
      distributionBindings?: DistributionAllocation[]
      additionalGeneric?: number
      kicked?: boolean
      giftPromised?: boolean
      giftRecipient?: PlayerId
      spreeModes?: string[]
      timesKicked?: number
      castOption?: string
      phyrexianLife?: number[]
      alternativeCost?: 'withoutPayingMana'
      /** Starting lore count chosen for a Saga with read ahead. */
      sagaChapter?: number
      door?: RoomDoorId
      adventureCast?: boolean
      x?: number
      sacrifice?: string[]
      exile?: string[]
      /** Separate graveyard selection for each collect-evidence payment. */
      evidence?: string[][]
      convoke?: string[]
      /** Graveyard cards exiled to pay generic mana (delve). */
      delve?: string[]
      discard?: string[]
      copy?: boolean
      withoutPayingMana?: boolean
      /** Server-private serializable canonical announcement continuation. */
      canonicalTransaction?: AnnouncementTransaction
      /** Explicit server-validated mana activation plan used before payment. */
      manaActivations?: Array<{ objectId: string; abilityId: string; choices?: string[]; x?: number }>
      wardPaid?: boolean
      selectedOptionalCosts?: number[]
      costPlayers?: Readonly<Record<number, PlayerId>>
      selectedAlternativeCost?: number
    }
  | { type: 'declineFreeCast'; seat: PlayerId; objectId: string }
  | {
      type: 'chooseParadigm'
      seat: PlayerId
      copyId: string
      cast: boolean
      targets?: TargetRef[]
    }
  | {
      type: 'chooseEpicTargets'
      seat: PlayerId
      sourceId: string
      targets?: TargetRef[]
    }
  | {
      type: 'resolveRecurringSpell'
      seat: PlayerId
      mode: 'epic' | 'paradigm'
      spell: GameObject
      targets: TargetRef[]
    }
  | {
      type: 'createToken'
      controller: PlayerId
      token: {
        name: string
        types: string[]
        subtypes?: string[]
        colors?: string[]
        power?: number | null
        toughness?: number | null
        oracleText?: string
        ruleDefinition?: GameObject['ruleDefinition']
        effects?: GameObject['effects']
        dsl?: true
        tapped?: boolean
      }
    }
  | {
      type: 'createEmblem'
      controller: PlayerId
      emblem: {
        name: string
        subtypes?: string[]
        oracleText?: string
        ruleDefinition?: GameObject['ruleDefinition']
      }
    }
  | {
      type: 'banAttacks'
      attackerController: PlayerId
      protectorController: PlayerId
      source: CapturedObject
      defenders: ObjectSelector
    }
  | {
      type: 'move'
      faceDown?: boolean
      /** This move completes a sacrifice action; replacements retain its provenance. */
      sacrifice?: true
      /** Record only the final exile identity, after replacement has applied. */
      exileLink?: Omit<LinkedExileSet, 'cards'>
      objectId: string
      to: ZoneId
      position?: 'top' | 'bottom'
      /** Same-zone moves normally reorder; exile/command re-entry creates a new object. */
      sameZone?: 'reorder' | 'newObject'
      controller?: PlayerId
      /** Starting lore count chosen as a Saga with read ahead enters. */
      sagaChapter?: number
      /** Rule instances whose replacement already rewrote this move. */
      replacedBy?: string[]
      replacementLineage?: ReplacementLineage
      tapped?: boolean
      /** Counters supplied by the effect putting this permanent onto the battlefield. */
      attachPlayer?: PlayerId
      attachTo?: ObjectIdentity
      enterCounters?: Readonly<Record<string, number>>
      copyOf?: ObjectIdentity
      copyExcept?: {
        notLegendary?: boolean
        plusCounters?: number
        keepName?: boolean
        keepAbility?: boolean
        keepAbilities?: boolean
        flying?: boolean
        keywords?: readonly string[]
        colors?: readonly string[]
        extraTypes?: readonly string[]
        extraSubtypes?: readonly string[]
        noManaCost?: boolean
        tapped?: boolean
      }
      /** Color chosen as this object enters (CR 614.12). */
      chosenType?: string
      chosenColor?: ManaId
      /** Take a non-resolving spell off the stack when this card leaves it (bounce, not counter). */
      dropStackItem?: boolean
    }
  | { type: 'tap'; objectId: string; skipNextUntap?: true }
  | { type: 'untap'; objectId: string }
  | { type: 'phaseOut'; objectId: string }
  | { type: 'phaseIn'; objectId: string }
  | { type: 'removeCounters'; objectId: string; counter: string; count: number }
  | { type: 'putCounters'; objectId: string; counter: string; count: number }
  | { type: 'proliferateCounter'; recipient: { kind: 'object'; objectId: string; counter: string } | { kind: 'player'; seat: PlayerId; counter: 'poison' | 'energy' } }
  /** CR 704.5q: a permanent with both +1/+1 and -1/-1 counters removes a pair of each. */
  | { type: 'annihilateCounters'; objectId: string }
  /** CR 704.5d: a token in a zone other than the battlefield ceases to exist. */
  | { type: 'tokenCeases'; objectId: string }
  | { type: 'becomesMonstrous'; objectId: string }
  // — CR keyword actions —
  | {
      type: 'draw'
      seat: PlayerId
      count?: number
      replacedBy?: string[]
      remainingAfter?: number
      replacementLineage?: ReplacementLineage
    }
  | {
      type: 'beginDredgeChoice'
      seat: PlayerId
      replacedBy: string[]
      remainingAfter?: number
    }
  | { type: 'discard'; seat: PlayerId; objectId: string }
  /** Canonical mill keeps the action distinct from an arbitrary move. */
  | { type: 'mill'; seat: PlayerId; objectId: string; sourceId?: string }
  /** Emitted after the top-library action finishes, including an empty library. */
  | { type: 'scry' | 'surveil'; seat: PlayerId; count: number }
  | { type: 'cycle'; seat: PlayerId; objectId: string }
  | { type: 'shuffleLibrary'; seat: PlayerId }
  | { type: 'reveal'; seat: PlayerId; objectIds: string[]; source?: string; turnFaceUp?: true }
  // — Mana —
  | { type: 'tapForMana'; seat: PlayerId; objectId: string; mana?: ManaId }
  | { type: 'addMana'; seat: PlayerId; mana: Partial<ManaPool>; sourceId?: string; restriction?: Pick<RestrictedMana, 'creatureType' | 'legendary' | 'uncounterable'> }
  | { type: 'payMana'; seat: PlayerId; cost: string }
  | {
      type: 'payExtort'
      seat: PlayerId
      triggerId: string
      mana?: 'W' | 'B'
    }
  | {
      type: 'payOptionalMana'
      seat: PlayerId
      pendingId: string
      cost?: string
    }
  | { type: 'emptyManaPools' }
  // — Special actions —
  | {
      type: 'unlockDoor'
      seat: PlayerId
      objectId: string
      door: RoomDoorId
      /** Ability effects skip the paid special action (CR 709.5c vs Marina). */
      withoutCost?: boolean
    }
  | { type: 'plot'; objectId: string; seat: PlayerId }
  | { type: 'suspend'; objectId: string; seat: PlayerId }
  | { type: 'foretell'; seat: PlayerId; objectId: string }
  | {
      type: 'lockDoor'
      seat: PlayerId
      objectId: string
      door: RoomDoorId
    }
  // — Combat & damage —
  | {
      type: 'declareAttackers'
      seat: PlayerId
      attackers: AttackerDecl[]
      payment?: ManaPayment[]
    }
  | {
      type: 'declareBlockers'
      seat: PlayerId
      blockers: BlockerDecl[]
      payment?: ManaPayment[]
    }
  | { type: 'assignCombatDamage' }
  | {
      type: 'combatDamage'
      sourceId: string
      target: TargetRef
      amount: number
      sourceSnapshot?: CapturedObject
    }
  | {
      type: 'dealDamage'
      sourceId: string
      target: TargetRef
      amount: number
      combat?: boolean
      /** CR 615.6: prevention cannot reduce this damage; shields are not consumed. */
      unpreventable?: boolean
      gainLife?: { seat: PlayerId; max?: number }
      /** Captured characteristics used when the source has left or changed zones. */
      sourceSnapshot?: CapturedObject
    }
  | {
      type: 'registerPrevention'
      hostObjectId: string
      filter: PreventionFilter
      capacity: number | 'unlimited'
      duration: DslEffectDuration
      sourceId?: string
      sourceRef?: ObjectIdentity
      sourceRevision?: string
      additionalEffects?: readonly Instruction[]
      capturedBindings?: PreventionInstance['capturedBindings']
      capturedSource?: CapturedObject
      createdTurn?: number
      durationUntilTurn?: number
      durationUntilStepTurn?: number
      durationUntilStepNotBeforeTurn?: number
      durationUntilStepActive?: PlayerId
      staticKey?: string
    }
  | {
      type: 'removeDefenseCounters'
      objectId: string
      amount: number
      sourceId?: string
    }
  | { type: 'chooseBattleProtector'; objectId: string }
  | { type: 'clearBattleProtector'; objectId: string }
  | { type: 'loseLife'; seat: PlayerId; amount: number; source?: string }
  | { type: 'gainLife'; seat: PlayerId; amount: number; source?: string }
  | { type: 'becomeMonarch'; seat: PlayerId }
  | { type: 'payLife'; seat: PlayerId; amount: number; source?: string }
  | { type: 'addEnergy'; seat: PlayerId; amount: number; source?: string }
  | { type: 'payEnergy'; seat: PlayerId; amount: number; source?: string }
  | { type: 'setLifeTotal'; seat: PlayerId; total: number; source?: string }
  | {
      type: 'exchangeLifeTotals'
      first: PlayerId
      second: PlayerId
      source?: string
    }
  | { type: 'winGame'; seat: PlayerId; source?: string }
  | { type: 'tokenCreated'; object: ObjectSnapshot }
  | { type: 'sacrifice'; objectId: string; sourceId?: string }
  | { type: 'proliferate'; seat: PlayerId; sourceId?: string }
  | { type: 'fight'; leftId: string; rightId: string }
  // — Choices & continuations —
  | {
      type: 'continueAction'
      /** `StackItem.id` of the waiting action to resume. */
      stackId: string
      /** Seat supplying the choice. */
      seat: PlayerId
      /** Choice payload (for example `{ objectIds: string[] }`). */
      payload: Record<string, unknown>
    }
  /**
   * Every vote just finished, whether public or secret: the revealed votes
   * and per-option tallies. "Whenever players finish voting" triggers on this.
   */
  | {
      type: 'votesFinished'
      sourceId: string
      owner: PlayerId
      result: VoteResult
    }
  | {
      type: 'copyStackItem'
      seat: PlayerId
      sourceId: string
      stackId: string
      accept: boolean
      targets?: TargetRef[]
    }
  | {
      type: 'selectCards'
      /** Seat making the choice. */
      seat: PlayerId
      /** Server-side pending selection identity; legacy callers may omit it during migration. */
      selectionId?: string
      kind:
        | 'choose'
        | 'discard'
        | 'sacrifice'
        | 'scry'
        | 'surveil'
        | 'reveal'
        | 'partition'
        | 'choosePile'
      count: number
      /** Cards selected from a hidden zone (discard / reveal / one pile). */
      objectIds?: string[]
      /** Ordered zone assignment for each candidate (scry / surveil / partition). */
      choices?: Array<{
        objectId: string
        destination: 'top' | 'bottom' | 'graveyard' | 'face-up' | 'face-down' | 'hand'
      }>
    }
  | {
      type: 'selectPlayers'
      seat: PlayerId
      selectionId: string
      players: PlayerId[]
    }
  | {
      type: 'selectOption'
      seat: PlayerId
      selectionId: string
      optionId: string
    }
  | {
      type: 'payCumulativeUpkeep'
      seat: PlayerId
      choiceId: string
      objectId: string
      pay: boolean
      recipients?: PlayerId[]
    }
  // — Player processes & rules —
  | { type: 'concede'; seat: PlayerId }
  /** CR 500.7: schedule an extra turn after this one; the newest is taken first. */
  | { type: 'takeExtraTurn'; seat: PlayerId; source?: string }
  | {
      type: 'addRule'
      pluginId: string
      sourceId?: string | null
      params?: Record<string, unknown>
    }
  | {
      type: 'removeRule'
      instanceId?: string
      pluginId?: string
      sourceId?: string | null
    }
  | {
      type: 'activateAbility'
      abilityId: string
      seat: PlayerId
      objectId: string
      targets?: TargetRef[]
      /** Canonical DSL targets grouped by declared clause. */
      targetClauses?: TargetRef[][]
      modeIndices?: number[]
      distributionBindings?: DistributionAllocation[]
      x?: number
      choices?: string[]
      evidence?: string[][]
      door?: RoomDoorId
      /** Host marks mana-ability timing. Kernel does not open that window. */
      manaAbility?: boolean
      wardPaid?: boolean
      selectedOptionalCosts?: number[]
      selectedAlternativeCost?: number
    }
  | { type: 'authoritativeSync'; snapshot: GameState }
  | {
      type: 'judgeFallback'
      seat: PlayerId
      source: string
      reason: string
      effects: GameEvent[]
    }
  /**
   * @deprecated Legacy escape hatch. New work must not add `custom` handlers.
   * Use typed events (`continueAction`, `selectOption`, `searchLibrary`, …) instead.
   */
  | { type: 'custom'; name: string; seat?: PlayerId; payload?: Record<string, unknown> }

export type EventTrace = {
  depth: number
  event: GameEvent
  outcome: 'applied' | 'replaced' | 'prevented' | 'rejected'
  pluginId?: string
  error?: string
}

/** Successful reduce. `prevented` means a replacement returned `null`. */
export type ReduceOk = {
  ok: true
  state: GameState
  trace: EventTrace[]
  prevented?: boolean
}
/** Failed reduce. `state` is the unchanged input. */
export type ReduceErr = {
  ok: false
  error: string
  state: GameState
  trace: EventTrace[]
}
export type ReduceResult = ReduceOk | ReduceErr

/**
 * Plugin hook argument. `state` is the frozen pre-event snapshot.
 * `draft` is the mutable next state (cloned GameState plus enqueue helpers).
 * `rule` is the instance currently being invoked. `catalog` looks up plugin code.
 */
export type HookCtx = {
  state: GameState
  event: GameEvent
  draft: Draft
  rule: RuleInstance
  catalog: PluginCatalog
}

/**
 * Catalog code for one `pluginId`. Each hook may no-op.
 * `legal` returns an error string to reject.
 * `replace` runs before apply: `null` prevents, an array folds left-to-right.
 * `apply` mutates `draft`. `sba` emits events until the loop goes quiet.
 */
export type Plugin = {
  id: string
  legal?: (ctx: HookCtx) => string | void
  replace?: (ctx: HookCtx) => GameEvent | GameEvent[] | null | undefined
  apply?: (ctx: HookCtx) => void
  /** Continuous-characteristic maintenance settled before ordinary SBAs. */
  recompute?: (ctx: HookCtx) => GameEvent[]
  sba?: (ctx: HookCtx) => GameEvent[]
}
