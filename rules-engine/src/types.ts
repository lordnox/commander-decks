export type PlayerId = string

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
export type TargetRef =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'object'; objectId: string }

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

export type StackItem = {
  id: string
  kind: 'spell' | 'ability'
  objectId: string
  controller: PlayerId
  name: string
  targets: TargetRef[]
}

export type RuleInstance = {
  instanceId: string
  pluginId: string
  sourceId: string | null
  timestamp: number
  params: Record<string, unknown>
}

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

export type GameState = {
  format: string
  playerOrder: PlayerId[]
  castableZones: ZoneId[]
  players: Record<PlayerId, PlayerState>
  objects: Record<string, GameObject>
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
