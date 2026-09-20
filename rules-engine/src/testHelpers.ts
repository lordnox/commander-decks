import type {
  GameEvent,
  GameState,
  ReduceResult,
  RoomDoorCharacteristics,
} from './types'

export const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

export const roomDoor = (
  name: string,
  manaCost: string,
  extra: Partial<RoomDoorCharacteristics> = {},
): RoomDoorCharacteristics => ({
  name,
  types: ['Enchantment'],
  subtypes: ['Room'],
  supertypes: [],
  manaCost,
  manaValue: [...manaCost.matchAll(/\{(\d+|[WUBRGC])\}/g)]
    .reduce((total, match) => total + (/^\d+$/.test(match[1]) ? Number(match[1]) : 1), 0),
  colors: [...new Set([...manaCost.matchAll(/[WUBRG]/g)].map((match) => match[0]))],
  oracleText: '',
  ...extra,
})

export const resolveStack = (
  rules: (state: GameState, event: GameEvent) => ReduceResult,
  state: GameState,
) => {
  let current = state
  while (current.stack.length > 0 && !current.stack[0].waiting) {
    current = ok(rules(current, { type: 'resolveTop' }))
  }
  return current
}
