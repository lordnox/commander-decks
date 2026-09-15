import type { Plugin } from '../types'

export const jointExploration: Plugin = {
  id: 'jointExploration',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (item?.name !== 'Joint Exploration') return
    draft.enqueue({ type: 'draw', seat: item.controller })
    draft.note(`${item.controller} resolves Joint Exploration`)
  },
}
