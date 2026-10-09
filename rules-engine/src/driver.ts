import { finishedSpellZone } from './cardPlugins/alternateCosts'
import { isSameObject } from './objectIdentity'
import {
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  evaluateStackItemSelector,
  type BoundRecipient,
  evaluateStackItemReference,
  type RuleDslRuntimeContext,
} from './cardPlugins/dsl/compiler/runtime'
import { canonicalTargetLegalityForAbility, canonicalScopeId } from './cardPlugins/dsl/compiler/targeting'
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
  TargetRef,
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

const spellAbility = (item: StackItem) => {
  const snapshot = item.execution?.definitionSnapshot
  if (!snapshot) return
  const compiled = loadDefinitionSnapshot(snapshot)
  const spells = compiled.definition.abilities.flatMap((ability, index) =>
    ability.kind === 'spell' ? [{ ability, index }] : [])
  if (spells.length !== 1) {
    throw new Error(`canonical spell requires exactly one spell ability; found ${spells.length}`)
  }
  return spells[0]
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
  return item?.kind === 'spell' && item.execution?.definitionSnapshot ? item : undefined
}

export const startCanonicalResolution = (
  draft: Draft,
  item: StackItem,
) => {
  const selected = spellAbility(item)
  if (!selected) throw new Error('canonical spell is missing its pinned definition')
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
  const targetLegality = targetBindings.length > 0
    ? canonicalTargetLegalityForAbility(draft, sourceObject, ability, targetBindings, item)
    : {}
  const targetCount = targetBindings.reduce((total, binding) => total + binding.recipients.length, 0)
  const legalCount = targetBindings.reduce((total, binding) =>
    total + (targetLegality[binding.clauseIndex] ?? []).filter(Boolean).length, 0)
  const allTargetsIllegal = targetCount > 0 && legalCount === 0
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
    targetLegality: structuredClone(targetLegality),
    ...(allTargetsIllegal ? { outcome: 'didNotResolve:allTargetsIllegal' as const } : {}),
    scopes: [{
      path: '.instructions',
      instructions: structuredClone(ability.instructions),
      cursor: 0,
    }],
    phase: 'running',
  }
  if (allTargetsIllegal) frame.scopes = []
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
  targets: Object.fromEntries((frame.targetBindings ?? [])
    .filter((binding) => binding.scopeId === (frame.scopeId ?? binding.scopeId))
    .map((binding): [number, BoundRecipient[]] => [binding.clauseIndex, binding.recipients.flatMap((target): BoundRecipient[] => {
      switch (target.kind) {
        case 'player': return [{ kind: 'player' as const, playerId: target.player }]
        case 'stackItem': return [{ kind: 'stackItem' as const, stackId: target.stackId }]
        case 'object': {
          if (target.incarnation === undefined || target.zone === undefined) return []
          return [{ kind: 'object' as const, objectId: target.objectId, incarnation: target.incarnation, zone: target.zone }]
        }
      }
    })])),
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

const availableAmount = (expression: Parameters<typeof evaluateRuntimeAmount>[0], context: RuleDslRuntimeContext) => {
  try {
    return evaluateRuntimeAmount(expression, context)
  } catch (error) {
    if (error instanceof RuleDslEvaluationError) return undefined
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
      const recipients: Array<{ kind: 'player'; player: string } | Extract<TargetRef, { kind: 'object' }>> = []
      switch (instruction.targets.kind) {
        case 'players': recipients.push(...evaluatePlayerSelector(instruction.targets, context).map((player) => ({ kind: 'player' as const, player }))); break
        case 'objects': recipients.push(...evaluateObjectSelector(instruction.targets, context).map((object) => ({ kind: 'object' as const, objectId: object.id, incarnation: object.incarnation, zone: object.zone }))); break
        case 'targetRef':
          for (const target of context.targets?.[instruction.targets.clauseIndex] ?? []) {
            if (target.kind === 'player') recipients.push({ kind: 'player', player: target.playerId })
            if (target.kind === 'object') recipients.push({ kind: 'object', objectId: target.objectId, incarnation: target.incarnation, zone: target.zone })
          }
          break
        case 'choiceRef':
          for (const player of evaluatePlayerReference(instruction.targets, context)) recipients.push({ kind: 'player', player })
          break
      }
      const amount = availableAmount(instruction.amount, context)
      if (amount === undefined || amount === 0) return []
      const source = frame.source.ref.objectId
      return recipients.map((target) => ({ type: 'dealDamage' as const, sourceId: source, target, amount }))
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
        ? context.targets?.[instruction.targets.clauseIndex]?.filter((target) => target.kind === 'stackItem') ?? []
        : instruction.targets.kind === 'stackItems'
          ? evaluateStackItemSelector(instruction.targets, context).map((item) => ({ kind: 'stackItem' as const, stackId: item.id }))
          : evaluateStackItemReference(instruction.targets, context)
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = {
        binding: instruction.bindResult,
        kind: 'counter',
        stackId: targets[0].kind === 'stackItem' ? targets[0].stackId : targets[0].id,
      }
      return targets.flatMap((target) => target.kind === 'stackItem'
        ? [{ type: 'counterStackItem' as const, stackId: target.stackId, sourceId: frame.source.ref.objectId }]
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
  const event = !item.copy && object?.zone === 'stack' && isSameObject(object, frame.source.ref)
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
