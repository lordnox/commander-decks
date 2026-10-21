import type Draft from '../../draft'
import { objectIdentity } from '../../objectIdentity'
import { markKnownToAll } from '../../knowledge'
import { openCardSelection } from '../../rules/selectCards'
import type { GameEvent, ObjectIdentity } from '../../types'
import {
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  objectMatchesSelector,
  type RuleDslRuntimeContext,
} from './compiler/runtime'
import type { Instruction, PlayerRecipient } from './schema/v1'
import { REVEAL_UNTIL_REST } from './schema/v1'

export type RevealUntilInstruction = Instruction & { kind: 'revealUntil' }

const librarySeats = (
  targets: PlayerRecipient,
  context: RuleDslRuntimeContext,
) => targets.kind === 'players'
  ? evaluatePlayerSelector(targets, context)
  : evaluatePlayerReference(targets, context)

export type RevealUntilBindings = {
  found?: Array<ObjectIdentity & { kind: 'object' }>
  rest?: Array<ObjectIdentity & { kind: 'object' }>
}

export const runRevealUntil = (
  draft: Draft,
  context: RuleDslRuntimeContext,
  instruction: RevealUntilInstruction,
  source: { id: string; name: string },
  options?: {
    resume?: { replacementFrameId: string }
    applyImmediately?: boolean
  },
): { complete: true; events: GameEvent[]; bindings: RevealUntilBindings }
  | { waiting: true; events: GameEvent[]; bindings: RevealUntilBindings } => {
  const resume = options?.resume
  const applyImmediately = options?.applyImmediately ?? false
  const seats = librarySeats(instruction.targets, context)
  const needed = Math.max(0, evaluateRuntimeAmount(instruction.count ?? { kind: 'constant', value: 1 }, context))
  const bindings: RevealUntilBindings = {
    ...(instruction.bindFound ? { found: [] } : {}),
    ...(instruction.bindRest ? { rest: [] } : {}),
  }
  const events: GameEvent[] = []
  let waiting = false

  for (const seat of seats) {
    if (needed === 0) continue
    const library = context.state.zoneOrder[seat]?.library ?? []
    const revealed: string[] = []
    const found: string[] = []
    for (const objectId of library) {
      const object = context.state.objects[objectId]
      if (!object) continue
      revealed.push(objectId)
      if (objectMatchesSelector(object, instruction.match, context)) {
        found.push(objectId)
        if (found.length >= needed) break
      }
    }
    if (revealed.length === 0) continue

    markKnownToAll(draft, revealed)
    draft.note(`${seat} reveals ${
      revealed.map((id) => draft.objects[id]?.name).filter(Boolean).join(', ')
    } for ${source.name}`)
    events.push({
      type: 'reveal',
      seat,
      objectIds: revealed,
      source: source.name,
    })

    const matched = found.slice(0, needed)
    const rest = revealed.filter((id) => !matched.includes(id))
    const boundIdentity = (id: string, to = context.state.objects[id]!.zone) => {
      const object = context.state.objects[id]!
      return { kind: 'object' as const, ...objectIdentity(object), zone: to,
        incarnation: object.incarnation + (object.zone !== to ? 1 : 0) }
    }
    if (instruction.bindFound) bindings.found = [...(bindings.found ?? []), ...matched.map(id => boundIdentity(id, instruction.foundTo))]
    if (instruction.bindRest) bindings.rest = [...(bindings.rest ?? []), ...rest.map(id => boundIdentity(id, instruction.rest === REVEAL_UNTIL_REST.graveyard ? 'graveyard' : 'library'))]

    for (const objectId of matched) {
      if (context.state.objects[objectId]?.zone !== instruction.foundTo) events.push({ type: 'move', objectId, to: instruction.foundTo })
    }

    switch (instruction.rest) {
      case REVEAL_UNTIL_REST.graveyard:
        for (const objectId of rest) events.push({ type: 'move', objectId, to: 'graveyard' })
        break
      case REVEAL_UNTIL_REST.orderBottom:
        if (rest.length === 0) break
        openCardSelection(draft, {
          seat,
          kind: 'scry',
          count: rest.length,
          candidates: rest,
          sourceId: source.id,
          source: source.name,
          prompt: 'Put the other revealed cards on the bottom in any order.',
          fromSeat: seat,
          fromZone: 'library',
          destinations: ['bottom'],
          ...(resume ? {
            canonicalChoice: {
              stackId: resume.replacementFrameId,
              binding: '__revealUntil_rest__',
              action: 'replacementProgram',
              replacementFrameId: resume.replacementFrameId,
            },
          } : {}),
        })
        waiting = true
        break
    }
  }

  if (applyImmediately) {
    for (const event of events) {
      if (event.type === 'move') draft.move(event.objectId, event.to)
      else draft.enqueue(event)
    }
  }
  const returnedEvents = applyImmediately ? [] : events
  if (waiting) return { waiting: true, events: returnedEvents, bindings }
  return { complete: true, events: returnedEvents, bindings }
}

export const storeRevealUntilBindings = <T extends Record<string, readonly ({ kind: 'object'; objectId: string } | { kind: 'player'; playerId: string })[]>>(
  choices: T | undefined,
  bindings: RevealUntilBindings,
  instruction: RevealUntilInstruction,
): T => {
  const next = (choices ? { ...choices } : {}) as T
  if (instruction.bindFound && bindings.found) {
    (next as Record<string, readonly { kind: 'object'; objectId: string }[]>)[instruction.bindFound]
      = structuredClone(bindings.found)
  }
  if (instruction.bindRest && bindings.rest) {
    (next as Record<string, readonly { kind: 'object'; objectId: string }[]>)[instruction.bindRest]
      = structuredClone(bindings.rest)
  }
  return next
}
