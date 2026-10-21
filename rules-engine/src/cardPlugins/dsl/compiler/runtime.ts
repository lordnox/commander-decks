import { hasManaAbility } from '../manaPrograms'
import { DAMAGEABLE_PERMANENT_TYPES } from '../schema/v1'
import { hasKeyword } from '../../../keywords'
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
  InstructionResult,
  Amount,
  StatDelta,
  AmountEvaluationContext,
  ChoiceReference,
  Condition,
  ContextReference,
  LifeLostCombine,
  NumericCharacteristic,
  ObjectFilter,
  ObjectReference,
  ObjectSelector,
  PlayerFilter,
  PlayerMatch,
  PlayerRecipient,
  PlayerReference,
  PlayerSelector,
  Reference,
  Selector,
  StackItemFilter,
  StackItemReference,
  StackItemSelector,
  TargetReference,
} from '../schema/v1'
import { LIFE_LOST_COMBINE, PLAYER_RELATIONS } from '../schema/v1'
import { lifeLostThisTurn as recordedLifeLostThisTurn } from '../../../plugins/life'
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
  results?: Readonly<Record<string, InstructionResult>>
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
    case 'triggering.player': {
      const occurrence = context.capturedOccurrenceBindings?.includes('player')
        ? context.capturedOccurrence
        : context.occurrence
      if (!occurrence?.player) {
        throw new RuleDslEvaluationError(`${reference.name} was not captured by this occurrence`)
      }
      return [occurrence.player]
    }
    case 'triggering.object.controller': {
      const captured = capturedOccurrenceObject({ kind: 'contextRef', name: 'triggering.object.after' }, context)
      if (!captured) {
        throw new RuleDslEvaluationError(`${reference.name} was not captured by this occurrence`)
      }
      return [captured.controller]
    }
    default: throw new RuleDslEvaluationError(`${reference.name} is not a player reference`)
  }
}

