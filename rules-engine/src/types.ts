import type PluginCatalog from './catalog'
import type Draft from './draft'

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
  counters: Record<string, number>
  types: string[]
  subtypes: string[]
  supertypes: string[]
  manaCost: string
  power: number | null
  toughness: number | null
  oracleText: string
  attachedTo: string | null
  attacking: PlayerId | null
  blocking: string | null
  grantedRules: string[]
  token: boolean
  tags: string[]
  tapProduces?: Partial<ManaPool>
}

/**
 * One object waiting to resolve. The card itself stays `zone: 'stack'` while
 * this item is in `state.stack`. Instants and sorceries leave the stack array
 * at `resolveTop` but stay in the stack zone until their finishing `move`.
 */
export type StackItem = {
  id: string
  kind: 'spell' | 'ability'
  objectId: string
  controller: PlayerId
  name: string
  targets: TargetRef[]
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

export type AttackerDecl = { objectId: string; defender: PlayerId }
export type BlockerDecl = { blockerId: string; attackerId: string }

/**
 * Input to `rules(state, event)`. Plugins ignore types they do not handle.
 * Replacement can rewrite one event, split it into an array, or return `null`
 * to prevent it. Apply may `draft.enqueue` follow-up events that drain after.
 *
 * Damage is a chain: `assignCombatDamage` → `combatDamage` → `dealDamage` →
 * `loseLife`. Fog prevents at `combatDamage`; "prevent damage" at `dealDamage`.
 * Instant/sorcery instructions enqueue, then enqueue `move` to the graveyard.
 */
export type GameEvent =
  | { type: 'passPriority'; seat: PlayerId }
  | { type: 'playLand'; seat: PlayerId; objectId: string }
  | { type: 'tapForMana'; seat: PlayerId; objectId: string }
  | { type: 'addMana'; seat: PlayerId; mana: Partial<ManaPool> }
  | { type: 'emptyManaPools' }
  | {
      type: 'castSpell'
      seat: PlayerId
      objectId: string
      targets?: TargetRef[]
      additionalGeneric?: number
    }
  | { type: 'resolveTop' }
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
  | { type: 'move'; objectId: string; to: ZoneId }
  | { type: 'tap'; objectId: string }
  | { type: 'untap'; objectId: string }
  | { type: 'advanceStep' }
  | { type: 'draw'; seat: PlayerId; count?: number }
  | { type: 'shuffleLibrary'; seat: PlayerId }
  | { type: 'authoritativeSync'; snapshot: GameState }
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
  | { type: 'custom'; name: string; seat?: PlayerId; payload?: Record<string, unknown> }

/** Successful reduce. `prevented` means a replacement returned `null`. */
export type ReduceOk = { ok: true; state: GameState; prevented?: boolean }
/** Failed reduce. `state` is the unchanged input. */
export type ReduceErr = { ok: false; error: string; state: GameState }
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
