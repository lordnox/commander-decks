import type { GameEvent, HookCtx, Plugin } from '../types'

const MAX_EFFECTS = 32
const FORBIDDEN_EFFECTS = new Set<GameEvent['type']>([
  'judgeFallback',
  'authoritativeSync',
  'addRule',
  'removeRule',
])

const legal = ({ state, event }: HookCtx) => {
  if (event.type !== 'judgeFallback') return
  if (!state.players[event.seat]) return 'fallback seat is not in the game'
  if (!event.reason.trim()) return 'fallback reason is required'
  if (!event.source.trim()) return 'fallback source is required'
  if (event.effects.length < 1 || event.effects.length > MAX_EFFECTS) {
    return `fallback must contain 1-${MAX_EFFECTS} primitive effects`
  }
  const forbidden = event.effects.find((effect) => FORBIDDEN_EFFECTS.has(effect.type))
  if (forbidden) return `fallback cannot contain ${forbidden.type}`
}

const apply = ({ event, draft }: HookCtx) => {
  if (event.type !== 'judgeFallback') return
  draft.note(`judge fallback for ${event.source}: ${event.reason}`)
  for (const effect of event.effects) draft.enqueue(effect)
}

export const judgeFallback: Plugin = {
  id: 'judgeFallback',
  legal,
  apply,
}
