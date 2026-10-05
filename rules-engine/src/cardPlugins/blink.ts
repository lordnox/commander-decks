import { registerDelayedTrigger } from '../rules/delayedTriggers'
import { openCardSelection } from '../rules/selectCards'
import type Draft from '../draft'
import type { GameObject, Plugin } from '../types'
import type { BlinkOptions } from './effectBuilders'
import { validTarget } from './targetedResolve'
import type { InstructionHandler } from './instructionHandlers/types'

export type BlinkSpec = Pick<
  BlinkOptions,
  'returnController' | 'when' | 'plusCounters' | 'tapped'
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
  if (spec.tapped) draft.enqueue({ type: 'tap', objectId: target.id })
  if (spec.plusCounters && spec.plusCounters > 0) {
    draft.enqueue({
      type: 'putCounters',
      objectId: target.id,
      counter: '+1/+1',
      count: spec.plusCounters,
    })
  }
}

/** "Return it at the beginning of the next end step." */
const registerEndStepReturn = (
  draft: Draft,
  source: GameObject,
  target: GameObject,
  spec: BlinkSpec,
) => {
  registerDelayedTrigger(
    draft,
    source,
    { kind: 'step', step: 'end' },
    [{
      kind: 'blinkReturn',
      objectId: target.id,
      returnController: spec.returnController ?? 'owner',
      ...(spec.plusCounters ? { plusCounters: spec.plusCounters } : {}),
      ...(spec.tapped ? { tapped: true as const } : {}),
    }],
  )
}

export const performBlink = (
  draft: Draft,
  source: GameObject,
  target: GameObject,
  spec: BlinkSpec = {},
) => {
  if (target.zone === 'exile' && spec.when === 'nextEndStep') {
    registerEndStepReturn(draft, source, target, spec)
    return
  }
  if (target.zone !== 'battlefield') return
  draft.enqueue({ type: 'move', objectId: target.id, to: 'exile' })
  if (spec.when === 'nextEndStep') {
    registerEndStepReturn(draft, source, target, spec)
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
    tapped: instruction.tapped,
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
    openCardSelection(draft, {
      seat: source.controller,
      kind: 'choose',
      count: 1,
      min: 0,
      candidates,
      sourceId: source.id,
      source: source.name,
      prompt: instruction.prompt ?? 'You may exile a permanent, then return it.',
      destinations: ['target'],
      triggerInstructions: [{ ...instruction, optional: false }],
    })
    return
  }

  const targetRef = item?.targets[instruction.targetIndex ?? 0]
  // A source that already left the battlefield is a new object (CR 400.7); the ability does nothing.
  const self = draft.object(source.id)
  const target = instruction.self
    ? self?.zone === 'battlefield' ? self : undefined
    : targetRef?.kind === 'object' ? draft.object(targetRef.objectId) : undefined
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
    tapped: instruction.tapped,
  })
}

export const blinkHandlers = {
  blink: blinkInstruction,
  blinkReturn: blinkReturnInstruction,
}

export const blinkPlugin: Plugin = { id: 'blink' }
