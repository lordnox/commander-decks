import { registerDelayedTrigger } from '../rules/delayedTriggers'
import { openCardSelection } from '../rules/selectCards'
import type Draft from '../draft'
import type { GameObject, Plugin } from '../types'
import type { BlinkOptions } from './effectBuilders'
import { validTarget } from './targetedResolve'
import type { InstructionHandler } from './instructionHandlers/types'

export type BlinkSpec = Pick<
  BlinkOptions,
  'returnController' | 'when' | 'plusCounters'
>

const returnControllerFor = (
  source: GameObject,
  target: GameObject,
  spec: BlinkSpec,
) => (spec.returnController === 'controller' ? source.controller : target.owner)

const enqueueReturn = (
  draft: Draft,
  source: GameObject,
  target: GameObject,
  spec: BlinkSpec,
) => {
  const controller = returnControllerFor(source, target, spec)
  draft.enqueue({
    type: 'move',
    objectId: target.id,
    to: 'battlefield',
    controller,
  })
  if (spec.plusCounters && spec.plusCounters > 0) {
    draft.enqueue({
      type: 'putCounters',
      objectId: target.id,
      counter: '+1/+1',
      count: spec.plusCounters,
    })
  }
}

export const performBlink = (
  draft: Draft,
  source: GameObject,
  target: GameObject,
  spec: BlinkSpec = {},
) => {
  if (target.zone !== 'battlefield') return
  draft.enqueue({ type: 'move', objectId: target.id, to: 'exile' })
  if (spec.when === 'nextEndStep') {
    registerDelayedTrigger(
      draft,
      source,
      { kind: 'step', step: 'end' },
      [{
        kind: 'blinkReturn',
        objectId: target.id,
        returnController: spec.returnController ?? 'owner',
        ...(spec.plusCounters ? { plusCounters: spec.plusCounters } : {}),
      }],
    )
    return
  }
  enqueueReturn(draft, source, target, spec)
}

export const applyBlinkReturn = (
  draft: Draft,
  source: GameObject,
  objectId: string,
  spec: BlinkSpec,
) => {
  const target = draft.object(objectId)
  if (!target || target.zone !== 'exile') return
  enqueueReturn(draft, source, target, spec)
}

const blinkInstruction: InstructionHandler<'blink'> = (
  { draft, source, item },
  instruction,
) => {
  const spec: BlinkSpec = {
    returnController: instruction.returnController ?? 'owner',
    when: instruction.when ?? 'immediate',
    plusCounters: instruction.plusCounters,
  }

  if (instruction.optional && instruction.filter) {
    const candidates = Object.values(draft.objects)
      .filter((object) =>
        validTarget(
          draft,
          object,
          instruction.filter!,
          source.controller,
          undefined,
          source.id,
        ))
      .map((object) => object.id)
    if (candidates.length === 0) return
    const { optional, filter, prompt, ...rest } = instruction
    openCardSelection(draft, {
      seat: source.controller,
      kind: 'choose',
      count: 1,
      min: 0,
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: prompt ?? 'You may exile a permanent, then return it.',
      destinations: ['target'],
      triggerInstructions: [{ kind: 'blink', ...rest, optional: false }],
    })
    return
  }

  const targetIndex = instruction.targetIndex ?? 0
  const targetRef = item?.targets[targetIndex]
  if (targetRef?.kind !== 'object') return
  const target = draft.object(targetRef.objectId)
  if (!target) return
  performBlink(draft, source, target, spec)
}

const blinkReturnInstruction: InstructionHandler<'blinkReturn'> = (
  { draft, source },
  instruction,
) => {
  applyBlinkReturn(draft, source, instruction.objectId, {
    returnController: instruction.returnController ?? 'owner',
    plusCounters: instruction.plusCounters,
  })
}

export const blinkHandlers = {
  blink: blinkInstruction,
  blinkReturn: blinkReturnInstruction,
}

export const blinkPlugin: Plugin = { id: 'blink' }
