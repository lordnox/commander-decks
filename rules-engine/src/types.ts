import type PluginCatalog from './catalog'
import type Draft from './draft'
import type { CardInstruction } from './cardPlugins/effects'

/** Seat key. Arbitrary string; generated games use `p1`…`pN`. */
export type PlayerId = string

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
export type StepId =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'precombatMain'
  | 'beginCombat'
  | 'declareAttackers'
  | 'declareBlockers'
  | 'firstStrikeDamage'
  | 'combatDamage'
  | 'endCombat'
  | 'postcombatMain'
  | 'end'
  | 'cleanup'

/** WUBRG plus colorless `{C}`. Generic `{N}` is paid from leftover pool, not stored as `C`. */
export type ManaId = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

export type ManaPool = Record<ManaId, number>

export type FaceCharacteristics = {
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
  effects?: import('./cardPlugins/effects').CardEffect[]
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
}

export type ReversibleEffect =
  | { kind: 'pump'; power: number; toughness: number }
  | {
      kind: 'animation'
      before: { types: string[]; power: number | null; toughness: number | null }
      after: { types: string[]; power: number; toughness: number }
    }
  | { kind: 'oracleLine'; line: string }
  | { kind: 'typeChange'; before: string[]; after: string[] }
  | { kind: 'copy'; before: CopySnapshot; after: CopySnapshot }
  | { kind: 'controller'; controller: PlayerId; base: PlayerId }

export type EffectDuration =
  | { kind: 'untilCleanup' }
  | { kind: 'whileSourceOnBattlefield'; sourceId: string }
  | { kind: 'whileSourceTappedAndPowerAtMost'; sourceId: string }

export type ContinuousEffect = {
  effect: ReversibleEffect
  duration: EffectDuration
}

/** Spell or ability target. Player targets use seat ids; object targets use object ids. */
export type TargetRef =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'object'; objectId: string }

/**
 * One card or token in the game. Identity is `id`; `name` is Oracle for fixtures.
 * Zone membership is duplicated in `zone` and in the owner's `zoneOrder` lists.
 * `grantedRules` are plugin ids installed while this object is on the battlefield.
 * `tags` carry format roles such as `commander`. `tapProduces` is the mana ability.
 */
export type GameObject = {
  id: string
  name: string
  owner: PlayerId
  controller: PlayerId
  zone: ZoneId
  tapped: boolean
  summoningSickness: boolean
  damageMarked: number
  /** Dealt damage by a deathtouch source this turn, so any of it is lethal. */
  deathtouched?: boolean
  counters: Record<string, number>
  types: string[]
  subtypes: string[]
  supertypes: string[]
  manaCost: string
  manaValue: number
  colors: string[]
  /**
   * Printed characteristics of the front face. In the library, only this face
   * exists for a transforming or modal double-faced card (CR 712.8a).
   */
  frontFace?: FaceCharacteristics
  /** Printed characteristics of the second face of a double-faced card. */
  backFace?: FaceCharacteristics
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
  attachedTo: string | null
  attacking: TargetRef | PlayerId | null
  blocking: string | null
  grantedRules: string[]
  token: boolean
  /** A copy of a spell that ceases to exist after leaving the stack. */
  spellCopy?: boolean
  tags: string[]
  tapProduces?: Partial<ManaPool>
  /** Chosen creature type, for example Roaming Throne. */
  chosenType?: string
  /** The card this permanent is printed as, once a copy effect renamed it. */
  printedName?: string
  /** Object ids currently linked to this permanent by an "exiled with" ability. */
  exiledCards?: string[]
  /** Object id of the permanent whose ability exiled this card. */
  exiledWith?: string
  /** Stamped from the name-keyed card-rule table when the object is created. */
  effects?: import('./cardPlugins/effects').CardEffect[]
  /** Alternative casting option used for the current battlefield entry. */
  enteredWithCastOption?: string
  /** Turn this object most recently entered the battlefield. */
  enteredBattlefieldTurn?: number
  /** Seats that may see this card's face while it is in a hidden zone. */
  knownTo?: PlayerId[]
  continuousEffects?: ContinuousEffect[]
}

/**
 * Spell, triggered/activated ability, or action on the stack (CR 405).
 * `id` is allocated once via `draft.allocId('stack')` and never regenerated —
 * stable for `continueAction`, replay, and client round-trips.
 */
