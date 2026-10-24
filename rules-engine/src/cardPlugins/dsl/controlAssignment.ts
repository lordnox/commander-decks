import { CONTROL_EVENT } from './controlConstants'
import type { CONTROL_CHOICE_ACTION } from './controlConstants'
import type Draft from '../../draft'
import type { GameEvent, ObjectIdentity, PlayerId } from '../../types'
import { openPlayerSelection } from '../../rules/selectPlayers'

export type ControlAssignment = {
  kind: typeof CONTROL_CHOICE_ACTION.assign
  stackId: string
  objects: ObjectIdentity[]
  candidates: PlayerId[]
  distinct: boolean
  assignments: PlayerId[]
  chooser: PlayerId
  sourceId: string
  source: string
}

export const openControlAssignment = (draft: Draft, action: ControlAssignment) => {
  const object = action.objects[action.assignments.length]
  const candidates = action.candidates.filter(seat => !draft.players[seat]?.lost
    && (!action.distinct || !action.assignments.includes(seat)))
  if (!object || candidates.length === 0) return false
  openPlayerSelection(draft, {
    seat: action.chooser, sourceId: action.sourceId, source: action.source,
    prompt: `Choose a player to gain control of ${draft.objects[object.objectId]?.name ?? 'this permanent'}.`,
    min: 1, max: 1, candidates,
    action: structuredClone(action),
  })
  return true
}

export const continueControlAssignment = (draft: Draft, action: ControlAssignment, player: PlayerId) => {
  const frame = draft.resolution?.kind === 'canonicalSpell' && draft.resolution.stackId === action.stackId
    ? draft.resolution : undefined
  if (!frame) return
  const next = { ...action, assignments: [...action.assignments, player] }
  if (openControlAssignment(draft, next)) return
  const events: GameEvent[] = next.assignments.map((controller, index) => ({
    type: CONTROL_EVENT.change, objectRef: next.objects[index]!, controller,
  }))
  frame.pendingEvents = events.length > 1 ? [{ type: 'actionGroup', events }] : events
}
