import { DAMAGEABLE_PERMANENT_TYPES } from '../schema/v1'
import { isSwamp } from '../../../plugins/swampOverlay'
import { isForest } from '../../../plugins/forestOverlay'
import { isSameObject } from '../../../objectIdentity'
import type {
  CapturedObject,
  GameObject,
  GameState,
  ObjectIdentity,
  OccurrenceSnapshot,
  PlayerId,
  StackItem,
} from '../../../types'
import type {
  Amount,
  StatDelta,
  AmountEvaluationContext,
  ChoiceReference,
  Condition,
  ContextReference,
  NumericCharacteristic,
  ObjectFilter,
  ObjectReference,
  ObjectSelector,
  PlayerFilter,
  PlayerMatch,
  PlayerReference,
  PlayerSelector,
  Reference,
  Selector,
  StackItemFilter,
  StackItemReference,
  StackItemSelector,
  TargetReference,
} from '../schema/v1'
import { PLAYER_RELATIONS } from '../schema/v1'
import type { DistributionAllocation } from './modes'
import { evaluateAmount, evaluateStatDelta } from './evaluate'
import { RuleDslEvaluationError } from './errors'

export type BoundRecipient =
  | { kind: 'player'; playerId: PlayerId }
  | ({ kind: 'object' } & ObjectIdentity)
  | { kind: 'stackItem'; stackId: string }

export type RuntimeBindings = {
  targets?: Readonly<Record<number, readonly BoundRecipient[]>>
  targetLegality?: Readonly<Record<number, readonly boolean[]>>
  choices?: Readonly<Record<string, readonly BoundRecipient[]>>
  variables?: Readonly<Partial<Record<'X', number>>>
  results?: Readonly<Record<string, boolean | number>>
  distributions?: readonly DistributionAllocation[]
  scopeId?: string
  capturedOccurrence?: OccurrenceSnapshot
  capturedOccurrenceBindings?: readonly ('player' | 'object.before' | 'object.after')[]
}

export type RuleDslRuntimeContext = RuntimeBindings & {
  state: GameState
  controller: PlayerId
  source: CapturedObject
  occurrence?: OccurrenceSnapshot
  stackItemId?: string
  optionChoices?: Readonly<Record<string, string>>
}

const targetRecipients = (reference: TargetReference, context: RuleDslRuntimeContext) => {
  if (!context.targets || !Object.hasOwn(context.targets, reference.clauseIndex)) {
    throw new RuleDslEvaluationError(`target clause ${reference.clauseIndex} is not bound`)
  }
  const bound = context.targets[reference.clauseIndex]!
  const legality = context.targetLegality?.[reference.clauseIndex]
  return legality
    ? bound.filter((_recipient, index) => legality[index] === true)
    : bound
}

const choiceRecipients = (reference: ChoiceReference, context: RuleDslRuntimeContext) => {
  if (!context.choices || !Object.hasOwn(context.choices, reference.binding)) {
    throw new RuleDslEvaluationError(`choice ${reference.binding} is not bound`)
  }
  return context.choices[reference.binding]!
}

const recipients = (
  reference: TargetReference | ChoiceReference,
  context: RuleDslRuntimeContext,
) => reference.kind === 'targetRef'
  ? targetRecipients(reference, context)
  : choiceRecipients(reference, context)

export const evaluateBoundRecipients = (
  reference: TargetReference | ChoiceReference,
  context: RuleDslRuntimeContext,
) => recipients(reference, context)

const unique = <Value>(values: readonly Value[]) => [...new Set(values)]

const recipientsInDomain = <Recipient extends BoundRecipient>(
  reference: TargetReference | ChoiceReference,
  context: RuleDslRuntimeContext,
  kind: Recipient['kind'],
  matches: (recipient: BoundRecipient) => recipient is Recipient,
) => {
  const bound = recipients(reference, context)
  if (!bound.every(matches)) {
    throw new RuleDslEvaluationError(`${reference.kind} is not bound to ${kind} recipients`)
  }
  return bound
}

const playerContextReference = (
  reference: ContextReference,
  context: RuleDslRuntimeContext,
) => {
  switch (reference.name) {
    case 'controller': return [context.controller]
    case 'event.player':
      if (!context.occurrence?.player) {
        throw new RuleDslEvaluationError(`${reference.name} was not captured by this occurrence`)
      }
      return [context.occurrence.player]
    case 'triggering.player':
      const occurrence = context.capturedOccurrenceBindings?.includes('player')
        ? context.capturedOccurrence
        : context.occurrence
      if (!occurrence?.player) {
        throw new RuleDslEvaluationError(`${reference.name} was not captured by this occurrence`)
      }
      return [occurrence.player]
    default: throw new RuleDslEvaluationError(`${reference.name} is not a player reference`)
  }
}

