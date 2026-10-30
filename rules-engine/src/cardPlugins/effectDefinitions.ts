import type {
  DelayedTriggerCondition,
  GameObject,
  ManaId,
  ManaPool,
  PlayerId,
  TriggerBindingIf,
  ZoneId,
} from '../types'
import type { ColorSet } from '../../../shared/cardColors'

export type CardCondition =
  | { kind: 'sourceType'; type: string }
  | { kind: 'otherLands'; min?: number; max?: number; subtype?: string }
  | { kind: 'controlledLands'; min?: number; max?: number }
  | { kind: 'controlledBasicLands'; min?: number; max?: number }
  | { kind: 'uniqueLandNames'; min: number }
  | { kind: 'notActivePlayer' }
  | { kind: 'controlledCreaturePower'; min: number }
  | { kind: 'graveyardCards'; min: number }
  | { kind: 'graveyardPermanentCards'; min: number }
  | { kind: 'graveyardCardTypes'; min: number }
  | { kind: 'lacksControlledSubtype'; subtypes: string[] }
  | { kind: 'opponentsAtMost'; max: number }
  | { kind: 'opponentHasMore'; stat: 'lands' | 'life' | 'creatures' | 'cardsInHand' }
  | { kind: 'opponentLostLifeThisTurn'; min: number }
  | { kind: 'opponentDealtCombatDamageByLegendaryThisTurn'; controller?: 'you' | 'any' }
  | { kind: 'controllerIsActive' }
  | { kind: 'castOption'; id: string }
  | { kind: 'controllerUpkeep' }
  | { kind: 'controllerLife'; min: number }
  | { kind: 'notMonstrous' }
  /** Intervening if for "if it was a creature" on a dies trigger (LKI: still a creature in graveyard). */
  | { kind: 'wasCreature' }
  /** True when the object has no counter of this kind; on a dies trigger it reads last-known information. */
  | { kind: 'lacksCounter'; counter: string }
  | { kind: 'stackXAtLeast'; min: number }
  /** The source's controller controls a commander they own (e.g. Lieutenant). */
  | { kind: 'controlsCommander' }
  /**
   * Intervening if on a trigger watching a creature: it has no other creature
   * you control, and no creature card in your graveyard, with its name.
   */
  | { kind: 'triggeringCreatureNameUnique' }

export type TokenSpec = {
  name: string
  types: string[]
  subtypes?: string[]
  power?: number | null
  toughness?: number | null
  oracleText?: string
  colors?: ColorSet
}

export type RevealUntilNonMatch = 'mill' | 'shuffle' | 'bottomRandom'

/**
 * Voters of the vote an instruction list is resolving for. The opponent
 * groups compare each opponent's vote with the controller's own.
 */
export type VoterGroup =
  | 'all'
  | 'opponentsAgreeing'
  | 'opponentsDisagreeing'
  | { votedFor: string }

/** A count that may be read from the vote result instead of fixed. */
export type InstructionCount = number | { voters: VoterGroup }

export type VoteOptions =
  | { kind: 'named'; options: Array<{ id: string; label: string }> }
  | { kind: 'players' }
  | { kind: 'objects'; filter: TargetFilter }

/** Player-only predicates; relations are relative to the resolving ability's controller. */
export type PlayerFilter = {
  relation?: 'you' | 'opponent' | 'any'
  all?: PlayerFilter[]
  any?: PlayerFilter[]
  not?: PlayerFilter
}

/** A non-targeted group, evaluated when its instruction resolves. */
export type PlayerSelector = { kind: 'players'; filter: PlayerFilter }

