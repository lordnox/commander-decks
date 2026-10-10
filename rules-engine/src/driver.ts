import { finishedSpellZone } from './cardPlugins/alternateCosts'
import { isSameObject, objectIdentity } from './objectIdentity'
import {
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluateBoundRecipients,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  evaluateStackItemSelector,
  type BoundRecipient,
  type RuleDslRuntimeContext,
} from './cardPlugins/dsl/compiler/runtime'
import { canonicalScopeId, canonicalWholeItemGate } from './cardPlugins/dsl/compiler/targeting'
import { loadDefinitionSnapshot } from './cardPlugins/dsl/compiler'
import { RuleDslEvaluationError } from './cardPlugins/dsl/compiler/errors'
import type {
  Condition,
  Instruction,
  PlayerRecipient,
} from './cardPlugins/dsl/schema/v1'
import type Draft from './draft'
import type {
  GameEvent,
  GameState,
  CanonicalResolutionFrame,
  StackItem,
  GameObject,
} from './types'
import { hasKeyword } from './keywords'
import { openOptionSelection } from './rules/selectOptions'
import { openCardSelection } from './rules/selectCards'

export const CANONICAL_RUNTIME_INSTRUCTIONS = [
  'counter',
  'damage',
  'destroy',
  'sacrifice',
  'move',
  'phase',
  'proliferate',
  'createToken',
  'copy',
  'putCounters',
  'draw',
  'mill',
  'discard',
  'gainLife',
  'loseLife',
] as const

const canonicalAbility = (item: StackItem) => {
  const snapshot = item.execution?.definitionSnapshot
  if (!snapshot) return
  const compiled = loadDefinitionSnapshot(snapshot)
  const abilityIndex = item.execution?.abilityIndex
  if (abilityIndex !== undefined) {
    const ability = compiled.definition.abilities[abilityIndex]
    if (!ability || (ability.kind !== 'activated' && ability.kind !== 'spell' && ability.kind !== 'triggered')) {
      throw new Error(`canonical ability index ${abilityIndex} is not executable`)
    }
    return { ability, index: abilityIndex }
  }
  const abilities = compiled.definition.abilities.flatMap((ability, index) =>
    ability.kind === (item.kind === 'spell' ? 'spell' : 'triggered') ? [{ ability, index }] : [])
  if (abilities.length !== 1) throw new Error(`canonical ${item.kind} requires exactly one executable ability; found ${abilities.length}`)
  return abilities[0]
}

const preflightInstructions = (
  instructions: readonly Instruction[],
  path: string,
) => {
  instructions.forEach((instruction, index) => {
    const instructionPath = `${path}[${index}]`
    if (instruction.kind === 'sequence') {
      preflightInstructions(instruction.instructions, `${instructionPath}.instructions`)
      return
    }
    switch (instruction.kind) {
      case 'draw':
      case 'gainLife':
      case 'loseLife':
      case 'damage':
      case 'destroy':
      case 'sacrifice':
      case 'move':
      case 'phase':
      case 'proliferate':
      case 'createToken':
      case 'copy':
      case 'putCounters':
      case 'counter':
      case 'mill':
      case 'discard':
        return
      case 'if':
        preflightInstructions(instruction.then, `${instructionPath}.then`)
        preflightInstructions(instruction.otherwise, `${instructionPath}.otherwise`)
        return
      case 'chooseInstructions':
      case 'chooseCards':
        return
      default:
        throw new Error(`${instructionPath}: unsupported canonical instruction`)
    }
  })
}

const pathError = (frame: CanonicalResolutionFrame, path: string, message: string) =>
  new Error(`${frame.declarationPath}${path}: ${message}`)

export const canonicalResolutionCandidate = (state: GameState) => {
  const item = state.stack[0]
  if (!item?.execution?.definitionSnapshot) return
  if (item.kind === 'spell') return item
  if (item.kind === 'ability' && item.execution.abilityIndex !== undefined) return item
}

