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

/** Per-color mana in a player's pool. */
export type ManaPool = Record<ManaId, number>

/** Spell or ability target. Player targets use seat ids; object targets use object ids. */
export type TargetRef =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'object'; objectId: string }

/**
 * One card or token in the game. Identity is `id`; `name` is Oracle for fixtures.
 * Zone membership is duplicated in `zone` and in the owner's `zoneOrder` lists.
 */
export type GameObject = {
  /** Stable object identity for moves, damage, and targeting. */
  id: string
  /** Oracle card name for fixtures and logging. */
  name: string
  /** Owner seat; does not change when control changes. */
  owner: PlayerId
  /** Seat that currently controls this object. */
  controller: PlayerId
  /** Current zone; mirrored in `zoneOrder` for that owner. */
  zone: ZoneId
  /** Whether the permanent is tapped. */
  tapped: boolean
  /** Summoning sickness until controller's next untap step. */
  summoningSickness: boolean
  /** Damage marked on this permanent this turn. */
  damageMarked: number
  /** Dealt damage by a deathtouch source this turn, so any of it is lethal. */
  deathtouched?: boolean
  /** Named counter buckets (for example `+1/+1`). */
  counters: Record<string, number>
  /** Card types (Creature, Land, …). */
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
  frontFace?: {
    types: string[]
    subtypes: string[]
    supertypes: string[]
    manaCost: string
    manaValue: number
    colors: string[]
  }
  power: number | null
  toughness: number | null
  printedLoyalty: number | null
  loyaltyActivatedTurn: number | null
  oracleText: string
  attachedTo: string | null
  attacking: TargetRef | PlayerId | null
  blocking: string | null
  /** Plugin ids installed while this object is on the battlefield. */
  grantedRules: string[]
  token: boolean
  /** Format roles such as `commander`. */
  tags: string[]
  /** Mana ability output when this permanent is tapped for mana. */
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
}

/**
 * One spell, triggered/activated ability, or action waiting to resolve on the stack.
 * The source card may stay `zone: 'stack'` while this item is in `state.stack`.
 * **`id` is allocated once** (via `draft.allocId('stack')`) and never regenerated —
 * stable for `continueAction`, replay, and client round-trips.
 */
export type StackItem = {
  /** Stable stack identity; never changes after `addToStack`. */
  id: string
  /** Spell from casting, ability from triggering/activating, or action from resolution. */
  kind: 'spell' | 'ability' | 'action'
  /** Source object id (spell/ability) or contextual id for actions. */
  objectId: string
  /** Seat that controls this stack item. */
  controller: PlayerId
  /** Display name (usually the source card). */
  name: string
  /** Targets chosen at cast or activation. */
  targets: TargetRef[]
  /** Activated or triggered ability id from card rules. */
  abilityId?: string
  /** Chosen X value for spells and abilities. */
  x?: number
  /** Modal or other string choices made at activation. */
  choices?: string[]
  /** Whether this spell was kicked. */
  kicked?: boolean
  /** Number of additional sacrifices paid for this cast. */
  sacrificed?: number
  /** Zone the spell was cast from. */
  castFrom?: ZoneId
  /**
   * Builtin action kind when `kind === 'action'`
   * (for example `'discard'`, `'draw'`, `'chooseTargets'`).
   */
  actionId?: string
  /**
   * Client must supply input before this action continues resolving.
   * `null` or omitted means not waiting.
   */
  waiting?: 'choice' | 'targets' | null
  /**
   * Action parameters and in-flight resolution state
   * (seat, count, filter, chosen ids, or `{ instructions }` for abilities).
   */
  payload?: Record<string, unknown>
}

/**
 * A live plugin binding. Catalog entries are code; these instances are state.
 * Card rules set `sourceId` to the permanent that granted them.
 */
export type RuleInstance = {
  /** Unique instance id for `removeRule`. */
  instanceId: string
  /** Catalog plugin id. */
  pluginId: string
  /** Permanent that installed this rule, or `null` for builtin game rules. */
  sourceId: string | null
  /** Orders replace/legal/apply when multiple rules react. */
  timestamp: number
  /** Plugin-specific configuration. */
  params: Record<string, unknown>
}

/**
 * Per-seat totals the kernel always knows. Format extras (commander tax,
 * commander damage) live in untyped `data`, keyed however that format chooses.
 */
export type PlayerState = {
  /** Seat id matching `GameState.playerOrder`. */
  id: PlayerId
  /** Current life total. */
  life: number
  /** Poison counters. */
  poison: number
  /** Mana currently in the pool. */
  mana: ManaPool
  /** True once this player has lost the game. */
  lost: boolean
  /** Lands played this turn. */
  landsPlayed: number
  /** Maximum land plays allowed this turn. */
  landPlaysAllowed: number
  /** Format-specific per-player data (commander tax, damage dealt, …). */
  data: Record<string, unknown>
}

/**
 * Frozen game snapshot returned by `rules(state, event)`.
 * History is not stored here; use `createHistory` for before/after trees.
 */
