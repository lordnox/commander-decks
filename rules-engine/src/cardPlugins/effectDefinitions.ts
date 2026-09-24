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
  | { kind: 'stackXAtLeast'; min: number }

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
}

export type RevealUntilNonMatch = 'mill' | 'shuffle'

export type CardInstruction =
  | { kind: 'selfMill'; count: number }
  | { kind: 'millTarget'; count: number }
  | { kind: 'bounceSelf' }
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
  | { kind: 'addManaToEachPlayer'; mana: Partial<ManaPool> }
  /** `seat` names a drawer other than the controller, snapshot when the instruction is built. */
  | { kind: 'draw'; count: number; seat?: PlayerId; who?: 'controller' | 'triggeringPlayer' }
  | { kind: 'discardCards'; count: number; who?: 'controller' | 'target' }
  | { kind: 'gainLife'; count: number | 'triggerAmount' }
  | { kind: 'drainOpponentsX'; multiplier: number }
  | { kind: 'drawX' }
  | { kind: 'dealDamageTargetX' }
  | { kind: 'setAllLifeToLowest' }
  | { kind: 'gainLifeLostThisTurn'; who: 'controller' | 'all' }
  | { kind: 'exchangeLifeWithOpponent'; optional?: boolean; drawLifeLost?: boolean }
  | { kind: 'drawHandDifference' }
  | { kind: 'winGame' }
  | { kind: 'addPlusCounters'; count: number }
  | { kind: 'putChargeCountersFromTimesKicked' }
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
  | { kind: 'returnSelfAsEnchantment' }
  | { kind: 'createToken'; token: TokenSpec }
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
  | { kind: 'surveil'; count: number }
  | { kind: 'scry'; count: number }
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
  | { kind: 'addChosenColorMana' }
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
      to?: 'hand' | 'battlefield'
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
  | { kind: 'tapAll'; filter: TargetFilter }
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
        | 'becomesMonstrous'
        | 'tapped'
        | 'gainLife'
        | 'playerAttacks'
      do: CardInstruction[]
      if?: CardCondition | TriggerBindingIf
      creatureOnly?: boolean
      modal?: ModalSpec
      targets?: 'opponent' | 'player' | {
        filter: TargetFilter
        min?: 0 | 1
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
      filter: TargetFilter
      kickedFilter?: TargetFilter
      action: 'destroy' | 'exile' | 'bounce' | 'counter' | 'copy' | 'reanimate' | 'select' | 'libraryBottom'
      do?: CardInstruction[]
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
      grantRetrace?: {
        nonlandPermanent?: boolean
        duringYourTurn?: boolean
        other?: boolean
      }
      /** Release linked exiles when this permanent leaves the battlefield (not a triggered ability). */
      linkedExileUntilLeaves?: { returnTo?: 'battlefield' | 'hand' }
      ptEqualsLife?: { who: 'controller' | 'owner' }
      grantControlledSubtypeTrigger?: {
        subtype: string
        on: Extract<CardEffect, { op: 'trigger' }>['on']
        do: CardInstruction[]
      }
      pumpPerLinkedExile?: { power: number; toughness: number }
      ward?: { mana?: number; sacrifice?: { count: number; nonland?: boolean } }
      exileOpponentGraveyard?: boolean
      playExiledWithLife?: boolean
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