export const startCanonicalResolution = (
  draft: Draft,
  item: StackItem,
) => {
  const selected = canonicalAbility(item)
  if (!selected) throw new Error('canonical stack item is missing its pinned definition')
  const { ability, index: abilityIndex } = selected
  const declarationPath = `$.abilities[${abilityIndex}]`
  const selectedInstructions = 'modes' in ability
    ? (item.execution?.modeIndices ?? []).flatMap((index) => ability.modes?.[index]?.instructions ?? [])
    : ability.instructions
  if ('modes' in ability && selectedInstructions.length === 0) {
    throw new Error(`${declarationPath}.modes: a mode must be selected before resolution`)
  }
  if (ability.decisions.distributions) {
    throw new Error(`${declarationPath}.decisions: Part 03 executes only fully supplied plain programs`)
  }
  const source = item.execution?.source
  const definitionSnapshot = item.execution?.definitionSnapshot
  if (!source || !definitionSnapshot) throw new Error('canonical spell is missing execution context')
  const variables = ability.decisions.variables ?? []
  for (const variable of variables) {
    const value = item.x
    if (value === undefined || value < variable.min || value > variable.max) {
      throw new Error(`${declarationPath}.decisions.variables: ${variable.name} is outside its declared bounds`)
    }
  }
  preflightInstructions(selectedInstructions, `${declarationPath}.modes`)
  const targetBindings = item.execution?.targetBindings ?? []
  const liveSource = draft.object(source.ref.objectId)
  const sourceObject = liveSource && isSameObject(liveSource, source.ref)
    ? liveSource
    : source.snapshot
  const gate = canonicalWholeItemGate(draft, sourceObject, ability, targetBindings, item)
  const frame: CanonicalResolutionFrame = {
    version: 1,
    kind: 'canonicalSpell',
    stackId: item.id,
    controller: item.controller,
    intendedPriority: draft.active,
    definitionSnapshot: structuredClone(definitionSnapshot),
    declarationPath,
    source: structuredClone(source),
    scopeId: canonicalScopeId(abilityIndex),
    targetBindings: structuredClone(targetBindings),
    targetLegality: structuredClone(gate.targetLegality),
    ...(gate.outcome === 'resolved' ? {} : { outcome: gate.outcome }),
    scopes: [{
      path: '.instructions',
      instructions: structuredClone(selectedInstructions),
      cursor: 0,
    }],
    phase: 'running',
  }
  frame.targetLegality = structuredClone(gate.targetLegality)
  if (gate.outcome !== 'resolved') frame.scopes = []
  draft.resolution = frame
  draft.priority = null
  draft.passedInRow = []
  return frame
}

const runtimeContext = (
  state: GameState,
  frame: CanonicalResolutionFrame,
  item: StackItem,
) => ({
  state,
  controller: frame.controller,
  source: frame.source,
  stackItemId: item.id,
  ...(item.execution?.occurrence ? { occurrence: item.execution.occurrence } : {}),
  targets: (() => {
    const targets: Record<number, BoundRecipient[]> = Object.fromEntries((frame.targetBindings ?? [])
      .filter((binding) => binding.scopeId === (frame.scopeId ?? binding.scopeId))
      .map((binding) => {
        const recipients: BoundRecipient[] = []
        for (const target of binding.recipients) {
          switch (target.kind) {
            case 'player': recipients.push({ kind: 'player', playerId: target.player }); break
            case 'stackItem': recipients.push({ kind: 'stackItem', stackId: target.stackId }); break
            case 'object':
              if (target.incarnation !== undefined && target.zone !== undefined) {
                recipients.push({ kind: 'object', objectId: target.objectId, incarnation: target.incarnation, zone: target.zone })
              }
              break
          }
        }
        return [binding.clauseIndex, recipients] as const
      }))
    return targets
  })(),
  choices: frame.choices,
  targetLegality: frame.targetLegality,
  results: frame.results,
  ...(item.x === undefined ? {} : { variables: { X: item.x } }),
})

const recipients = (
  recipient: PlayerRecipient,
  context: RuleDslRuntimeContext,
) => recipient.kind === 'players'
  ? evaluatePlayerSelector(recipient, context)
  : evaluatePlayerReference(recipient, context)

type DamageRecipient = Extract<GameEvent, { type: 'dealDamage' }>['target']

const objectRecipients = (objects: readonly GameObject[]) => objects.map((object) => ({
  kind: 'object' as const,
  objectId: object.id,
  incarnation: object.incarnation,
  zone: object.zone,
})) as DamageRecipient[]

const objectActions = (
  recipient: Extract<Instruction, { kind: 'destroy' | 'sacrifice' | 'move' | 'phase' | 'copy' | 'putCounters' }>['targets'],
  context: RuleDslRuntimeContext,
) => recipient.kind === 'objects'
  ? evaluateObjectSelector(recipient, context)
  : evaluateObjectReference(recipient, context)

