import type {
  GameObject,
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
  | { kind: 'opponentLostLifeThisTurn'; min: number }
  | { kind: 'controllerIsActive' }
  | { kind: 'castOption'; id: string }
  | { kind: 'controllerUpkeep' }
  | { kind: 'controllerLife'; min: number }
  | { kind: 'giftPromised' }
  | { kind: 'giftNotPromised' }

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
  sacrificeForMana?: Partial<ManaPool>
}

export type RevealUntilNonMatch = 'mill' | 'shuffle'

export type CardInstruction =
  | { kind: 'selfMill'; count: number }
  | { kind: 'bounceSelf' }
  | { kind: 'unearthSelf' }
  | { kind: 'exileSelf' }
  | { kind: 'tap' }
  | { kind: 'payMana'; cost: string }
  | { kind: 'sacrificeSelf' }
  | { kind: 'addMana'; mana: Partial<ManaPool> }
  | { kind: 'addManaToEachPlayer'; mana: Partial<ManaPool> }
  /** `seat` names a drawer other than the controller, snapshot when the instruction is built. */
  | { kind: 'draw'; count: number; seat?: PlayerId }
  | { kind: 'discardCards'; count: number; who?: 'controller' | 'target' }
  | { kind: 'gainLife'; count: number | 'triggerAmount' }
  | { kind: 'drainOpponentsX'; multiplier: number }
  | { kind: 'drawX' }
  | { kind: 'dealDamageTargetX' }
  | { kind: 'setAllLifeToLowest' }
  | { kind: 'gainLifeLostThisTurn'; who: 'controller' | 'all' }
  | { kind: 'exchangeLifeWithOpponent'; optional?: boolean; drawLifeLost?: boolean }
  | { kind: 'winGame' }
  | { kind: 'addPlusCounters'; count: number }
  | { kind: 'pumpAllCreaturesByX'; multiplier: number }
  | {
      kind: 'revealUntil'
      count: number | 'opponentCount'
      match: TargetFilter
      destination: 'hand' | 'battlefield'
      nonMatch: RevealUntilNonMatch
    }
  | { kind: 'revealUntilBasicLand' }
  | { kind: 'revealMatchingToHand'; count: number; type: string }
  | { kind: 'lockOrUnlockDoor' }
  | { kind: 'sacrificePermanentsThenDraw'; types?: string[] }
  | { kind: 'opponentsSacrifice'; type: string; count: number }
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
  | { kind: 'lookTopChooseOne'; count: number }
  | { kind: 'teferiSunsetEmblem' }
  | { kind: 'exileColoredPermanentsAtMostX' }
  | { kind: 'putPermanentsFromHand'; max: number }
  | { kind: 'discardHandsThenDrawGreatest' }
  | { kind: 'extraLandPlays'; count: number }
  | { kind: 'returnOwnedGraveyardLands'; tapped?: boolean }
  | { kind: 'createToken'; token: TokenSpec }
  | { kind: 'attachedCopyOrToken'; cost: string; token: TokenSpec }
  | { kind: 'copySelf' }
  | { kind: 'doublePlusCounters' }
  | { kind: 'if'; if: CardCondition; whenTrue: CardInstruction[]; whenFalse?: CardInstruction[] }
  | { kind: 'surveil'; count: number }
  | { kind: 'scry'; count: number }
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
  | { kind: 'pump'; power: number; toughness: number }
  | { kind: 'pumpTargetX'; multiplier: number }
  | { kind: 'pumpSelf'; power: number; toughness: number }
  | { kind: 'animateUntilEot'; power: number; toughness: number }
  | { kind: 'grantUntilEot'; keywords: string[] }
  | { kind: 'goadTargets'; untilEndOfTurn?: boolean }
  | { kind: 'phaseOutControlled' }
  | { kind: 'grantProtectionFromEverything' }
  | { kind: 'lifeTotalCannotChange' }
  | { kind: 'crewVehicle' }
  | { kind: 'createXTokens'; token: TokenSpec }
  | { kind: 'encoreTokens' }
  | { kind: 'sacrificeObjectIds'; objectIds: string[] }
  | { kind: 'dealDamageToSelf'; amount: number }
  | { kind: 'addChosenColorMana' }
  | { kind: 'optionalMill'; count: number }
  | { kind: 'mayDraw'; count: number; seat?: PlayerId }
  | { kind: 'chooseModes'; choose: 'one' | 'any'; modes: ModalMode[] }
  | { kind: 'eachPlayerDiscard'; count: number }
  | { kind: 'eachPlayerDraw'; count: number }
  | { kind: 'eachPlayerLoseLife'; amount: number }
  | { kind: 'eachPlayerSacrifice'; type: string }
  | { kind: 'returnChosenLandFromGraveyard'; tapped?: boolean }
  | { kind: 'returnCreatureManaValueX'; minimumX?: number; tapped?: boolean }
  | { kind: 'drawAtNextUpkeep'; count: number; who: 'you' | 'targetController'; optional?: boolean }
  | { kind: 'putMilledLandTapped' }
  | { kind: 'copyAllCreaturesUntilEot'; notLegendary?: boolean }
  | {
      kind: 'chooseCreatureType'
      action: 'addToSource' | 'destroyOthers' | 'bounceOthers'
    }
  | {
      kind: 'putFromHand'
      who: 'each' | 'active' | 'controller'
      max: number
      types?: string[]
      repeat?: boolean
      optional?: boolean
    }
  | { kind: 'secretCouncil' }
  | { kind: 'fight'; with: 'self-target' | 'two-targets' }
  | { kind: 'fightUpToOne' }
  | { kind: 'exchangeControlUntilEot' }
  | { kind: 'gainControlPermanent' }
  | {
      kind: 'pairDonateToOpponents'
      objectIds: string[]
      distinctWhenBalanced?: boolean
    }
  | { kind: 'bounceAttacking' }
  | { kind: 'chooseVotesThisTurn' }
  | { kind: 'createTreasures'; count: number; who: 'you' | 'targetController' }
  | { kind: 'drawGreatestPower'; nonHuman?: boolean }
  | {
      kind: 'pumpControlled'
      power: number
      toughness: number
      trample?: boolean
      powerFromGreatest?: boolean
      nonHuman?: boolean
      other?: boolean
    }
  | { kind: 'searchLibrary'; spec?: SearchSpec; subtype?: string }
  | { kind: 'fightOwnedVsOpponent' }
  | { kind: 'counterUnlessPay'; amount: number }
  | { kind: 'copyTargetSpell' }
  | { kind: 'destroyTargetPermanent'; types: string[] }
  | { kind: 'lookTopPutLand'; count: number }
  | { kind: 'grantControlled'; keywords: string[]; other?: boolean; nonHuman?: boolean }
  | { kind: 'preventCombatDamage'; from?: 'target' | 'all'; toController?: boolean }
  | { kind: 'untapTarget' }
  | { kind: 'addManaPerSwamp'; basic?: boolean }
  | { kind: 'revealDrawLoseLife' }
  | { kind: 'gainLifeTargetPower' }
  | { kind: 'mayCastFromExileWithoutPayingMana' }
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

