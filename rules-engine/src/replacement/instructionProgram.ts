import type { PluginCatalog } from '../catalog'
import { freezeDraft, makeDraft } from '../draft'
import {
  evaluateCondition,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  type RuleDslRuntimeContext,
} from '../cardPlugins/dsl/compiler/runtime'
import { runRevealUntil, storeRevealUntilBindings } from '../cardPlugins/dsl/revealUntilExecution'
import { captureObject, objectIdentity } from '../objectIdentity'
import { openCardSelection } from '../rules/selectCards'
import { openOptionSelection } from '../rules/selectOptions'
import type { Instruction, PlayerRecipient } from '../cardPlugins/dsl/schema/v1'
import type {
  EventProcessingFrame,
  GameEvent,
  GameState,
  ReplacementInstructionProgramState,
  ReplacementLineage,
} from '../types'
import type { PlayerId } from '../types'
import { descendantLineage, withLineage } from './lineage'

const recipients = (
  recipient: PlayerRecipient,
  context: RuleDslRuntimeContext,
) => recipient.kind === 'players'
  ? evaluatePlayerSelector(recipient, context)
  : evaluatePlayerReference(recipient, context)

const availableAmount = (instruction: Instruction, context: RuleDslRuntimeContext) => {
  switch (instruction.kind) {
    case 'draw':
    case 'mill':
      return evaluateRuntimeAmount(instruction.count, context)
    case 'discard':
      return instruction.count === undefined
        ? undefined
        : evaluateRuntimeAmount(instruction.count, context)
    case 'gainLife':
    case 'loseLife':
      return evaluateRuntimeAmount(instruction.amount, context)
    default:
      return undefined
  }
}

const runtimeForProgram = (
  state: GameState,
  program: ReplacementInstructionProgramState,
): RuleDslRuntimeContext => {
  const source = state.objects[program.sourceId]
  if (!source) throw new Error('replacement program source is missing')
  return {
    state,
    controller: program.controller,
    source: captureObject(source),
    occurrence: { kind: 'event' as const, eventType: 'draw', player: program.occurrencePlayer },
    results: program.results,
    choices: program.choices as RuleDslRuntimeContext['choices'],
  }
}

export const initReplacementProgram = (
  instructions: readonly Instruction[],
  meta: {
    sourceId: string
    controller: PlayerId
    occurrencePlayer: PlayerId
  },
): ReplacementInstructionProgramState => ({
  instructions,
  scopes: [{ path: 'root', instructions: [...instructions], cursor: 0 }],
  sourceId: meta.sourceId,
  controller: meta.controller,
  occurrencePlayer: meta.occurrencePlayer,
  emittedEvents: [],
})

const lineageForFrame = (frame: EventProcessingFrame) => descendantLineage(frame.lineage)

const recordEmitted = (
  event: GameEvent,
  lineage: ReplacementLineage,
  program: ReplacementInstructionProgramState,
) => {
  program.emittedEvents.push(withLineage(event, lineage))
}

const emitInstruction = (
  instruction: Instruction,
  context: RuleDslRuntimeContext,
  lineage: ReplacementLineage,
  program: ReplacementInstructionProgramState,
) => {
  switch (instruction.kind) {
    case 'draw': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction, context) ?? 0
      if (amount <= 0) return
      for (const seat of targets) {
        recordEmitted({ type: 'draw', seat, count: amount }, lineage, program)
      }
      return
    }
    case 'mill': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction, context) ?? 0
      if (amount <= 0) return
      for (const seat of targets) {
        const library = context.state.zoneOrder[seat].library ?? []
        for (let i = 0; i < Math.min(amount, library.length); i += 1) {
          const objectId = library[i]!
          recordEmitted({ type: 'mill', seat, objectId, sourceId: program.sourceId }, lineage, program)
        }
      }
      return
    }
    case 'gainLife':
    case 'loseLife': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction, context) ?? 0
      if (amount <= 0) return
      for (const seat of targets) {
        recordEmitted({
          type: instruction.kind,
          seat,
          amount,
          source: program.sourceId,
        }, lineage, program)
      }
      return
    }
    case 'discard':
      if (instruction.count === undefined) return
      break
    default:
      return
  }
}

