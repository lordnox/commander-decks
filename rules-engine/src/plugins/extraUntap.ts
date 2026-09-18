import type { Plugin } from '../types'

/** Bender's Waterskin: untap during each other player's untap step. */
export const extraUntap: Plugin = {
  id: 'extraUntap',
  apply: ({ event, draft, rule }) => {
    if (event.type !== 'custom' || event.name !== 'advanceStep') return
    if (draft.step !== 'untap' || !rule.sourceId) return
    const source = draft.object(rule.sourceId)
    if (!source || source.zone !== 'battlefield') return
    if (source.controller === draft.active) return
    source.tapped = false
    draft.note(`${source.name} untaps during ${draft.active}'s untap`)
  },
}