export type CardInstruction =
  | { kind: 'exileTargetPlayerGraveyard' }
  | { kind: 'selfMill'; count: number }
  | { kind: 'millTarget'; count: number }
  | { kind: 'bounceSelf' }
  | {
      kind: 'delay'
      condition: DelayedTriggerCondition
      do: CardInstruction[]
      untilCleanup?: boolean
      /** Snapshot the first object target into the condition and return instructions. */
      bindTarget?: boolean
    }
  | { kind: 'returnToOwnersControl'; objectId?: string }
  | { kind: 'unearthSelf' }
  | { kind: 'exileSelf' }
  /** "Then you exile this spell": the resolving instant or sorcery is exiled instead of going to the graveyard. */
  | { kind: 'exileThisSpell' }
  | { kind: 'removeTarget'; action: 'destroy' | 'bounce' | 'exile' }
  | {
      kind: 'opponentMayPayMana'
      cost: string
      payer: 'active' | 'controller'
      ifNot: CardInstruction[]
    }
  | {
      kind: 'attackBanUntilEot'
      defenderFilter: TargetFilter
      attackerController: 'active' | 'controller'
    }
  | { kind: 'putHandCardOnLibraryBottom' }
  | { kind: 'putSelfOntoBattlefield' }
  | { kind: 'phaseOutTarget' }
  | { kind: 'searchTargetControllerForBasicLandType' }
  /** Taps this object, or the voted object when `subject` is `triggeringObject`. */
  | { kind: 'tap'; subject?: 'triggeringObject' }
  | { kind: 'payMana'; cost: string }
  | { kind: 'getEnergy'; count: number }
  | { kind: 'payEnergy'; count: number }
  | { kind: 'sacrificeSelf' }
  | { kind: 'addMana'; mana: Partial<ManaPool> }
  /** Adds one of the listed pools; the controller picks privately unless the activation already named one. */
  | { kind: 'addManaChoice'; options: Array<Partial<ManaPool>> }
  | { kind: 'addManaToEachPlayer'; mana: Partial<ManaPool> }
  /** `seat` names a drawer other than the controller, snapshot when the instruction is built. */
  | { kind: 'draw'; count: number; seat?: PlayerId; who?: 'controller' | 'triggeringPlayer' | 'target' }
  | {
      kind: 'discardCards'
      count: number
      who?: 'controller' | 'target'
      optional?: boolean
      then?: { filter: TargetFilter; do: CardInstruction[] }
    }
  | { kind: 'gainLife'; count: number | 'triggerAmount'; to?: PlayerSelector }
  | { kind: 'damage'; amount: number; to: PlayerSelector }
  | { kind: 'drawX' }
  | { kind: 'setAllLifeToLowest' }
  | { kind: 'gainLifeLostThisTurn'; who: 'controller' | 'all' }
  | { kind: 'exchangeLifeWithOpponent'; optional?: boolean; drawLifeLost?: boolean }
  | { kind: 'drawHandDifference' }
  | { kind: 'winGame' }
  | { kind: 'addPlusCounters'; count: InstructionCount }
  /** Puts counters of any kind on the object a per-option or per-trigger pass is about; skipped once it has left the battlefield. */
  | { kind: 'putCounters'; counter: string; count: number | 'triggerAmount'; subject: 'triggeringObject' }
  | { kind: 'pumpAllCreaturesByX'; multiplier: number }
  | {
      kind: 'revealUntil'
      count: InstructionCount | 'opponentCount'
      match: TargetFilter
      destination: 'hand' | 'battlefield'
      nonMatch: RevealUntilNonMatch
      then?: CardInstruction[]
    }
  | { kind: 'revealUntilBasicLand' }
  | { kind: 'revealMatchingToHand'; count: number; type: string }
  | { kind: 'lockOrUnlockDoor' }
  | { kind: 'sacrificePermanentsThenDraw'; types?: string[] }
  | { kind: 'opponentsSacrifice'; type: string; count: number }
  /** The defending player named by an attack trigger sacrifices that many permanents of their choice. */
  | { kind: 'defendingPlayerSacrifices'; count: number }
  /** Put the card that caused this trigger onto the battlefield under your control if it is still in a graveyard. */
  | { kind: 'putTriggeringCardOntoBattlefield' }
  | { kind: 'reanimateCreatureFromGraveyards'; addSubtype?: string }
  | {
      kind: 'loseLife'
      amount: number | 'triggerAmount'
      who: 'triggeringPlayer' | 'controller'
      to?: never
    }
  | { kind: 'loseLife'; amount: number; to: PlayerSelector; who?: never }
  | { kind: 'loseLifeTargetPlayer'; amount: number }
  | { kind: 'loseLifeTargetManaValue' }
  | { kind: 'loseLifeTargetController'; amount: number }
  | { kind: 'dealDamageToChosenTarget'; amount: number }
  | { kind: 'teferiSunsetPlusOne' }
  | { kind: 'lookTopPick'; count: number; pick: number }
  | { kind: 'teferiSunsetEmblem' }
  | { kind: 'exileColoredPermanentsAtMostX' }
  | { kind: 'putPermanentsFromHand'; max: InstructionCount }
  | { kind: 'returnOwnedGraveyardLands'; tapped?: boolean }
  | { kind: 'returnSelfAsEnchantment' }
  /** Return this card from the graveyard to the battlefield under its owner's control with one counter. */
  | { kind: 'returnSelfWithCounter'; counter: string }
  | { kind: 'createToken'; token: TokenSpec }
  /**
   * Destroy every legal target, then each destroyed permanent's controller
   * creates `token` for each permanent that was actually put into a graveyard.
   */
  | {
      kind: 'destroyThenTokenForController'
      token: TokenSpec
      /** Set once the destroy events are queued: each destroyed target and its controller. */
      destroyed?: Array<{ objectId: string; controller: PlayerId }>
    }
  | {
      kind: 'embalmToken'
      colors: ColorSet
      extraSubtypes: string[]
    }
  | { kind: 'copySelf'; for?: 'controller' | 'targetPlayer' }
  | { kind: 'doublePlusCounters' }
  | { kind: 'if'; if: CardCondition; whenTrue: CardInstruction[]; whenFalse?: CardInstruction[] }
  | {
      kind: 'ifTargetTypes'
      types: string[]
      whenTrue: CardInstruction[]
      whenFalse?: CardInstruction[]
    }
  /** Run `do`, then if `if` still holds, run `do` once more. */
  | {
      kind: 'repeatIf'
      if: CardCondition
      do: CardInstruction[]
      /** After the first process has finished; only the condition check remains. */
      spent?: true
    }
  /** Mill `count`, then the controller may pay mana and life to put one of those cards into hand. */
  | {
      kind: 'millThenRecover'
      count: number
      mana?: string
      life?: number
      /** Snapshot of milled object ids; set when offering the recover choice after mill. */
      fromObjectIds?: string[]
    }
  | { kind: 'surveil'; count: number }
  | { kind: 'scry'; count: InstructionCount }
  | {
      kind: 'opponentPiles'
      count: number
      /** `public` reveals the cards; `look` shows them only to the chosen opponent. */
      reveal: 'public' | 'look'
      /** `public` keeps both piles public; `facedown-faceup` hides the face-down pile. */
      piles: 'public' | 'facedown-faceup'
    }
  | { kind: 'putLandFromHand'; tapped?: boolean }
  | { kind: 'bounceChosenLand' }
  | { kind: 'revealPick'; count: number; type?: string; permanent?: boolean }
  | { kind: 'copyControlledCreature'; notLegendary?: boolean; plusCounters?: number; keepName?: boolean }
  | { kind: 'copyTargetCreature'; notLegendary?: boolean; flying?: boolean }
  | {
      kind: 'returnTargetFromGraveyard'
      to: 'hand' | 'battlefield'
      tapped?: boolean
      optional?: boolean
    }
  | {
      /** You may exile a matching card from your graveyard. If you do, exile stack targets. */
      kind: 'ifYouDoExileFromGraveyard'
      filter: TargetFilter
    }
  | { kind: 'pump'; power: number; toughness: number }
  | { kind: 'pumpTargetX'; multiplier: number; toughnessMultiplier?: number }
  | { kind: 'pumpSelf'; power: number; toughness: number }
  | { kind: 'animateUntilEot'; power: number; toughness: number; fromX?: boolean }
  | { kind: 'grantUntilEot'; keywords: string[]; maxFromX?: boolean }
  | { kind: 'goadTargets'; untilEndOfTurn?: boolean }
  | { kind: 'goadObjectIds'; objectIds: string[]; objectIdsFromRevealUntil?: boolean }
  | { kind: 'crewVehicle' }
  | { kind: 'monstrosity'; count: number }
  | { kind: 'createXTokens'; token: TokenSpec }
  | { kind: 'encoreTokens' }
  | { kind: 'sacrificeObjectIds'; objectIds: string[] }
  | { kind: 'dealDamageToSelf'; amount: number }
  | { kind: 'addChosenColorMana'; colors?: Array<Exclude<ManaId, 'C'>> }
  | { kind: 'optionalMill'; count: number }
  | { kind: 'mayDraw'; count: number; seat?: PlayerId }
  | { kind: 'mayPayLifeDraw' }
  | { kind: 'eachPlayerDiscard'; count: number }
  | { kind: 'eachPlayerDraw'; count: number }
  /** Each player draws cards equal to the damage dealt to this by sources they controlled this turn. */
  | { kind: 'eachPlayerDrawDamageDealtToSource' }
  /**
   * Each player, in turn order, may discard their hand and, if they do, draws `count` cards.
   * Must be the last instruction in its list: option choices do not resume later instructions.
   */
  | { kind: 'eachPlayerMayWheel'; count: number }
  | { kind: 'eachPlayerLoseLife'; amount: number }
  | { kind: 'eachPlayerSacrifice'; type: string }
  | {
      kind: 'returnChosenLandFromGraveyard'
      tapped?: boolean
      count?: number
      min?: number
      max?: number
      to?: 'hand' | 'battlefield'
      filter?: TargetFilter
      /** Each living player chooses from their own graveyard, in turn order, instead of only the controller. */
      eachPlayer?: true
    }
  | { kind: 'sacrificeControlled'; types?: string[]; count: number }
  | { kind: 'putTargetOnLibraryTop' }
  /** Destroy every battlefield permanent matching `filter`; `other` spares the source. Indestructible survives. */
  | { kind: 'destroyAll'; filter: TargetFilter }
  /** Return every battlefield permanent matching `filter` to its owner's hand. */
  | { kind: 'bounceAll'; filter: TargetFilter }
  | { kind: 'millHalfTargetPlayers' }
  | { kind: 'untapUpToLands'; count: number }
  | { kind: 'opponentsLoseLife'; amount: number }
  | { kind: 'pumpAttached'; power: number; toughness: number }
  | { kind: 'tapAttached' }
  | { kind: 'addPlusCountersEqualToLands' }
  | { kind: 'pumpTargetEqualToLands'; trample?: boolean }
  | { kind: 'returnCreatureManaValueX'; minimumX?: number; tapped?: boolean }
  | { kind: 'drawAtNextUpkeep'; count: number; who: 'you' | 'targetController'; optional?: boolean }
  | { kind: 'putMilledLandTapped' }
  | { kind: 'copyAllCreaturesUntilEot'; notLegendary?: boolean }
  | {
      kind: 'chooseCreatureType'
      action: 'addToSource' | 'setChosenType' | 'destroyOthers' | 'bounceOthers'
    }
  | {
      kind: 'putFromHand'
      who: 'each' | 'active' | 'controller'
      max: InstructionCount
      types?: string[]
      repeat?: boolean
      optional?: boolean
    }
  | { kind: 'secretCouncil' }
  | { kind: 'fight'; with: 'self-target' | 'two-targets' }
  | { kind: 'fightUpToOne' }
  | { kind: 'exchangeControlUntilEot' }
  | { kind: 'gainControlPermanent'; untap?: boolean }
  | {
      kind: 'pairDonateToOpponents'
      objectIds: string[]
      distinctWhenBalanced?: boolean
      objectIdsFromRevealUntil?: boolean
    }
  | { kind: 'bounceAttacking' }
  | { kind: 'chooseVotesThisTurn' }
  | { kind: 'createTreasures'; count: number; who: 'you' | 'targetController' | 'triggeringPlayer' }
  /**
   * Every player votes, starting with the controller. Put every instruction
   * that follows the vote in `outcome`: it runs once the last vote is in, with
   * the result readable by the vote instructions below.
   */
  | {
      kind: 'vote'
      prompt: string
      options: VoteOptions
      secret?: boolean
      outcome: CardInstruction[]
    }
  /** `option` has strictly more votes than every other option; a tie runs `whenFalse`. */
  | {
      kind: 'ifVoteLeads'
      option: string
      whenTrue: CardInstruction[]
      whenFalse?: CardInstruction[]
    }
  /** Run `do` once per voter in `who`, with that voter as the triggering player. */
  | { kind: 'forEachVoter'; who: VoterGroup; do: CardInstruction[] }
  /** Run `do` once per option with votes; the vote count is the trigger amount. */
  | { kind: 'forEachVotedOption'; do: CardInstruction[] }
  | { kind: 'exileVoteWinners' }
  | { kind: 'drawGreatestPower'; nonHuman?: boolean }
  | {
      kind: 'pumpControlled'
      power: number
      toughness: number
      trample?: boolean
      powerFromGreatest?: boolean
      fromStackX?: boolean
      nonHuman?: boolean
      other?: boolean
    }
  | { kind: 'searchLibrary'; spec?: SearchSpec; subtype?: string }
  | { kind: 'fightOwnedVsOpponent' }
  | { kind: 'counterUnlessPay'; amount: number }
  /** Copy the spell this item targeted; its controller keeps the targets or picks new ones. */
  | { kind: 'copyTargetSpell' }
  | { kind: 'destroyTargetPermanent'; types: string[] }
  | {
      kind: 'lookTopPutLand'
      count: number
      orHand?: boolean
      countFromPower?: boolean
      anyNumber?: boolean
      tapped?: boolean
      shuffleAfter?: boolean
    }
  | { kind: 'devour'; types: string[]; countersPer: number; then?: CardInstruction[] }
  | { kind: 'addPlusCountersFromSacrifice'; countersPer: number }
  | { kind: 'grantControlled'; keywords: string[]; other?: boolean; nonHuman?: boolean }
  | { kind: 'preventCombatDamage'; from?: 'target' | 'all'; toController?: boolean }
  | { kind: 'untapTarget' }
  | {
      kind: 'tapAll'
      filter: TargetFilter
      /** Only permanents controlled by the targeted player; `filter.controller` is ignored. */
      ofTargetPlayer?: boolean
      /** They don't untap during their controller's next untap step. */
      skipNextUntap?: boolean
    }
  | { kind: 'addManaPerSwamp'; basic?: boolean }
  | { kind: 'revealDrawLoseLife' }
  | { kind: 'mayCastFromExileWithoutPayingMana' }
  | { kind: 'mayCastFromHandWithoutPayingMana'; maxManaValue: number }
  | { kind: 'finishWarpExile' }
  | { kind: 'addUntilCleanupRule'; pluginId: string; params?: Record<string, unknown> }
  | { kind: 'cumulativeUpkeepOpponentLife' }
  | { kind: 'copyTargetForEachOtherPlayer' }
  | { kind: 'combatDialogueUntilEot' }
  | {
      kind: 'linkExile'
      filter: TargetFilter
      min?: number
      max?: number
      optional?: boolean
      /** Exile permanents you control (mass self-exile). */
      controlled?: boolean
      perOpponent?: { max: number }
    }
  | { kind: 'returnLinkedExile'; returnTo?: 'battlefield' | 'hand' }
  | {
      kind: 'blink'
      returnController?: 'owner' | 'controller'
      when?: 'immediate' | 'nextEndStep'
      plusCounters?: number
      /** Return the permanent tapped. */
      tapped?: true
      /** Blink the source itself instead of an ability or spell target. */
      self?: true
      targetIndex?: number
      optional?: boolean
      filter?: TargetFilter
      prompt?: string
    }
  | {
      kind: 'blinkReturn'
      objectId: string
      returnController?: 'owner' | 'controller'
      plusCounters?: number
      tapped?: true
    }
  | { kind: 'becomeMonarch' }
  | {
      kind: 'exileUntilOpponentBecomesMonarch'
      filter: TargetFilter
      min?: number
      max?: number
      optional?: boolean
    }
  | {
      kind: 'becomeCopyOfTarget'
      filter: TargetFilter
      keepAbility?: boolean
    }
  | {
      kind: 'loseAbilitiesBecome'
      extraSubtype: string
      power: number
      toughness: number
    }
  | { kind: 'pumpFromLinkedExilePower'; applyTo: 'self' | 'stackTarget' }
  | { kind: 'pumpFromLinkedExilePowerApply'; applyTo: 'self' | 'stackTarget' }
  | { kind: 'putLinkedExileToGraveyardGainLife' }
  | { kind: 'putLinkedExileToGraveyardGainLifeApply' }
  | { kind: 'loseHalfLifeRoundedUp' }
  | { kind: 'addManaAtNextMainFromTarget' }
  | { kind: 'tapOpponentsCreatures' }
  /** `chosen` counters the spell this item already targeted instead of asking for one. */
  | { kind: 'counterTargetSpell'; chosen?: true }
  | { kind: 'bounceTargetPermanent' }
  | { kind: 'addPlusCountersToControlled'; count: number }
  | { kind: 'hiddenPileNegotiation'; pileSize: number; pileCount: 2; lifeLoss: number }

