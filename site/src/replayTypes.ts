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
  name: string | number
  tapped?: boolean
  token?: boolean
  token_id?: string | null
  pt?: string
  commander?: boolean
  counters?: Record<string, number>
  note?: string
  face?: string | number
}

export type PlayerState = {
  life: number
  poison?: number
  commander_damage?: Record<string, number>
  commander_tax?: number
  library_count: number
  hand: Array<string | number>
  battlefield: BattlefieldCard[]
  graveyard: Array<string | number>
  exile: Array<string | number>
  command: Array<string | number>
  revealed_top?: Array<string | number>
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

export type ReplayEvent = {
  id: number
  turn: number
  phase: string
  seat: string | null
  kind: string
  summary: string
  cards?: Array<string | number>
  notes?: string
  decision?: ReplayDecision
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
      controller?: string
      text?: string
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