const boundDamageRecipients = (bound: BoundRecipient) => {
  const boundTargets: DamageRecipient[] = []
  switch (bound.kind) {
    case 'player': boundTargets.push({ kind: 'player', player: bound.playerId }); break
    case 'object': boundTargets.push({ kind: 'object', objectId: bound.objectId, incarnation: bound.incarnation, zone: bound.zone }); break
    case 'stackItem': break
  }
  return boundTargets
}

const mixedRecipients = (recipient: Extract<Instruction, { kind: 'damage' }>['targets'], context: RuleDslRuntimeContext) => {
  const damageTargets: DamageRecipient[] = []
  switch (recipient.kind) {
    case 'players': damageTargets.push(...evaluatePlayerSelector(recipient, context).map((player) => ({ kind: 'player' as const, player }))); break
    case 'objects': damageTargets.push(...objectRecipients(evaluateObjectSelector(recipient, context))); break
    case 'targetRef':
    case 'choiceRef':
      damageTargets.push(...evaluateBoundRecipients(recipient, context).flatMap(boundDamageRecipients)); break
    case 'contextRef':
      if (recipient.name === 'source') damageTargets.push(...objectRecipients(evaluateObjectReference(recipient, context, 'currentOrLastKnown')))
      else damageTargets.push(...evaluatePlayerReference(recipient, context).map((player) => ({ kind: 'player' as const, player })))
  }
  return damageTargets
}

const capturedDamageSource = (source: GameObject, context: RuleDslRuntimeContext) => ({
  ref: source.id === context.source.ref.objectId && !isSameObject(context.state.objects[source.id], context.source.ref)
    ? context.source.ref
    : objectIdentity(source),
  snapshot: structuredClone(source),
  information: isSameObject(context.state.objects[source.id], objectIdentity(source)) ? 'current' as const : 'lastKnown' as const,
})

const availableAmount = (expression: Parameters<typeof evaluateRuntimeAmount>[0], context: RuleDslRuntimeContext) => {
  try {
    return evaluateRuntimeAmount(expression, context)
  } catch (error) {
    if (
      error instanceof RuleDslEvaluationError
      && expression.kind === 'characteristic'
      && expression.of.kind === 'targetRef'
    ) {
      const bound = evaluateBoundRecipients(expression.of, context)
      if (bound.length === 0) return undefined
      if (expression.information === 'current'
        && evaluateObjectReference(expression.of, context, 'current').length === 0) return undefined
    }
    throw error
  }
}

const conditionValue = (condition: Condition, context: RuleDslRuntimeContext): boolean => {
  switch (condition.kind) {
    case 'resultIsTrue': return context.results?.[condition.value.binding] === true
    case 'compareAmount': {
      const left = evaluateRuntimeAmount(condition.left, context)
      const right = evaluateRuntimeAmount(condition.right, context)
      switch (condition.operator) {
        case 'eq': return left === right
        case 'gte': return left >= right
        case 'lte': return left <= right
      }
    }
    case 'all': return condition.conditions.every((entry) => conditionValue(entry, context))
    case 'any': return condition.conditions.some((entry) => conditionValue(entry, context))
    case 'not': return !conditionValue(condition.condition, context)
  }
}

