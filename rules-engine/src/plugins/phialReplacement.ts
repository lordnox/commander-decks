import type { Plugin } from '../types'

export const phialReplacement: Plugin = {
  id: 'phialReplacement',
  replace: ({ state, event, rule }) => {
    const source = rule.sourceId ? state.objects[rule.sourceId] : undefined
    if (!source || source.zone !== 'battlefield') return
    const seat = source.controller
    if (
      event.type === 'draw'
      && event.seat === seat
      && (event.count ?? 1) === 1
      && state.zoneOrder[seat].hand.length === 0
      && !event.replacedBy?.includes(rule.instanceId)
    ) {
      return {
        ...event,
        count: 2,
        replacedBy: [...(event.replacedBy ?? []), rule.instanceId],
      }
    }
    if (
      event.type === 'gainLife'
      && event.seat === seat
      && state.players[seat].life <= 5
    ) {
      return { ...event, amount: event.amount * 2 }
    }
  },
}
