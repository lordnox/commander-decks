import { grantOracleLine } from './continuousEffects'
import type { InstructionHandler } from './instructionHandlers/types'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type { Plugin } from '../types'

export const UNEARTH_ABILITY = 'unearth'

const endStepExile: [{ kind: 'exileSelf' }] = [{ kind: 'exileSelf' }]

export const unearthSelfInstruction: InstructionHandler<'unearthSelf'> = ({ draft, source }) => {
  if (source.zone !== 'graveyard') return
  draft.enqueue({ type: 'move', objectId: source.id, to: 'battlefield' })
  grantOracleLine(source, 'haste')
  draft.enqueue({
    type: 'addRule',
    pluginId: 'unearth',
    sourceId: source.id,
  })
  registerDelayedTrigger(draft, source, { kind: 'step', step: 'end' }, endStepExile)
  draft.note(`${source.controller} unearths ${source.name}`)
}

/** CR 702.83 — sorcery-speed graveyard activation, haste, end-step exile, leave replacement. */
export const unearth: Plugin = {
  id: 'unearth',
  replace: ({ state, event, rule }) => {
    if (rule.pluginId !== 'unearth' || event.type !== 'move') return
    if (event.objectId !== rule.sourceId) return
    const object = state.objects[event.objectId]
    if (!object || object.zone !== 'battlefield') return
    if (event.to === 'battlefield' || event.to === 'exile') return
    return { ...event, to: 'exile' }
  },
}
