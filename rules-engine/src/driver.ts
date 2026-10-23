import { evaluateCreatureType } from './cardPlugins/dsl/compiler/runtime'
import { CREATURE_TYPES, CREATURE_TYPE_CHOICE_ACTION } from './creatureTypes'
import { advanceCollectedChoices } from './cardPlugins/dsl/collectedChoices'
import { evaluateLifeTotalAmount } from './cardPlugins/dsl/compiler/evaluate'
import { availableManaTypes } from './cardPlugins/dsl/manaTypes'
import { PLAYER_PROGRAM_CHOICE_ACTION } from './cardPlugins/dsl/playerProgramConstants'
import { CONTROL_CHOICE_ACTION, CONTROL_EVENT } from './cardPlugins/dsl/controlConstants'
import { pickRandomChoices, RANDOM_CHOICE as HIDDEN_RANDOM } from './plugins/hiddenInformation'
import { CANONICAL_RANDOM_RESULT } from './cardPlugins/dsl/canonicalRandom'
import { cardRuleDefinition } from './cardPlugins/dsl/builders'
import { LIBRARY_VISIBILITY, RULE_DSL_SCHEMA_VERSION } from './cardPlugins/dsl/schema/v1'
import { resolvedSpellDestination } from './cardPlugins/alternateCosts'
import { isPermanentType } from './definitions'
import { captureObject, isSameObject, objectIdentity, snapshotObject } from './objectIdentity'
import {
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluateBoundRecipients,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  evaluateRuntimeStatDelta,
  amountEvaluationContext,
  evaluateCondition,
  evaluateStackItemSelector,
  withOccurrencePlayer,
  type BoundRecipient,
  type RuleDslRuntimeContext,
} from './cardPlugins/dsl/compiler/runtime'
import { canonicalModeScopeId, canonicalScopeId, canonicalWholeItemGate } from './cardPlugins/dsl/compiler/targeting'
import { selectedDistributionScopeIds, selectedDistributionSpecs, validateModeSelection, validateScopedDistributions } from './cardPlugins/dsl/compiler/modes'
import { compileCardRuleDefinition, createDefinitionSnapshot, loadDefinitionSnapshot } from './cardPlugins/dsl/compiler'
import { RuleDslEvaluationError } from './cardPlugins/dsl/compiler/errors'
import type {
  DecisionsSpec,
  EffectDuration,
  Instruction,
  ObjectRecipient,
  PlayerRecipient,
} from './cardPlugins/dsl/schema/v1'
import { numericInstructionResult } from './cardPlugins/dsl/instructionResults'
import type Draft from './draft'
import type {
  GameEvent,
  GameState,
  CanonicalResolutionFrame,
  StackItem,
  GameObject,
  StepId,
  ZoneId,
} from './types'
import { hasKeyword } from './keywords'
import { openOptionSelection, openNextCopySlot } from './rules/selectOptions'
import { openCardSelection } from './rules/selectCards'
import { openControlAssignment } from './cardPlugins/dsl/controlAssignment'
import { openPlayerSelection } from './rules/selectPlayers'
import { copyCharacteristics } from './cardPlugins/effectRuntime'
import { apnapSeats } from './turnOrder'
import { ceaseToExist } from './rules/spellCopies'
import { captureLexicalBindings, generatedAbilitySnapshot, occurrenceBindingsForPattern } from './cardPlugins/dsl/generatedPrograms'
import { runRevealUntil, storeRevealUntilBindings } from './cardPlugins/dsl/revealUntilExecution'
import type { DelayedPattern } from './cardPlugins/dsl/schema/v1'
import { canPayResolutionMana, eligibleResolutionManaAbilities, resolutionCostLabel, resolutionManaCost } from './cardPlugins/dsl/resolutionPayment'
import { beginVote, disambiguateVoteOptions, pendingVote } from './cardPlugins/vote'

export const CANONICAL_RUNTIME_INSTRUCTIONS = [
  'discardHands',
  'chooseParticipants',
  'chooseCardsForEachPlayer',
  'exileThisSpell',
  'becomeMonarch',
  'choosePlayer',
  'forEachPlayer',
  'inspectTop',
  'distributeControl',
  'captureAmount',
  'counter',
  'damage',
  'destroy',
  'sacrifice',
  'move',
  'phase',
  'proliferate',
  'createToken',
  'createEmblem',
  'banAttacks',
  'copy',
  'copySpell',
  'putCounters',
  'draw',
  'mill',
  'discard',
  'gainLife',
  'loseLife',
  'shuffle',
] as const

const PERMANENT_RESOLUTION_INDEX = -1
const PERMANENT_RESOLUTION_PATH = '$.permanentResolution'

const emptyPermanentDecisions: DecisionsSpec = { targets: [] }
const emptyPermanentSpell = () => ({
  kind: 'spell' as const,
  costs: [] as const,
  decisions: emptyPermanentDecisions,
  instructions: [] as const,
})

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
  if (abilities.length === 1) return abilities[0]
  if (
    item.kind === 'spell'
    && abilities.length === 0
    && isPermanentType(item.execution?.source.snapshot.types ?? [])
  ) {
    return { ability: emptyPermanentSpell(), index: PERMANENT_RESOLUTION_INDEX }
  }
  throw new Error(`canonical ${item.kind} requires exactly one executable ability; found ${abilities.length}`)
}

const resolutionDeclarationPath = (abilityIndex: number) =>
  abilityIndex === PERMANENT_RESOLUTION_INDEX
    ? PERMANENT_RESOLUTION_PATH
    : canonicalScopeId(abilityIndex)

