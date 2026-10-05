import type {
  DelayedTriggerCondition,
  GameObject,
  ManaId,
  ManaPool,
  PlayerId,
  TriggerBindingIf,
  ZoneId,
} from '../types'

export const RANDOM_EXILE_COPY_CARD_CHOSEN = 'randomExileCopy.cardChosen'
export const RANDOM_EXILE_COPY_FINISH = 'randomExileCopy.finish'

export type CardCondition =
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
  | { kind: 'giftPromised' }
  | { kind: 'giftNotPromised' }
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

export type GiftSpec = {
  label?: string
  draw?: number
  extraTurn?: true
  token?: TokenSpec & { tapped?: boolean }
}

export type TokenSpec = {
  name: string
  types: string[]
  subtypes?: string[]
  power?: number | null
  toughness?: number | null
  oracleText?: string
  colors?: string[]
  sacrificeForMana?: Partial<ManaPool>
  /** Stamped onto the token; plugins read these, never the token's name. */
  effects?: CardEffect[]
}

/** Test on a mana value; every present field must hold. Zero is even. */
export type ManaValuePredicate = {
  parity?: 'even' | 'odd'
  min?: number
  max?: number
}

export type RevealUntilNonMatch = 'mill' | 'shuffle'

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

export type CardInstruction =
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
  | { kind: 'removeTarget'; action: 'destroy' | 'bounce' }
  | { kind: 'putSelfOntoBattlefield' }
  | { kind: 'phaseOutTarget' }
  | { kind: 'createHeroWithLandCounters' }
  | { kind: 'searchTargetControllerForBasicLandType' }
  | { kind: 'tap' }
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
  | { kind: 'gainLife'; count: number | 'triggerAmount' }
  | { kind: 'drainOpponentsX'; multiplier: number }
  | { kind: 'drawX' }
  | { kind: 'dealDamageTargetX' }
  | { kind: 'setAllLifeToLowest' }
  | { kind: 'gainLifeLostThisTurn'; who: 'controller' | 'all' }
  | { kind: 'exchangeLifeWithOpponent'; optional?: boolean; drawLifeLost?: boolean }
  | { kind: 'drawHandDifference' }
  | { kind: 'winGame' }
  | { kind: 'addPlusCounters'; count: InstructionCount }
  | { kind: 'putChargeCountersFromTimesKicked' }
  | { kind: 'pumpAllCreaturesByX'; multiplier: number }
  | {
      kind: 'revealUntil'
      count: InstructionCount | 'opponentCount'
      match: TargetFilter
      destination: 'hand' | 'battlefield'
      nonMatch: RevealUntilNonMatch
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
    }
  | { kind: 'loseLifeTargetPlayer'; amount: number }
  | { kind: 'loseLifeTargetManaValue' }
  | { kind: 'loseLifeTargetController'; amount: number }
  | { kind: 'dealDamageToChosenTarget'; amount: number }
  | { kind: 'teferiSunsetPlusOne' }
  | { kind: 'lookTopPick'; count: number; pick: number }
  | { kind: 'teferiSunsetEmblem' }
  | { kind: 'exileColoredPermanentsAtMostX' }
  | { kind: 'putPermanentsFromHand'; max: InstructionCount }
  | { kind: 'discardHandsThenDrawGreatest' }
  | { kind: 'extraLandPlays'; count: number }
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
      colors: string[]
      extraSubtypes: string[]
    }
  | { kind: 'attachedCopyOrToken'; cost: string; token: TokenSpec }
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
  | { kind: 'phaseOutControlled' }
  | { kind: 'grantProtectionFromEverything' }
  | { kind: 'lifeTotalCannotChange' }
  | { kind: 'crewVehicle' }
  | { kind: 'monstrosity'; count: number }
  | { kind: 'createXTokens'; token: TokenSpec }
  | { kind: 'encoreTokens' }
  | { kind: 'sacrificeObjectIds'; objectIds: string[] }
  | { kind: 'dealDamageToSelf'; amount: number }
  | { kind: 'addChosenColorMana'; colors?: Array<Exclude<ManaId, 'C'>> }
  | { kind: 'optionalMill'; count: number }
  | { kind: 'mayDraw'; count: number; seat?: PlayerId }
  | { kind: 'chooseModes'; choose: 'one' | 'any' | 'two'; modes: ModalMode[] }
  | { kind: 'eachPlayerDiscard'; count: number }
  | { kind: 'eachPlayerDraw'; count: number }
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
    }
  | { kind: 'sacrificeControlled'; types?: string[]; count: number }
  | { kind: 'putTargetOnLibraryTop' }
  | { kind: 'destroyAllCreatures' }
  | { kind: 'millHalfTargetPlayers' }
  | { kind: 'untapUpToLands'; count: number }
  | { kind: 'opponentsLoseLife'; amount: number }
  | { kind: 'revealTopLandsTapped' }
  | { kind: 'pumpAttached'; power: number; toughness: number }
  | { kind: 'tapAttached' }
  | { kind: 'bounceCreaturesExcept'; subtypes: string[] }
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
  | { kind: 'gainLifeTargetPower' }
  | { kind: 'mayCastFromExileWithoutPayingMana' }
  | { kind: 'mayCastFromHandWithoutPayingMana'; maxManaValue: number }
  | { kind: 'finishWarpExile' }
  | { kind: 'addUntilCleanupRule'; pluginId: string; params?: Record<string, unknown> }
  | { kind: 'cumulativeUpkeepOpponentLife' }
  | { kind: 'randomExileCopyWhile'; repeatWhileType: string; tapped?: boolean }
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
  | { kind: 'gainLifeTargetToughness' }
  | { kind: 'tapOpponentsCreatures' }
  | { kind: 'counterTargetSpell' }
  | { kind: 'bounceTargetPermanent' }
  | { kind: 'addPlusCountersToControlled'; count: number }
  | { kind: 'opponentMayDrawThenStealCast'; count: number }
  | { kind: 'hiddenPileNegotiation'; pileSize: number; pileCount: 2; lifeLoss: number }