export type ModalMode = { id: string; label: string; do: CardInstruction[] }

export type SpreeMode = {
  id: string
  label: string
  extraCost: string
  do: CardInstruction[]
}

export type ModalSpec = {
  choose: 'one' | 'any'
  modes: ModalMode[]
}

export type SagaChapter = {
  numbers: number[]
  do: CardInstruction[]
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
  discard?: 'self' | 'land' | 'any'
  sacrificeTarget?: 'creature' | 'land'
  sacrificeOther?: boolean
  /** Signed loyalty change paid before the ability goes on the stack. */
  loyalty?: number
  /** Use the activation event's chosen X as a negative loyalty cost. */
  loyaltyX?: boolean
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
  controller?: 'you' | 'opponent'
  spellTargetsControlledPermanent?: boolean
  players?: 'any' | 'opponent'
  nonlegendary?: boolean
  /** Exclude the source permanent ("another target"). */
  other?: boolean
  excludeSubtypes?: string[]
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
      do: 'tapSelf' | 'tapUnlessPayLife' | 'tapUnlessRevealSubtype'
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
      do: CardInstruction[]
      if?: CardCondition | TriggerBindingIf
      creatureOnly?: boolean
      modal?: ModalSpec
      targets?: 'opponent' | {
        filter: TargetFilter
      }
      /** CR 603.2 — trigger only on the turn's first matching event, source or not. */
      firstTimeEachTurn?: boolean
      /** That ability on this object triggers at most once each turn (not the same as `firstTimeEachTurn`). */
      onceEachTurn?: boolean
      /** On the nth resolution this turn, run `do` instead of the base `do`. */
      whenResolvedNth?: { nth: number; do: CardInstruction[] }
    }
  | { op: 'modal'; choose: 'one' | 'any'; modes: ModalMode[] }
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
        | { filter: TargetFilter }
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
      filter: TargetFilter
      kickedFilter?: TargetFilter
      action: 'destroy' | 'exile' | 'bounce' | 'counter' | 'copy' | 'reanimate' | 'select'
      do?: CardInstruction[]
    }
  | { op: 'mana'; if: CardCondition }
  | {
      op: 'manaCapability'
      from: 'opponentsLands' | 'controlledLands'
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
      grantRetrace?: {
        nonlandPermanent?: boolean
        duringYourTurn?: boolean
        other?: boolean
      }
      /** Release linked exiles when this permanent leaves the battlefield (not a triggered ability). */
      linkedExileUntilLeaves?: { returnTo?: 'battlefield' | 'hand' }
    }
  | { op: 'handler'; pluginId: string }
  | {
      op: 'castCost'
      convoke?: boolean
      lifeX?: boolean
      xMana?: 'generic' | 'black'
      timing?: 'yourEndStep'
      kicker?: string
      gift?: GiftSpec
      spree?: SpreeMode[]
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
    }
  | { op: 'spellTrait'; uncounterable?: boolean }
  | {
      op: 'vote'
      prompt: string
      filter: TargetFilter
      outcome: 'exile-most'
    }
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