export type ProgramStep =
  | { kind: 'waiting'; state: GameState }
  | { kind: 'complete'; followUp: GameEvent[]; state: GameState; pendingDraw?: Extract<GameEvent, { type: 'draw' }> }

export const advanceReplacementProgram = (
  state: GameState,
  frame: EventProcessingFrame,
  _catalog: PluginCatalog,
): ProgramStep => {
  const program = frame.program
  if (!program) {
    return {
      kind: 'complete',
      followUp: frame.followUp ?? [],
      state,
      ...(frame.pendingEvent.type === 'draw' ? { pendingDraw: frame.pendingEvent } : {}),
    }
  }

  const draft = makeDraft(state)
  const lineage = lineageForFrame(frame)

  if (program.pendingDiscard) {
    return { kind: 'waiting', state: freezeDraft(draft) }
  }

  while (program.scopes.length > 0) {
    const scope = program.scopes.at(-1)!
    if (scope.cursor >= scope.instructions.length) {
      program.scopes.pop()
      continue
    }
    const index = scope.cursor
    const instruction = scope.instructions[index]!
    scope.cursor += 1
    const context = runtimeForProgram(freezeDraft(draft), program)

    if (instruction.kind === 'sequence' || instruction.kind === 'forEach') {
      program.scopes.push({
        path: `${scope.path}[${index}].instructions`,
        instructions: [...instruction.instructions],
        cursor: 0,
      })
      continue
    }
    if (instruction.kind === 'if') {
      const takeThen = evaluateCondition(instruction.condition, context)
      const branch = takeThen ? instruction.then : instruction.otherwise
      if (branch.length > 0) {
        program.scopes.push({
          path: `${scope.path}[${index}].${takeThen ? 'then' : 'otherwise'}`,
          instructions: [...branch],
          cursor: 0,
        })
      }
      continue
    }
    if (instruction.kind === 'chooseInstructions') {
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      if (chooser && instruction.options.length > 0) {
        openOptionSelection(draft, {
          seat: chooser,
          sourceId: program.sourceId,
          source: draft.objects[program.sourceId]?.name ?? 'Replacement',
          prompt: instruction.prompt ?? 'Choose an instruction program.',
          options: instruction.options.map((option, optionIndex) => ({
            id: `instruction:${optionIndex}`,
            label: option.label ?? `Option ${optionIndex + 1}`,
          })),
          action: {
            kind: 'replacementInstructionChoice',
            frameId: frame.id,
            options: instruction.options.map((option, optionIndex) => ({
              id: `instruction:${optionIndex}`,
              instructions: [...option.instructions],
            })),
          },
        })
      }
      draft.eventProcessing = { ...frame, program }
      return { kind: 'waiting', state: freezeDraft(draft) }
    }
    if (instruction.kind === 'revealUntil') {
      const source = draft.objects[program.sourceId]
      const stepped = runRevealUntil(
        draft,
        context,
        instruction,
        { id: program.sourceId, name: source?.name ?? 'Replacement' },
        { resume: { replacementFrameId: frame.id }, applyImmediately: true },
      )
      program.choices = storeRevealUntilBindings(program.choices, stepped.bindings, instruction)
      for (const emitted of stepped.events) {
        recordEmitted(emitted, lineage, program)
      }
      if ('waiting' in stepped) {
        draft.eventProcessing = { ...frame, program }
        return { kind: 'waiting', state: freezeDraft(draft) }
      }
      continue
    }
    if (instruction.kind === 'discard' && instruction.count !== undefined) {
      const seats = recipients(instruction.targets, context)
      const amount = availableAmount(instruction, context) ?? 0
      if (amount <= 0) {
        if (instruction.bindResult) {
          program.results = { ...program.results, [instruction.bindResult]: false }
        }
        continue
      }
      const seat = seats[0]
      if (!seat) {
        if (instruction.bindResult) {
          program.results = { ...program.results, [instruction.bindResult]: false }
        }
        continue
      }
      const hand = (draft.zoneOrder[seat].hand ?? []).map((id) => draft.objects[id]).filter(Boolean)
      if (hand.length === 0) {
        if (instruction.bindResult) {
          program.results = { ...program.results, [instruction.bindResult]: false }
        }
        continue
      }
      const count = Math.min(amount, hand.length)
      openCardSelection(draft, {
        seat,
        kind: 'discard',
        count,
        min: count,
        candidates: hand.map((object) => object.id),
        sourceId: program.sourceId,
        source: draft.objects[program.sourceId]?.name ?? 'Replacement',
        prompt: 'Choose a card to discard.',
        destinations: ['target'],
        targetIdentities: Object.fromEntries(hand.map((object) => [object.id, objectIdentity(object)])),
        canonicalChoice: {
          stackId: frame.id,
          binding: instruction.bindResult ?? `__replacement_discard_${index}`,
          action: 'replacementDiscard',
          replacementFrameId: frame.id,
        },
      })
      program.pendingDiscard = {
        seats: [seat],
        index: 0,
        amount: count,
        selected: [],
        binding: instruction.bindResult,
      }
      draft.eventProcessing = { ...frame, program }
      return { kind: 'waiting', state: freezeDraft(draft) }
    }

    emitInstruction(instruction, context, lineage, program)
  }

  const followUp = [...(frame.followUp ?? []), ...program.emittedEvents]
  const pendingDraw = frame.pendingEvent.type === 'draw' ? frame.pendingEvent : undefined
  delete draft.eventProcessing
  return { kind: 'complete', followUp, state: freezeDraft(draft), pendingDraw }
}