export type ModalMode = { id: string; label: string; do: CardInstruction[] }

export type SpreeMode = {
  id: string
  label: string
  extraCost: string
  do: CardInstruction[]
}

export type ModalSpec = {
  choose: 'one' | 'any' | 'two'
  commanderChooseBoth?: boolean
  modes: ModalMode[]
}

export type SagaChapter = {
  numbers: number[]
  do: CardInstruction[]
  targets?: { filter: TargetFilter }
}

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
  zone?: ZoneId
  zones?: ZoneId[]
  /** Restrict a spell target by the zone it was cast from. */
  castFromNot?: ZoneId
  /** Restrictions printed in square brackets and removed by Cleave. */
  bracketed?: TargetFilter
  type?: string
  types?: string[]
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
  nontoken?: boolean
  powerAtLeast?: number
  /** Mana value predicates; zero is even. */
  manaValue?: { eq?: number; min?: number; max?: number; parity?: 'even' | 'odd' }
}

/** Layer-style static effect on matching permanents; keywords are lowercase ability tokens. */
export type StaticBoardPumpSpec = {
  power: number
  toughness: number
  requireTypes: string[]
  /** Only while the condition holds for the source; re-evaluated as the game changes. */
  if?: CardCondition
  /** `self` is only the source; `others` excludes it. Default: every matching permanent. */
  affects?: 'self' | 'others'
  /** Whose permanents are affected. Default: the source's controller. */
  controller?: 'you' | 'opponent'
  grantKeywords?: string[]
  /** "Lose and can't have or gain": wins over every grant, printed or static. */
  suppressKeywords?: string[]
}

export type CastCostCondition =
  | CardCondition
  | { kind: 'target'; filter: TargetFilter }

