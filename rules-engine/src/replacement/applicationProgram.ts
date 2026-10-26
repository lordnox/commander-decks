import { openPlayerSelection } from '../rules/selectPlayers'
import { isCreatureType } from '../creatureTypes'
import { REPLACEMENT_APPLICATION_CARD_CHOICE, REPLACEMENT_APPLICATION_PLAYER_CHOICE } from './constants'
import { openCardSelection } from '../rules/selectCards'
import { freezeDraft, makeDraft } from '../draft'
import { objectIdentity, captureObject, isSameObject } from '../objectIdentity'
import { CHOSEN_COLOR_BINDING, CHOSEN_CREATURE_TYPE_BINDING } from '../cardPlugins/dsl/schema/v2'
import {
  evaluateObjectReference, evaluateObjectSelector, evaluatePlayerReference, evaluatePlayerSelector,
  evaluateCondition,
  evaluateRuntimeAmount,
} from '../cardPlugins/dsl/compiler/runtime'
import { PENDING_OPTION_SELECTION, openOptionSelection } from '../rules/selectOptions'
import type PluginCatalog from '../catalog'
import type { CardColor } from '../../../shared/cardColors'
import type {
  EventProcessingFrame,
  GameEvent,
  GameState,
  ObjectIdentity,
  ReduceResult,
  ReplacementProgramCursor,
} from '../types'
import { applyReplacementTransform } from './program'

import type { Instruction, ReplacementProgramInstruction, ReplacementTransform } from '../cardPlugins/dsl/schema/v2'

type NestedApply = (state: GameState, event: GameEvent, catalog: PluginCatalog) => ReduceResult

let nestedApply: NestedApply | undefined

export const registerNestedApply = (apply: NestedApply) => {
  nestedApply = apply
}

const COLORS = new Set<CardColor>(['W', 'U', 'B', 'R', 'G'])

