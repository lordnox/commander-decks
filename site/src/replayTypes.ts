import type { CardRef, LiveSeatSnapshot } from '../../shared/liveTypes'

export type CardFace = {
  name: string
  image_small: string
  image_normal: string
  type_line: string
  mana_cost: string
  oracle_text: string
  stats: string
}

export type CardDetails = {
  id?: string
  scryfall_uri?: string
  image_small?: string
  image_normal?: string
  type_line?: string
  mana_cost?: string
  oracle_text?: string
  stats?: string
  faces?: CardFace[]
}

export type BattlefieldCard = {
  /** Omitted only for a face-down hand slot. */
  name?: string | number
  tapped?: boolean
  summoningSickness?: boolean
  token?: boolean
  token_id?: string | null
  pt?: string
  commander?: boolean
  counters?: Record<string, number>
  note?: string
  face?: string | number
  /** Card this permanent is printed as, when a copy effect renamed it. */
  printed_name?: string
  /** Seat name this creature is attacking. */
  attacking?: string
  /** Card name this creature is blocking. */
  blocking?: string
  objectId?: string
  /** Face-down hand slot visible to opponents without naming the card. */
  hidden?: boolean
}

export type PlayerState = LiveSeatSnapshot<
  BattlefieldCard,
  CardRef | BattlefieldCard
> & {
  hand: Array<CardRef>
}

export type ReplaySeat = {
  id: string
  name: string
  deck: string
  commanders: string[]
  plan: string
  mulligans: number
  color: string
}

export type ReplayReference = {
  kind: 'player' | 'card' | 'deal'
  name?: string
  seat?: string
  commander?: number
  from?: number
  to?: number[]
  terms?: string
  if_refused?: string
  expires?: string
}

export type ReplayDecision = {
  open_mana?: number
  available?: Array<string | number>
  held?: Array<string | number>
  held_for?: string
  play_later?: string
  reason?: string
  honors_deal?: number
}

export type ReplayPlan = {
  scope: 'game' | 'turn' | 'impact'
  status?: 'set' | 'kept' | 'revised'
  summary: string
  details?: string
  steps?: string[]
}

export type CombatAttacker = {
  card: string | number
  defender: string | number
  pt?: string
  tapped?: boolean
  keywords?: string[]
}

export type CombatBlock = {
  attacker: string | number
  blockers: Array<string | number>
}

export type ReplayCombat = {
  step?: 'attackers' | 'blockers' | 'first_strike_damage' | 'combat_damage'
  attackers?: CombatAttacker[]
  possible_blockers?: Record<string, Array<string | number>>
  blocks?: CombatBlock[]
  unblocked?: Array<string | number>
}

export type ReplayDamage = {
  source: string | number
  target: string | number
  amount: number
  type: 'combat' | 'noncombat'
  commander?: boolean
  keyword?: string
}

export type ReplayEvent = {
  id: number
  turn: number
  phase: string
  seat: string | null
  kind: string
  summary: string
  cards?: Array<string | number>
  notes?: string
  combat?: ReplayCombat
  damage?: ReplayDamage[]
  decision?: ReplayDecision
  plan?: ReplayPlan
  deal?: {
    id: number
    action: string
  }
  state: {
    active: string
    turn: number
    phase: string
    stack: Array<{
      name: string | number
      kind?: 'spell' | 'trigger' | 'ability' | 'action'
      controller?: string
      text?: string
      waiting?: 'choice' | 'targets' | null
    }>
    deals?: Array<{
      id: number
      status: string
      offered_event?: number
      resolved_event?: number
    }>
    players: Record<string, PlayerState>
  }
}

export type ReplayGame = {
  schema: number
  planning?: number
  played_at?: string
  seed: number
  starting_life: number
  headline: string
  result: {
    winner: string | null
    ended: 'win' | 'draw' | 'truncated'
    turn: number
    summary: string
  }
  seats: ReplaySeat[]
  references?: ReplayReference[]
  catalog: Record<string, CardDetails>
  tokens?: Record<string, CardDetails>
  events: ReplayEvent[]
}