export const evaluatePlayerReference = (
  reference: PlayerReference,
  context: RuleDslRuntimeContext,
) => {
  if (reference.kind === 'contextRef') return playerContextReference(reference, context)
  return unique(recipientsInDomain(reference, context, 'player', (recipient) => recipient.kind === 'player').map((recipient) =>
    recipient.playerId))
}

const capturedOccurrenceObject = (
  reference: ContextReference,
  context: RuleDslRuntimeContext,
) => {
  const binding = reference.name === 'triggering.object.before' ? 'object.before' : 'object.after'
  const occurrence = context.capturedOccurrenceBindings?.includes(binding)
    ? context.capturedOccurrence
    : context.occurrence
  switch (reference.name) {
    case 'triggering.object.before': return occurrence?.object?.before
    case 'triggering.object.after': return occurrence?.object?.after
    default: return undefined
  }
}

const currentSource = (context: RuleDslRuntimeContext) => {
  const object = context.state.objects[context.source.ref.objectId]
  return isSameObject(object, context.source.ref) ? object : undefined
}

export const evaluateObjectReference = (
  reference: ObjectReference,
  context: RuleDslRuntimeContext,
  information: 'current' | 'currentOrLastKnown' = 'current',
) => {
  if (reference.kind === 'contextRef') {
    if (reference.name === 'source') {
      const current = currentSource(context)
      return current ? [current] : information === 'currentOrLastKnown' ? [context.source.snapshot] : []
    }
    const captured = capturedOccurrenceObject(reference, context)
    if (captured) return [captured]
    if (reference.name === 'triggering.object.before' || reference.name === 'triggering.object.after') {
      throw new RuleDslEvaluationError(`${reference.name} was not captured by this occurrence`)
    }
    throw new RuleDslEvaluationError(`${reference.name} is not an object reference`)
  }
  return recipientsInDomain(reference, context, 'object', (recipient) => recipient.kind === 'object').flatMap((recipient) => {
    const object = context.state.objects[recipient.objectId]
    return isSameObject(object, recipient) ? [object] : []
  })
}

export const evaluateStackItemReference = (
  reference: StackItemReference,
  context: RuleDslRuntimeContext,
) => recipientsInDomain(reference, context, 'stackItem', (recipient) => recipient.kind === 'stackItem').flatMap((recipient) => {
  const item = context.state.stack.find((candidate) => candidate.id === recipient.stackId)
  return item ? [item] : []
})

export const matchesPlayer = (player: PlayerId, match: PlayerMatch | undefined, context: RuleDslRuntimeContext) => {
  if (match === undefined) return false
  if (!context.state.players[player] || context.state.players[player].lost) return false
  switch (match) {
    case PLAYER_RELATIONS.you: return player === context.controller
    case PLAYER_RELATIONS.opponent: return context.state.opponents[context.controller].includes(player)
    case PLAYER_RELATIONS.anyone: return true
    case PLAYER_RELATIONS.teammate:
      return player !== context.controller && !context.state.opponents[context.controller].includes(player)
    default: {
      const selected = evaluatePlayerReference(match, context)
      if (selected.length > 1) throw new RuleDslEvaluationError('player filter reference must resolve to at most one player')
      return selected[0] === player
    }
  }
}

/** Absence is neither a match nor a mismatch; these helpers are not complements. */
export const mismatchesPlayer = (player: PlayerId, match: PlayerMatch | undefined, context: RuleDslRuntimeContext) =>
  match !== undefined && !matchesPlayer(player, match, context)

export const matchesController = (object: { controller: PlayerId }, filter: Pick<ObjectFilter, 'controller'>, context: RuleDslRuntimeContext) =>
  matchesPlayer(object.controller, filter.controller, context)

export const mismatchesController = (object: { controller: PlayerId }, filter: Pick<ObjectFilter, 'controller'>, context: RuleDslRuntimeContext) =>
  mismatchesPlayer(object.controller, filter.controller, context)

