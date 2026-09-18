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
  grantedRules: string[]
  token: boolean
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
  /** Seats that may see this card's face while it is in a hidden zone. */
  knownTo?: PlayerId[]
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
  kicked?: boolean
  sacrificed?: number
  castFrom?: ZoneId
  /** Builtin action kind when `kind === 'action'` (for example `'discard'`, `'draw'`). */
  actionId?: string
  /** Client input required before resolution continues; omitted when not waiting. */
  waiting?: 'choice' | 'targets' | null
  /** Action parameters and in-flight resolution state. */
  payload?: Record<string, unknown>
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
  | {
      type: 'selectCards'
      /** Seat making the choice. */
      seat: PlayerId
      kind: 'discard' | 'scry' | 'surveil'
      count: number
      objectIds: string[]
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
