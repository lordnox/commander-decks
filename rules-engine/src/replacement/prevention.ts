import { compileCardRuleDefinition } from '../cardPlugins/dsl/compiler'
import {
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  type RuleDslRuntimeContext,
} from '../cardPlugins/dsl/compiler/runtime'
import type {
  EffectDuration as DslEffectDuration,
  Instruction,
  PlayerRecipient,
  PlayerReference,
  PreventionEffectDefinition,
  PreventionFilter,
} from '../cardPlugins/dsl/schema/v1'
import { captureObject } from '../objectIdentity'
import type {
  EffectDuration,
  GameEvent,
  GameObject,
  GameState,
  PlayerId,
  PreventionInstance,
  StepId,
  TargetRef,
} from '../types'
import { printedStaticAbilityActive, printedStaticEffectKey } from '../cardPlugins/dsl/staticModifierCore'
import type { ReplacementCategory } from './types'

export type PreventionCandidate = {
  kind: 'prevention'
  category: ReplacementCategory
  instanceId: string
  preventionId: string
  label: string
  optional: false
  chooser: string
}

const runtimeFor = (state: GameState, sourceId: string, controller: string): RuleDslRuntimeContext => {
  const source = state.objects[sourceId]
  if (!source) throw new Error('prevention source is missing')
  return { state, controller, source: captureObject(source) }
}

const staticPreventionAbilityIndex = (instance: PreventionInstance) => {
  if (!instance.staticKey) return undefined
  const prefix = `${instance.hostSourceId}:`
  if (!instance.staticKey.startsWith(prefix)) return undefined
  const remainder = instance.staticKey.slice(prefix.length)
  const separator = remainder.indexOf(':')
  if (separator < 0) return undefined
  const abilityIndex = Number(remainder.slice(0, separator))
  return Number.isInteger(abilityIndex) && abilityIndex >= 0 ? abilityIndex : undefined
}

const staticPreventionActive = (state: GameState, instance: PreventionInstance) => {
  if (!instance.staticKey) return true
  const host = state.objects[instance.hostSourceId]
  const abilityIndex = staticPreventionAbilityIndex(instance)
  return Boolean(
    host
    && abilityIndex !== undefined
    && printedStaticAbilityActive(state, host, abilityIndex),
  )
}

const matchesPlayerRecipient = (
  filter: PreventionFilter,
  runtime: RuleDslRuntimeContext,
  target: Extract<TargetRef, { kind: 'player' }>,
) => {
  const recipient = filter.recipient
  if (!recipient) return true
  if (typeof recipient === 'object' && 'kind' in recipient) {
    if (recipient.kind === 'players') {
      return evaluatePlayerSelector(recipient, runtime).includes(target.player)
    }
    if (recipient.kind === 'objects') return false
    return evaluatePlayerReference(recipient, runtime).includes(target.player)
  }
  return false
}

const matchesObjectRecipient = (
  filter: PreventionFilter,
  runtime: RuleDslRuntimeContext,
  target: Extract<TargetRef, { kind: 'object' }>,
) => {
  const recipient = filter.recipient
  if (!recipient) return true
  if (typeof recipient === 'object' && 'kind' in recipient) {
    if (recipient.kind === 'objects') {
      return evaluateObjectSelector(recipient, runtime)
        .some((object) => object.id === target.objectId)
    }
    if (recipient.kind === 'players') return false
    return evaluateObjectReference(recipient, runtime)
      .some((object) => object.id === target.objectId)
  }
  return false
}

export const damageMatchesPreventionFilter = (
  state: GameState,
  event: Extract<GameEvent, { type: 'dealDamage' }>,
  filter: PreventionFilter,
  hostSourceId: string,
  controller: PlayerId,
) => {
  const runtime = runtimeFor(state, hostSourceId, controller)
  if (event.target.kind === 'player') {
    if (!matchesPlayerRecipient(filter, runtime, event.target)) return false
  } else if (event.target.kind === 'object') {
    if (!matchesObjectRecipient(filter, runtime, event.target)) return false
  } else return false

  if (filter.source) {
    const source = state.objects[event.sourceId]
    if (!source) return false
    const sourceFilter = filter.source
    if (typeof sourceFilter === 'object' && 'kind' in sourceFilter) {
      if (sourceFilter.kind === 'objects') {
        return evaluateObjectSelector(sourceFilter, runtime).some((object) => object.id === source.id)
      }
      return evaluateObjectReference(sourceFilter, runtime).some((object) => object.id === source.id)
    }
  }
  return true
}

