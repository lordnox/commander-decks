import { finishedSpellZone } from './cardPlugins/alternateCosts'
import { isSameObject, objectIdentity } from './objectIdentity'
import {
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluateBoundRecipients,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  amountEvaluationContext,
  evaluateCondition,
  evaluateStackItemSelector,
  type BoundRecipient,
  type RuleDslRuntimeContext,
} from './cardPlugins/dsl/compiler/runtime'
import { canonicalModeScopeId, canonicalScopeId, canonicalWholeItemGate } from './cardPlugins/dsl/compiler/targeting'
import { validateModeSelection, validateScopedDistributions } from './cardPlugins/dsl/compiler/modes'
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
import { openOptionSelection } from './rules/selectOptions'
import { openCardSelection } from './rules/selectCards'
import { openPlayerSelection } from './rules/selectPlayers'
import { copyCharacteristics } from './cardPlugins/effectRuntime'
import { apnapSeats } from './turnOrder'
import { ceaseToExist } from './rules/spellCopies'

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
  'copySpell',
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
      case 'addMana':
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
      case 'copySpell':
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
  options: { inline?: boolean } = {},
) => {
  const selected = canonicalAbility(item)
  if (!selected) throw new Error('canonical stack item is missing its pinned definition')
  const { ability, index: abilityIndex } = selected
  const declarationPath = `$.abilities[${abilityIndex}]`
  const selectedModes = 'modes' in ability ? (item.execution?.modeIndices ?? []) : []
  if ('modes' in ability) {
    const modeSpec = ability.decisions.modes
    if (!modeSpec) throw new Error(`${declarationPath}.decisions.modes: modal program is missing its mode specification`)
    const modeTotal = modeSpec.count.kind === 'constant' ? modeSpec.count.value : item.x
    if (modeTotal === undefined) throw new Error(`${declarationPath}.decisions.modes.count: mode count is not bound`)
    validateModeSelection(modeSpec, ability.modes?.length ?? 0, modeTotal, selectedModes)
  }
  const selectedInstructions = 'modes' in ability
    ? selectedModes.flatMap((index) => ability.modes?.[index]?.instructions ?? [])
    : ability.instructions
  if ('modes' in ability && selectedInstructions.length === 0) {
    throw new Error(`${declarationPath}.modes: a mode must be selected before resolution`)
  }
  const source = item.execution?.source
  const definitionSnapshot = item.execution?.definitionSnapshot
  if (!source || !definitionSnapshot) throw new Error('canonical spell is missing execution context')
  if (ability.decisions.distributions) {
    const allocations = item.execution?.distributionBindings
    if (!allocations) throw new Error(`${declarationPath}.decisions.distributions: announcement is missing allocations`)
    const context = amountEvaluationContext({
      state: draft,
      controller: item.controller,
      source,
      variables: item.x === undefined ? undefined : { X: item.x },
    })
    validateScopedDistributions(
      ability.decisions.distributions,
      allocations,
      (scopeId, clauseIndex) => (item.execution?.targetBindings ?? [])
        .find((binding) => binding.scopeId === scopeId && binding.clauseIndex === clauseIndex)?.recipients ?? [],
      context,
    )
  }
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
    ...(options.inline ? {
      inlineItem: structuredClone(item),
      parentResolution: structuredClone(draft.resolution),
      parentPriority: draft.priority,
    } : {}),
    controller: item.controller,
    intendedPriority: draft.active,
    definitionSnapshot: structuredClone(definitionSnapshot),
    declarationPath,
    source: structuredClone(source),
    scopeId: canonicalScopeId(abilityIndex),
    targetBindings: structuredClone(targetBindings),
    ...(item.execution?.distributionBindings ? { distributionBindings: structuredClone(item.execution.distributionBindings) } : {}),
    targetLegality: structuredClone(gate.targetLegality),
    targetLegalityByScope: structuredClone(gate.targetLegalityByScope),
    ...(gate.outcome === 'resolved' ? {} : { outcome: gate.outcome }),
    scopes: 'modes' in ability
      ? selectedModes.toReversed().map((modeIndex, reverseIndex) => {
        const occurrence = selectedModes.length - reverseIndex - 1
        return {
          path: `.modes[${modeIndex}].instructions`,
          scopeId: item.execution?.modeScopeIds?.[occurrence]
            ?? canonicalModeScopeId(abilityIndex, modeIndex, occurrence),
          instructions: structuredClone(ability.modes?.[modeIndex]?.instructions ?? []),
          cursor: 0,
        }
      })
      : [{
        path: '.instructions',
        scopeId: canonicalScopeId(abilityIndex),
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
  scopeId = frame.scopeId,
) => ({
  state,
  controller: frame.controller,
  source: frame.source,
  stackItemId: item.id,
  ...(item.execution?.occurrence ? { occurrence: item.execution.occurrence } : {}),
  targets: (() => {
    const targets: Record<number, BoundRecipient[]> = Object.fromEntries((frame.targetBindings ?? [])
      .filter((binding) => binding.scopeId === scopeId)
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
  targetLegality: frame.targetLegalityByScope?.[scopeId ?? ''] ?? frame.targetLegality,
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

const actionEvents = (
  instruction: Instruction,
  context: RuleDslRuntimeContext,
  draft: Draft,
  frame: CanonicalResolutionFrame,
  path: string,
) => {
  switch (instruction.kind) {
    case 'addMana': {
      const targets = recipients(instruction.targets, context)
      const mana = Object.fromEntries(Object.entries(instruction.amount).flatMap(([symbol, amount]) => {
        const value = availableAmount(amount, context)
        return typeof value === 'number' && value > 0 ? [[symbol, value]] : []
      }))
      return targets.map((seat) => ({ type: 'addMana' as const, seat, mana, sourceId: frame.source.ref.objectId }))
    }
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
      const legal = targets.filter((object) => object.zone === 'battlefield' && !hasKeyword(object, 'indestructible', context.state))
      if (instruction.bindResult) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: legal.length > 0, eventType: 'destroy' }
      return legal.map((object) => ({ type: 'destroy' as const, objectId: object.id, sourceId: frame.source.ref.objectId }))
    }
    case 'sacrifice': {
      const targets = objectActions(instruction.targets, context)
      const legal = targets.filter((object) => object.zone === 'battlefield')
      if (instruction.bindResult) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: legal.length > 0, eventType: 'sacrifice' }
      return legal.map((object) => ({ type: 'sacrifice' as const, objectId: object.id, sourceId: frame.source.ref.objectId }))
    }
    case 'move': {
      const targets = objectActions(instruction.targets, context)
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: true, eventType: 'move' }
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
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: amount, eventType: 'createToken' }
      return targets.flatMap((seat) => Array.from({ length: amount }, () => ({
        type: 'createToken' as const,
        controller: seat,
        token: {
          ...instruction.token,
          types: [...instruction.token.types],
          ...(instruction.token.subtypes ? { subtypes: [...instruction.token.subtypes] } : {}),
          ...(instruction.token.colors ? { colors: [...instruction.token.colors] } : {}),
          dsl: true as const,
        },
      })))
    }
    case 'copy': {
      const targets = objectActions(instruction.targets, context)
      const controllers = instruction.controller
        ? (instruction.controller.kind === 'players'
          ? evaluatePlayerSelector(instruction.controller, context)
          : evaluatePlayerReference(instruction.controller, context))
        : [context.controller]
      if (instruction.bindResult && targets.length > 0 && controllers.length > 0) {
        frame.pendingResult = {
          binding: instruction.bindResult,
          kind: 'action',
          value: targets.length * controllers.length,
          eventType: 'copyPermanent',
        }
      }
      return targets.flatMap((object) => controllers.map((controller) => ({
        type: 'copyPermanent' as const,
        objectId: object.id,
        controller,
        token: copyCharacteristics(object),
        sourceId: frame.source.ref.objectId,
      })))
    }
    case 'copySpell': {
      const targets = instruction.targets.kind === 'stackItems'
        ? evaluateStackItemSelector(instruction.targets, context).map((candidate) => ({ kind: 'stackItem' as const, stackId: candidate.id }))
        : evaluateBoundRecipients(instruction.targets, context).filter((target) => target.kind === 'stackItem')
      const controllers = instruction.controller
        ? (instruction.controller.kind === 'players'
          ? evaluatePlayerSelector(instruction.controller, context)
          : evaluatePlayerReference(instruction.controller, context))
        : [context.controller]
      const copies: GameEvent[] = []
      for (const target of targets) {
        const original = context.state.stack.find((candidate) => candidate.id === target.stackId)
        if (!original) continue
        const source = context.state.objects[original.objectId]
        if (!source || original.kind !== 'spell') continue
        // `keep` preserves the original target pins. Explicit retargeting is
        // answered through the durable typed offer API, never by refreshing
        // incarnations as a side effect of copying.
        if (instruction.retarget?.kind === 'chooseNewTargets') {
          const jobs = targets.flatMap((candidate) => controllers.map((controller) => {
            const item = context.state.stack.find((entry) => entry.id === candidate.stackId)
            return item ? { originalStackId: item.id, controller, targets: structuredClone(item.targets), slotCursor: 0, changedIndices: [], answers: [] } : undefined
          })).filter((job): job is NonNullable<typeof job> => Boolean(job))
          frame.pendingCopyTargets = jobs
          const first = jobs[0]
          if (first) {
          const abilitySnapshot = original.execution?.definitionSnapshot
          const abilityIndex = original.execution?.abilityIndex
          const copyDefinition = abilitySnapshot ? loadDefinitionSnapshot(abilitySnapshot).definition : undefined
          const inferredAbilityIndex = abilityIndex ?? copyDefinition?.abilities.findIndex((ability) => ability.kind === 'spell')
          const copyAbility = copyDefinition && inferredAbilityIndex !== undefined && inferredAbilityIndex >= 0
            ? copyDefinition.abilities[inferredAbilityIndex]
            : undefined
          if (!copyAbility || !('decisions' in copyAbility)) {
            throw pathError(frame, path, 'copySpell retargeting has no pinned canonical definition')
          }
          openOptionSelection(draft, {
            seat: context.controller,
            sourceId: frame.source.ref.objectId,
            source: frame.source.snapshot.name,
            prompt: 'Keep the copied spell targets or choose new targets.',
            options: [
              { id: 'keep', label: 'Keep the original targets' },
              { id: 'retarget', label: 'Choose new targets' },
            ],
            action: {
              kind: 'canonical-copy-retarget',
              stackId: frame.stackId,
              copyStackId: first.originalStackId,
              controller: first.controller,
              slotIndex: 0,
            },
          })
          frame.phase = 'committing'
          frame.pendingEvents = []
          return []
          }
        }
        for (const controller of controllers) {
          copies.push({ type: 'copySpell', stackId: original.id, controller, targets: structuredClone(original.targets), retarget: false, sourceId: frame.source.ref.objectId })
        }
      }
      if (instruction.bindResult) frame.pendingResult = {
        binding: instruction.bindResult,
        kind: 'action',
        value: copies.length,
        eventType: 'copySpell',
      }
      // Copy placement is itself the committed action; the stack mutation is
      // complete before the next written instruction is considered.
      return copies
    }
    case 'putCounters': {
      const targets = objectActions(instruction.targets, context)
      const amount = availableAmount(instruction.count, context)
      if (amount === undefined || amount === 0) return []
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: amount, eventType: 'putCounters' }
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
        if (instruction.bindResult && targets.length === 1) {
          frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: true, eventType: 'discard' }
        }
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
  const item = draft.stack.find((candidate) => candidate.id === frame.stackId) ?? frame.inlineItem
  if (!item) throw new Error(`resolution stack item ${frame.stackId} is missing`)
  if (frame.pendingDiscard) {
    const pending = frame.pendingDiscard
    while (pending.index < pending.seats.length) {
      const seat = pending.seats[pending.index]!
      const hand = (draft.zoneOrder[seat].hand ?? []).map((objectId) => draft.objects[objectId]).filter(Boolean)
      const count = Math.min(pending.amount, hand.length)
      if (count > 0) {
        openCardSelection(draft, {
          seat,
          kind: 'discard',
          count,
          min: count,
          candidates: hand.map((object) => object.id),
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose cards to discard.',
          destinations: ['target'],
          targetIdentities: Object.fromEntries(hand.map((object) => [object.id, objectIdentity(object)])),
          canonicalChoice: {
            stackId: frame.stackId,
            scopeId: pending.scopeId,
            binding: pending.binding ?? `__discard_${pending.index}`,
            action: 'discard',
          },
        })
        frame.phase = 'committing'
        frame.pendingEvents = []
        return { kind: 'events', events: [] }
      }
      pending.index += 1
    }
    if (pending.binding) frame.results = { ...frame.results, [pending.binding]: pending.selected.length > 0 }
    delete frame.pendingDiscard
  }
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
        scopeId: scope.scopeId,
        instructions: structuredClone(instruction.instructions),
        cursor: 0,
      })
      continue
    }
    if (instruction.kind === 'if') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const takeThen = evaluateCondition(instruction.condition, context)
      const branch = takeThen ? instruction.then : instruction.otherwise
      if (branch.length > 0) {
        frame.scopes.push({
          path: `${path}.${takeThen ? 'then' : 'otherwise'}`,
          scopeId: scope.scopeId,
          instructions: structuredClone(branch),
          cursor: 0,
        })
      }
      continue
    }
    if (instruction.kind === 'chooseInstructions') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
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
            scopeId: scope.scopeId,
            options: instruction.options.map((option, optionIndex) => ({ id: `instruction:${optionIndex}`, instructions: [...option.instructions] })),
          },
        })
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'chooseCards') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      const candidates = evaluateObjectSelector(instruction.filter, context)
      const requestedMin = availableAmount(instruction.min, context) ?? 0
      const requestedMax = availableAmount(instruction.max, context) ?? requestedMin
      const min = instruction.whenInsufficient === 'chooseAvailable'
        ? Math.min(requestedMin, candidates.length)
        : requestedMin
      const max = Math.min(requestedMax, candidates.length)
      if (chooser && candidates.length > 0 && max > 0) {
        openCardSelection(draft, {
          seat: chooser,
          kind: 'choose',
          count: max,
          min,
          candidates: candidates.map((object) => object.id),
          targetIdentities: Object.fromEntries(candidates.map((object) => [object.id, objectIdentity(object)])),
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose cards for the Rule DSL program.',
          destinations: ['target', 'skip'],
          canonicalChoice: { stackId: frame.stackId, scopeId: scope.scopeId, binding: instruction.bindChoice },
        })
      } else if (min === 0) {
        frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'discard' && instruction.count !== undefined) {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const seats = recipients(instruction.targets, context)
      const amount = availableAmount(instruction.count, context) ?? 0
      frame.pendingDiscard = {
        scopeId: scope.scopeId,
        seats: apnapSeats(draft).filter((candidate) => new Set(seats).has(candidate)),
        index: 0,
        amount,
        selected: [],
        ...(instruction.bindResult ? { binding: instruction.bindResult } : {}),
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'proliferate') {
      const candidates = Object.values(draft.objects).filter((object) =>
        object.zone === 'battlefield' && !object.phasedOut && Object.keys(object.counters).length > 0)
      const playerCandidates = apnapSeats(draft).filter((seat) =>
        draft.players[seat].poison > 0 || (draft.players[seat].energy ?? 0) > 0)
      if (candidates.length > 0) {
        openCardSelection(draft, {
          seat: frame.controller,
          kind: 'choose',
          count: candidates.length,
          min: 0,
          candidates: candidates.map((object) => object.id),
          targetIdentities: Object.fromEntries(candidates.map((object) => [object.id, objectIdentity(object)])),
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose any number of permanents to proliferate.',
          destinations: ['target', 'skip'],
          canonicalChoice: { stackId: frame.stackId, scopeId: scope.scopeId, binding: `__proliferate_${path}`, action: 'proliferate' },
        })
      } else if (playerCandidates.length > 0) {
        openPlayerSelection(draft, {
          seat: frame.controller,
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: 'Choose players with counters to proliferate.',
          min: 0,
          max: playerCandidates.length,
          candidates: playerCandidates,
          action: { kind: 'canonicalProliferatePlayers', stackId: frame.stackId },
        })
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    frame.phase = 'committing'
    const events = actionEvents(instruction, runtimeContext(draft, frame, item, scope.scopeId), draft, frame, path)
    const committed = events.length > 1
      ? [{ type: 'actionGroup' as const, events }]
      : events
    frame.pendingEvents = structuredClone(committed)
    return {
      kind: 'events',
      events: committed,
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
  if (frame.kind !== 'canonicalSpell') return
  const outcome = frame.outcome ?? 'resolved'
  draft.note(`${frame.kind} ${frame.stackId} ${outcome}`)
  if (frame.inlineItem) {
    draft.resolution = frame.parentResolution
    draft.priority = frame.parentPriority === undefined ? frame.intendedPriority : frame.parentPriority
  } else {
    const completedItem = draft.stack.find((item) => item.id === frame.stackId)
    draft.stack = draft.stack.filter((item) => item.id !== frame.stackId)
    if (completedItem?.copy) {
      const object = draft.object(completedItem.objectId)
      if (object) ceaseToExist(draft, object)
    }
    draft.priority = frame.intendedPriority
    delete draft.resolution
  }
  draft.passedInRow = []
}