export const matchesOwner = (object: { owner: PlayerId }, filter: Pick<ObjectFilter, 'owner'>, context: RuleDslRuntimeContext) =>
  matchesPlayer(object.owner, filter.owner, context)

export const mismatchesOwner = (object: { owner: PlayerId }, filter: Pick<ObjectFilter, 'owner'>, context: RuleDslRuntimeContext) =>
  mismatchesPlayer(object.owner, filter.owner, context)

// Recursive filter composition requires an explicit return type.
const matchesPlayerFilter = (
  player: PlayerId,
  filter: PlayerFilter,
  context: RuleDslRuntimeContext,
): boolean => {
  if (filter.all && !filter.all.every((part) => matchesPlayerFilter(player, part, context))) return false
  if (filter.any && !filter.any.some((part) => matchesPlayerFilter(player, part, context))) return false
  if (filter.not && matchesPlayerFilter(player, filter.not, context)) return false
  if (mismatchesPlayer(player, filter.relation, context)) return false
  return true
}

export const evaluatePlayerSelector = (
  selector: PlayerSelector,
  context: RuleDslRuntimeContext,
) => context.state.playerOrder.filter((player) =>
  !context.state.players[player].lost && matchesPlayerFilter(player, selector.filter, context))

// Recursive filter composition requires an explicit return type.
const matchesObjectFilter = (
  object: GameObject,
  filter: ObjectFilter,
  context: RuleDslRuntimeContext,
): boolean => {
  if (filter.all && !filter.all.every((part) => matchesObjectFilter(object, part, context))) return false
  if (filter.any && !filter.any.some((part) => matchesObjectFilter(object, part, context))) return false
  if (filter.not && matchesObjectFilter(object, filter.not, context)) return false
  if (filter.other && isSameObject(object, context.source.ref)) return false
  if (filter.among && !evaluateObjectReference(filter.among, context).some(candidate => candidate.id === object.id)) return false
  if (filter.zone && object.zone !== filter.zone) return false
  if (filter.type && !object.types.includes(filter.type)) return false
  if (filter.subtypes && !filter.subtypes.every(subtype => {
    if (object.subtypes.includes(subtype)) return true
    if (object.zone !== 'battlefield') return false
    switch (subtype) {
      case 'Swamp': return isSwamp(object, context.state)
      case 'Forest': return isForest(object, context.state)
      default: return false
    }
  })) return false
  if (filter.supertypes && !filter.supertypes.every((supertype) => object.supertypes.includes(supertype))) return false
  if (mismatchesController(object, filter, context)) return false
  if (mismatchesOwner(object, filter, context)) return false
  if (filter.token !== undefined && object.token !== filter.token) return false
  if (filter.name !== undefined && object.name !== filter.name) return false
  if (filter.powerAtLeast !== undefined && (typeof object.power !== 'number' || object.power < filter.powerAtLeast)) return false
  if (filter.tapped !== undefined && object.tapped !== filter.tapped) return false
  if (filter.attacking !== undefined && Boolean(object.attacking) !== filter.attacking) return false
  return true
}

export const evaluateObjectSelector = (
  selector: ObjectSelector,
  context: RuleDslRuntimeContext,
) => Object.values(context.state.objects).filter((object) =>
  !object.phasedOut && matchesObjectFilter(object, selector.filter, context))

// Recursive filter composition requires an explicit return type.
const matchesStackItemFilter = (
  item: StackItem,
  filter: StackItemFilter,
  context: RuleDslRuntimeContext,
): boolean => {
  if (filter.all && !filter.all.every((part) => matchesStackItemFilter(item, part, context))) return false
  if (filter.any && !filter.any.some((part) => matchesStackItemFilter(item, part, context))) return false
  if (filter.not && matchesStackItemFilter(item, filter.not, context)) return false
  if (filter.kind && item.kind !== filter.kind) return false
  if (filter.type) {
    const source = context.state.objects[item.objectId]
    if (!source?.types.includes(filter.type)) return false
  }
  if (filter.color && !context.state.objects[item.objectId]?.colors.includes(filter.color)) return false
  if (filter.other && item.id === context.stackItemId) return false
  if (mismatchesController(item, filter, context)) return false
  return true
}

export const evaluateStackItemSelector = (
  selector: StackItemSelector,
  context: RuleDslRuntimeContext,
) => context.state.stack.filter((item) =>
  item.kind !== 'action' && matchesStackItemFilter(item, selector.filter, context))