const untilStepHolds = (
  state: GameState,
  step: StepId,
  turn: number,
  notBeforeTurn?: number,
  active?: PlayerId,
) => {
  if (notBeforeTurn !== undefined) {
    if (state.turn < notBeforeTurn) return true
    return !(state.step === step && (active === undefined || active === state.active))
  }
  if (state.turn < turn) return true
  if (state.turn > turn) return false
  return !(state.step === step && (active === undefined || active === state.active))
}

const preventionDurationFromDsl = (
  duration: DslEffectDuration,
  state: GameState,
  host: GameObject,
  event: Extract<GameEvent, { type: 'registerPrevention' }>,
): EffectDuration => {
  const createdTurn = event.createdTurn ?? state.turn
  switch (duration.kind) {
    case 'untilCleanup':
      return { kind: 'untilCleanup' }
    case 'permanent':
      return { kind: 'permanent' }
    case 'untilStep': {
      const active = duration.active
        ? evaluatePlayerReference(duration.active, runtimeFor(state, host.id, host.controller))[0]
        : event.durationUntilStepActive
      return {
        kind: 'untilStep',
        step: duration.step as StepId,
        turn: event.durationUntilStepTurn ?? createdTurn,
        ...(event.durationUntilStepNotBeforeTurn !== undefined
          ? { notBeforeTurn: event.durationUntilStepNotBeforeTurn }
          : {}),
        ...(active ? { active } : {}),
      }
    }
    case 'forTurns': {
      const untilTurn = event.durationUntilTurn
        ?? createdTurn + evaluateRuntimeAmount(duration.count, runtimeFor(state, host.id, host.controller))
      return { kind: 'forTurns', untilTurn }
    }
    case 'whileSourceOnBattlefield':
      return { kind: 'whileSourceOnBattlefield', sourceId: host.id, sourceIncarnation: host.incarnation }
  }
}

export const preventionInstanceHolds = (
  state: GameState,
  instance: PreventionInstance,
  endTurnEffects: boolean,
) => {
  const host = state.objects[instance.hostSourceId]
  switch (instance.duration.kind) {
    case 'untilCleanup':
      return !endTurnEffects
    case 'permanent':
      return true
    case 'forTurns':
      return state.turn < (instance.untilTurn ?? instance.duration.untilTurn)
    case 'whileSourceOnBattlefield':
      return Boolean(
        host
        && host.zone === 'battlefield'
        && host.incarnation === instance.duration.sourceIncarnation,
      )
    case 'untilStep':
      return untilStepHolds(
        state,
        instance.duration.step,
        instance.untilStepTurn ?? instance.duration.turn,
        instance.untilStepNotBeforeTurn ?? instance.duration.notBeforeTurn,
        instance.untilStepActive ?? instance.duration.active,
      )
    default:
      return true
  }
}

export const expirePreventionInstances = (state: GameState, endTurnEffects: boolean) => {
  const instances = state.preventionInstances ?? []
  const remaining = instances.filter((instance) => preventionInstanceHolds(state, instance, endTurnEffects))
  if (remaining.length === instances.length) return state
  return { ...state, preventionInstances: remaining.length > 0 ? remaining : undefined }
}

const registerInstance = (
  state: GameState,
  input: Omit<PreventionInstance, 'id'>,
): GameState => {
  if (input.staticKey) {
    const existing = (state.preventionInstances ?? []).find((instance) => instance.staticKey === input.staticKey)
    if (existing) return state
  }
  const id = `prevention-${state.nextId}`
  const instance: PreventionInstance = { ...input, id }
  return {
    ...state,
    nextId: state.nextId + 1,
    preventionInstances: [...(state.preventionInstances ?? []), instance],
  }
}

