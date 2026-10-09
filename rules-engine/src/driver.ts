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

export const CANONICAL_RUNTIME_INSTRUCTIONS = [
  'counter',
  'damage',
  'destroy',
  'draw',
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
      case 'counter':
        return
      default:
        throw new Error(`${instructionPath}: ${instruction.kind} is not executable in Part 04`)
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
  if ('modes' in ability) {
    throw new Error(`${declarationPath}.modes: modal execution begins in Part 09`)
  }
  if (ability.decisions.modes || ability.decisions.distributions) {
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
  preflightInstructions(ability.instructions, `${declarationPath}.instructions`)
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
      instructions: structuredClone(ability.instructions),
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
      const targets = instruction.targets.kind === 'objects'
        ? evaluateObjectSelector(instruction.targets, context)
        : evaluateObjectReference(instruction.targets, context)
      return targets.flatMap((object) => hasKeyword(object, 'indestructible', context.state)
        ? []
        : [{ type: 'move' as const, objectId: object.id, to: 'graveyard' as const }])
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
