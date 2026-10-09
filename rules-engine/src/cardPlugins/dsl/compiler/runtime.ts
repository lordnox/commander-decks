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
  AmountEvaluationContext,
  ChoiceReference,
  ContextReference,
  NumericCharacteristic,
  ObjectFilter,
  ObjectReference,
  ObjectSelector,
  PlayerFilter,
  PlayerReference,
  PlayerSelector,
  Reference,
  Selector,
  StackItemFilter,
  StackItemReference,
  StackItemSelector,
  TargetReference,
} from '../schema/v1'
import { evaluateAmount } from './evaluate'
import { RuleDslEvaluationError } from './errors'

export type BoundRecipient =
  | { kind: 'player'; playerId: PlayerId }
  | ({ kind: 'object' } & ObjectIdentity)
  | { kind: 'stackItem'; stackId: string }

export type RuntimeBindings = {
  targets?: Readonly<Record<number, readonly BoundRecipient[]>>
  choices?: Readonly<Record<string, readonly BoundRecipient[]>>
  variables?: Readonly<Partial<Record<'X', number>>>
}

export type RuleDslRuntimeContext = RuntimeBindings & {
  state: GameState
  controller: PlayerId
  source: CapturedObject
  occurrence?: OccurrenceSnapshot
  stackItemId?: string
}

const targetRecipients = (reference: TargetReference, context: RuleDslRuntimeContext) => {
  if (!context.targets || !Object.hasOwn(context.targets, reference.clauseIndex)) {
    throw new RuleDslEvaluationError(`target clause ${reference.clauseIndex} is not bound`)
  }
  return context.targets[reference.clauseIndex]!
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
    case 'triggering.player':
      if (!context.occurrence?.player) {
        throw new RuleDslEvaluationError(`${reference.name} was not captured by this occurrence`)
      }
      return [context.occurrence.player]
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
  switch (reference.name) {
    case 'triggering.object.before': return context.occurrence?.object?.before
    case 'triggering.object.after': return context.occurrence?.object?.after
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

// Recursive filter composition requires an explicit return type.
const matchesPlayerFilter = (
  player: PlayerId,
  filter: PlayerFilter,
  context: RuleDslRuntimeContext,
): boolean => {
  if (filter.all && !filter.all.every((part) => matchesPlayerFilter(player, part, context))) return false
  if (filter.any && !filter.any.some((part) => matchesPlayerFilter(player, part, context))) return false
  if (filter.not && matchesPlayerFilter(player, filter.not, context)) return false
  if (filter.relation === 'you' && player !== context.controller) return false
  if (
    filter.relation === 'opponent'
    && !context.state.opponents[context.controller].includes(player)
  ) return false
  return true
}

export const evaluatePlayerSelector = (
  selector: PlayerSelector,
  context: RuleDslRuntimeContext,
) => context.state.playerOrder.filter((player) =>
  !context.state.players[player].lost && matchesPlayerFilter(player, selector.filter, context))

const referencedPlayer = (
  value: 'you' | PlayerReference,
  context: RuleDslRuntimeContext,
) => {
  if (value === 'you') return context.controller
  const players = evaluatePlayerReference(value, context)
  if (players.length > 1) {
    throw new RuleDslEvaluationError('object filter player reference must resolve to at most one player')
  }
  return players[0]
}

// Recursive filter composition requires an explicit return type.
const matchesObjectFilter = (
  object: GameObject,
  filter: ObjectFilter,
  context: RuleDslRuntimeContext,
): boolean => {
  if (filter.all && !filter.all.every((part) => matchesObjectFilter(object, part, context))) return false
  if (filter.any && !filter.any.some((part) => matchesObjectFilter(object, part, context))) return false
  if (filter.not && matchesObjectFilter(object, filter.not, context)) return false
  if (filter.zone && object.zone !== filter.zone) return false
  if (filter.type && !object.types.includes(filter.type)) return false
  if (filter.subtypes && !filter.subtypes.every((subtype) => object.subtypes.includes(subtype))) return false
  if (filter.controller && object.controller !== referencedPlayer(filter.controller, context)) return false
  if (filter.owner && object.owner !== referencedPlayer(filter.owner, context)) return false
  if (filter.token !== undefined && object.token !== filter.token) return false
  if (filter.name !== undefined && object.name !== filter.name) return false
  return true
}

export const evaluateObjectSelector = (
  selector: ObjectSelector,
  context: RuleDslRuntimeContext,
) => Object.values(context.state.objects).filter((object) =>
  !object.phasedOut && matchesObjectFilter(object, selector.filter, context))

const stackController = (
  value: 'you' | PlayerReference,
  context: RuleDslRuntimeContext,
) => referencedPlayer(value, context)

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
  if (filter.other && item.id === context.stackItemId) return false
  if (filter.controller && item.controller !== stackController(filter.controller, context)) return false
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
export function evaluateSelector(selector: Selector, context: RuleDslRuntimeContext) {
  switch (selector.kind) {
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
  variables: context.variables,
  eventAmount: context.occurrence?.amount,
  count: (selector) => {
    switch (selector.kind) {
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