const actionEvents = (
  instruction: Instruction,
  context: RuleDslRuntimeContext,
  frame: CanonicalResolutionFrame,
  path: string,
) => {
  switch (instruction.kind) {
    case 'draw': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction.count, context)
      if (amount === undefined || amount === 0) return []
      return targets.map((seat) => ({ type: 'draw' as const, seat, count: amount }))
    }
    case 'gainLife':
    case 'loseLife': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction.amount, context)
      if (amount === undefined || amount === 0) return []
      return targets.map((seat) => ({
        type: instruction.kind,
        seat,
        amount,
        source: frame.source.ref.objectId,
      }))
    }
    case 'damage': {
      const damageRecipients = mixedRecipients(instruction.targets, context)
      const amount = availableAmount(instruction.amount, context)
      if (amount === undefined || amount === 0) return []
      const sources = evaluateObjectReference(instruction.source, context, 'currentOrLastKnown')
      if (sources.length !== 1) return []
      const source = sources[0]
      return damageRecipients.map((target) => ({
        type: 'dealDamage' as const,
        sourceId: source.id,
        sourceSnapshot: capturedDamageSource(source, context),
        target,
        amount,
      }))
    }
    case 'destroy': {
      const targets = objectActions(instruction.targets, context)
      const legal = targets.filter((object) => !hasKeyword(object, 'indestructible', context.state))
      if (instruction.bindResult && legal.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: true }
      return legal.flatMap((object) => hasKeyword(object, 'indestructible', context.state)
        ? []
        : [{ type: 'destroy' as const, objectId: object.id, sourceId: frame.source.ref.objectId }])
    }
    case 'sacrifice': {
      const targets = objectActions(instruction.targets, context)
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: true }
      return targets.map((object) => ({ type: 'sacrifice' as const, objectId: object.id, sourceId: frame.source.ref.objectId }))
    }
    case 'move': {
      const targets = objectActions(instruction.targets, context)
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: true }
      return targets.map((object) => ({ type: 'move' as const, objectId: object.id, to: instruction.to }))
    }
    case 'phase': {
      const targets = objectActions(instruction.targets, context)
      return targets.map((object) => ({ type: instruction.out ? 'phaseOut' as const : 'phaseIn' as const, objectId: object.id }))
    }
    case 'proliferate': {
      return recipients(instruction.targets, context).map((seat) => ({ type: 'proliferate' as const, seat, sourceId: frame.source.ref.objectId }))
    }
    case 'createToken': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction.count, context)
      if (!amount || !targets.length) return []
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: amount }
      return targets.flatMap((seat) => Array.from({ length: amount }, () => ({
        type: 'createToken' as const,
        controller: seat,
        token: {
          ...instruction.token,
          types: [...instruction.token.types],
          ...(instruction.token.subtypes ? { subtypes: [...instruction.token.subtypes] } : {}),
          ...(instruction.token.colors ? { colors: [...instruction.token.colors] } : {}),
        },
      })))
    }
    case 'copy': {
      const targets = objectActions(instruction.targets, context)
      return targets.map((object) => ({
        type: 'copyPermanent' as const,
        objectId: object.id,
        controller: instruction.controller
          ? (instruction.controller.kind === 'players'
            ? evaluatePlayerSelector(instruction.controller, context)[0]
            : evaluatePlayerReference(instruction.controller, context)[0]) ?? context.controller
          : context.controller,
        sourceId: frame.source.ref.objectId,
      }))
    }
    case 'putCounters': {
      const targets = objectActions(instruction.targets, context)
      const amount = availableAmount(instruction.count, context)
      if (amount === undefined || amount === 0) return []
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: amount }
      return targets.map((object) => ({ type: 'putCounters' as const, objectId: object.id, counter: instruction.counter, count: amount }))
    }
    case 'mill': {
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction.count, context)
      if (amount === undefined || amount === 0) return []
      return targets.flatMap((seat) => (context.state.zoneOrder[seat].library ?? []).slice(0, amount)
        .map((objectId) => ({ type: 'mill' as const, seat, objectId, sourceId: frame.source.ref.objectId })))
    }
    case 'discard': {
      if (instruction.by !== undefined) {
        const by = evaluatePlayerReference(instruction.by, context)[0]
        const targets = instruction.targets.kind === 'objects'
          ? evaluateObjectSelector(instruction.targets, context)
          : evaluateObjectReference(instruction.targets, context)
        return targets.map((object) => ({ type: 'discard' as const, seat: by, objectId: object.id }))
      }
      const targets = recipients(instruction.targets, context)
      const amount = availableAmount(instruction.count, context)
      if (amount === undefined || amount === 0) return []
      return targets.flatMap((seat) => (context.state.zoneOrder[seat].hand ?? []).slice(0, amount)
        .map((objectId) => ({ type: 'discard' as const, seat, objectId })))
    }
    case 'counter': {
      const targets = instruction.targets.kind === 'targetRef'
        ? evaluateBoundRecipients(instruction.targets, context).filter((target) => target.kind === 'stackItem')
        : instruction.targets.kind === 'stackItems'
          ? evaluateStackItemSelector(instruction.targets, context).map((item) => ({ kind: 'stackItem' as const, stackId: item.id }))
          : evaluateBoundRecipients(instruction.targets, context).filter((target) => target.kind === 'stackItem')
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = {
        binding: instruction.bindResult,
        kind: 'counter',
          stackId: targets[0].stackId,
      }
      const counterEvent = (stackId: string) => {
        const item = context.state.stack.find((candidate) => candidate.id === stackId)
        const object = item ? context.state.objects[item.objectId] : undefined
        return {
          type: 'counterStackItem' as const,
          stackId,
          sourceId: frame.source.ref.objectId,
          ...(object ? { objectRef: objectIdentity(object) } : {}),
        }
      }
      return targets.flatMap((target) => target.kind === 'stackItem'
        ? [counterEvent(target.stackId)]
        : [])
    }
    default:
      throw pathError(frame, path, `${instruction.kind} is not executable in Part 04`)
  }
}

