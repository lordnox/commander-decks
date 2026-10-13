import { freezeDraft, makeDraft } from '../draft'
import {
  CHOSEN_COLOR_BINDING,
  type Instruction,
  type ReplacementProgramInstruction,
  type ReplacementTransform,
} from '../cardPlugins/dsl/schema/v1'
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
  | { kind: 'complete'; event: GameEvent; state: GameState }
  | { kind: 'prevented'; state: GameState }
  | { kind: 'fork'; events: GameEvent[]; state: GameState }
  | { kind: 'program'; instructions: readonly Instruction[]; event: GameEvent; state: GameState }

const openChoice = (
  draft: ReturnType<typeof makeDraft>,
  frame: EventProcessingFrame,
  instruction: Extract<ReplacementProgramInstruction, { kind: 'choose' }>,
) => {
  const source = draft.objects[frame.applicationProgram?.sourceId ?? '']
  const chooser = frame.chooser ?? source?.controller
  if (!chooser) return
  openOptionSelection(draft, {
    seat: chooser,
    sourceId: source?.id,
    source: source?.name ?? 'Replacement',
    prompt: `Choose a color for ${source?.name ?? 'this permanent'}.`,
    options: instruction.options.map((option) => ({ id: option.id, label: option.label })),
    action: {
      kind: 'replacementProgramChoice',
      frameId: frame.id,
      bindChoice: instruction.bindChoice,
    },
  })
}

export const advanceApplicationProgram = (
  state: GameState,
  frame: EventProcessingFrame,
) => {
  const draft = makeDraft(state)
  const working = draft.eventProcessing ?? structuredClone(frame)
  draft.eventProcessing = working
  const program = working.applicationProgram
  if (!program) return { kind: 'complete' as const, event: working.pendingEvent, state }
  while (program.index < program.instructions.length) {
    const instruction = program.instructions[program.index]!
    if (instruction.kind === 'choose') {
      openChoice(draft, working, instruction)
      return { kind: 'waiting' as const, state: freezeDraft(draft) }
    }
    program.index += 1
  }
  const transformed = applyReplacementTransform(working.pendingEvent, program.transform, working.lineage)
  delete draft.eventProcessing
  const frozen = freezeDraft(draft)
  switch (transformed.kind) {
    case 'prevented':
      return { kind: 'prevented' as const, state: frozen }
    case 'continue':
      return { kind: 'complete' as const, event: transformed.event, state: frozen }
    case 'fork':
      return { kind: 'fork' as const, events: transformed.events, state: frozen }
    case 'program':
      return {
        kind: 'program' as const,
        instructions: transformed.instructions,
        event: working.pendingEvent,
        state: frozen,
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
