import type { InstructionHandler } from './instructionHandlers/types'
import type { Plugin } from '../types'

export const MONSTROSITY_ABILITY = 'monstrosity'

export const monstrosityInstruction: InstructionHandler<'monstrosity'> = (
  { draft, source },
  instruction,
) => {
  const live = draft.object(source.id)
  if (!live || live.monstrous) return
  draft.enqueue({
    type: 'putCounters',
    objectId: live.id,
    counter: '+1/+1',
    count: instruction.count,
  })
  live.monstrous = true
  draft.enqueue({ type: 'becomesMonstrous', objectId: live.id })
  draft.note(`${live.name} becomes monstrous`)
}

/** CR 701.109 — one-shot activated ability; zone change drops the monstrous marker. */
export const monstrosity: Plugin = {
  id: 'monstrosity',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'move') return
    const before = state.objects[event.objectId]
    if (!before?.monstrous) return
    if (before.zone === 'battlefield' && event.to !== 'battlefield') {
      const live = draft.object(event.objectId)
      if (live) live.monstrous = false
    }
  },
}