const preflightInstructions = (
  instructions: readonly Instruction[],
  path: string,
) => {
  instructions.forEach((instruction, index) => {
    const instructionPath = `${path}[${index}]`
    if (instruction.kind === 'sequence' || instruction.kind === 'forEach' || instruction.kind === 'forEachPlayer') {
      preflightInstructions(instruction.instructions, `${instructionPath}.instructions`)
      return
    }
    switch (instruction.kind) {
      case 'draw':
      case 'grantLandPlays':
      case 'grantNoMaximumHandSize':
      case 'grantFlash':
      case 'addManaChosenColor':
      case 'addManaFrom':
      case 'becomeMonarch':
      case 'linkExile':
      case 'returnLinkedExile':
      case 'addMana':
      case 'inspectTop':
      case 'partitionPiles':
      case 'vote':
      case 'chooseRandom':
      case 'changeControl':
      case 'chooseParticipants':
      case 'chooseCardsForEachPlayer':
      case 'choosePlayer':
      case 'capturePlayer':
      case 'captureAmount':
      case 'captureCopy':
      case 'gainLife':
      case 'loseLife':
      case 'setLife':
      case 'exchangeLife':
      case 'winGame':
      case 'blink':
      case 'fight':
      case 'damage':
      case 'destroy':
      case 'sacrifice':
      case 'move':
      case 'exileThisSpell':
      case 'reveal':
      case 'tap':
      case 'untap':
      case 'phase':
      case 'proliferate':
      case 'createToken':
      case 'createEmblem':
      case 'banAttacks':
      case 'copy':
      case 'copySpell':
      case 'putCounters':
      case 'counter':
      case 'createEffect':
      case 'payOptional':
      case 'createDelayed':
      case 'mill':
      case 'discardHands':
      case 'discard':
      case 'shuffle':
      case 'chooseCreatureType':
      case 'lockOrUnlockDoor':
        return
      case 'if':
        preflightInstructions(instruction.then, `${instructionPath}.then`)
        preflightInstructions(instruction.otherwise, `${instructionPath}.otherwise`)
        return
      case 'repeat':
      case 'repeatWhile':
        preflightInstructions(instruction.instructions, `${instructionPath}.instructions`)
        return
      case 'chooseInstructions':
      case 'distributeControl':
      case 'chooseCards':
      case 'revealUntil':
      case 'scry':
      case 'surveil':
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
  const declarationPath = resolutionDeclarationPath(abilityIndex)
  const selectedModes = 'modes' in ability ? (item.execution?.modeIndices ?? []) : []
  if ('modes' in ability) {
    const modeSpec = ability.decisions.modes
    if (!modeSpec) throw new Error(`${declarationPath}.decisions.modes: modal program is missing its mode specification`)
    const modeTotal = item.execution?.modeCount
      ?? (modeSpec.count.kind === 'constant' ? modeSpec.count.value : item.x)
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
  const capturedBindings = ability.kind === 'triggered' && ability.generated ? ability.capturedBindings : undefined
  const choiceAliases = Object.entries(item.execution?.capturedChoiceAliases ?? {})
  const resultAliases = Object.entries(item.execution?.capturedResultAliases ?? {})
  for (const alias of capturedBindings?.choices ?? []) {
    const original = choiceAliases.find(([, candidate]) => candidate === alias)?.[0]
    if (!original || item.execution?.choices?.[original] === undefined) {
      throw new Error(`${declarationPath}.capturedBindings.choices: captured choice ${alias} is unavailable`)
    }
  }
  for (const alias of Object.keys(capturedBindings?.results ?? {})) {
    const original = resultAliases.find(([, candidate]) => candidate === alias)?.[0]
    if (!original || item.execution?.results?.[original] === undefined) {
      throw new Error(`${declarationPath}.capturedBindings.results: captured result ${alias} is unavailable`)
    }
  }
  const capturedOccurrence = item.execution?.capturedOccurrence
  for (const binding of capturedBindings?.occurrence ?? []) {
    const available = binding === 'source' ? capturedOccurrence?.source !== undefined : binding === 'player'
      ? capturedOccurrence?.player !== undefined
      : binding === 'object.before'
        ? capturedOccurrence?.object?.before !== undefined
        : capturedOccurrence?.object?.after !== undefined
    if (!available) throw new Error(`${declarationPath}.capturedBindings.occurrence: captured ${binding} is unavailable`)
  }
  const distributionSpecs = selectedDistributionSpecs(ability, selectedModes)
  if (distributionSpecs.length > 0) {
    const allocations = item.execution?.distributionBindings
    if (!allocations) throw new Error(`${declarationPath}.decisions.distributions: announcement is missing allocations`)
    const context = amountEvaluationContext({
      state: draft,
      controller: item.controller,
      source,
      occurrence: item.execution?.occurrence,
      capturedOccurrence: item.execution?.capturedOccurrence,
      capturedOccurrenceBindings: item.execution?.capturedOccurrenceBindings,
      variables: item.x === undefined ? item.execution?.variables : { X: item.x },
      choices: item.execution?.choices
        ? {
            ...item.execution.choices,
            ...Object.fromEntries(Object.entries(item.execution.capturedChoiceAliases ?? {}).flatMap(([original, alias]) => {
              const value = item.execution?.choices?.[original]
              return value === undefined ? [] : [[alias, value]]
            })),
          }
        : undefined,
      results: item.execution?.results
        ? {
            ...item.execution.results,
            ...Object.fromEntries(Object.entries(item.execution.capturedResultAliases ?? {}).flatMap(([original, alias]) => {
              const value = item.execution?.results?.[original]
              return value === undefined ? [] : [[alias, value]]
            })),
          }
        : undefined,
    })
    validateScopedDistributions(
      distributionSpecs,
      allocations,
      (scopeId, clauseIndex) => (item.execution?.targetBindings ?? [])
        .find((binding) => binding.scopeId === scopeId && binding.clauseIndex === clauseIndex)?.recipients ?? [],
      context,
      selectedDistributionScopeIds(abilityIndex, ability, selectedModes),
      allocations.map((allocation, index) => ({
        total: allocation.amounts.reduce((sum, amount) => sum + amount, 0),
        minEach: item.execution?.distributionBounds?.[index]?.minEach
          ?? (allocation.amounts.length > 0 ? Math.min(...allocation.amounts) : 0),
      })),
    )
  }
  const variables = ability.decisions.variables ?? []
  const boundVariables = item.x === undefined ? item.execution?.variables : { X: item.x }
  for (const variable of variables) {
    const value = boundVariables?.[variable.name]
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
  const capturedChoices = item.execution?.choices
    ? {
        ...structuredClone(item.execution.choices),
        ...Object.fromEntries(Object.entries(item.execution.capturedChoiceAliases ?? {}).flatMap(([original, alias]) => {
          const value = item.execution?.choices?.[original]
          return value === undefined ? [] : [[alias, structuredClone(value)]]
        })),
      }
    : undefined
  const capturedResults = item.execution?.results
    ? {
        ...structuredClone(item.execution.results),
        ...Object.fromEntries(Object.entries(item.execution.capturedResultAliases ?? {}).flatMap(([original, alias]) => {
          const value = item.execution?.results?.[original]
          return value === undefined ? [] : [[alias, value]]
        })),
      }
    : undefined
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
    ...(item.execution?.referencedObjects ? { referencedObjects: structuredClone(item.execution.referencedObjects) } : {}),    ...(item.execution?.sourceLess ? { sourceLess: true as const } : {}),
    monarchRevision: item.execution?.monarchRevision ?? 0,
    scopeId: item.execution?.scopeId ?? resolutionDeclarationPath(abilityIndex),
    targetBindings: structuredClone(targetBindings),
    ...(item.x !== undefined || item.execution?.variables
      ? { variables: { ...item.execution?.variables, ...(item.x !== undefined ? { X: item.x } : {}) } }
      : {}),
    ...(capturedChoices ? { choices: capturedChoices } : {}),
    ...(capturedBindings?.playerChoices ? { playerChoiceBindings: [...capturedBindings.playerChoices] } : {}),
    ...(capturedResults ? { results: capturedResults } : {}),
    ...(item.execution?.distributionBindings ? { distributionBindings: structuredClone(item.execution.distributionBindings) } : {}),
    targetLegality: structuredClone(gate.targetLegality),
    targetLegalityByScope: structuredClone(gate.targetLegalityByScope),
    ...(gate.outcome === 'resolved' ? {} : { outcome: gate.outcome }),
    scopes: 'modes' in ability
      ? selectedModes
        .map((modeIndex, occurrence) => ({ modeIndex, occurrence }))
        // Resolution walks the top scope first.  Push modes in reverse printed
        // order so repeated occurrences retain their own scope while the
        // resulting execution order follows the card's printed mode order.
        .toSorted((left, right) => right.modeIndex - left.modeIndex || right.occurrence - left.occurrence)
        .map(({ modeIndex, occurrence }) => {
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
        scopeId: item.execution?.scopeId ?? resolutionDeclarationPath(abilityIndex),
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

const capturedExecutionSource = (frame: CanonicalResolutionFrame) => ({
  source: structuredClone(frame.source),
  ...(frame.referencedObjects ? { referencedObjects: structuredClone(frame.referencedObjects) } : {}),  ...(frame.sourceLess ? { sourceLess: true as const } : {}),
  ...(frame.monarchRevision !== undefined ? { monarchRevision: frame.monarchRevision } : {}),
})

const runtimeContext = (
  state: GameState,
  frame: CanonicalResolutionFrame,
  item: StackItem,
  scopeId = frame.scopeId,
) => ({
  state,
  controller: frame.controller,
  source: frame.source,
  ...(frame.referencedObjects ? { referencedObjects: frame.referencedObjects } : {}),  ...(item.execution?.sourceLess ? { sourceLess: true as const } : {}),
  stackItemId: item.id,
  ...((frame.scopes.findLast(scope => scope.occurrence)?.occurrence ?? item.execution?.occurrence)
    ? { occurrence: frame.scopes.findLast(scope => scope.occurrence)?.occurrence ?? item.execution?.occurrence }
    : {}),
  ...(item.execution?.capturedOccurrence ? { capturedOccurrence: item.execution.capturedOccurrence } : {}),
  ...(item.execution?.capturedOccurrenceBindings ? { capturedOccurrenceBindings: item.execution.capturedOccurrenceBindings } : {}),
  ...(item.execution?.grantSource ? { grantSource: item.execution.grantSource } : {}),
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
  scopeId,
  ...(frame.distributionBindings ? { distributions: frame.distributionBindings } : {}),
  choices: frame.choices,
  targetLegality: frame.targetLegalityByScope?.[scopeId ?? ''] ?? frame.targetLegality,
  results: frame.results,
  ...(frame.voteResults ? { voteResults: frame.voteResults } : {}),
  variables: item.x === undefined ? frame.variables : { ...frame.variables, X: item.x },
})

const distributedAmount = (
  target: { kind: string; clauseIndex?: number },
  recipient: string | { kind: 'object'; objectId: string },
  context: RuleDslRuntimeContext,
  fallback: number,
) => {
  if (target.kind !== 'targetRef' || target.clauseIndex === undefined) return fallback
  const allocation = context.distributions?.find((entry) =>
    entry.scopeId === context.scopeId && entry.clauseIndex === target.clauseIndex)
  if (!allocation) return fallback
  const bound = context.targets?.[target.clauseIndex] ?? []
  const index = bound.findIndex((entry) => entry.kind === 'player'
    ? typeof recipient === 'string' && entry.playerId === recipient
    : typeof recipient !== 'string' && entry.kind === 'object' && entry.objectId === recipient.objectId)
  return index >= 0 ? allocation.amounts[index] ?? fallback : fallback
}

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
  recipient: ObjectRecipient,
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
    case 'relatedPlayer':
    case 'resultRef':
      damageTargets.push(...evaluatePlayerReference(recipient, context).map(player => ({ kind: 'player' as const, player })))
      break
    case 'contextRef':
      if (recipient.name === 'source') damageTargets.push(...objectRecipients(evaluateObjectReference(recipient, context, 'currentOrLastKnown')))
      else damageTargets.push(...evaluatePlayerReference(recipient, context).map((player) => ({ kind: 'player' as const, player })))
  }
  return damageTargets
}

const stepIndex = (step: string) => [
  'untap', 'upkeep', 'draw', 'precombatMain', 'beginCombat', 'declareAttackers',
  'declareBlockers', 'firstStrikeDamage', 'combatDamage', 'endCombat',
  'postcombatMain', 'end', 'cleanup',
].indexOf(step)

const durationMetadata = (
  duration: EffectDuration,
  context: RuleDslRuntimeContext,
  draft: Draft,
) => {
  if (duration.kind === 'forTurns') {
    const count = Math.max(0, availableAmount(duration.count, context) ?? 0)
    return { durationUntilTurn: draft.turn + count }
  }
  if (duration.kind === 'untilStep') {
    const active = duration.active ? evaluatePlayerReference(duration.active, context)[0] : undefined
    const targetIndex = stepIndex(duration.step)
    const currentIndex = stepIndex(draft.step)
    if (!active) {
      return {
        durationUntilStepTurn: draft.turn + (currentIndex < targetIndex ? 0 : 1),
      }
    }
    return {
      durationUntilStepNotBeforeTurn: draft.turn + (currentIndex < targetIndex ? 0 : 1),
      ...(active ? { durationUntilStepActive: active } : {}),
    }
  }
  return {}
}

const parentVariables = (frame: CanonicalResolutionFrame, scopeId = frame.scopeId) => {
  const abilityIndex = Number(/\[(\d+)\]/.exec(frame.declarationPath)?.[1] ?? -1)
  const ability = abilityIndex >= 0 ? frame.definitionSnapshot.definition.abilities[abilityIndex] : undefined
  const modeIndex = scopeId?.match(/\.modes\[(\d+)\]/)?.[1]
  if (ability && modeIndex !== undefined && 'modes' in ability) {
    return ability.modes?.[Number(modeIndex)]?.decisions.variables
  }
  return ability && 'decisions' in ability ? ability.decisions.variables : undefined
}

const registerCanonicalDelayed = (
  draft: Draft,
  condition: DelayedPattern,
  instructions: readonly Instruction[],
  frame: CanonicalResolutionFrame,
  context: RuleDslRuntimeContext,
  inheritTargets = true,
  notThisTurn = false,
  repeatUntilCleanup = false,
) => {
  const eventCondition = condition.kind === 'tappedForMana' ? structuredClone(condition) : condition.kind === 'event'
    ? (() => {
        const referenced = condition.objectId
          ? evaluateObjectReference(condition.objectId, context, 'currentOrLastKnown')[0]
          : undefined
        return {
          kind: 'event' as const,
          type: condition.type as GameEvent['type'],
          ...(referenced ? { objectId: referenced.id } : {}),
          ...(referenced ? { objectRef: objectIdentity(referenced) } : {}),
          ...(condition.from ? { from: condition.from as ZoneId } : {}),
          ...(condition.to ? { to: condition.to as ZoneId } : {}),
        }
      })()
    : {
        kind: 'step' as const,
        step: (Array.isArray(condition.step) ? [...condition.step] : condition.step) as StepId | StepId[],
        ...(condition.active
          ? { active: evaluatePlayerReference(condition.active, context)[0] }
          : {}),
      }
  const generated = {
    kind: 'triggered' as const,
    on: condition,
    instructions: structuredClone(instructions),
  }
  const parentAbilityIndex = Number(/\[(\d+)\]/.exec(frame.declarationPath)?.[1] ?? -1)
  const parentAbility = parentAbilityIndex >= 0
    ? frame.definitionSnapshot.definition.abilities[parentAbilityIndex]
    : undefined
  const modeIndex = context.scopeId?.match(/\.modes\[(\d+)\]/)?.[1]
  const inheritedDecisions = parentAbility && modeIndex !== undefined && 'modes' in parentAbility
    ? parentAbility.modes?.[Number(modeIndex)]?.decisions
    : parentAbility && 'decisions' in parentAbility
      ? parentAbility.decisions
      : undefined
  const captured = captureLexicalBindings(
    generated.instructions,
    frame.choices,
    frame.results,
    [eventCondition], condition.kind === 'tappedForMana' ? ['player', 'object.after'] : [], frame.playerChoiceBindings,
  )
  const loweredDecisions = inheritTargets ? inheritedDecisions : {
    targets: [],
    ...(inheritedDecisions?.variables ? { variables: inheritedDecisions.variables } : {}),
  }
  const inheritedTargets = Boolean(loweredDecisions?.targets?.length)
  const capturedScopeId = context.scopeId ?? frame.scopeId
  draft.delayedTriggers.push({
    id: draft.allocId('delayed'),
    sourceId: frame.source.ref.objectId,
    sourceName: frame.source.snapshot.name,
    controller: frame.controller,
    sourceIncarnation: frame.source.ref.incarnation,
    sourceDefinitionRevision: frame.definitionSnapshot.definitionRevision,
    condition: eventCondition,
    ...(notThisTurn ? { notBeforeTurn: draft.turn + 1 } : {}),
    ...(repeatUntilCleanup ? { recurring: true, untilCleanup: true } : {}),
    instructions: [],
    timestamp: draft.allocTs(),
    objectRef: eventCondition.kind === 'event' ? eventCondition.objectRef : undefined,
    execution: {
      controller: frame.controller,
      ...capturedExecutionSource(frame),
      ...((context.capturedOccurrence ?? context.occurrence) ? { capturedOccurrence: structuredClone(context.capturedOccurrence ?? context.occurrence) } : {}),
      ...(captured.capturedBindings.occurrence ? { capturedOccurrenceBindings: captured.capturedBindings.occurrence } : {}),
      ...(inheritTargets && frame.targetBindings ? { targetBindings: structuredClone(frame.targetBindings) } : {}),
      ...(frame.choices ? { choices: structuredClone(frame.choices) } : {}),
      ...(frame.results ? { results: structuredClone(frame.results) } : {}),
      ...(Object.keys(captured.choiceAliases).length > 0 ? { capturedChoiceAliases: captured.choiceAliases } : {}),
      ...(Object.keys(captured.resultAliases).length > 0 ? { capturedResultAliases: captured.resultAliases } : {}),
      ...(frame.variables ? { variables: structuredClone(frame.variables) } : {}),
      ...(capturedScopeId ? { scopeId: capturedScopeId } : {}),
    },
    canonical: {
      definitionSnapshot: generatedAbilitySnapshot(
        { ...generated, on: captured.rewrittenAdditionalValues[0] as typeof generated.on, instructions: captured.instructions },
        loweredDecisions,
        captured.capturedBindings,
      ),
      abilityIndex: 0,
      ...(inheritedTargets ? { inheritedTargets: true } : {}),
    },
  })
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
    case 'exileThisSpell': {
      const item = draft.stack.find(candidate => candidate.id === frame.stackId) ?? frame.inlineItem
      const object = item ? draft.objects[item.objectId] : undefined
      if (item?.kind !== 'spell' || object?.zone !== 'stack' || !isSameObject(object, frame.source.ref)) return []
      return [{ type: 'move' as const, objectId: object.id, to: 'exile' as const }]
    }
    case 'addManaChosenColor': {
      const source = evaluateObjectReference(instruction.of, context, 'currentOrLastKnown')[0]
      const color = source?.chosenColor
      const amount = availableAmount(instruction.amount, context) ?? 0
      return color && color !== 'C' && amount > 0 ? recipients(instruction.targets, context).map(seat => ({ type: 'addMana' as const, seat, mana: { [color]: amount }, sourceId: frame.source.ref.objectId })) : []
    }
    case 'addMana': {
      const targets = recipients(instruction.targets, context)
      const mana = Object.fromEntries(Object.entries(instruction.amount).flatMap(([symbol, amount]) => {
        const value = availableAmount(amount, context)
        return typeof value === 'number' && value > 0 ? [[symbol, value]] : []
      }))
      return targets.map((seat) => ({ type: 'addMana' as const, seat, mana, sourceId: frame.source.ref.objectId }))
    }
    case 'grantLandPlays': {
      const count = availableAmount(instruction.count, context)
      if (count === undefined || count === 0) return []
      return recipients(instruction.targets, context).map((seat) => ({ type: 'grantLandPlays' as const, seat, count }))
    }
    case 'grantNoMaximumHandSize': {
      return recipients(instruction.targets, context).map((seat) => ({ type: 'grantNoMaximumHandSize' as const, seat }))
    }
    case 'grantFlash': {
      return recipients(instruction.targets, context).map((seat) => ({
        type: 'addRule' as const,
        pluginId: 'flashGrant',
        params: {
          ...(instruction.duration.kind === 'untilCleanup' ? { untilCleanup: true } : { duration: structuredClone(instruction.duration) }),
          controller: seat,
        },
      }))
    }
    case 'becomeMonarch': return recipients(instruction.targets, context).map(seat => ({ type: 'becomeMonarch' as const, seat }))
    case 'linkExile': {
      const sourceId = frame.source.ref.objectId
      const source = draft.object(sourceId)
      if (instruction.untilSourceLeaves && (!source || source.zone !== 'battlefield' || !isSameObject(source, frame.source.ref))) return []
      const objectIds = objectActions(instruction.targets, context)
        .filter(object => isSameObject(context.state.objects[object.id], objectIdentity(object)))
        .map(object => object.id)
      if (objectIds.length === 0) return []
      return [{
        type: 'linkExile' as const,
        sourceId,
        sourceRef: { ...frame.source.ref },
        ...(instruction.untilOpponentMonarch ? { untilOpponentMonarch: { player: frame.controller, since: frame.monarchRevision ?? draft.monarchRevision ?? 0 } } : {}),
        targetRefs: objectIds.map(id => objectIdentity(context.state.objects[id])),
        objectIds,
        ...(instruction.untilSourceLeaves ? { untilSourceLeaves: true as const } : {}),
        ...(instruction.returnTo ? { returnTo: instruction.returnTo } : {}),
      }]
    }
    case 'returnLinkedExile': {
      return [{
        type: 'returnLinkedExile' as const,
        sourceId: frame.source.ref.objectId,
        sourceRef: { ...frame.source.ref },
        ...(instruction.returnTo ? { returnTo: instruction.returnTo } : {}),
      }]
    }
    case 'draw': {
      const targets = recipients(instruction.targets, context)
      return targets.flatMap((seat) => {
        const amount = availableAmount(instruction.count, withOccurrencePlayer(context, seat))
        if (amount === undefined || amount === 0) return []
        const assigned = distributedAmount(instruction.targets, seat, context, amount)
        if (assigned === 0) return []
        return [{ type: 'draw' as const, seat, count: assigned }]
      })
    }
    case 'inspectTop': {
      const players = evaluatePlayerReference(instruction.player, context)
      if (players.length !== 1) throw new RuleDslEvaluationError('inspectTop requires exactly one library')
      const count = availableAmount(instruction.count, context) ?? 0
      const player = players[0]!
      const ids = (draft.zoneOrder[player]?.library ?? []).slice(0, count)
      frame.choices = { ...frame.choices, [instruction.bindChoice]: ids.map(id => ({ kind: 'object' as const, ...objectIdentity(draft.objects[id]!) })) }
      if (ids.length === 0) return []
      if (instruction.visibility === LIBRARY_VISIBILITY.public) return [{ type: 'reveal' as const, seat: player, objectIds: ids, source: frame.source.snapshot.name }]
      draft.note(`${player} looks at the top ${ids.length} cards.`)
      return []
    }
    case 'capturePlayer': {
      const players = evaluatePlayerReference(instruction.player, context)
      if (players.length !== 1) throw new RuleDslEvaluationError('capturePlayer requires exactly one player')
      frame.results = { ...frame.results, [instruction.bindResult]: players[0]! }
      return []
    }
    case 'captureAmount':
      frame.results = { ...frame.results, [instruction.bindResult]: evaluateRuntimeAmount(instruction.amount, context) }
      return []
    case 'captureCopy': {
      const targets = objectActions(instruction.targets, context)
      if (targets.length !== 1) throw new RuleDslEvaluationError('captureCopy requires exactly one object')
      frame.capturedCopies = { ...frame.capturedCopies, [instruction.bindResult]: copyCharacteristics(targets[0]!) }
      return []
    }
    case 'gainLife':
    case 'loseLife': {
      const targets = recipients(instruction.targets, context)
      if (instruction.kind === 'loseLife' && instruction.bindResult) {
        frame.results = { ...frame.results, [instruction.bindResult]: 0 }
      }
      const events = targets.flatMap((seat) => {
        const amount = availableAmount(instruction.amount, withOccurrencePlayer(context, seat))
        if (amount === undefined || amount === 0) return []
        const assigned = distributedAmount(instruction.targets, seat, context, amount)
        if (assigned === 0) return []
        return [{
          type: instruction.kind,
          seat,
          amount: assigned,
          source: frame.source.ref.objectId,
        }]
      })
      if (instruction.kind === 'loseLife' && instruction.bindResult && events.length > 0) {
        frame.pendingResult = { binding: instruction.bindResult, kind: 'amount', eventType: 'loseLife', value: 0 }
      }
      return events
    }
    case 'setLife': {
      const targets = recipients(instruction.targets, context)
      if (instruction.bindResult) frame.results = { ...frame.results, [instruction.bindResult]: 0 }
      const expression = instruction.amount
      const lowest = expression.kind === 'lowestLife'
        ? evaluateLifeTotalAmount(expression, amountEvaluationContext(context))
        : undefined
      const events = targets.flatMap((seat) => {
        const amount = expression.kind === 'lowestLife' ? lowest : availableAmount(expression, withOccurrencePlayer(context, seat))
        if (amount === undefined) return []
        return [{
          type: 'setLifeTotal' as const,
          seat,
          total: amount,
          source: frame.source.ref.objectId,
        }]
      })
      if (instruction.bindResult && events.length > 0) {
        frame.pendingResult = {
          binding: instruction.bindResult,
          kind: 'amount',
          eventType: 'loseLife',
          value: 0,
          expectedSeats: [...targets],
        }
      }
      return events
    }
    case 'exchangeLife': {
      const first = recipients(instruction.first, context)
      const second = recipients(instruction.second, context)
      if (first.length !== 1 || second.length !== 1) {
        throw new RuleDslEvaluationError('exchangeLife requires exactly one player on each side')
      }
      const left = first[0]!
      const right = second[0]!
      if (left === right) return []
      if (instruction.bindResult) frame.results = { ...frame.results, [instruction.bindResult]: 0 }
      if (instruction.bindResult) {
        frame.pendingResult = {
          binding: instruction.bindResult,
          kind: 'amount',
          eventType: 'loseLife',
          value: 0,
          expectedSeats: [left],
        }
      }
      return [{
        type: 'exchangeLifeTotals' as const,
        first: left,
        second: right,
        source: frame.source.ref.objectId,
      }]
    }
    case 'winGame':
      return recipients(instruction.targets, context).map((seat) => ({
        type: 'winGame' as const,
        seat,
        source: frame.source.ref.objectId,
      }))
    case 'blink': {
      const targets = objectActions(instruction.targets, context).filter(object => object.zone === 'battlefield')
      const controllers = instruction.returnController && instruction.returnController !== 'owner'
        ? evaluatePlayerReference(instruction.returnController, context) : undefined
      if (controllers && controllers.length !== 1) throw new RuleDslEvaluationError('blink return controller must resolve to exactly one player')
      // Ordinary move(target(0)) cannot follow the new exile incarnation. Keep
      // only the next incarnation this instruction is about to create (400.7j).
      frame.pendingBlink = targets.filter(object => !object.token).map(object => ({
        ref: { objectId: object.id, incarnation: object.incarnation + 1, zone: 'exile' },
        controller: controllers?.[0] ?? object.owner,
        ...(instruction.tapped !== undefined ? { tapped: instruction.tapped } : {}),
      }))
      return targets.map(object => ({ type: 'move' as const, objectId: object.id, to: 'exile' as const }))
    }
    case 'fight': {
      const left = evaluateObjectReference(instruction.left, context)
      const right = evaluateObjectReference(instruction.right, context)
      if (left.length !== 1 || right.length !== 1) return []
      const first = left[0]!
      const second = right[0]!
      if (!isSameObject(context.state.objects[first.id], objectIdentity(first))
        || !isSameObject(context.state.objects[second.id], objectIdentity(second))
        || first.phasedOut || second.phasedOut) return []
      return [{ type: 'fight' as const, leftId: first.id, rightId: second.id }]
    }
    case 'damage': {
      const damageRecipients = mixedRecipients(instruction.targets, context)
      if (instruction.bindResult) frame.results = { ...frame.results, [instruction.bindResult]: 0 }
      const amount = availableAmount(instruction.amount, context)
      if (amount === undefined || amount === 0) return []
      const sources = evaluateObjectReference(instruction.source, context, 'currentOrLastKnown')
      if (sources.length !== 1) return []
      const source = sources[0]
      if (instruction.bindResult && damageRecipients.length > 0) frame.pendingResult = { binding: instruction.bindResult, kind: 'amount', eventType: 'dealDamage', value: 0 }
      return damageRecipients.map((target) => ({
        type: 'dealDamage' as const,
        sourceId: source.id,
        sourceSnapshot: capturedDamageSource(source, context),
        target,
        amount: target.kind === 'player'
          ? distributedAmount(instruction.targets, target.player, context, amount)
          : target.kind === 'object'
            ? distributedAmount(instruction.targets, target, context, amount)
            : amount,
      }))
    }
    case 'destroy': {
      const targets = objectActions(instruction.targets, context)
      const legal = targets.filter((object) => object.zone === 'battlefield' && !hasKeyword(object, 'indestructible', context.state))
      if (instruction.bindResult) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: legal.length > 0, eventType: 'destroy' }
      if (instruction.bindChoice) frame.pendingDestroyedChoice = {
        binding: instruction.bindChoice,
        entries: legal.map(object => ({
          objectId: object.id,
          incarnation: object.incarnation,
          snapshot: snapshotObject(object),
        })),
      }
      return legal.map((object) => ({ type: 'destroy' as const, objectId: object.id, sourceId: frame.source.ref.objectId }))
    }
    case 'sacrifice': {
      const targets = objectActions(instruction.targets, context)
      const legal = targets.filter((object) => object.zone === 'battlefield' && isSameObject(context.state.objects[object.id], objectIdentity(object)))
      if (instruction.bindResult || instruction.bindCount) frame.pendingResult = {
        binding: instruction.bindCount ?? instruction.bindResult!,
        kind: 'amount', value: 0, eventType: 'sacrifice',
        ...(instruction.bindResult ? { booleanBinding: instruction.bindResult } : {}),
        expectedObjects: legal.map(objectIdentity),
      }
      return legal.map((object) => ({ type: 'sacrifice' as const, objectId: object.id, sourceId: frame.source.ref.objectId }))
    }
    case 'move': {
      let targets = objectActions(instruction.targets, context).filter(object =>
        isSameObject(context.state.objects[object.id], objectIdentity(object)))
      if (instruction.order === 'random') {
        const ordered = pickRandomChoices(draft, targets.map(object => object.id), targets.length)
        const byId = new Map(targets.map(object => [object.id, object]))
        targets = ordered.map(id => byId.get(id)!)
        for (const object of targets) draft.objects[object.id]!.knownTo = []
      }
      const controllers = instruction.controller ? evaluatePlayerReference(instruction.controller, context) : undefined
      if (controllers && controllers.length !== 1) throw new RuleDslEvaluationError('move controller must resolve to exactly one player')
      if (instruction.bindChoice) frame.pendingMovedChoice = {
        binding: instruction.bindChoice,
        objects: targets.map(object => ({ objectId: object.id, zone: instruction.to,
          incarnation: object.incarnation + (object.zone !== instruction.to || instruction.to === 'exile' || instruction.to === 'command' ? 1 : 0) })),
      }
      if (instruction.bindResult) {
        frame.results = { ...frame.results, [instruction.bindResult]: 0 }
        frame.pendingResult = { binding: instruction.bindResult, kind: 'amount', eventType: 'move', value: 0, destination: instruction.to }
      }
      return targets.map((object) => {
        const stackItem = object.zone === 'stack'
          ? context.state.stack.find((item) => item.objectId === object.id)
          : undefined
        const dropStackItem = Boolean(
          stackItem
          && instruction.to !== 'stack'
          && stackItem.id !== frame.stackId
        )
        return {
          type: 'move' as const,
          objectId: object.id,
          to: instruction.to,
          ...(dropStackItem ? { dropStackItem: true } : {}),
          ...(instruction.position !== undefined ? { position: instruction.position } : {}),
          ...(controllers ? { controller: controllers[0] } : {}),
          ...(instruction.tapped !== undefined ? { tapped: instruction.tapped } : {}),
          ...(instruction.enterCounters !== undefined ? { enterCounters: Object.fromEntries(Object.entries(instruction.enterCounters).flatMap(([counter, count]) => {
            const amount = availableAmount(count, context)
            return amount === undefined || amount === 0 ? [] : [[counter, amount]]
          })) } : {}),
        }
      })
    }
    case 'reveal': {
      const owners = new Map<string, string[]>()
      for (const object of objectActions(instruction.targets, context)) {
        const ids = owners.get(object.owner) ?? []
        ids.push(object.id)
        owners.set(object.owner, ids)
      }
      return [...owners].map(([seat, objectIds]) => ({ type: 'reveal' as const, seat, objectIds }))
    }
    case 'tap':
      return objectActions(instruction.targets, context)
        .filter(object => isSameObject(context.state.objects[object.id], objectIdentity(object)))
        .map(object => ({
          type: 'tap' as const,
          objectId: object.id,
          ...(instruction.skipNextUntap ? { skipNextUntap: true as const } : {}),
        }))
    case 'untap':
      return objectActions(instruction.targets, context)
        .filter(object => isSameObject(context.state.objects[object.id], objectIdentity(object)))
        .map(object => ({ type: 'untap' as const, objectId: object.id }))
    case 'changeControl': {
      const controller = evaluatePlayerReference(instruction.controller, context)[0]
      if (!controller) return []
      return objectActions(instruction.targets, context)
        .filter(object => object.zone === 'battlefield' && isSameObject(context.state.objects[object.id], objectIdentity(object)))
        .map(object => ({ type: CONTROL_EVENT.change, objectRef: objectIdentity(object), controller }))
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
      if (!amount || !targets.length) {
        if (instruction.bindChoice) frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
        return []
      }
      if (instruction.bindResult && targets.length === 1) frame.pendingResult = { binding: instruction.bindResult, kind: 'action', value: amount, eventType: 'createToken' }
      if (instruction.bindChoice) frame.pendingCreatedChoice = {
        binding: instruction.bindChoice,
        beforeIds: Object.values(draft.objects).filter(object => object.zone === 'battlefield').map(object => object.id),
      }
      const { abilities, ...token } = instruction.token
      const ruleDefinition = abilities ? createDefinitionSnapshot(compileCardRuleDefinition(cardRuleDefinition(RULE_DSL_SCHEMA_VERSION, { abilities }))) : undefined
      return targets.flatMap((seat) => Array.from({ length: amount }, () => ({
        type: 'createToken' as const,
        controller: seat,
        token: {
          ...token,
          ...(ruleDefinition ? { ruleDefinition } : {}),
          types: [...instruction.token.types],
          ...(instruction.token.subtypes ? { subtypes: [...instruction.token.subtypes] } : {}),
          ...(instruction.token.colors ? { colors: [...instruction.token.colors] } : {}),
          dsl: true as const,
        },
      })))
    }
    case 'createEmblem': {
      const targets = recipients(instruction.targets, context)
      const { abilities, ...emblem } = instruction.emblem
      const ruleDefinition = createDefinitionSnapshot(compileCardRuleDefinition(cardRuleDefinition(RULE_DSL_SCHEMA_VERSION, { abilities })))
      return targets.map((seat) => ({
        type: 'createEmblem' as const,
        controller: seat,
        emblem: {
          name: emblem.name,
          ...(emblem.subtypes ? { subtypes: [...emblem.subtypes] } : {}),
          ...(emblem.oracleText !== undefined ? { oracleText: emblem.oracleText } : {}),
          ruleDefinition,
        },
      }))
    }
    case 'banAttacks': {
      const attackers = instruction.attackers.kind === 'players'
        ? evaluatePlayerSelector(instruction.attackers, context)
        : evaluatePlayerReference(instruction.attackers, context)
      return attackers.map((seat) => ({
        type: 'banAttacks' as const,
        attackerController: seat,
        protectorController: frame.controller,
        source: structuredClone(frame.source),
        defenders: structuredClone(instruction.defenders),
      }))
    }
    case 'copy': {
      const sources = instruction.snapshot
        ? (() => {
          const snapshot = frame.capturedCopies?.[instruction.snapshot]
          if (!snapshot) throw new RuleDslEvaluationError(`copy snapshot ${instruction.snapshot} is not bound`)
          return [{ objectId: frame.source.ref.objectId, token: { ...snapshot, ...(instruction.tapped ? { tapped: true as const } : {}) } }]
        })()
        : objectActions(instruction.targets!, context).map(object => ({
          objectId: object.id,
          token: { ...copyCharacteristics(object), ...(instruction.tapped ? { tapped: true as const } : {}) },
        }))
      const controllers = instruction.controller
        ? (instruction.controller.kind === 'players'
          ? evaluatePlayerSelector(instruction.controller, context)
          : evaluatePlayerReference(instruction.controller, context))
        : [context.controller]
      if (instruction.bindResult && sources.length > 0 && controllers.length > 0) {
        frame.pendingResult = {
          binding: instruction.bindResult,
          kind: 'action',
          value: sources.length * controllers.length,
          eventType: 'copyPermanent',
        }
      }
      if (instruction.bindChoice) {
        if (sources.length === 0 || controllers.length === 0) {
          frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
        } else {
          frame.pendingCreatedChoice = {
            binding: instruction.bindChoice,
            beforeIds: Object.values(draft.objects).filter(object => object.zone === 'battlefield').map(object => object.id),
          }
        }
      }
      return sources.flatMap((source) => controllers.map((controller) => ({
        type: 'copyPermanent' as const,
        objectId: source.objectId,
        controller,
        token: source.token,
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
          if (instruction.bindResult) frame.pendingResult = {
            binding: instruction.bindResult,
            kind: 'action',
            value: jobs.length,
            eventType: 'copySpell',
          }
          if (jobs.length > 0) {
            openNextCopySlot(draft, frame)
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
      const amount = availableAmount(instruction.count, context) ?? 0
      const ids = targets.flatMap(seat => (context.state.zoneOrder[seat].library ?? []).slice(0, amount))
      if (instruction.bindChoice) frame.pendingMilledChoice = {
        binding: instruction.bindChoice,
        objects: ids.map(id => objectIdentity(context.state.objects[id]!)),
      }
      return targets.flatMap(seat => (context.state.zoneOrder[seat].library ?? []).slice(0, amount)
        .map(objectId => ({ type: 'mill' as const, seat, objectId, sourceId: frame.source.ref.objectId })))
    }
    case 'shuffle': {
      return recipients(instruction.targets, context).map((seat) => ({
        type: 'shuffleLibrary' as const,
        seat,
      }))
    }
    case 'discardHands':
      return recipients(instruction.targets, context).flatMap(seat => (context.state.zoneOrder[seat].hand ?? []).map(objectId => ({ type: 'discard' as const, seat, objectId })))
    case 'discard': {
      if (instruction.by !== undefined) {
        const by = evaluatePlayerReference(instruction.by, context)[0]
        const targets = instruction.targets.kind === 'objects'
          ? evaluateObjectSelector(instruction.targets, context)
          : evaluateObjectReference(instruction.targets, context)
        if (instruction.bindResult) {
          frame.pendingResult = { binding: instruction.bindResult, kind: 'amount', eventType: 'discard', value: 0 }
        }
        if (!by) return []
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
        const destination = instruction.destination
        const redirect = Boolean(
          destination
          && (!destination.types || destination.types.some((type) => object?.types.includes(type))),
        )
        const controller = redirect && destination?.controller
          ? evaluatePlayerReference(destination.controller, context)[0]
          : undefined
        return {
          type: 'counterStackItem' as const,
          stackId,
          sourceId: frame.source.ref.objectId,
          ...(object ? { objectRef: objectIdentity(object) } : {}),
          ...(redirect && destination ? { destination: destination.to } : {}),
          ...(controller ? { controller } : {}),
        }
      }
      return targets.flatMap((target) => target.kind === 'stackItem'
        ? [counterEvent(target.stackId)]
        : [])
    }
    case 'createEffect': {
      const targets = instruction.effect.kind === 'prevention' && instruction.targets.kind !== 'objects'
        ? evaluateObjectReference(instruction.targets, context, 'currentOrLastKnown')
        : objectActions(instruction.targets, context)
      if (instruction.effect.kind === 'prevention') {
        const preventionEffect = instruction.effect
        const capacity = preventionEffect.capacity.kind === 'unlimited'
          ? 'unlimited' as const
          : availableAmount(preventionEffect.capacity, context) ?? 0
        if ((capacity !== 'unlimited' && capacity <= 0) || targets.length === 0) return []
        const capturedBindings = {
          ...(context.results && Object.keys(context.results).length > 0 ? { results: structuredClone(context.results) } : {}),
          ...(context.targets && Object.keys(context.targets).length > 0
            ? { targets: structuredClone(context.targets) } : {}),
          ...(context.targetLegality ? { targetLegality: structuredClone(context.targetLegality) } : {}),
          ...(context.choices && Object.keys(context.choices).length > 0
            ? { choices: structuredClone(context.choices) } : {}),
        }
        return targets.map((object) => {
          const live = context.state.objects[object.id]
          return {
            type: 'registerPrevention' as const,
            hostObjectId: object.id,
            filter: structuredClone(preventionEffect.filter),
            capacity,
            duration: structuredClone(instruction.duration),
            sourceId: frame.source.ref.objectId,
            sourceRef: structuredClone(frame.source.ref),
            sourceRevision: frame.definitionSnapshot.definitionRevision,
            capturedSource: captureObject(
              object,
              live && isSameObject(live, objectIdentity(object)) ? 'current' : 'lastKnown',
            ),
            ...(preventionEffect.additionalEffects
              ? { additionalEffects: structuredClone(preventionEffect.additionalEffects) }
              : {}),
            ...(Object.keys(capturedBindings).length > 0 ? { capturedBindings } : {}),
            createdTurn: draft.turn,
            ...durationMetadata(instruction.duration, context, draft),
          }
        })
      }
      if (instruction.effect.kind === 'grantActivatedAbility') {
        const ability = instruction.effect.ability
        if (ability.modes) throw new Error('granted activated programs require instructions')
        const captured = captureLexicalBindings(ability.instructions ?? [], frame.choices, frame.results, [ability.decisions], [], frame.playerChoiceBindings)
        return targets.map(object => ({
          type: 'canonicalEffect' as const, objectId: object.id,
          effect: { kind: 'grantActivatedAbility' as const, ability: { ...ability, generated: true as const, capturedBindings: captured.capturedBindings, decisions: captured.rewrittenAdditionalValues[0] as typeof ability.decisions, instructions: captured.instructions } },
          duration: structuredClone(instruction.duration), sourceId: frame.source.ref.objectId, sourceRef: frame.source.ref, sourceRevision: frame.definitionSnapshot.definitionRevision,
          execution: { controller: frame.controller, ...capturedExecutionSource(frame),
            ...(frame.choices ? { choices: structuredClone(frame.choices) } : {}), ...(frame.results ? { results: structuredClone(frame.results) } : {}),
            ...(frame.variables ? { variables: structuredClone(frame.variables) } : {}), capturedChoiceAliases: captured.choiceAliases, capturedResultAliases: captured.resultAliases,
          },
        }))
      }
      const grant = instruction.effect.kind === 'grantAbility' ? instruction.effect.ability : undefined
      const grantChoices = grant
        ? captureLexicalBindings(
          grant.instructions,
          frame.choices,
          frame.results,
          [grant.on],
          occurrenceBindingsForPattern(grant.on), frame.playerChoiceBindings,
        )
        : undefined
      const grantDecisions = grant && grantChoices
        ? grant.decisions
          ? {
              ...grant.decisions,
              ...(!grant.decisions.variables && frame.variables
                ? { variables: parentVariables(frame, context.scopeId) } : {}),
            }
          : frame.variables
            ? { variables: parentVariables(frame, context.scopeId) }
            : undefined
        : undefined
      const grantEffect = grant && grantChoices
        ? {
            kind: 'grantAbility' as const,
            ability: {
              ...grant,
              on: grantChoices.rewrittenAdditionalValues[0] as typeof grant.on,
              ...(Object.keys(grantChoices.capturedBindings.choices ?? {}).length > 0
                || Object.keys(grantChoices.capturedBindings.results ?? {}).length > 0
                || (grantChoices.capturedBindings.occurrence?.length ?? 0) > 0
                ? { capturedBindings: grantChoices.capturedBindings }
                : {}),
              ...(grantDecisions ? { decisions: grantDecisions } : {}),
              instructions: grantChoices.instructions,
            },
          }
        : undefined
      const selectedType = instruction.effect.kind === 'addTypes' && instruction.effect.creatureType ? evaluateCreatureType(instruction.effect.creatureType, context) : undefined
      const effect = instruction.effect.kind === 'pump' || instruction.effect.kind === 'setStats'
        ? {
            kind: instruction.effect.kind,
            power: { kind: 'constant' as const, value: evaluateRuntimeStatDelta(instruction.effect.power, context) },
            toughness: { kind: 'constant' as const, value: evaluateRuntimeStatDelta(instruction.effect.toughness, context) },
          }
        : structuredClone(instruction.effect.kind === 'addTypes' && selectedType ? { ...instruction.effect, creatureType: undefined, subtypes: [...(instruction.effect.subtypes ?? []), selectedType] } : grantEffect ?? instruction.effect)
      const grantExecution = grant && grantChoices && (
        frame.choices !== undefined
        || frame.results !== undefined
        || frame.variables !== undefined
        || context.capturedOccurrence !== undefined
        || context.occurrence !== undefined
        || Object.keys(grantChoices.choiceAliases).length > 0
        || Object.keys(grantChoices.resultAliases).length > 0
      )
        ? {
            controller: frame.controller,
            ...capturedExecutionSource(frame),
            ...((context.capturedOccurrence ?? context.occurrence) ? { capturedOccurrence: structuredClone(context.capturedOccurrence ?? context.occurrence) } : {}),
            ...(grantChoices.capturedBindings.occurrence ? { capturedOccurrenceBindings: grantChoices.capturedBindings.occurrence } : {}),
            ...(frame.choices ? { choices: structuredClone(frame.choices) } : {}),
            ...(frame.results ? { results: structuredClone(frame.results) } : {}),
            ...(frame.variables ? { variables: structuredClone(frame.variables) } : {}),
            ...(Object.keys(grantChoices.choiceAliases).length > 0 ? { capturedChoiceAliases: grantChoices.choiceAliases } : {}),
            ...(Object.keys(grantChoices.resultAliases).length > 0 ? { capturedResultAliases: grantChoices.resultAliases } : {}),
            ...(context.scopeId ?? frame.scopeId ? { scopeId: context.scopeId ?? frame.scopeId } : {}),
          }
        : undefined
      return targets.map((object) => ({
        type: 'canonicalEffect' as const,
        objectId: object.id,
        effect,
        ...(effect.kind === 'goad' ? { effectPlayer: frame.controller } : {}),
        duration: structuredClone(instruction.duration),
        sourceId: frame.source.ref.objectId,
        sourceRef: structuredClone(frame.source.ref),
        sourceRevision: frame.definitionSnapshot.definitionRevision,
        ...(grantExecution ? { execution: grantExecution } : {}),
        createdTurn: draft.turn,
        ...durationMetadata(instruction.duration, context, draft),
      }))
    }
    case 'createDelayed': {
      registerCanonicalDelayed(draft, instruction.condition, instruction.instructions, frame, context, instruction.inheritTargets, instruction.notThisTurn, instruction.repeatUntilCleanup)
      return []
    }
    case 'lockOrUnlockDoor': {
      const item = frame.inlineItem
        ?? draft.stack.find(candidate => candidate.id === frame.stackId)
        ?? context.state.stack.find(candidate => candidate.id === frame.stackId)
      const door = item?.door
      if (door !== 'left' && door !== 'right') return []
      return objectActions(instruction.targets, context).flatMap((object): GameEvent[] => {
        if (!object.roomDoors || object.controller !== frame.controller) return []
        if (object.unlockedDoors?.includes(door)) {
          return [{ type: 'lockDoor', seat: frame.controller, objectId: object.id, door }]
        }
        return [{
          type: 'unlockDoor',
          seat: frame.controller,
          objectId: object.id,
          door,
          withoutCost: true,
        }]
      })
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
  if (advanceCollectedChoices(draft)) return { kind: 'events' as const, events: [] }
  if (frame.pendingMilledChoice) {
    const pending = frame.pendingMilledChoice
    frame.choices = { ...frame.choices, [pending.binding]: pending.objects.flatMap(ref => {
      const object = draft.objects[ref.objectId]
      if (!object || object.incarnation !== ref.incarnation + 1 || object.faceDown
        || object.zone === 'library' || object.zone === 'hand') return []
      return [{ kind: 'object' as const, ...objectIdentity(object) }]
    }) }
    delete frame.pendingMilledChoice
  }
  if (frame.pendingMovedChoice) {
    const pending = frame.pendingMovedChoice
    frame.choices = { ...frame.choices, [pending.binding]: pending.objects
      .filter(ref => isSameObject(draft.objects[ref.objectId], ref))
      .map(ref => ({ kind: 'object' as const, ...ref })) }
    delete frame.pendingMovedChoice
  }
  if (frame.pendingCreatedChoice) {
    const pending = frame.pendingCreatedChoice
    const created = Object.values(draft.objects).filter(object =>
      object.zone === 'battlefield' && object.token && !pending.beforeIds.includes(object.id))
    frame.choices = {
      ...frame.choices,
      [pending.binding]: created.map(object => ({ kind: 'object' as const, ...objectIdentity(object) })),
    }
    delete frame.pendingCreatedChoice
  }
  if (frame.pendingDestroyedChoice) {
    const pending = frame.pendingDestroyedChoice
    const kept = pending.entries.filter(entry => {
      const current = draft.objects[entry.objectId]
      return !current || current.zone === 'graveyard'
    })
    frame.choices = {
      ...frame.choices,
      [pending.binding]: kept.map(entry => {
        const current = draft.objects[entry.objectId]
        return current
          ? { kind: 'object' as const, ...objectIdentity(current) }
          : { kind: 'object' as const, objectId: entry.objectId, incarnation: entry.incarnation, zone: 'graveyard' as const }
      }),
    }
    frame.choiceSnapshots = { ...frame.choiceSnapshots, [pending.binding]: kept.map(entry => structuredClone(entry.snapshot)) }
    delete frame.pendingDestroyedChoice
  }
  if (frame.pendingBlink) {
    const returns = frame.pendingBlink
    delete frame.pendingBlink
    const events = returns.filter(entry => isSameObject(draft.objects[entry.ref.objectId], entry.ref))
      .map(entry => ({ type: 'move' as const, objectId: entry.ref.objectId, to: 'battlefield' as const, controller: entry.controller,
        ...(entry.tapped !== undefined ? { tapped: entry.tapped } : {}) }))
    frame.phase = 'committing'
    frame.pendingEvents = events.length > 1 ? [{ type: 'actionGroup', events }] : events
    return { kind: 'events', events: frame.pendingEvents }
  }
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
    if (pending.binding) frame.results = { ...frame.results, [pending.binding]: pending.selected.length }
    delete frame.pendingDiscard
  }
  while (frame.scopes.length > 0) {
    const scope = frame.scopes.at(-1)!
    if (scope.cursor >= scope.instructions.length && (scope.repeatRemaining ?? 0) > 0) {
      scope.repeatRemaining! -= 1
      scope.cursor = 0
    }
    if (scope.cursor >= scope.instructions.length || (scope.iterationPlayer && draft.players[scope.iterationPlayer]?.lost)) {
      frame.scopes.pop()
      if (scope.restoreBindings) {
        const collected = scope.collectMax
          ? Math.max(
            frame.resultMaxima?.[scope.collectMax.as] ?? 0,
            numericInstructionResult(frame.results?.[scope.collectMax.from]),
          )
          : undefined
        if (scope.collectMax && collected !== undefined) {
          frame.resultMaxima = { ...frame.resultMaxima, [scope.collectMax.as]: collected }
        }
        for (const key of ['choices', 'results', 'choiceSnapshots', 'capturedCopies', 'playerChoiceBindings'] as const) {
          delete frame[key]
        }
        Object.assign(frame, structuredClone(scope.restoreBindings))
        if (scope.collectMax && collected !== undefined) {
          frame.results = { ...frame.results, [scope.collectMax.as]: collected }
        }
      }
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
    if (instruction.kind === 'chooseParticipants' || instruction.kind === 'chooseCardsForEachPlayer') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const selected = new Set(recipients(instruction.of, context))
      const seats = apnapSeats(draft).filter(seat => selected.has(seat))
      frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
      if (instruction.kind === 'chooseParticipants') frame.playerChoiceBindings = [...(frame.playerChoiceBindings ?? []), instruction.bindChoice]
      frame.collectedPlayerChoices = {
        kind: instruction.kind === 'chooseParticipants' ? 'participants' : 'cards', binding: instruction.bindChoice,
        ...(instruction.kind === 'chooseParticipants' && instruction.prompt ? { prompt: instruction.prompt } : {}),
        participants: [], cards: [], requests: seats.map(seat => {
          const runtime = withOccurrencePlayer(context, seat)
          const min = instruction.kind === 'chooseCardsForEachPlayer' ? evaluateRuntimeAmount(instruction.min, runtime) : 0
          const max = instruction.kind === 'chooseCardsForEachPlayer' ? evaluateRuntimeAmount(instruction.max, runtime) : 0
          if (min > max) throw pathError(frame, path, 'choice minimum exceeds maximum')
          return { seat, candidates: instruction.kind === 'chooseCardsForEachPlayer' ? evaluateObjectSelector(instruction.filter, runtime).map(objectIdentity) : [], min, max }
        }),
      }
      if (advanceCollectedChoices(draft)) return { kind: 'events', events: [] }
      continue
    }
    if (instruction.kind === 'forEachPlayer') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const selected = new Set(recipients(instruction.of, context))
      const players = apnapSeats(draft).filter(player => selected.has(player))
      if (instruction.bindMax) {
        frame.resultMaxima = { ...frame.resultMaxima, [instruction.bindMax.as]: 0 }
        frame.results = { ...frame.results, [instruction.bindMax.as]: 0 }
      }
      const restoreBindings = {
        ...(frame.playerChoiceBindings ? { playerChoiceBindings: [...frame.playerChoiceBindings] } : {}),
        ...(frame.choices ? { choices: structuredClone(frame.choices) } : {}),
        ...(frame.results ? { results: structuredClone(frame.results) } : {}),
        ...(frame.voteResults ? { voteResults: structuredClone(frame.voteResults) } : {}),
        ...(frame.choiceSnapshots ? { choiceSnapshots: structuredClone(frame.choiceSnapshots) } : {}),
        ...(frame.capturedCopies ? { capturedCopies: structuredClone(frame.capturedCopies) } : {}),
      }
      for (const player of players.toReversed()) frame.scopes.push({
        path: `${path}.instructions`, scopeId: scope.scopeId,
        instructions: structuredClone(instruction.instructions), cursor: 0,
        occurrence: { kind: 'event', eventType: 'forEachPlayer', player }, iterationPlayer: player,
        restoreBindings: structuredClone(restoreBindings),
        ...(instruction.bindMax ? { collectMax: instruction.bindMax } : {}),
      })
      continue
    }
    if (instruction.kind === 'chooseRandom') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const candidates = evaluateObjectSelector(instruction.filter, context)
      if (candidates.length === 0) {
        frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
        continue
      }
      const events: GameEvent[] = [{
        type: 'custom',
        name: HIDDEN_RANDOM,
        seat: frame.controller,
        payload: {
          choices: candidates.map(object => object.id),
          resultName: CANONICAL_RANDOM_RESULT,
          context: { binding: instruction.bindChoice, stackId: frame.stackId },
        },
      }]
      frame.phase = 'committing'
      frame.pendingEvents = events
      return { kind: 'events', events }
    }
    if (instruction.kind === 'vote') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const options = instruction.options.kind === 'named'
        ? [...instruction.options.options]
        : instruction.options.kind === 'players'
          ? evaluatePlayerSelector(
            { kind: 'players', filter: instruction.options.filter ?? {} },
            context,
          ).map((seat) => ({ id: seat, label: seat }))
          : disambiguateVoteOptions(evaluateObjectSelector(instruction.options.filter, context).map((object) => ({
            id: object.id,
            label: object.name,
          })))
      beginVote(draft, {
        source: {
          id: frame.source.ref.objectId,
          name: frame.source.snapshot.name,
          controller: frame.controller,
        },
        item,
        prompt: instruction.prompt,
        options,
        canonical: {
          stackId: frame.stackId,
          bindResult: instruction.bindResult,
          ...(instruction.bindWinners ? { bindWinners: instruction.bindWinners } : {}),
        },
      })
      if (pendingVote(draft)) {
        frame.phase = 'committing'
        frame.pendingEvents = []
        return { kind: 'events', events: [] }
      }
      continue
    }
    if (instruction.kind === 'partitionPiles') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const partitioner = evaluatePlayerReference(instruction.partitioner, context)[0]
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      const cards = objectActions(instruction.cards, context)
      if (!partitioner || !chooser || cards.length === 0) {
        frame.choices = { ...frame.choices, [instruction.bindChosen]: [], [instruction.bindOther]: [] }
        continue
      }
      openCardSelection(draft, {
        seat: partitioner,
        kind: 'partition',
        count: cards.length,
        candidates: cards.map((object) => object.id),
        sourceId: frame.source.ref.objectId,
        source: frame.source.snapshot.name,
        prompt: 'Separate these cards into two piles.',
        destinations: ['face-up', 'face-down'],
        fromSeat: cards[0]?.owner ?? chooser,
        fromZone: 'library',
        pileController: chooser,
        pileReveal: 'public',
        pileVisibility: 'public',
        canonicalChoice: {
          stackId: frame.stackId,
          scopeId: scope.scopeId,
          binding: instruction.bindChosen,
          bindOther: instruction.bindOther,
          action: 'partitionPiles',
        },
      })
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'choosePlayer') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      const candidates = evaluatePlayerSelector(instruction.filter, context)
      frame.playerChoiceBindings = [...(frame.playerChoiceBindings ?? []), instruction.bindChoice]
      frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
      if (chooser && candidates.length > 0) openPlayerSelection(draft, {
        seat: chooser, sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
        prompt: 'Choose a player.', min: 1, max: 1, candidates,
        action: { kind: PLAYER_PROGRAM_CHOICE_ACTION.choose, stackId: frame.stackId, binding: instruction.bindChoice },
      })
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'forEach') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const snapshots = instruction.of.kind === 'choiceRef' && frame.choiceSnapshots?.[instruction.of.binding]
        ? frame.choiceSnapshots[instruction.of.binding]!
        : objectActions(instruction.of, context).map(snapshotObject)
      for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        const snapshot = snapshots[index]!
        frame.scopes.push({
          path: `${path}.instructions`,
          scopeId: scope.scopeId,
          instructions: structuredClone(instruction.instructions),
          cursor: 0,
          occurrence: {
            kind: 'event',
            eventType: 'forEach',
            player: snapshot.controller,
            object: { after: snapshot },
          },
        })
      }
      continue
    }
    if (instruction.kind === 'repeat') {
      const count = availableAmount(instruction.count, runtimeContext(draft, frame, item, scope.scopeId)) ?? 0
      if (count === 0 || instruction.instructions.length === 0) continue
      frame.scopes.push({
        path: `${path}.instructions`, scopeId: scope.scopeId,
        instructions: structuredClone(instruction.instructions), cursor: 0,
        repeatRemaining: count - 1,
      })
      continue
    }
    if (instruction.kind === 'repeatWhile') {
      const looping = scope.continueWhile === true
      if (looping) {
        const context = runtimeContext(draft, frame, item, scope.scopeId)
        if (!evaluateCondition(instruction.condition, context)) continue
      }
      frame.scopes.push({
        path: `${path}.instructions`,
        scopeId: scope.scopeId,
        instructions: [...instruction.instructions, instruction],
        cursor: 0,
        continueWhile: true,
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
    if (instruction.kind === 'addManaFrom') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      if (availableAmount(instruction.amount, context) === 0) continue
      const types = availableManaTypes(context.state, frame.source.snapshot, instruction.of, instruction.colorsOnly, context, instruction.basis)
      const selected = item.choices?.[0]
      const options = types.map(type => ({ label: type, instructions: [{ kind: 'addMana' as const, targets: instruction.targets, amount: { [type]: instruction.amount } }] }))
      const chosen = options.find(option => option.label === selected)
      const next: Instruction[] = chosen ? chosen.instructions : options.length === 0 ? [] : [{ kind: 'chooseInstructions', chooser: { kind: 'contextRef', name: 'controller' }, count: { kind: 'constant', value: 1 }, options, whenInsufficient: 'chooseAvailable' }]
      frame.scopes.push({ path, scopeId: scope.scopeId, instructions: next, cursor: 0 })
      continue
    }
    if (instruction.kind === 'chooseCreatureType') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      if (chooser) openOptionSelection(draft, {
        seat: chooser, sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
        prompt: 'Choose a creature type.', options: CREATURE_TYPES.map(type => ({ id: type, label: type })),
        action: { kind: CREATURE_TYPE_CHOICE_ACTION, stackId: frame.stackId, binding: instruction.bindResult },
      })
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'chooseInstructions') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const announced = frame.inlineItem && item.choices?.[0]
      const selected = announced ? instruction.options.find(option => option.label === announced) : undefined
      if (selected) {
        frame.scopes.push({ path, scopeId: scope.scopeId, instructions: [...selected.instructions], cursor: 0 })
        continue
      }
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      if (chooser && instruction.options.length > 0) {
        openOptionSelection(draft, {
          seat: chooser,
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: instruction.prompt ?? 'Choose an instruction program.',
          ...(instruction.optional ? { optionalAction: {
            key: JSON.stringify([frame.source.ref, frame.declarationPath, path]),
            acceptSlot: 0, declineSlot: 1,
          } } : {}),
          options: instruction.options.map((option, optionIndex) => ({
            id: `instruction:${optionIndex}`,
            label: option.label ?? `Option ${optionIndex + 1}`,
          })),
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
    if (instruction.kind === 'distributeControl') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const chooser = evaluatePlayerReference(instruction.chooser, context)[0]
      const candidates = recipients(instruction.recipients, context)
      const targets = objectActions(instruction.targets, context).filter(object => object.zone === 'battlefield')
      if (chooser && targets.length && candidates.length) openControlAssignment(draft, {
        kind: CONTROL_CHOICE_ACTION.assign, stackId: frame.stackId,
        objects: targets.map(objectIdentity), candidates, distinct: instruction.distinct, assignments: [],
        chooser, sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
      })
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
      const fromZone = instruction.filter.filter.zone
      const visibleCards = instruction.viewCards ? evaluateObjectReference(instruction.viewCards, context).map(object => object.id) : undefined
      // An empty eligible set still needs a private read-and-continue view.
      if (chooser && ((candidates.length > 0 && max > 0) || (visibleCards?.length ?? 0) > 0)) {
        openCardSelection(draft, {
          seat: chooser,
          kind: 'choose',
          count: max,
          min,
          candidates: candidates.map((object) => object.id),
          ...(visibleCards ? { visibleCards } : {}),
          targetIdentities: Object.fromEntries(candidates.map((object) => [object.id, objectIdentity(object)])),
          sourceId: frame.source.ref.objectId,
          source: frame.source.snapshot.name,
          prompt: instruction.viewCards ? 'Choose from the inspected cards.' : fromZone === 'library'
            ? 'Search your library.'
            : 'Choose cards for the Rule DSL program.',
          destinations: ['target', 'skip'],
          canonicalChoice: { stackId: frame.stackId, scopeId: scope.scopeId, binding: instruction.bindChoice },
          ...(instruction.viewLibrary ? { viewLibrary: true as const } : {}),
          ...(instruction.related ? { related: instruction.related } : {}),
          ...(fromZone ? {
            fromZone,
            fromSeat: candidates[0]?.owner ?? chooser,
          } : {}),
        })
      } else if (min === 0) {
        frame.choices = { ...frame.choices, [instruction.bindChoice]: [] }
      }
      frame.phase = 'committing'
      frame.pendingEvents = []
      return { kind: 'events', events: [] }
    }
    if (instruction.kind === 'scry' || instruction.kind === 'surveil') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const count = availableAmount(instruction.count, context) ?? 0
      const selected = new Set(recipients(instruction.targets, context))
      const waitingSeats: string[] = []
      const completions: GameEvent[] = []
      for (const seat of apnapSeats(draft).filter(seat => selected.has(seat))) {
        if (count === 0) continue
        completions.push({ type: instruction.kind, seat, count })
        const candidates = draft.zoneOrder[seat].library.slice(0, count)
        if (candidates.length === 0) continue
        waitingSeats.push(seat)
        openCardSelection(draft, {
          seat, kind: instruction.kind, count: candidates.length, candidates,
          sourceId: frame.source.ref.objectId, source: frame.source.snapshot.name,
          fromSeat: seat, fromZone: 'library',
          destinations: instruction.kind === 'scry' ? ['top', 'bottom'] : ['top', 'graveyard'],
          sequence: waitingSeats.length - 1,
          canonicalChoice: { stackId: frame.stackId, scopeId: scope.scopeId, binding: path, action: 'topDeck' },
        })
      }
      if (waitingSeats.length > 0) frame.pendingTopDeck = { seats: waitingSeats, events: [], completions }
      frame.phase = 'committing'
      frame.pendingEvents = waitingSeats.length > 0 ? [] : completions
      return { kind: 'events', events: frame.pendingEvents }
    }
    if (instruction.kind === 'revealUntil') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const stepped = runRevealUntil(
        draft,
        context,
        instruction,
        { id: frame.source.ref.objectId, name: frame.source.snapshot.name },
      )
      frame.choices = storeRevealUntilBindings(frame.choices, stepped.bindings, instruction)
      if (('waiting' in stepped) || stepped.events.length > 0) {
        frame.phase = 'committing'
        frame.pendingEvents = structuredClone(stepped.events)
        return { kind: 'events', events: stepped.events }
      }
      continue
    }
    if (instruction.kind === 'payOptional') {
      const context = runtimeContext(draft, frame, item, scope.scopeId)
      const payer = evaluatePlayerReference(instruction.payer, context)[0]
      if (!payer) throw pathError(frame, path, 'resolution payment payer is not available')
      let paymentAmount: number | undefined
      switch (instruction.cost.kind) {
        case 'mana': paymentAmount = 0; break
        case 'manaAndLife': paymentAmount = availableAmount(instruction.cost.life, context); break
        case 'life': paymentAmount = availableAmount(instruction.cost.amount, context); break
        case 'discard':
        case 'sacrifice': paymentAmount = availableAmount(instruction.cost.count, context); break
      }
      if (paymentAmount === undefined) throw pathError(frame, path, 'resolution payment amount is not available')
      const bindings = {
        ...(context.targets ? { targets: structuredClone(context.targets) } : {}),
        ...(context.targetLegality ? { targetLegality: structuredClone(context.targetLegality) } : {}),
        ...(context.choices ? { choices: structuredClone(context.choices) } : {}),
        ...(context.results ? { results: structuredClone(context.results) } : {}),
        ...(context.variables ? { variables: structuredClone(context.variables) } : {}),
        ...(context.occurrence ? { occurrence: structuredClone(context.occurrence) } : {}),
        ...(context.capturedOccurrence ? { capturedOccurrence: structuredClone(context.capturedOccurrence) } : {}),
        ...(context.capturedOccurrenceBindings ? { capturedOccurrenceBindings: [...context.capturedOccurrenceBindings] } : {}),
        ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
      }
      const manaPayment = resolutionManaCost(instruction.cost)
      const manaActivations = manaPayment && !canPayResolutionMana(draft, payer, manaPayment, frame.source, bindings)
        ? eligibleResolutionManaAbilities(draft, payer)
        : []
      const options = [
        { id: 'pay', label: 'Pay' },
        { id: 'decline', label: 'Decline' },
        ...manaActivations.map((activation) => ({
          id: activation.kind === 'tapForMana'
            ? `tap:${activation.objectId}:${activation.mana ?? ''}`
            : `activate:${activation.objectId}:${activation.abilityId}`,
          label: activation.label,
        })),
      ]
      openOptionSelection(draft, {
        seat: payer,
        sourceId: frame.source.ref.objectId,
        source: frame.source.snapshot.name,
        prompt: `Pay ${resolutionCostLabel(instruction.cost, paymentAmount)}.`,
        options,
        action: {
          kind: 'canonicalResolutionPayment',
          stackId: frame.stackId,
          scopeId: scope.scopeId,
          cost: instruction.cost,
          ...capturedExecutionSource(frame),
          controller: frame.controller,
          bindResult: instruction.bindResult,
          ...(instruction.whenPaidDecisions ? { whenPaidDecisions: structuredClone(instruction.whenPaidDecisions) } : {}),
          ifPaid: instruction.ifPaid ?? [],
          ifDeclined: instruction.ifDeclined ?? [],
          whenPaid: instruction.whenPaid ?? [],
          paymentAmount,
          bindings,
          ...(manaActivations.length > 0 ? { manaActivations } : {}),
        },
      })
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
  const destination = object ? resolvedSpellDestination(item, object) : undefined
  const event = item.kind === 'spell'
    && object?.zone === 'stack'
    && isSameObject(object, frame.source.ref)
    && destination !== undefined
    && (!item.copy || destination === 'battlefield')
    ? {
        type: 'move' as const,
        objectId: object.id,
        to: destination,
        ...(object.subtypes.includes('Aura') && item.targets[0]?.kind === 'player' ? { attachPlayer: item.targets[0].player } : {}),
        ...(object.subtypes.includes('Aura') && item.targets[0]?.kind === 'object' ? { attachTo: { objectId: item.targets[0].objectId, incarnation: item.targets[0].incarnation ?? draft.objects[item.targets[0].objectId]?.incarnation, zone: 'battlefield' as const } } : {}),
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
      if (object?.spellCopy) ceaseToExist(draft, object)
    }
    draft.priority = frame.intendedPriority
    delete draft.resolution
  }
  draft.passedInRow = []
}