export function evaluateSelector(selector: PlayerSelector, context: RuleDslRuntimeContext): PlayerId[]
export function evaluateSelector(selector: ObjectSelector, context: RuleDslRuntimeContext): GameObject[]
export function evaluateSelector(selector: StackItemSelector, context: RuleDslRuntimeContext): StackItem[]
export function evaluateSelector(selector: Extract<Selector, { kind: 'anyTarget' }>, context: RuleDslRuntimeContext): (PlayerId | GameObject)[]
export function evaluateSelector(selector: Selector, context: RuleDslRuntimeContext) {
  switch (selector.kind) {
    case 'anyTarget': return [...evaluatePlayerSelector({ kind: 'players', filter: {} }, context), ...evaluateObjectSelector({ kind: 'objects', filter: { zone: 'battlefield', any: DAMAGEABLE_PERMANENT_TYPES.map(type => ({ type })) } }, context)]
    case 'players': return evaluatePlayerSelector(selector, context)
    case 'objects': return evaluateObjectSelector(selector, context)
    case 'stackItems': return evaluateStackItemSelector(selector, context)
  }
}

const oneReferenceValue = (
  reference: Reference,
  context: RuleDslRuntimeContext,
  characteristic: NumericCharacteristic,
  information: 'current' | 'currentOrLastKnown',
) => {
  if (characteristic === 'life') {
    const players = reference.kind === 'resultRef'
      ? []
      : evaluatePlayerReference(reference, context)
    if (players.length !== 1) throw new RuleDslEvaluationError('life reference must resolve to exactly one player')
    return context.state.players[players[0]].life
  }
  if (reference.kind === 'resultRef') {
    throw new RuleDslEvaluationError(`${characteristic} cannot read an instruction result`)
  }
  const objects = evaluateObjectReference(reference, context, information)
  if (objects.length !== 1) {
    throw new RuleDslEvaluationError(`${characteristic} reference must resolve to exactly one object`)
  }
  const value = objects[0][characteristic]
  if (typeof value !== 'number') throw new RuleDslEvaluationError(`${characteristic} is not numeric on the referenced object`)
  return value
}

export const amountEvaluationContext = (
  context: RuleDslRuntimeContext,
) => ({
  result: (reference) => {
    const value = context.results?.[reference.binding]
    return typeof value === 'number' ? value : undefined
  },
  variables: context.variables,
  eventAmount: context.occurrence?.amount,
  count: (selector) => {
    switch (selector.kind) {
      case 'anyTarget': return evaluateSelector(selector, context).length
      case 'players': return evaluatePlayerSelector(selector, context).length
      case 'objects': return evaluateObjectSelector(selector, context).length
      case 'stackItems': return evaluateStackItemSelector(selector, context).length
    }
  },
  characteristic: (reference, characteristic, information) =>
    oneReferenceValue(reference, context, characteristic, information),
} satisfies AmountEvaluationContext)

export const evaluateRuntimeAmount = (
  expression: Amount,
  context: RuleDslRuntimeContext,
) => evaluateAmount(expression, amountEvaluationContext(context))

export const evaluateRuntimeStatDelta = (
  expression: StatDelta,
  context: RuleDslRuntimeContext,
) => evaluateStatDelta(expression, amountEvaluationContext(context))

export const evaluateCondition = (
  condition: Condition,
  context: RuleDslRuntimeContext,
): boolean => {
  switch (condition.kind) {
    case 'resultIsTrue': {
      if (condition.value.kind !== 'resultRef') {
        throw new RuleDslEvaluationError('resultIsTrue requires a result reference')
      }
      return context.results?.[condition.value.binding] === true
    }
    case 'compareAmount': {
      const left = evaluateRuntimeAmount(condition.left, context)
      const right = evaluateRuntimeAmount(condition.right, context)
      switch (condition.operator) {
        case 'eq': return left === right
        case 'gte': return left >= right
        case 'lte': return left <= right
      }
    }
    case 'choiceIs': return context.optionChoices?.[condition.binding] === condition.option
    case 'all': return condition.conditions.every((part) => evaluateCondition(part, context))
    case 'any': return condition.conditions.some((part) => evaluateCondition(part, context))
    case 'not': return !evaluateCondition(condition.condition, context)
  }
}

export const objectMatchesSelector = (
  object: GameObject,
  selector: ObjectSelector,
  context: RuleDslRuntimeContext,
) => !object.phasedOut && matchesObjectFilter(object, selector.filter, context)