export type StackItem = {
  id: string
  kind: 'spell' | 'ability' | 'action'
  objectId: string
  controller: PlayerId
  name: string
  targets: TargetRef[]
  abilityId?: string
  x?: number
  choices?: string[]
  /** Mana actually removed from the pool while casting, by symbol. */
  manaSpent?: Partial<ManaPool>
  kicked?: boolean
  castOption?: string
  exileAfterUse?: boolean
  /** Read ahead choice carried from casting through battlefield entry. */
  sagaChapter?: number
  door?: RoomDoorId
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
  mana: ManaPool
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
export type GameState = {
  format: string
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
  delayedTriggers: DelayedTrigger[]
  active: PlayerId
  priority: PlayerId | null
  turn: number
  step: StepId
  passedInRow: PlayerId[]
  rules: RuleInstance[]
  nextId: number
  nextTimestamp: number
  ended: boolean
  prevented?: boolean
  log: string[]
}

export type AttackerDecl = { objectId: string; defender: TargetRef | PlayerId }
export type BlockerDecl = { blockerId: string; attackerId: string }
export type ManaPayment = { objectId: string; mana?: ManaId }

/**
 * Optional predicate on a declarative trigger. `seat` compares the triggering
 * event's involved seat to the trigger source's controller.
 */
export type TriggerBindingIf = {
  seat?: 'opponent' | 'controller' | 'triggeringPlayer'
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
  | { kind: 'event'; type: GameEvent['type'] }
  /** Omit `active` for "the next upkeep"; name a seat for "your next upkeep". */
  | { kind: 'step'; step: StepId; active?: PlayerId }

export type DelayedTrigger = {
  id: string
  sourceId: string
  sourceName: string
  controller: PlayerId
  condition: DelayedTriggerCondition
  instructions: CardInstruction[]
  timestamp: number
  recurring?: boolean
  payload?: Record<string, unknown>
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
  // — Priority / structure —
  | { type: 'passPriority'; seat: PlayerId }
  | { type: 'resolveTop' }
  | { type: 'advanceStep' }
  // — Zone & card motion —
  | { type: 'playLand'; seat: PlayerId; objectId: string }
  | {
      type: 'castSpell'
      seat: PlayerId
      objectId: string
      targets?: TargetRef[]
      additionalGeneric?: number
      kicked?: boolean
      castOption?: string
      phyrexianLife?: number[]
      alternativeCost?: 'withoutPayingMana'
      /** Starting lore count chosen for a Saga with read ahead. */
      sagaChapter?: number
      door?: RoomDoorId
      x?: number
      sacrifice?: string[]
      convoke?: string[]
      discard?: string[]
      copy?: boolean
      withoutPayingMana?: boolean
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
      }
    }
  | {
      type: 'searchBasicsForExiledAttackers'
      seat: PlayerId
      sourceId: string
      objectIds: string[]
    }
  | {
      type: 'move'
      objectId: string
      to: ZoneId
      position?: 'top' | 'bottom'
      controller?: PlayerId
      /** Starting lore count chosen as a Saga with read ahead enters. */
      sagaChapter?: number
    }
  | { type: 'tap'; objectId: string }
  | { type: 'untap'; objectId: string }
  | { type: 'putCounters'; objectId: string; counter: string; count: number }
  // — CR keyword actions —
  | {
      type: 'draw'
      seat: PlayerId
      count?: number
      replacedBy?: string[]
      remainingAfter?: number
    }
  | {
      type: 'beginDredgeChoice'
      seat: PlayerId
      replacedBy: string[]
      remainingAfter?: number
    }
  | { type: 'discard'; seat: PlayerId; objectId: string }
  | { type: 'shuffleLibrary'; seat: PlayerId }
  | { type: 'reveal'; seat: PlayerId; objectIds: string[]; source?: string }
  // — Mana —
  | { type: 'tapForMana'; seat: PlayerId; objectId: string; mana?: ManaId }
  | { type: 'addMana'; seat: PlayerId; mana: Partial<ManaPool> }
  | { type: 'payMana'; seat: PlayerId; cost: string }
  | {
      type: 'payExtort'
      seat: PlayerId
      triggerId: string
      mana?: 'W' | 'B'
    }
  | { type: 'emptyManaPools' }
  // — Special actions —
  | {
      type: 'unlockDoor'
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
    }
  | {
      type: 'dealDamage'
      sourceId: string
      target: TargetRef
      amount: number
      combat?: boolean
      gainLife?: { seat: PlayerId; max?: number }
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
  | { type: 'payLife'; seat: PlayerId; amount: number; source?: string }
  | { type: 'setLifeTotal'; seat: PlayerId; total: number; source?: string }
  | {
      type: 'exchangeLifeTotals'
      first: PlayerId
      second: PlayerId
      source?: string
    }
  | { type: 'winGame'; seat: PlayerId; source?: string }
  | { type: 'sacrifice'; objectId: string }
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
  | {
      type: 'vote'
      seat: PlayerId
      sourceId: string
      choice: TargetRef
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
      kind: 'choose' | 'discard' | 'sacrifice' | 'scry' | 'surveil' | 'reveal'
      count: number
      /** Cards selected from a hidden zone (discard / reveal). */
      objectIds?: string[]
      /** Ordered zone assignment for each candidate (scry / surveil). */
      choices?: Array<{
        objectId: string
        destination: 'top' | 'bottom' | 'graveyard'
      }>
    }
  | {
      type: 'selectPlayers'
      seat: PlayerId
      selectionId: string
      players: PlayerId[]
    }
  | {
      type: 'completeDelayedReturn'
      objectId: string
      seat: PlayerId
      sourceId: string
      discardCount: number
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
      x?: number
      choices?: string[]
      /** Host marks mana-ability timing. Kernel does not open that window. */
      manaAbility?: boolean
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
   * Use typed events (`continueAction`, `vote`, `searchLibrary`, …) instead.
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
  sba?: (ctx: HookCtx) => GameEvent[]
}