export type SearchSpec = {
  prompt: string
  match: (object: GameObject) => boolean
  kickedMatch?: (object: GameObject) => boolean
  kickedPrompt?: string
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
  | { op: 'dredge'; count: number }
  | {
      op: 'saga'
      chapters: SagaChapter[]
      readAhead?: boolean
    }
  | {
      op: 'replacement'
      on: 'enters'
      do: 'tapSelf' | 'tapUnlessPayLife' | 'tapUnlessRevealSubtype' | 'chooseColor'
      life?: number
      subtypes?: string[]
      if?: CardCondition
    }
  | {
      op: 'trigger'
      on:
        | 'enters'
        | 'leaves'
        | 'dies'
        | 'landfall'
        | 'attacks'
        | 'resolve'
        | 'landToGraveyard'
        | 'upkeep'
        | 'precombatMain'
        | 'cast'
        | 'discard'
        | 'cycle'
        | 'draw'
        | 'end'
        | 'unlock'
        | 'fullyUnlock'
        | 'combatDamage'
        | 'dealtCombatDamage'
        | 'playLand'
        | 'becomesMonstrous'
        | 'tapped'
        | 'gainLife'
        | 'playerAttacks'
        | 'permanentEnters'
        | 'permanentSacrificed'
        | 'votesFinished'
      do: CardInstruction[]
      /**
       * For `permanentEnters` and `permanentSacrificed`: the permanent that
       * entered or was sacrificed, not necessarily the source, must match. The
       * filter reads that permanent's characteristics as the event saw them,
       * and `controller` is relative to this ability's controller.
       */
      watch?: TargetFilter
      if?: CardCondition | TriggerBindingIf
      creatureOnly?: boolean
      /** A `cast` trigger only fires for noncreature spells. */
      noncreatureOnly?: boolean
      /** Whose casts fire a `cast` trigger; by default only the permanent's controller's. */
      castBy?: 'opponent'
      modal?: ModalSpec
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
      /** On the nth resolution this turn, run `do` instead of the base `do`. */
      whenResolvedNth?: { nth: number; do: CardInstruction[] }
    }
  | {
      op: 'modal'
      choose: 'one' | 'any' | 'two'
      commanderChooseBoth?: boolean
      modes: ModalMode[]
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
      kickedFilter?: TargetFilter
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
  | { op: 'mana'; if: CardCondition }
  | {
      op: 'manaCapability'
      from: 'opponentsLands' | 'controlledLands'
    }
  | {
      op: 'restrictedMana'
      creatureOfChosenType: true
      uncounterable?: boolean
    }
  | {
      op: 'static'
      pluginId?: string
      extraLandPlays?: number
      extraLandfall?: number
      extraEnters?: number
      playLandsFromGraveyard?: boolean
      playLandsFromLibraryTop?: boolean
      revealLibraryTop?: boolean
      allCreatureTypes?: boolean
      legendRuleOff?: boolean
      attackTax?: { amount: number; whileUntapped?: boolean }
      blockTax?: { amount: number; whileAttacking?: boolean }
      /** "Your opponents can't block with creatures with …" while this is on the battlefield. */
      opponentsCantBlock?: ManaValuePredicate
      /** "Your opponents can't cast spells with …" while this is on the battlefield. */
      opponentsCantCast?: ManaValuePredicate
      grantRetrace?: {
        nonlandPermanent?: boolean
        duringYourTurn?: boolean
        other?: boolean
      }
      /** Release linked exiles when this permanent leaves the battlefield (not a triggered ability). */
      linkedExileUntilLeaves?: { returnTo?: 'battlefield' | 'hand' }
      ptEqualsLife?: { who: 'controller' | 'owner' }
      /** Layer 7a CDA: P/T each equal the number of matching permanents you control. */
      ptEqualsCount?: { types: string[] }
      /** Activated abilities of matching permanents you control cost this much less. */
      reduceActivationCost?: { generic: number; requireTypes?: string[] }
      /** Matching permanents get +N/+N and keyword changes while this source is on the battlefield. */
      staticBoardPump?: StaticBoardPumpSpec
      /** Ward: generic {N}, mana {N}, or a sacrifice cost (CR 702.21). */
      ward?: {
        generic?: number
        mana?: number
        sacrifice?: { count: number; nonland?: boolean }
      }
      grantControlledSubtypeTrigger?: {
        subtype: string
        on: Extract<CardEffect, { op: 'trigger' }>['on']
        do: CardInstruction[]
      }
      pumpPerLinkedExile?: { power: number; toughness: number }
      /** If this card would be put into a graveyard from anywhere, reveal it and shuffle it into its owner's library. */
      shuffleIntoLibraryInstead?: true
      /** Whenever the permanent this Aura enchants is tapped for mana, its controller adds one more mana. */
      enchantedManaBoost?: { mana: Exclude<ManaId, 'C'> } | { chosenColor: true }
      exileOpponentGraveyard?: boolean
      playExiledWithLife?: boolean
    }
  | { op: 'handler'; pluginId: string }
  | {
      op: 'castCost'
      convoke?: boolean
      delve?: boolean
      lifeX?: boolean
      xMana?: 'generic' | 'black'
      timing?: 'yourEndStep'
      kicker?: string
      gift?: GiftSpec
      spree?: SpreeMode[]
      multikicker?: string
      reduceGeneric?: {
        amount: number
        if: CastCostCondition
      }
    }
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
  | { op: 'foretell'; manaCost: string }
  | { op: 'drawReplacementByType' }
  | { op: 'spellTrait'; uncounterable?: boolean }
  | {
      op: 'targetingRequirement'
      kind: 'flagbearer' | 'hexproof-while-untapped'
    }
  | {
      op: 'playerAuraDeal'
      drawAtEnchantedEnd: number
      breakOnMutualAttack: boolean
    }
  | {
      op: 'bestow'
      cost: string
      power: number
      toughness: number
    }