export type ActivateCost = {
  tap?: boolean
  crew?: number
  mana?: string
  mill?: number
  life?: number
  sacrifice?: 'self'
  /** Exile this card from your graveyard as an additional activation cost. */
  exileSelf?: boolean
  exileFromGraveyard?: boolean
  discard?: 'self' | 'land' | 'any'
  /** How many cards a hand `discard` cost takes (default 1): "Discard three cards:". */
  discardCount?: number
  sacrificeTarget?: 'creature' | 'land'
  sacrificeOther?: boolean
  /** Signed loyalty change paid before the ability goes on the stack. */
  loyalty?: number
  /** Use the activation event's chosen X as a negative loyalty cost. */
  loyaltyX?: boolean
  /** Energy counters ({E}) paid from the controller's pool. */
  energy?: number
  if?: CardCondition
  /** Replace `{X}` in `mana` with the activation event's chosen X. */
  xMana?: boolean
  /** Reduce only the generic component once per legendary creature controlled. */
  reducePerLegendaryCreature?: number
}

export type SearchDestination = 'hand' | 'battlefield' | 'graveyard'

export type TargetFilter = {
  /** Boolean composition; fields on the same filter also combine with AND. */
  all?: TargetFilter[]
  any?: TargetFilter[]
  not?: TargetFilter
  owner?: 'you' | 'opponent'

  zone?: ZoneId
  zones?: ZoneId[]
  /** Restrict a spell target by the zone it was cast from. */
  castFromNot?: ZoneId
  /** Restrictions printed in square brackets and removed by Cleave. */
  bracketed?: TargetFilter
  type?: string
  types?: string[]
  subtypes?: string[]
  supertype?: string
  nonland?: boolean
  noncreature?: boolean
  nonblack?: boolean
  controller?: 'you' | 'opponent' | 'notController'
  spellTargetsControlledPermanent?: boolean
  players?: 'any' | 'opponent'
  nonlegendary?: boolean
  /** Exclude the source permanent ("another target"). */
  other?: boolean
  excludeSubtypes?: string[]
  /** Card types must include a permanent type (creature, land, artifact, etc.). */
  permanent?: boolean
  /** In a graveyard and moved there from the battlefield this turn (not mill or discard). */
  fromBattlefieldThisTurn?: boolean
  nonbasic?: boolean
  attacking?: boolean
  stealIfTypes?: string[]
  /** Subtype, honoring land-type overlays (a Forest/Swamp overlay makes every land one). */
  subtype?: string
  /** Required colors; every listed color must be present (additional colors are allowed). */
  colors?: string[]
  token?: boolean
  nontoken?: boolean
  powerAtLeast?: number
  /** Mana value predicates; zero is even. */
  manaValue?: { eq?: number; min?: number; max?: number; parity?: 'even' | 'odd' }
}