export type DriverStep =
  | { kind: 'events'; events: GameEvent[] }
  | { kind: 'complete'; event?: GameEvent }

/**
 * Advance data-only cursors until one semantic instruction is ready. The caller
 * commits the returned events before changing `phase` back to `running`.
 */
export const prepareResolutionStep = (draft: Draft) => {
  const frame = draft.resolution
  if (!frame) throw new Error('no resolution frame is active')
  if (frame.kind !== 'canonicalSpell') throw new Error('active resolution is not canonical')
  const item = draft.stack.find((candidate) => candidate.id === frame.stackId)
  if (!item) throw new Error(`resolution stack item ${frame.stackId} is missing`)
  while (frame.scopes.length > 0) {
    const scope = frame.scopes.at(-1)!
    if (scope.cursor >= scope.instructions.length) {
      frame.scopes.pop()
      continue
    }
    const index = scope.cursor
    const instruction = scope.instructions[index]
    scope.cursor += 1
    const path = `${scope.path}[${index}]`
    if (instruction.kind === 'sequence') {
      frame.scopes.push({
        path: `${path}.instructions`,
        instructions: structuredClone(instruction.instructions),
        cursor: 0,
      })
      continue
    }
    if (instruction.kind === 'if') {
      const context = runtimeContext(draft, frame, item)
      const takeThen = conditionValue(instruction.condition, context)
      const branch = takeThen ? instruction.then : instruction.otherwise
      if (branch.length > 0) {
        frame.scopes.push({
          path: `${path}.${takeThen ? 'then' : 'otherwise'}`,
          instructions: structuredClone(branch),
          cursor: 0,
        })
      }
      continue
    }
    if (instruction.kind === 'chooseInstructions') {
      const context = runtimeContext(draft, frame, item)
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      if (chooser && instruction.options.length > 0) {
        openOptionSelection(draft, {
          seat: chooser,
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose an instruction program.',
          options: instruction.options.map((_option, optionIndex) => ({ id: `instruction:${optionIndex}`, label: `Option ${optionIndex + 1}` })),
          action: {
            kind: 'canonicalInstructionChoice',
            stackId: frame.stackId,
            options: instruction.options.map((option, optionIndex) => ({ id: `instruction:${optionIndex}`, instructions: [...option.instructions] })),
          },
        })
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'chooseCards') {
      const context = runtimeContext(draft, frame, item)
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      const candidates = evaluateObjectSelector(instruction.filter, context)
      const min = availableAmount(instruction.min, context) ?? 0
      const max = availableAmount(instruction.max, context) ?? min
      if (chooser && candidates.length > 0 && max > 0) {
        openCardSelection(draft, {
          seat: chooser,
          kind: 'choose',
          count: max,
          min,
          candidates: candidates.map((object) => object.id),
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose cards for the Rule DSL program.',
          destinations: ['target', 'skip'],
          canonicalChoice: { stackId: frame.stackId, binding: instruction.bindChoice },
        })
      } else if (min === 0) {
        frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    frame.phase = 'committing'
    const events = actionEvents(instruction, runtimeContext(draft, frame, item), frame, path)
    frame.pendingEvents = structuredClone(events)
    return {
      kind: 'events',
      events,
    }
  }
  const object = draft.object(item.objectId)
  const event = item.kind === 'spell'
    && !item.copy
    && object?.zone === 'stack'
    && isSameObject(object, frame.source.ref)
    ? {
        type: 'move' as const,
        objectId: object.id,
        to: finishedSpellZone(
          item,
          (item.adventureCast ? 'exile' : 'graveyard'),
        ),
      }
    : undefined
  return { kind: 'complete', event }
}

export const finishResolution = (draft: Draft) => {
  const frame = draft.resolution
  if (!frame) return
  if (frame.kind === 'canonicalSpell') {
    const outcome = frame.outcome ?? 'resolved'
    draft.note(`${frame.kind} ${frame.stackId} ${outcome}`)
  }
  draft.stack = draft.stack.filter((item) => item.id !== frame.stackId)
  draft.priority = frame.intendedPriority
  draft.passedInRow = []
  delete draft.resolution
}