const processingFrame = (state: GameState, frameId: string) =>
  [state.eventProcessing, ...(state.deferredEventProcessing ?? [])]
    .find((entry): entry is EventProcessingFrame => Boolean(entry && entry.id === frameId))

export const resumeReplacementInstructionChoice = (
  state: GameState,
  frameId: string,
  optionId: string,
  options: readonly { id: string; instructions: readonly Instruction[] }[],
  catalog: PluginCatalog,
): ProgramStep => {
  const frame = processingFrame(state, frameId)
  if (!frame?.program) {
    return { kind: 'complete', followUp: [], state }
  }
  const program = frame.program
  const option = options.find((entry) => entry.id === optionId)
  if (!option) return { kind: 'complete', followUp: [], state }
  program.scopes.push({
    path: `.choice.${optionId}`,
    instructions: [...option.instructions],
    cursor: 0,
  })
  const draft = makeDraft({ ...state, eventProcessing: frame })
  draft.eventProcessing = { ...frame, program }
  return advanceReplacementProgram(freezeDraft(draft), draft.eventProcessing!, catalog)
}

export const continueReplacementProgram = (
  state: GameState,
  catalog: PluginCatalog,
): ProgramStep => {
  const frame = state.eventProcessing
  if (!frame?.program) return { kind: 'complete', followUp: [], state }
  return advanceReplacementProgram(state, frame, catalog)
}

export const completeReplacementDiscard = (
  state: GameState,
  frameId: string,
  binding: string,
  discarded: boolean,
  objectIds: readonly string[],
  catalog: PluginCatalog,
): ProgramStep => {
  const frame = state.eventProcessing
  if (!frame || frame.id !== frameId || !frame.program?.pendingDiscard) {
    return { kind: 'complete', followUp: [], state }
  }
  const program = frame.program
  const pending = program.pendingDiscard
  if (!pending) return { kind: 'complete', followUp: [], state }
  const draft = makeDraft(state)
  const seat = pending.seats[pending.index]
  if (seat && discarded && objectIds.length > 0) {
    pending.selected.push(...objectIds.map((objectId) => ({ seat, objectId })))
    const lineage = lineageForFrame(frame)
    for (const objectId of objectIds) {
      recordEmitted({ type: 'discard', seat, objectId }, lineage, program)
    }
  }
  if (pending.binding ?? binding) {
    program.results = {
      ...program.results,
      [pending.binding ?? binding]: discarded,
    }
  }
  delete program.pendingDiscard
  draft.eventProcessing = { ...frame, program }
  return advanceReplacementProgram(freezeDraft(draft), draft.eventProcessing!, catalog)
}
