import type {
  InteractionCancellation,
  InteractionPhase,
  InteractionPurpose,
  InteractionRequest,
} from './interaction'

/**
 * The parser checks incoming choices against this list, so a destination that
 * exists only in the type is dropped as an invalid message.
 */
export const TOPDECK_DESTINATIONS = [
  'top',
  'bottom',
  'graveyard',
  'hand',
  'exile',
  'battlefield',
  'library',
  'target',
  'reveal',
  'sacrifice',
  'skip',
  'face-up',
  'face-down',
] as const

export type TopdeckDestination = (typeof TOPDECK_DESTINATIONS)[number]

export type TopdeckRequirements = Partial<Record<
  TopdeckDestination,
  { min?: number; max?: number }
>>

/** Request identity and offer metadata shared by browser, headless, and host snapshots. */
export type LiveInteractionMetadata = {
  requestId?: string
  revision?: number
  phase?: InteractionPhase
  purpose?: InteractionPurpose
  cancellation?: InteractionCancellation
  interaction?: InteractionRequest
}

/**
 * Offered cards may share a name (two Forests, one per controller). Each
 * duplicate gets its position among its namesakes so the player can tell the
 * choices apart and the prompt can describe them; unique names stay as they are.
 */
export const distinctCardLabels = (names: string[]) => {
  const totals = new Map<string, number>()
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return names.map((name) => {
    if ((totals.get(name) ?? 0) < 2) return name
    const nth = (seen.get(name) ?? 0) + 1
    seen.set(name, nth)
    return `${name} #${nth}`
  })
}

export type CardRef = string | number

/** Per-seat board state shared between live wire seats and replay player state. */
export type LiveSeatSnapshot<
  TBattlefield = CardRef,
  TExile = CardRef,
> = {
  life: number
  poison?: number
  energy?: number
  commander_damage?: Record<string, number>
  commander_tax?: number
  /** Floating mana, by symbol. Absent whenever the pool is empty. */
  mana?: Record<string, number>
  library_count: number
  hand_count?: number
  hand?: Array<CardRef>
  /** Opponent hand cards everyone may see (subset of hand_count). */
  known_hand?: Array<CardRef>
  battlefield: TBattlefield[]
  graveyard: Array<CardRef>
  exile: Array<TExile>
  command: Array<CardRef>
  revealed_top?: Array<CardRef>
}
