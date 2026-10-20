import { freezeDraft, makeDraft } from '../draft'
import { captureObject } from '../objectIdentity'
import {
  CHOSEN_COLOR_BINDING,
  type Instruction,
  type ReplacementProgramInstruction,
  type ReplacementTransform,
} from '../cardPlugins/dsl/schema/v1'
import {
  evaluateCondition,
  evaluateRuntimeAmount,
  type RuleDslRuntimeContext,
} from '../cardPlugins/dsl/compiler/runtime'
import { PENDING_OPTION_SELECTION, openOptionSelection } from '../rules/selectOptions'
import type {
  EventProcessingFrame,
  GameEvent,
  GameState,
  ManaId,
} from '../types'
import { applyReplacementTransform } from './program'

const COLORS = new Set<ManaId>(['W', 'U', 'B', 'R', 'G'])

const storeChosenColor = (frame: EventProcessingFrame, optionId: string) => {
  if (!COLORS.has(optionId as ManaId)) return
  const pending = frame.pendingEvent
  if (pending.type === 'move') {
    frame.pendingEvent = { ...pending, chosenColor: optionId as ManaId }
  }
}

export const initApplicationProgram = (
  instructions: readonly ReplacementProgramInstruction[],
  transform: ReplacementTransform,
  sourceId: string,
  controller: string,
) => ({
  instructions,
  index: 0,
  bindings: {},
  transform,
  sourceId,
  controller,
})

export type ApplicationProgramStep =
  | { kind: 'waiting'; state: GameState }
  | { kind: 'complete'; event: GameEvent; state: GameState; followUp: GameEvent[] }
  | { kind: 'prevented'; state: GameState; followUp: GameEvent[] }
  | { kind: 'fork'; events: GameEvent[]; state: GameState; followUp: GameEvent[] }
  | { kind: 'program'; instructions: readonly Instruction[]; event: GameEvent; state: GameState; followUp: GameEvent[] }

const openChoice = (
  draft: ReturnType<typeof makeDraft>,
  frame: EventProcessingFrame,
  instruction: Extract<ReplacementProgramInstruction, { kind: 'choose' }>,
) => {
  const source = draft.objects[frame.applicationProgram?.sourceId ?? '']
  const chooser = frame.chooser ?? source?.controller
  if (!chooser) return
  const defaultPrompt = instruction.bindChoice === CHOSEN_COLOR_BINDING
    ? `Choose a color for ${source?.name ?? 'this permanent'}.`
    : `Choose an option for ${source?.name ?? 'this permanent'}.`
  openOptionSelection(draft, {
    seat: chooser,
    sourceId: source?.id,
    source: source?.name ?? 'Replacement',
    prompt: instruction.prompt ?? defaultPrompt,
    options: instruction.options.map((option) => ({ id: option.id, label: option.label })),
    action: {
      kind: 'replacementProgramChoice',
      frameId: frame.id,
      bindChoice: instruction.bindChoice,
    },
  })
}

const persistFollowUp = (
  frame: EventProcessingFrame,
  followUp: GameEvent[],
) => {
  if (followUp.length === 0) return
  frame.followUp = [...(frame.followUp ?? []), ...followUp]
}

export const advanceApplicationProgram = (
  state: GameState,
  frame: EventProcessingFrame,
) => {
  const draft = makeDraft(state)
  const working = draft.eventProcessing ?? structuredClone(frame)
  draft.eventProcessing = working
  const program = working.applicationProgram
  if (!program) return { kind: 'complete' as const, event: working.pendingEvent, state, followUp: [] as GameEvent[] }
  const followUp: GameEvent[] = []
  const runtime = (): RuleDslRuntimeContext | undefined => {
    const source = draft.objects[program.sourceId]
    if (!source) return
    return {
      state: freezeDraft(draft),
      controller: program.controller,
      source: captureObject(source),
      optionChoices: program.bindings,
    }
  }
  while (program.index < program.instructions.length) {
    const instruction = program.instructions[program.index]!
    switch (instruction.kind) {
      case 'choose': {
        openChoice(draft, working, instruction)
        persistFollowUp(working, followUp)
        return { kind: 'waiting' as const, state: freezeDraft(draft) }
      }
      case 'branch': {
        const context = runtime()
        const takeThen = context ? evaluateCondition(instruction.condition, context) : false
        const next = takeThen ? instruction.then : (instruction.otherwise ?? [])
        program.instructions = [
          ...program.instructions.slice(0, program.index),
          ...next,
          ...program.instructions.slice(program.index + 1),
        ]
        continue
      }
      case 'modifyEvent': {
        if (program.transform.kind === 'modifyEvent') {
          program.transform = {
            kind: 'modifyEvent',
            changes: { ...program.transform.changes, ...instruction.changes },
          }
        }
        program.index += 1
        continue
      }
      case 'payLife': {
        const context = runtime()
        if (context) {
          followUp.push({
            type: 'payLife',
            seat: program.controller,
            amount: evaluateRuntimeAmount(instruction.amount, context),
            source: program.sourceId,
          })
        }
        program.index += 1
        continue
      }
      case 'emit': {
        program.index += 1
        continue
      }
    }
  }
  const transformed = applyReplacementTransform(working.pendingEvent, program.transform, working.lineage)
  delete draft.eventProcessing
  const frozen = freezeDraft(draft)
  switch (transformed.kind) {
    case 'prevented':
      return { kind: 'prevented' as const, state: frozen, followUp }
    case 'continue':
      return { kind: 'complete' as const, event: transformed.event, state: frozen, followUp }
    case 'fork':
      return { kind: 'fork' as const, events: transformed.events, state: frozen, followUp }
    case 'program':
      return {
        kind: 'program' as const,
        instructions: transformed.instructions,
        event: working.pendingEvent,
        state: frozen,
        followUp,
      }
  }
}

export const rememberApplicationChoice = (
  state: GameState,
  frameId: string,
  bindChoice: string,
  optionId: string,
) => {
  const draft = makeDraft(state)
  const frame = draft.eventProcessing
  const program = frame?.applicationProgram
  if (!frame || frame.id !== frameId || !program) {
    return { kind: 'invalid' as const, error: 'replacement program choice is not active' }
  }
  const instruction = program.instructions[program.index]
  if (!instruction || instruction.kind !== 'choose' || instruction.bindChoice !== bindChoice) {
    return { kind: 'invalid' as const, error: 'replacement program choice is not authorized' }
  }
  const chooser = frame.chooser
  if (chooser) delete draft.players[chooser].data[PENDING_OPTION_SELECTION]
  program.bindings[bindChoice] = optionId
  if (bindChoice === CHOSEN_COLOR_BINDING) {
    storeChosenColor(frame, optionId)
    const source = draft.objects[program.sourceId]
    if (source && COLORS.has(optionId as ManaId)) {
      source.chosenColor = optionId as ManaId
      draft.note(`${chooser ?? source.controller} chooses ${optionId} for ${source.name}`)
    }
  }
  program.index += 1
  draft.eventProcessing = frame
  return advanceApplicationProgram(freezeDraft(draft), frame)
}
