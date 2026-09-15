import type { Plugin } from '../types'

const NAME = 'Analyze the Pollen'
export const ANALYZE_THE_POLLEN_SEARCH = 'analyzeThePollen.search'
export const ANALYZE_THE_POLLEN_CHOSEN = 'analyzeThePollen.chosen'

const topSpell = (state: { stack: Array<{ name: string; controller: string }> }) =>
  state.stack[0]?.name === NAME ? state.stack[0] : undefined

const awaitingSearch = (state: {
  stack: Array<{ name: string; controller: string }>
  players: Record<string, { data: Record<string, unknown> }>
}) => {
  const item = topSpell(state)
  return Boolean(item && state.players[item.controller]?.data[ANALYZE_THE_POLLEN_SEARCH] === true)
}

const searchChosen = (state: {
  stack: Array<{ name: string; controller: string }>
  players: Record<string, { data: Record<string, unknown> }>
}) => {
  const item = topSpell(state)
  return Boolean(item && state.players[item.controller]?.data[ANALYZE_THE_POLLEN_SEARCH] === 'chosen')
}

/**
 * Collect evidence is paid with ordinary exile moves plus kicked on cast.
 * Resolution searches the library, so the host must stop before resolveTop
 * chooses a hidden card.
 */
export const analyzeThePollen: Plugin = {
  id: 'analyzeThePollen',
  legal: ({ state, event }) => {
    if (event.type !== 'passPriority') return
    if (awaitingSearch(state)) {
      return 'Analyze the Pollen is waiting for a library search'
    }
  },
  replace: ({ state, event }) => {
    if (event.type !== 'resolveTop') return
    const item = topSpell(state)
    if (!item) return
    if (searchChosen(state)) return
    if (awaitingSearch(state)) return null
    return { type: 'custom', name: ANALYZE_THE_POLLEN_SEARCH, seat: item.controller }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === ANALYZE_THE_POLLEN_SEARCH) {
      if (!event.seat) return
      draft.players[event.seat].data[ANALYZE_THE_POLLEN_SEARCH] = true
      draft.note(`${event.seat} searches for Analyze the Pollen`)
      return
    }
    if (event.type === 'custom' && event.name === ANALYZE_THE_POLLEN_CHOSEN) {
      if (!event.seat) return
      draft.players[event.seat].data[ANALYZE_THE_POLLEN_SEARCH] = 'chosen'
      return
    }
    if (event.type === 'resolveTop') {
      const item = topSpell(state)
      if (item && searchChosen(state)) {
        delete draft.players[item.controller].data[ANALYZE_THE_POLLEN_SEARCH]
      }
    }
  },
}
