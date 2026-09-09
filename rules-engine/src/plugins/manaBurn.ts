import { emptyMana, poolTotal } from '../draft'
import type { GameEvent, GameState, Plugin, RuleInstance } from '../types'

const PLUGIN_ID = 'manaBurn'

/** Several sources may grant mana burn; only the oldest instance applies it. */
const isPrimary = (state: GameState, rule: RuleInstance) => {
  const instances = state.rules
    .filter((other) => other.pluginId === PLUGIN_ID)
    .sort((a, b) => a.timestamp - b.timestamp)
  return instances[0]?.instanceId === rule.instanceId
}

const replace: Plugin['replace'] = ({ state, event, rule }) => {
  if (event.type !== 'emptyManaPools') return
  if (!isPrimary(state, rule)) return
  const burns: GameEvent[] = Object.values(state.players)
    .filter((player) => !player.lost && poolTotal(player.mana) > 0)
    .map((player) => ({
      type: 'loseLife',
      seat: player.id,
      amount: poolTotal(player.mana),
      source: PLUGIN_ID,
    }))
  return [...burns, { type: 'custom', name: 'clearMana' }]
}

const apply: Plugin['apply'] = ({ event, draft, rule }) => {
  if (!isPrimary(draft, rule)) return
  if (event.type === 'loseLife') {
    const player = draft.players[event.seat]
    player.life -= event.amount
    if (player.life <= 0) player.lost = true
    draft.note(`${event.seat} loses ${event.amount} life${event.source ? ` (${event.source})` : ''}`)
    return
  }
  if (event.type === 'custom' && event.name === 'clearMana') {
    for (const player of Object.values(draft.players)) player.mana = emptyMana()
    draft.note('mana pools empty')
  }
}

export const manaBurn: Plugin = { id: PLUGIN_ID, replace, apply }
