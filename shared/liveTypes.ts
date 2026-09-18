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
  'sacrifice',
  'skip',
] as const

export type TopdeckDestination = (typeof TOPDECK_DESTINATIONS)[number]

export type TopdeckRequirements = Partial<Record<
  TopdeckDestination,
  { min?: number; max?: number }
>>

export type CardRef = string | number

/** Per-seat board state shared between live wire seats and replay player state. */
export type LiveSeatSnapshot<
  TBattlefield = CardRef,
  TExile = CardRef,
> = {
  life: number
  poison?: number
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