export type GameState = {
  /** Format id from `GameFormat`. */
  format: string
  /** Hidden-information profile: authoritative server vs viewer replica. */
  knowledge: {
    mode: 'authoritative' | 'replica'
    viewer: PlayerId | null
  }
  /** Turn and priority order. */
  playerOrder: PlayerId[]
  /** Zones from which spells may be cast. */
  castableZones: ZoneId[]
  /** Per-seat public and hidden totals. */
  players: Record<PlayerId, PlayerState>
  /** All game objects by id. */
  objects: Record<string, GameObject>
  /** Ordered object ids per seat and zone (authoritative only). */
  zoneOrder: Record<PlayerId, Record<ZoneId, string[]>>
  /** Public zone sizes when identities are redacted. */
  zoneCounts: Record<PlayerId, Record<ZoneId, number>>
  /** LIFO stack of spells, abilities, and actions waiting to resolve. */
  stack: StackItem[]
  /** Seat whose turn it is (CR 500.4). */
  active: PlayerId
  /** Seat that may act next in the priority window, or `null` between steps. */
  priority: PlayerId | null
  /** Player-turn counter (not table rounds). */
  turn: number
  /** Current step within the active player's turn. */
  step: StepId
  /** Seats that passed priority in the current window without acting. */
  passedInRow: PlayerId[]
  /** Active plugin instances in timestamp order. */
  rules: RuleInstance[]
  /** Monotonic id allocator for objects, stack items, etc. */
  nextId: number
  /** Monotonic timestamp allocator for new rules. */
  nextTimestamp: number
  /** True when the game has ended. */
  ended: boolean
  /** Set when a replacement effect prevented the current event. */
  prevented?: boolean
  /** Human-readable apply trace for this reduce. */
  log: string[]
}

export type AttackerDecl = { objectId: string; defender: TargetRef | PlayerId }
export type BlockerDecl = { blockerId: string; attackerId: string }

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
  /** `GameEvent.type` to listen for (for example `'discard'`, `'draw'`). */
  on: string
  /** Optional filter on the triggering event and seats. */
  if?: TriggerBindingIf
  /** Instructions executed when the triggered ability resolves. */
  do: CardInstruction[]
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
      x?: number
      sacrifice?: string[]
    }
  | {
      type: 'move'
      objectId: string
      to: ZoneId
      position?: 'top' | 'bottom'
      controller?: PlayerId
    }
  | { type: 'tap'; objectId: string }
  | { type: 'untap'; objectId: string }
  // — CR keyword actions —
  | { type: 'draw'; seat: PlayerId; count?: number }
  | { type: 'discard'; seat: PlayerId; objectId: string }
  | { type: 'shuffleLibrary'; seat: PlayerId }
  | { type: 'reveal'; seat: PlayerId; objectIds: string[]; source?: string }
  // — Mana —
  | { type: 'tapForMana'; seat: PlayerId; objectId: string; mana?: ManaId }
  | { type: 'addMana'; seat: PlayerId; mana: Partial<ManaPool> }
  | { type: 'payMana'; seat: PlayerId; cost: string }
  | { type: 'emptyManaPools' }
  // — Combat & damage —
  | { type: 'declareAttackers'; seat: PlayerId; attackers: AttackerDecl[] }
  | { type: 'declareBlockers'; seat: PlayerId; blockers: BlockerDecl[] }
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
    }
  | { type: 'loseLife'; seat: PlayerId; amount: number; source?: string }
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

/** One line in the event-centric reduce trace. */
export type EventTrace = {
  /** Nesting depth for enqueued and replacement events. */
  depth: number
  /** Event that was processed at this trace line. */
  event: GameEvent
  /** How the kernel finished this event. */
  outcome: 'applied' | 'replaced' | 'prevented' | 'rejected'
  /** Plugin that replaced or rejected, when applicable. */
  pluginId?: string
  /** Error message when `outcome` is `rejected`. */
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
/** Result of `rules(state, event)`. */
export type ReduceResult = ReduceOk | ReduceErr

/**
 * Plugin hook argument. `state` is the frozen pre-event snapshot.
 * `draft` is the mutable next state (cloned GameState plus enqueue helpers).
 */
export type HookCtx = {
  /** Immutable game snapshot before this event is applied. */
  state: GameState
  /** Event currently being reduced. */
  event: GameEvent
  /** Mutable working copy of the next state. */
  draft: Draft
  /** Rule instance invoking this hook. */
  rule: RuleInstance
  /** Lookup for plugin implementations by id. */
  catalog: PluginCatalog
}

/**
 * Catalog code registered for one `pluginId`.
 * Hooks receive `HookCtx`; only handle events they care about.
 */
export type Plugin = {
  /** Unique plugin id referenced by `RuleInstance.pluginId`. */
  id: string
  /** Return an error string to reject the incoming event before apply. */
  legal?: (ctx: HookCtx) => string | void
  /**
   * Rewrite or prevent the event before apply.
   * `null` prevents; an array folds left-to-right through `rules`.
   */
  replace?: (ctx: HookCtx) => GameEvent | GameEvent[] | null | undefined
  /** Mutate `draft` to apply the event. */
  apply?: (ctx: HookCtx) => void
  /** Emit state-based-action follow-up events after apply. */
  sba?: (ctx: HookCtx) => GameEvent[]
}