export const applyRegisterPrevention = (state: GameState, event: Extract<GameEvent, { type: 'registerPrevention' }>) => {
  const host = state.objects[event.hostObjectId]
  if (!host) return state
  const createdTurn = event.createdTurn ?? state.turn
  const duration = preventionDurationFromDsl(event.duration, state, host, event)
  return registerInstance(state, {
    remaining: event.capacity,
    capacity: event.capacity,
    duration,
    hostSourceId: host.id,
    hostSourceIncarnation: host.incarnation,
    controller: host.controller,
    filter: structuredClone(event.filter),
    ...(event.staticKey ? { staticKey: event.staticKey } : {}),
    ...(event.additionalEffects ? { additionalEffects: structuredClone(event.additionalEffects) } : {}),
    createdTurn,
    ...(event.durationUntilTurn !== undefined ? { untilTurn: event.durationUntilTurn } : {}),
    ...(event.durationUntilStepTurn !== undefined ? { untilStepTurn: event.durationUntilStepTurn } : {}),
    ...(event.durationUntilStepNotBeforeTurn !== undefined
      ? { untilStepNotBeforeTurn: event.durationUntilStepNotBeforeTurn } : {}),
    ...(event.durationUntilStepActive !== undefined ? { untilStepActive: event.durationUntilStepActive } : {}),
  })
}

const staticPreventionFromPrintedModifiers = (state: GameState, sourceId: string): GameState => {
  const source = state.objects[sourceId]
  if (!source?.controller || source.zone !== 'battlefield' || source.phasedOut) return state
  let next = state
  for (const modifier of source.printedStaticModifiers ?? []) {
    if (modifier.kind !== 'prevention') continue
    if (!printedStaticAbilityActive(state, source, modifier.abilityIndex)) continue
    const key = printedStaticEffectKey(sourceId, modifier.abilityIndex, modifier.effectIndex)
    const effect = modifier.effect
    const capacity = evaluateRuntimeAmount(effect.capacity, runtimeFor(state, sourceId, source.controller))
    if (capacity <= 0) continue
    next = registerInstance(next, {
      remaining: capacity,
      capacity,
      duration: { kind: 'whileSourceOnBattlefield', sourceId, sourceIncarnation: source.incarnation },
      hostSourceId: sourceId,
      hostSourceIncarnation: source.incarnation,
      controller: source.controller,
      filter: structuredClone(effect.filter),
      staticKey: key,
      ...(effect.additionalEffects ? { additionalEffects: structuredClone(effect.additionalEffects) } : {}),
      createdTurn: state.turn,
    })
  }
  return next
}

export const syncStaticPreventionInstances = (state: GameState): GameState => {
  let next: GameState = { ...state, preventionInstances: state.preventionInstances ? [...state.preventionInstances] : undefined }
  for (const object of Object.values(state.objects)) {
    if (!object.ruleDefinition || object.zone !== 'battlefield' || object.phasedOut) continue
    next = staticPreventionFromPrintedModifiers(next, object.id)
  }
  const staticKeys = new Set(
    (next.preventionInstances ?? [])
      .filter((instance) => instance.staticKey)
      .map((instance) => instance.staticKey!),
  )
  for (const object of Object.values(state.objects)) {
    if (!object.ruleDefinition || object.zone !== 'battlefield') continue
    const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
    compiled.definition.abilities.forEach((ability, abilityIndex) => {
      if (ability.kind !== 'static') return
      ability.effects.forEach((effect, effectIndex) => {
        if (effect.kind === 'prevention') {
          staticKeys.add(printedStaticEffectKey(object.id, abilityIndex, effectIndex))
        }
      })
    })
  }
  const filtered = (next.preventionInstances ?? []).filter((instance) => {
    if (!instance.staticKey) {
      return preventionInstanceHolds(next, instance, false)
    }
    const host = next.objects[instance.hostSourceId]
    if (!host || host.zone !== 'battlefield' || host.incarnation !== instance.hostSourceIncarnation) {
      return false
    }
    return staticKeys.has(instance.staticKey)
  })
  return filtered.length > 0 ? { ...next, preventionInstances: filtered } : { ...next, preventionInstances: undefined }
}

