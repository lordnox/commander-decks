export const SEAT_IDS = ['p1', 'p2', 'p3', 'p4'] as const
export type SeatId = (typeof SEAT_IDS)[number]

export type ZoneId =
  | 'battlefield'
  | 'stack'
  | 'hand'
  | 'library'
  | 'graveyard'
  | 'exile'
  | 'command'

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

export type ManaId = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

export type ManaPool = Record<ManaId, number>

export type GameObject = {
  id: string
  name: string
  owner: SeatId
  controller: SeatId
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
  attacking: SeatId | null
  blocking: string | null
  grantedRules: string[]
  token: boolean
  commander: boolean
  tapProduces?: Partial<ManaPool>
}

export type StackItem = {
  id: string
  kind: 'spell' | 'ability'
  objectId: string
  controller: SeatId
  name: string
  targets: string[]
}

export type RuleInstance = {
  instanceId: string
  pluginId: string
  sourceId: string | null
  timestamp: number
  params: Record<string, unknown>
}

export type PlayerState = {
  id: SeatId
  life: number
  poison: number
  commanderDamage: Record<string, number>
  commanderTax: number
  mana: ManaPool
  lost: boolean
  landsPlayed: number
  landPlaysAllowed: number
}

export type GameState = {
  players: Record<SeatId, PlayerState>
  objects: Record<string, GameObject>
  stack: StackItem[]
  active: SeatId
  priority: SeatId | null
  turn: number
  step: StepId
  passedInRow: SeatId[]
  rules: RuleInstance[]
  nextId: number
  nextTimestamp: number
  ended: boolean
  prevented?: boolean
  log: string[]
}

export type AttackerDecl = { objectId: string; defender: SeatId }
export type BlockerDecl = { blockerId: string; attackerId: string }

export type GameEvent =
  | { type: 'passPriority'; seat: SeatId }
  | { type: 'playLand'; seat: SeatId; objectId: string }
  | { type: 'tapForMana'; seat: SeatId; objectId: string }
  | { type: 'addMana'; seat: SeatId; mana: Partial<ManaPool> }
  | { type: 'emptyManaPools' }
  | { type: 'castSpell'; seat: SeatId; objectId: string; targets?: string[] }
  | { type: 'resolveTop' }
  | { type: 'declareAttackers'; seat: SeatId; attackers: AttackerDecl[] }
  | { type: 'declareBlockers'; seat: SeatId; blockers: BlockerDecl[] }
  | { type: 'assignCombatDamage' }
  | {
      type: 'dealDamage'
      sourceId: string
      target: SeatId | string
      amount: number
      combat?: boolean
      commander?: boolean
    }
  | { type: 'loseLife'; seat: SeatId; amount: number; source?: string }
  | { type: 'move'; objectId: string; to: ZoneId }
  | { type: 'tap'; objectId: string }
  | { type: 'untap'; objectId: string }
  | { type: 'advanceStep' }
  | { type: 'draw'; seat: SeatId; count?: number }
  | { type: 'concede'; seat: SeatId }
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
  | { type: 'custom'; name: string; seat?: SeatId; payload?: Record<string, unknown> }

export type ReduceOk = { ok: true; state: GameState; prevented?: boolean }
export type ReduceErr = { ok: false; error: string; state: GameState }
export type ReduceResult = ReduceOk | ReduceErr

export type HookCtx = {
  state: GameState
  event: GameEvent
  draft: import('./draft').Draft
  rule: RuleInstance
  catalog: import('./catalog').PluginCatalog
}

export type Plugin = {
  id: string
  legal?: (ctx: HookCtx) => string | void
  replace?: (ctx: HookCtx) => GameEvent | GameEvent[] | null | undefined
  apply?: (ctx: HookCtx) => void
  sba?: (ctx: HookCtx) => GameEvent[]
}
