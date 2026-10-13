import type { PluginCatalog } from '../catalog'
import { freezeDraft, makeDraft } from '../draft'
import {
  evaluateCondition,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  type RuleDslRuntimeContext,
} from '../cardPlugins/dsl/compiler/runtime'
import { captureObject } from '../objectIdentity'
import { objectIdentity } from '../objectIdentity'
import { openCardSelection } from '../rules/selectCards'
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

const availableAmount = (amount: Instruction & { count?: unknown; amount?: unknown }, context: RuleDslRuntimeContext) => {
  const expression = 'count' in amount && amount.count
    ? amount.count as import('../cardPlugins/dsl/schema/v1').Amount
    : 'amount' in amount && amount.amount
      ? amount.amount as import('../cardPlugins/dsl/schema/v1').Amount
      : undefined
  if (!expression) return undefined
  return evaluateRuntimeAmount(expression, context)
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
  | { kind: 'complete'; followUp: GameEvent[]; state: GameState }

export const advanceReplacementProgram = (
  state: GameState,
  frame: EventProcessingFrame,
  _catalog: PluginCatalog,
): ProgramStep => {
  const program = frame.program
  if (!program) return { kind: 'complete', followUp: frame.followUp ?? [], state }

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

    if (instruction.kind === 'sequence') {
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
  delete draft.eventProcessing
  return { kind: 'complete', followUp, state: freezeDraft(draft) }
}

export const completeReplacementDiscard = (
  state: GameState,
  frameId: string,
  binding: string,
  discarded: boolean,
  objectIds: readonly string[],
  _catalog: PluginCatalog,
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
  if (seat && objectIds.length > 0) {
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
  return advanceReplacementProgram(freezeDraft(draft), draft.eventProcessing!, _catalog)
}