export const discoverPreventionCandidates = (
  state: GameState,
  event: GameEvent,
  usedInstanceIds: readonly string[],
): PreventionCandidate[] => {
  if (event.type !== 'dealDamage') return []
  const candidates: PreventionCandidate[] = []
  for (const instance of state.preventionInstances ?? []) {
    if (instance.remaining <= 0) continue
    if (usedInstanceIds.includes(instance.id)) continue
    if (!preventionInstanceHolds(state, instance, false)) continue
    const host = state.objects[instance.hostSourceId]
    if (!host || host.phasedOut) continue
    if (!staticPreventionActive(state, instance)) continue
    if (!damageMatchesPreventionFilter(state, event, instance.filter, instance.hostSourceId, instance.controller)) {
      continue
    }
    candidates.push({
      kind: 'prevention',
      category: 'general',
      instanceId: instance.id,
      preventionId: instance.id,
      label: host?.name ?? 'Prevention',
      optional: false,
      chooser: event.target.kind === 'player'
        ? event.target.player
        : event.target.kind === 'object'
          ? state.objects[event.target.objectId]?.controller ?? instance.controller
          : instance.controller,
    })
  }
  return candidates
}

export const consumePrevention = (
  state: GameState,
  preventionId: string,
  amount: number,
) => {
  const instances = state.preventionInstances ?? []
  const index = instances.findIndex((instance) => instance.id === preventionId)
  if (index < 0) return state
  const instance = instances[index]!
  const prevented = Math.min(instance.remaining, amount)
  const remaining = Math.max(0, instance.remaining - prevented)
  const nextInstances = [...instances]
  nextInstances[index] = { ...instance, remaining }
  return {
    ...state,
    preventionInstances: nextInstances,
  }
}

export const applyPreventionToDamage = (
  state: GameState,
  event: Extract<GameEvent, { type: 'dealDamage' }>,
  preventionId: string,
): { state: GameState; event: Extract<GameEvent, { type: 'dealDamage' }>; preventedAmount: number } => {
  const instance = (state.preventionInstances ?? []).find((entry) => entry.id === preventionId)
  if (!instance) return { state, event, preventedAmount: 0 }
  if (event.unpreventable) {
    return { state, event, preventedAmount: 0 }
  }
  const preventedAmount = Math.min(instance.remaining, event.amount)
  const nextEvent = { ...event, amount: event.amount - preventedAmount }
  const nextState = preventedAmount > 0 ? consumePrevention(state, preventionId, preventedAmount) : state
  return { state: nextState, event: nextEvent, preventedAmount }
}

export const preventionAdditionalEffects = (
  state: GameState,
  preventionId: string,
): PreventionEffectDefinition['additionalEffects'] | undefined =>
  (state.preventionInstances ?? []).find((instance) => instance.id === preventionId)?.additionalEffects

export const isImmediatePreventionAdditional = (instruction: Instruction) => {
  return instruction.kind === 'gainLife' || instruction.kind === 'loseLife' || instruction.kind === 'draw'
}

const seatsFor = (
  targets: PlayerRecipient,
  runtime: RuleDslRuntimeContext,
) => {
  if (typeof targets === 'object' && targets && 'kind' in targets && targets.kind === 'players') {
    return evaluatePlayerSelector(targets, runtime)
  }
  return evaluatePlayerReference(targets as PlayerReference, runtime)
}

/** Minimal CR 615.12 follow-ups for prevention side effects in tests and DSL shields. */
export const eventsFromPreventionAdditional = (
  state: GameState,
  hostSourceId: string,
  controller: PlayerId,
  instructions: readonly Instruction[],
): GameEvent[] => {
  const events: GameEvent[] = []
  const runtime = runtimeFor(state, hostSourceId, controller)
  const walk = (nodes: readonly Instruction[]) => {
    for (const instruction of nodes) {
      if (instruction.kind === 'sequence') {
        walk(instruction.instructions)
        continue
      }
      if (instruction.kind === 'gainLife' || instruction.kind === 'loseLife') {
        const amount = evaluateRuntimeAmount(instruction.amount, runtime)
        if (amount <= 0) continue
        for (const seat of seatsFor(instruction.targets, runtime)) {
          events.push({
            type: instruction.kind,
            seat,
            amount,
            source: hostSourceId,
          })
        }
        continue
      }
      if (instruction.kind === 'draw') {
        const count = evaluateRuntimeAmount(instruction.count, runtime)
        if (count <= 0) continue
        for (const seat of seatsFor(instruction.targets, runtime)) {
          events.push({ type: 'draw', seat, count })
        }
      }
    }
  }
  walk(instructions)
  return events
}