const storeChosenColor = (frame: EventProcessingFrame, optionId: string) => {
  if (!COLORS.has(optionId as CardColor)) return
  const pending = frame.pendingEvent
  if (pending.type === 'move') {
    frame.pendingEvent = { ...pending, chosenColor: optionId as CardColor }
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

const sacrificeEventsFor = (
  instruction: Extract<Instruction, { kind: 'sacrifice' }>,
  context: {
    state: GameState
    controller: string
    source: ReturnType<typeof captureObject>
    optionChoices: ReplacementProgramCursor['bindings']
    choices: ReplacementProgramCursor['choices']
    results: ReplacementProgramCursor['results']
  },
  sourceId: string,
) => {
  const targets = instruction.targets.kind === 'objects'
    ? evaluateObjectSelector(instruction.targets, context)
    : evaluateObjectReference(instruction.targets, context)
  return targets
    .filter(object => object.zone === 'battlefield' && isSameObject(context.state.objects[object.id], objectIdentity(object)))
    .map(object => ({ type: 'sacrifice' as const, objectId: object.id, sourceId }))
}

const bindEmitResults = (
  program: ReplacementProgramCursor,
  counted: number,
  bindCount?: string,
  bindResult?: string,
) => {
  const results = { ...program.results }
  if (bindCount) results[bindCount] = counted
  if (bindResult) results[bindResult] = counted > 0
  program.results = results
  delete program.pendingEmit
}

const sacrificedAfter = (identity: ObjectIdentity | undefined, applied: GameState) =>
  Boolean(identity && !isSameObject(applied.objects[identity.objectId], identity))

const applyEmitEvents = (
  state: GameState,
  working: EventProcessingFrame,
  program: ReplacementProgramCursor,
  events: GameEvent[],
  counted: number,
  catalog: PluginCatalog | undefined,
  bindCount?: string,
  bindResult?: string,
  pendingIdentity?: ObjectIdentity,
): { kind: 'waiting'; state: GameState } | { kind: 'done'; state: GameState } => {
  if (!nestedApply || !catalog) {
    working.followUp = [...(working.followUp ?? []), ...events]
    bindEmitResults(program, counted + events.length, bindCount, bindResult)
    return { kind: 'done', state }
  }
  let current = state
  let remaining = events
  let currentCount = pendingIdentity && sacrificedAfter(pendingIdentity, current)
    ? counted + 1
    : counted
  while (remaining.length > 0) {
    const event = remaining[0]!
    const rest = remaining.slice(1)
    const object = event.type === 'sacrifice' ? current.objects[event.objectId] : undefined
    const identity = object ? objectIdentity(object) : undefined
    const isolated = {
      ...current,
      eventProcessing: undefined,
      deferredEventProcessing: undefined,
      resolution: undefined,
    }
    const applied = nestedApply(isolated, event, catalog)
    if (!applied.ok) {
      remaining = rest
      continue
    }
    if (applied.state.eventProcessing) {
      program.pendingEmit = {
        remaining: rest,
        counted: currentCount,
        ...(identity ? { pendingIdentity: identity } : {}),
        ...(bindCount ? { bindCount } : {}),
        ...(bindResult ? { bindResult } : {}),
      }
      const frames = [
        applied.state.eventProcessing,
        ...(applied.state.deferredEventProcessing ?? []),
        working,
        ...(state.deferredEventProcessing ?? []),
      ].filter((entry): entry is EventProcessingFrame => Boolean(entry))
      return {
        kind: 'waiting',
        state: {
          ...applied.state,
          eventProcessing: frames[0],
          deferredEventProcessing: frames.length > 1 ? frames.slice(1) : undefined,
          resolution: current.resolution,
        },
      }
    }
    if (sacrificedAfter(identity, applied.state)) currentCount += 1
    remaining = rest
    current = { ...applied.state, eventProcessing: working, resolution: current.resolution }
  }
  bindEmitResults(program, currentCount, bindCount, bindResult)
  return { kind: 'done', state: current }
}

export const advanceApplicationProgram = (
  state: GameState,
  frame: EventProcessingFrame,
  reopenChoice = false,
  catalog?: PluginCatalog,
) => {
  const draft = makeDraft(state)
  const working = draft.eventProcessing ?? structuredClone(frame)
  draft.eventProcessing = working
  const program = working.applicationProgram
  if (!program) return { kind: 'complete' as const, event: working.pendingEvent, state, followUp: [] as GameEvent[] }
  const followUp: GameEvent[] = []
  const runtime = () => {
    const source = draft.objects[program.sourceId]
    if (!source) return
    return {
      state: freezeDraft(draft),
      controller: program.controller,
      source: captureObject(source),
      optionChoices: program.bindings,
      choices: program.choices, results: program.results,
    }
  }
  const adopt = (next: GameState) => {
    const {
      enqueue, allocId, allocTs, note, object, move, zoneOf, addToStack, addTriggeredAbility,
    } = draft
    Object.assign(draft, structuredClone(next))
    draft.enqueue = enqueue
    draft.allocId = allocId
    draft.allocTs = allocTs
    draft.note = note
    draft.object = object
    draft.move = move
    draft.zoneOf = zoneOf
    draft.addToStack = addToStack
    draft.addTriggeredAbility = addTriggeredAbility
    draft.eventProcessing = working
    draft.pending = []
  }
  if (program.pendingEmit) {
    const pending = program.pendingEmit
    const stepped = applyEmitEvents(
      freezeDraft(draft), working, program, pending.remaining, pending.counted, catalog,
      pending.bindCount, pending.bindResult, pending.pendingIdentity,
    )
    if (stepped.kind === 'waiting') return stepped
    adopt(stepped.state)
    program.index += 1
  }
  while (program.index < program.instructions.length) {
    const instruction = program.instructions[program.index]!
    switch (instruction.kind) {
      case 'choosePlayer': {
        const context = runtime()
        const candidates = context ? evaluatePlayerSelector(instruction.filter, context) : []
        const chooser = context ? evaluatePlayerReference(instruction.chooser, context)[0] : undefined
        if (chooser && candidates.length > 0) {
          openPlayerSelection(draft, {
            seat: chooser, sourceId: program.sourceId, source: draft.objects[program.sourceId]?.name ?? '', prompt: 'Choose a player.', min: 1, max: 1, candidates,
            action: { kind: REPLACEMENT_APPLICATION_PLAYER_CHOICE, frameId: frame.id, binding: instruction.bindChoice },
          })
          persistFollowUp(working, followUp)
          return { kind: 'waiting' as const, state: freezeDraft(draft) }
        }
        program.choices = { ...program.choices, [instruction.bindChoice]: [] }
        program.index += 1
        continue
      }
      case 'chooseCards': {
        const context = runtime()
        const chooser = context ? evaluatePlayerReference(instruction.chooser, context)[0] : undefined
        const candidates = context ? evaluateObjectSelector(instruction.filter, context) : []
        const visibleCards = context && instruction.viewCards ? evaluateObjectReference(instruction.viewCards, context).map(object => object.id) : undefined
        const min = Math.min(context ? evaluateRuntimeAmount(instruction.min, context) : 0, candidates.length)
        const max = Math.min(context ? evaluateRuntimeAmount(instruction.max, context) : 0, candidates.length)
        program.choices = { ...program.choices, [instruction.bindChoice]: [] }
        if (chooser && (reopenChoice || (candidates.length > 0 && max > 0) || (visibleCards?.length ?? 0) > 0)) {
          openCardSelection(draft, {
            seat: chooser, sourceId: program.sourceId, source: draft.objects[program.sourceId]?.name ?? 'Replacement',
            kind: 'choose', min, count: max, candidates: candidates.map(object => object.id),
            prompt: 'Choose cards for the entry replacement.', destinations: ['target', 'skip'],
            targetIdentities: Object.fromEntries(candidates.map(object => [object.id, objectIdentity(object)])),
            canonicalChoice: { stackId: '', binding: instruction.bindChoice, action: REPLACEMENT_APPLICATION_CARD_CHOICE, replacementFrameId: frame.id },
            ...(visibleCards ? { visibleCards } : {}),
            ...(instruction.viewLibrary ? { viewLibrary: true as const } : {}),
            ...(instruction.filter.filter.zone && instruction.filter.filter.zone !== 'battlefield' ? { fromZone: instruction.filter.filter.zone, fromSeat: chooser } : {}),
          })
          persistFollowUp(working, followUp)
          return { kind: 'waiting' as const, state: freezeDraft(draft) }
        }
        program.index += 1
        continue
      }
      case 'captureAmount': {
        const context = runtime()
        if (context) program.results = { ...program.results, [instruction.bindResult]: evaluateRuntimeAmount(instruction.amount, context) }
        program.index += 1
        continue
      }
      case 'reveal': {
        const context = runtime()
        const targets = context ? instruction.targets.kind === 'objects' ? evaluateObjectSelector(instruction.targets, context) : evaluateObjectReference(instruction.targets, context) : []
        const owners = new Set(targets.map(object => object.owner))
        const sourceName = draft.objects[program.sourceId]?.name
        for (const seat of owners) followUp.push({
          type: 'reveal',
          seat,
          objectIds: targets.filter(object => object.owner === seat).map(object => object.id),
          ...(sourceName ? { source: sourceName } : {}),
        })
        program.index += 1
        continue
      }
      case 'shuffle': {
        const context = runtime()
        const seats = !context
          ? []
          : instruction.targets.kind === 'players'
            ? evaluatePlayerSelector(instruction.targets, context)
            : evaluatePlayerReference(instruction.targets, context)
        for (const seat of seats) followUp.push({ type: 'shuffleLibrary', seat })
        program.index += 1
        continue
      }
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
            changes: {
              ...program.transform.changes, ...instruction.changes,
              ...(instruction.changes.enterCounters ? { enterCounters: {
                ...program.transform.changes.enterCounters,
                ...Object.fromEntries(Object.entries(instruction.changes.enterCounters).map(([name, amount]) => [name,
                  program.transform.kind === 'modifyEvent' && program.transform.changes.enterCounters?.[name]
                    ? { kind: 'add' as const, left: program.transform.changes.enterCounters[name], right: amount }
                    : amount,
                ])),
              } } : {}),
            },
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
        const context = runtime()
        const events: GameEvent[] = []
        let bindCount: string | undefined
        let bindResult: string | undefined
        for (const inner of instruction.instructions) {
          if (inner.kind !== 'sacrifice') continue
          if (context) events.push(...sacrificeEventsFor(inner, context, program.sourceId))
          bindCount = inner.bindCount ?? bindCount
          bindResult = inner.bindResult ?? bindResult
        }
        const stepped = applyEmitEvents(
          freezeDraft(draft), working, program, events, 0, catalog, bindCount, bindResult,
        )
        if (stepped.kind === 'waiting') {
          persistFollowUp(working, followUp)
          return stepped
        }
        adopt(stepped.state)
        program.index += 1
        continue
      }
    }
  }
  const transformed = applyReplacementTransform(working.pendingEvent, program.transform, working.lineage, runtime())
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
  optionId: string | readonly string[],
  catalog?: PluginCatalog,
) => {
  const draft = makeDraft(state)
  const frame = draft.eventProcessing
  const program = frame?.applicationProgram
  if (!frame || frame.id !== frameId || !program) {
    return { kind: 'invalid' as const, error: 'replacement program choice is not active' }
  }
  const instruction = program.instructions[program.index]
  if (instruction?.kind === 'choosePlayer' && typeof optionId !== 'string' && instruction.bindChoice === bindChoice) {
    program.choices = { ...program.choices, [bindChoice]: optionId.map(playerId => ({ kind: 'player' as const, playerId })) }
    program.index += 1
    return advanceApplicationProgram(freezeDraft(draft), frame, false, catalog)
  }
  if (instruction?.kind === 'chooseCards' && typeof optionId !== 'string' && instruction.bindChoice === bindChoice) {
    program.choices = { ...program.choices, [bindChoice]: optionId.map(id => ({ kind: 'object' as const, ...objectIdentity(draft.objects[id]!) })) }
    program.index += 1
    return advanceApplicationProgram(freezeDraft(draft), frame, false, catalog)
  }
  if (!instruction || instruction.kind !== 'choose' || instruction.bindChoice !== bindChoice || typeof optionId !== 'string') {
    return { kind: 'invalid' as const, error: 'replacement program choice is not authorized' }
  }
  const chooser = frame.chooser
  if (chooser) delete draft.players[chooser].data[PENDING_OPTION_SELECTION]
  program.bindings[bindChoice] = optionId
  if (bindChoice === CHOSEN_CREATURE_TYPE_BINDING && isCreatureType(optionId)) {
    if (frame.pendingEvent.type === 'move') frame.pendingEvent = { ...frame.pendingEvent, chosenType: optionId }
    const source = draft.objects[program.sourceId]
    if (source) source.chosenType = optionId
  }
  if (bindChoice === CHOSEN_COLOR_BINDING) {
    storeChosenColor(frame, optionId)
    const source = draft.objects[program.sourceId]
    if (source && COLORS.has(optionId as CardColor)) {
      source.chosenColor = optionId as CardColor
      draft.note(`${chooser ?? source.controller} chooses ${optionId} for ${source.name}`)
    }
  }
  program.index += 1
  draft.eventProcessing = frame
  return advanceApplicationProgram(freezeDraft(draft), frame, false, catalog)
}