export type SearchSpec = {
  prompt: string
  match: (object: GameObject) => boolean
  destination: SearchDestination
  tapped?: boolean
  min: number
  max: number
  reveal?: boolean
  gainLife?: number
  validateSelection?: (objects: GameObject[]) => string | void
  untapWithFourLands?: boolean
  /** Sacrificed while casting, as Harrow's printed additional cost. */
  sacrificeLands?: number
  /** Sacrificed while resolving, as Scapeshift's first sentence. */
  sacrificeOnResolve?: 'any'
  zones?: ZoneId[]
  maxManaValue?: number | 'x'
  shuffleIfSearched?: boolean
  then?: CardInstruction[]
  empoweredMax?: number
  empoweredIf?: CardCondition
  split?: {
    battlefield: { min: number; max: number; tapped?: boolean }
    hand: { min: number; max: number }
    totalMax: number
    paired?: boolean
  }
  /** Hideouts default sacrifice when gainLife or sacrificeSource !== false. */
  sacrificeSource?: boolean
  optionalEnter?: boolean
  /** Run after the search choice completes (fail-to-find included). */
  after?: CardInstruction[]
}

export type CardEffect =
  | {
      op: 'trigger'
      on:
        | 'enters'
        | 'permanentLeaves'
        | 'permanentDies'
        | 'exiled'
        | 'leaves'
        | 'dies'
        | 'attacks'
        | 'resolve'
        | 'upkeep'
        | 'precombatMain'
        | 'beginCombat'
        | 'end'
        | 'unlock'
        | 'fullyUnlock'
        | 'combatDamage'
        | 'dealtCombatDamage'
        | 'becomesMonstrous'
        | 'tapped'
        | 'playerAttacks'
        | 'tokenCreated'
        | 'permanentEnters'
        | 'permanentSacrificed'
        | 'votesFinished'
      do: CardInstruction[]
      /** Filter the event's involved object; departure triggers use its pre-move characteristics. */
      watch?: TargetFilter
      /** Involved player, relative to the source controller; zone moves use the departing controller. */
      player?: 'you' | 'opponent' | 'any' | PlayerFilter
      /** Origin zone for zone-change triggers. */
      from?: ZoneId | ZoneId[]
      if?: CardCondition | TriggerBindingIf
      /** Active source type checked only when detecting the trigger, never on resolution. */
      sourceTypeAtTrigger?: string
      targets?: 'opponent' | 'player' | {
        filter: TargetFilter
        /** Fewest targets; defaults to `max`, so `0` makes "up to N" a "you may". */
        min?: 0 | 1
        /** Most targets, chosen together before the ability goes on the stack. Defaults to 1. */
        max?: number
      }
      /** CR 603.2 — trigger only on the turn's first matching event, source or not. */
      firstTimeEachTurn?: boolean
      /** That ability on this object triggers at most once each turn (not the same as `firstTimeEachTurn`). */
      onceEachTurn?: boolean
    }
  | {
      op: 'activate'
      id: string
      manaAbility?: boolean
      targets?:
        | 'any'
        | 'opponent'
        | 'teferiSunsetPlusOne'
        | 'creature'
        | 'land'
        | 'room'
        | 'legendary'
        | { filter: TargetFilter }
        | TargetFilter
      sorcery?: boolean
      zone?: ZoneId
      costs: ActivateCost
      if?: CardCondition
      do: CardInstruction[]
      /** CR 702.89 — cycling activated from hand; emits a `cycle` event on resolve. */
      cycling?: true
    }
  | { op: 'search'; via: 'spell'; spec: SearchSpec }
  | { op: 'search'; via: 'ability'; spec: SearchSpec; costs: ActivateCost }
  | { op: 'search'; via: 'enters'; spec: SearchSpec }
  | {
      op: 'targetedResolve'
      target: number
      /** Consecutive targets sharing `filter`, starting at `target`. */
      count?: number
      filter: TargetFilter
      action: 'destroy' | 'exile' | 'bounce' | 'counter' | 'copy' | 'reanimate' | 'select' | 'libraryBottom'
      /** Return reanimated permanents tapped. */
      tapped?: boolean
      /** Sacrifice a matching controlled creature on resolution; only then apply the action. */
      sacrificeThen?: { type: string }
      do?: CardInstruction[]
      optional?: boolean
      min?: number
      max?: number
    }
  | {
      op: 'static'
      pluginId?: string
      /** Ward: generic {N}, mana {N}, life, or a sacrifice cost (CR 702.21). */
    }
  | { op: 'handler'; pluginId: string }
  | {
      op: 'alternateCast'
      id: string
      label: string
      manaCost: string
      life?: number
      controlledSubtype?: string
      fromZone?: ZoneId
      exileAfterUse?: boolean
      discard?: 'land'
      sacrifice?: { type: string; count: number }
      /** Cast from exile after a warp exile; manaCost `__printed__` uses the object's mana cost. */
      afterWarp?: boolean
      exileGraveyard?: { count: number; other?: boolean }
    }
