import type Draft from '../draft'
import type { GameEvent, GameObject, Plugin, StackItem } from '../types'
import type { CardInstruction } from './effects'
import {
  dispatchInstruction,
  flushStackActions,
  type BufferedStackAction,
  type InstructionContext,
} from './instructionHandlers'
import {
  INSTRUCTIONS_RESUME,
  pendingSelectionsFor,
  type InstructionResume,
  type PendingCardSelection,
} from '../rules/selectCards'

const YIELD_AFTER_BUFFER = new Set(['putLandFromHand'])

const isResumeEvent = (event: GameEvent): event is Extract<GameEvent, { type: 'custom' }> =>
  event.type === 'custom' && event.name === INSTRUCTIONS_RESUME

const resumeFromPayload = (payload: Record<string, unknown> | undefined): InstructionResume | undefined => {
  if (!payload || typeof payload.sourceId !== 'string' || !Array.isArray(payload.remaining)) return
  return {
    sourceId: payload.sourceId,
    remaining: payload.remaining as CardInstruction[],
    ...(payload.item ? { item: payload.item as StackItem } : {}),
  }
}

const selectionSnapshot = (draft: Draft) =>
  new Set(
    draft.playerOrder.flatMap((seat) =>
      pendingSelectionsFor(draft, seat).map((selection) => selection.id)),
  )

const newSelection = (draft: Draft, before: Set<string>) => {
  for (const seat of draft.playerOrder) {
    for (const selection of pendingSelectionsFor(draft, seat)) {
      if (!before.has(selection.id)) return selection
    }
  }
}

const lastQueuedResume = (draft: Draft, fromIndex: number) => {
  for (let index = draft.pending.length - 1; index >= fromIndex; index -= 1) {
    const event = draft.pending[index]
    if (isResumeEvent(event)) return event
  }
}

const writeResume = (
  target: { resume?: InstructionResume },
  sourceId: string,
  remaining: CardInstruction[],
  item?: StackItem,
) => {
  target.resume = {
    sourceId,
    remaining: [...(target.resume?.remaining ?? []), ...remaining],
    ...(item ? { item } : {}),
  }
}

export const runInstructions = (
  draft: Draft,
  source: GameObject,
  instructions: CardInstruction[],
  item?: StackItem,
  stackBuffer?: BufferedStackAction[],
) => {
  const buffer = stackBuffer ?? (item ? [] : undefined)
  const attachRemaining = (
    remaining: CardInstruction[],
    nestedSource: GameObject,
    opened?: PendingCardSelection,
    resumeEvent?: Extract<GameEvent, { type: 'custom' }>,
  ) => {
    if (opened) {
      writeResume(opened, nestedSource.id, remaining, item)
      return
    }
    if (!resumeEvent) return
    const current = resumeFromPayload(resumeEvent.payload)
    resumeEvent.payload = {
      sourceId: current?.sourceId ?? nestedSource.id,
      remaining: [...(current?.remaining ?? []), ...remaining],
      ...(current?.item ?? item ? { item: current?.item ?? item } : {}),
    }
  }

  const run = (nested: CardInstruction[], nestedSource = source): boolean => {
    const ctx: InstructionContext = {
      draft,
      source: nestedSource,
      item,
      buffer,
      run,
      appendRemaining: (extra) => {
        const withResume = draft.playerOrder
          .flatMap((seat) => pendingSelectionsFor(draft, seat))
          .find((selection) => selection.resume)
        if (withResume?.resume) {
          withResume.resume.remaining = [...withResume.resume.remaining, extra]
          return
        }
        const queued = lastQueuedResume(draft, 0)
        if (queued) {
          attachRemaining([extra], nestedSource, undefined, queued)
          return
        }
        const latest = draft.playerOrder
          .flatMap((seat) => pendingSelectionsFor(draft, seat))
          .at(-1)
        if (latest) writeResume(latest, nestedSource.id, [extra], item)
      },
    }
    for (let index = 0; index < nested.length; index += 1) {
      const instruction = nested[index]
      if (buffer?.length && YIELD_AFTER_BUFFER.has(instruction.kind)) {
        flushStackActions(draft, nestedSource, buffer, item)
        buffer.length = 0
        draft.enqueue({
          type: 'custom',
          name: INSTRUCTIONS_RESUME,
          payload: {
            sourceId: nestedSource.id,
            remaining: nested.slice(index),
            ...(item ? { item } : {}),
          },
        })
        return true
      }
      const beforeSelections = selectionSnapshot(draft)
      const pendingBefore = draft.pending.length
      dispatchInstruction(ctx, instruction)
      const opened = newSelection(draft, beforeSelections)
      const resumeEvent = lastQueuedResume(draft, pendingBefore)
      if (!opened && !resumeEvent) continue
      attachRemaining(nested.slice(index + 1), nestedSource, opened, resumeEvent)
      return true
    }
    return false
  }

  run(instructions)

  if (buffer && stackBuffer === undefined) flushStackActions(draft, source, buffer, item)
}

export const instructionResume: Plugin = {
  id: 'instructionResume',
  apply: ({ event, draft }) => {
    if (!isResumeEvent(event)) return
    const resume = resumeFromPayload(event.payload)
    if (!resume || resume.remaining.length === 0) return
    const source = draft.object(resume.sourceId)
    if (!source) return
    runInstructions(draft, source, resume.remaining, resume.item)
  },
}