export const evaluatePlayerReference = (
  reference: PlayerReference,
  context: RuleDslRuntimeContext,
) => {
  switch (reference.kind) {
    case 'resultRef': {
      const value = context.results?.[reference.binding]
      if (typeof value !== 'string' || !context.state.players[value]) throw new RuleDslEvaluationError(`player result ${reference.binding} is not bound`)
      return [value]
    }
    case 'relatedPlayer': {
      const referenced = reference.of
      if (referenced.kind !== 'contextRef') {
        const bound = recipients(referenced, context)
        if (bound.every(recipient => recipient.kind === 'stackItem')) {
          if (reference.relation !== 'controller') throw new RuleDslEvaluationError('stack items have a controller, not an owner')
          return unique(evaluateStackItemReference(referenced, context).map(item => item.controller))
        }
      }
      return unique(evaluateObjectReference(referenced, context).map(object => object[reference.relation]))
    }
    case 'contextRef': return playerContextReference(reference, context)
    case 'targetRef':
    case 'choiceRef':
      return unique(recipientsInDomain(reference, context, 'player', (recipient) => recipient.kind === 'player').map(recipient => recipient.playerId))
  }
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

const objectFromStackItem = (stackId: string, context: RuleDslRuntimeContext) => {
  const item = context.state.stack.find(candidate => candidate.id === stackId)
  return item ? context.state.objects[item.objectId] : undefined
}

const characteristicObjects = (
  reference: Reference,
  context: RuleDslRuntimeContext,
  information: 'current' | 'currentOrLastKnown',
) => {
  if (reference.kind === 'resultRef' || reference.kind === 'relatedPlayer') return []
  if (reference.kind === 'targetRef' || reference.kind === 'choiceRef') {
    const bound = recipients(reference, context)
    if (bound.every(recipient => recipient.kind === 'stackItem')) {
      return bound.flatMap(recipient => {
        const object = objectFromStackItem(recipient.stackId, context)
        return object ? [object] : []
      })
    }
  }
  return evaluateObjectReference(reference, context, information)
}

export const matchesPlayer = (
  player: PlayerId,
  match: PlayerMatch | undefined,
  context: RuleDslRuntimeContext,
  includeLost?: true,
) => {
  if (match === undefined) return false
  const seat = context.state.players[player]
  if (!seat || (!includeLost && seat.lost)) return false
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
export const mismatchesPlayer = (
  player: PlayerId,
  match: PlayerMatch | undefined,
  context: RuleDslRuntimeContext,
  includeLost?: true,
) => match !== undefined && !matchesPlayer(player, match, context, includeLost)

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
  includeLost?: true,
): boolean => {
  if (filter.all && !filter.all.every((part) => matchesPlayerFilter(player, part, context, includeLost))) return false
  if (filter.any && !filter.any.some((part) => matchesPlayerFilter(player, part, context, includeLost))) return false
  if (filter.not && matchesPlayerFilter(player, filter.not, context, includeLost)) return false
  if (mismatchesPlayer(player, filter.relation, context, includeLost)) return false
  return true
}

export const evaluatePlayerSelector = (
  selector: PlayerSelector,
  context: RuleDslRuntimeContext,
  includeLost?: true,
) => context.state.playerOrder.filter((player) =>
  (includeLost || !context.state.players[player].lost)
  && matchesPlayerFilter(player, selector.filter, context, includeLost))

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
  if (filter.commander !== undefined && object.tags.includes('commander') !== filter.commander) return false
  if (filter.manaAbility !== undefined && hasManaAbility(object) !== filter.manaAbility) return false
  if (filter.sameNameAs && !evaluateObjectReference(filter.sameNameAs, context, 'currentOrLastKnown').some(other => other.name === object.name)) return false
  if (filter.among && !evaluateObjectReference(filter.among, context).some(candidate => candidate.id === object.id)) return false
  if (filter.zone && object.zone !== filter.zone) return false
  if (filter.type && !object.types.includes(filter.type)) return false
  if (filter.subtypes && !filter.subtypes.every(subtype => {
    if (object.subtypes.includes(subtype)) return true
    if (hasKeyword(object, 'changeling')) return true
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
  fallback?: number,
) => {
  // A default allows reading an optional characteristic from a mixed-domain target.
  if (fallback !== undefined && (reference.kind === 'targetRef' || reference.kind === 'choiceRef')) {
    const bound = recipients(reference, context)
    if (bound.length !== 1) throw new RuleDslEvaluationError('characteristic reference must resolve to exactly one recipient')
    const recipient = bound[0]!
    if ((characteristic === 'life') !== (recipient.kind === 'player')) return fallback
  }
  if (fallback !== undefined && reference.kind === 'contextRef') {
    const playerReference = ['controller', 'event.player', 'triggering.player'].includes(reference.name)
    if ((characteristic === 'life') !== playerReference) return fallback
  }
  if (characteristic === 'life') {
    const players = reference.kind === 'resultRef'
      ? reference.field === 'player' ? evaluatePlayerReference({ ...reference, field: 'player' }, context) : []
      : evaluatePlayerReference(reference, context)
    if (players.length !== 1) throw new RuleDslEvaluationError('life reference must resolve to exactly one player')
    return context.state.players[players[0]].life
  }
  if (reference.kind === 'resultRef' || reference.kind === 'relatedPlayer') {
    throw new RuleDslEvaluationError(`${characteristic} cannot read an instruction result`)
  }
  const objects = characteristicObjects(reference, context, information)
  if (objects.length !== 1) {
    throw new RuleDslEvaluationError(`${characteristic} reference must resolve to exactly one object`)
  }
  const value = characteristic === 'loyalty'
    ? (objects[0].types.includes('Planeswalker') ? objects[0].counters.loyalty ?? 0 : undefined)
    : objects[0][characteristic]
  if (typeof value !== 'number' && fallback !== undefined) return fallback
  if (typeof value !== 'number') throw new RuleDslEvaluationError(`${characteristic} is not numeric on the referenced object`)
  return value
}

export const withOccurrencePlayer = (
  context: RuleDslRuntimeContext,
  player: PlayerId,
): RuleDslRuntimeContext => ({
  ...context,
  occurrence: {
    ...context.occurrence,
    kind: 'event',
    eventType: context.occurrence?.eventType ?? 'playerAction',
    player,
  },
})

export const amountEvaluationContext = (
  context: RuleDslRuntimeContext,
) => ({
  result: (reference) => {
    const value = context.results?.[reference.binding]
    return typeof value === 'number' ? value : undefined
  },
  variables: context.variables,
  eventAmount: context.occurrence?.amount,
  manaSpent: (color) => {
    const item = context.stackItemId
      ? context.state.stack.find((candidate) => candidate.id === context.stackItemId)
      : undefined
    return item?.manaSpent?.[color] ?? 0
  },
  count: (selector: Selector, distinctNames?: true) => {
    switch (selector.kind) {
      case 'anyTarget': return evaluateSelector(selector, context).length
      case 'players': return evaluatePlayerSelector(selector, context).length
      case 'objects': {
        const objects = evaluateObjectSelector(selector, context)
        return distinctNames ? new Set(objects.map(object => object.name)).size : objects.length
      }
      case 'stackItems': return evaluateStackItemSelector(selector, context).length
    }
  },
  greatest: (selector, characteristic, _information) => {
    const values = evaluateObjectSelector(selector, context).map(object => {
      if (characteristic === 'life') return 0
      if (characteristic === 'loyalty') {
        return object.types.includes('Planeswalker') ? object.counters.loyalty ?? 0 : 0
      }
      const value = object[characteristic]
      return typeof value === 'number' ? value : 0
    })
    return values.length === 0 ? 0 : Math.max(0, ...values)
  },
  characteristic: (reference, characteristic, information, fallback) =>
    oneReferenceValue(reference, context, characteristic, information, fallback),
  lifeLostThisTurn: (of, combine) => lifeLostThisTurnAmong(of, combine, context),
} satisfies AmountEvaluationContext)

const lifeLostThisTurnAmong = (
  of: PlayerRecipient,
  combine: LifeLostCombine | undefined,
  context: RuleDslRuntimeContext,
) => {
  const seats = of.kind === 'players'
    ? evaluatePlayerSelector(of, context, true)
    : evaluatePlayerReference(of, context)
  const amounts = seats.map((seat) => recordedLifeLostThisTurn(context.state.players[seat] ?? { data: {} }))
  if (amounts.length === 0) return 0
  if (combine === LIFE_LOST_COMBINE.greatest) return Math.max(0, ...amounts)
  return amounts.reduce((sum, value) => sum + value, 0)
}

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
    case 'somePlayerHasMore': {
      const reference = evaluatePlayerReference(condition.than, context)
      if (reference.length !== 1) throw new RuleDslEvaluationError('player comparison requires exactly one reference player')
      const metric = (player: PlayerId) => {
        switch (condition.metric) {
          case 'life': return context.state.players[player].life
          case 'hand': return context.state.zoneOrder[player].hand.length
          case 'lands':
          case 'creatures': return evaluateObjectSelector({ kind: 'objects', filter: { zone: 'battlefield', controller: { kind: 'contextRef', name: 'event.player' }, type: condition.metric === 'lands' ? 'Land' : 'Creature' } }, withOccurrencePlayer(context, player)).length
        }
      }
      const baseline = metric(reference[0]!)
      return evaluatePlayerSelector(condition.players, context).some(player => metric(player) > baseline)
    }

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
    case 'activePlayer': {
      const seats = evaluatePlayerReference(condition.of, context)
      if (seats.length !== 1) throw new RuleDslEvaluationError('activePlayer requires exactly one player')
      return context.state.active === seats[0]
    }
    case 'currentStep': {
      const steps = Array.isArray(condition.step) ? condition.step : [condition.step]
      return steps.includes(context.state.step)
    }
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
