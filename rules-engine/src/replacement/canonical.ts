import {
  evaluateCondition,
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluatePlayerReference,
  evaluatePlayerSelector,
  type RuleDslRuntimeContext,
} from '../cardPlugins/dsl/compiler/runtime'
import {
  printedStaticAbilityActive,
  printedStaticEffectKey,
  prospectiveBattlefieldStaticReplacements,
} from '../cardPlugins/dsl/staticModifierCore'
import type { ReplacementEffectDefinition } from '../cardPlugins/dsl/schema/v1'
import { captureObject } from '../objectIdentity'
import { damageMatchesPreventionFilter } from './prevention'
import { isProtectedFirstDrawInOwnDrawStep } from '../rules/drawStepHistory'
import type { GameEvent, GameState } from '../types'
import type { ReplacementCategory } from './types'

export type CanonicalReplacementCandidate = {
  kind: 'canonical'
  category: ReplacementCategory
  instanceId: string
  sourceId: string
  sourceName: string
  abilityIndex: number
  effectIndex: number
  effect: ReplacementEffectDefinition
  label: string
  optional: boolean
  chooser: string
  rulesTimestamp: number
}

const damageMatchesFilter = (
  event: Extract<GameEvent, { type: 'dealDamage' }>,
  filter: NonNullable<Extract<ReplacementEffectDefinition['event'], { kind: 'damage' }>['filter']>,
  runtime: RuleDslRuntimeContext,
) => damageMatchesPreventionFilter(
  runtime.state,
  event,
  filter,
  runtime.source.ref.objectId,
  runtime.controller,
)

const runtimeFor = (state: GameState, sourceId: string, controller: string): RuleDslRuntimeContext => {
  const source = state.objects[sourceId]
  if (!source) throw new Error('replacement source is missing')
  return { state, controller, source: captureObject(source) }
}

const drawRuntime = (state: GameState, sourceId: string, controller: string, event: Extract<GameEvent, { type: 'draw' }>) => {
  const runtime = runtimeFor(state, sourceId, controller)
  return {
    ...runtime,
    occurrence: { kind: 'event' as const, eventType: 'draw', player: event.seat },
  }
}

const eventMatchesPattern = (
  event: GameEvent,
  effect: ReplacementEffectDefinition,
  runtime: RuleDslRuntimeContext,
  state: GameState,
  sourceId: string,
  controller: string,
) => {
  switch (effect.event.kind) {
    case 'draw': {
      if (event.type !== 'draw') return false
      const filter = effect.event.filter
      const drawContext = drawRuntime(state, sourceId, controller, event)
      if (filter.firstDrawInOwnDrawStep === false
        && isProtectedFirstDrawInOwnDrawStep(state, event.seat)) return false
      if (filter.firstDrawInOwnDrawStep === true
        && !isProtectedFirstDrawInOwnDrawStep(state, event.seat)) return false
      if (filter.player) {
        if (typeof filter.player === 'object' && 'kind' in filter.player && filter.player.kind === 'players') {
          const seats = evaluatePlayerSelector(filter.player, drawContext)
          if (!seats.includes(event.seat)) return false
        } else {
          const seats = evaluatePlayerReference(filter.player, drawContext)
          if (!seats.includes(event.seat)) return false
        }
      }
      return true
    }
    case 'gainLife': {
      if (event.type !== 'gainLife') return false
      const player = effect.event.filter.player
      const seats = player.kind === 'players' ? evaluatePlayerSelector(player, runtime) : evaluatePlayerReference(player, runtime)
      return seats.includes(event.seat)
    }
    case 'enterBattlefield': {
      if (event.type !== 'move' || event.to !== 'battlefield') return false
      const object = runtime.state.objects[event.objectId]
      if (!object) return false
      const filter = effect.event.filter.object
      if (typeof filter === 'object' && 'kind' in filter) {
        if (filter.kind === 'contextRef' && filter.name === 'source') {
          return event.objectId === runtime.source.ref.objectId
        }
        return evaluateObjectReference(filter, runtime).some((candidate) => candidate.id === object.id)
      }
      const matches = evaluateObjectSelector({ kind: 'objects', filter }, runtime)
      return matches.some((candidate) => candidate.id === object.id)
    }
    case 'damage': {
      if (event.type !== 'dealDamage') return false
      const filter = effect.event.filter
      if (!filter) return true
      return damageMatchesFilter(event, filter, runtime)
    }
    case 'move': {
      if (event.type !== 'move') return false
      if (effect.event.filter.to && event.to !== effect.event.filter.to) return false
      const object = runtime.state.objects[event.objectId]
      if (!object) return false
      if (effect.event.filter.object) {
        const filter = effect.event.filter.object
        if (typeof filter === 'object' && 'kind' in filter) {
          return evaluateObjectReference(filter, runtime)
            .some((candidate) => candidate.id === object.id)
        }
        const matches = evaluateObjectSelector({ kind: 'objects', filter }, runtime)
        return matches.some((candidate) => candidate.id === object.id)
      }
      return true
    }
    default:
      return false
  }
}

const categoryFor = (effect: ReplacementEffectDefinition, event: GameEvent, sourceId: string): ReplacementCategory => {
  if (effect.event.kind === 'enterBattlefield' && event.type === 'move' && event.objectId === sourceId) return 'self'
  if (effect.event.kind === 'enterBattlefield') return 'entryControl'
  return 'general'
}

const chooserFor = (state: GameState, event: GameEvent, controller: string) => {
  switch (event.type) {
    case 'draw':
    case 'gainLife':
      return event.seat
    case 'dealDamage':
      if (event.target.kind === 'player') return event.target.player
      if (event.target.kind === 'object') {
        return state.objects[event.target.objectId]?.controller ?? controller
      }
      return controller
    case 'move':
      return event.controller
        ?? state.objects[event.objectId]?.controller
        ?? state.objects[event.objectId]?.owner
        ?? controller
    case 'destroy':
    case 'sacrifice': {
      const object = state.objects[event.objectId]
      return object?.controller ?? object?.owner ?? controller
    }
    default:
      return controller
  }
}

const pushCandidate = (
  candidates: CanonicalReplacementCandidate[],
  seen: Set<string>,
  candidate: CanonicalReplacementCandidate,
) => {
  if (seen.has(candidate.instanceId)) return
  seen.add(candidate.instanceId)
  candidates.push(candidate)
}

const discoverProspectiveSelfEntry = (
  state: GameState,
  event: GameEvent,
  usedInstanceIds: readonly string[],
  settledOptionalDeclines: readonly string[],
  seen: Set<string>,
  candidates: CanonicalReplacementCandidate[],
) => {
  if (event.type !== 'move' || event.to !== 'battlefield') return
  const host = state.objects[event.objectId]
  if (!host) return
  if (host.subtypes.includes('Aura') && !event.attachTo && !event.attachPlayer) {
    host.ruleDefinition?.definition.abilities.forEach((ability, abilityIndex) => {
      if (ability.kind !== 'static') return
      ability.effects.forEach((effect, effectIndex) => {
        if (effect.kind !== 'enchant') return
        const instanceId = `${printedStaticEffectKey(host.id, abilityIndex, effectIndex)}:attachment`
        if (usedInstanceIds.includes(instanceId)) return
        const choice = effect.filter.kind === 'players'
          ? { kind: 'choosePlayer' as const, chooser: { kind: 'contextRef' as const, name: 'controller' as const }, filter: { kind: 'players' as const, filter: { all: [effect.filter.filter, { enchantableBy: { kind: 'contextRef' as const, name: 'source' as const } }] } }, bindChoice: 'attachment' }
          : { kind: 'chooseCards' as const, chooser: { kind: 'contextRef' as const, name: 'controller' as const }, filter: { kind: 'objects' as const, filter: { all: [effect.filter.filter, { enchantableBy: { kind: 'contextRef' as const, name: 'source' as const } }] } }, min: { kind: 'constant' as const, value: 1 }, max: { kind: 'constant' as const, value: 1 }, bindChoice: 'attachment', distinct: true as const, whenInsufficient: 'chooseAvailable' as const }
        pushCandidate(candidates, seen, {
          kind: 'canonical', category: 'self', instanceId, sourceId: host.id, sourceName: host.name, abilityIndex, effectIndex,
          effect: { kind: 'replacement', event: { kind: 'enterBattlefield', filter: { object: { kind: 'contextRef', name: 'source' } } }, transform: { kind: 'modifyEvent', changes: {} }, program: [choice, { kind: 'modifyEvent', changes: { attachTo: { kind: 'choiceRef', binding: 'attachment' } } }] },
          label: host.name, optional: false, chooser: event.controller ?? host.controller, rulesTimestamp: host.staticRulesTimestamp ?? 0,
        })
      })
    })
  }
  const prospectiveController = event.controller ?? host.controller
  const runtime = runtimeFor(state, host.id, prospectiveController)
  for (const entry of prospectiveBattlefieldStaticReplacements(host)) {
    const instanceId = printedStaticEffectKey(host.id, entry.abilityIndex, entry.effectIndex)
    if (usedInstanceIds.includes(instanceId) || settledOptionalDeclines.includes(instanceId)) continue
    if (entry.effect.when && !evaluateCondition(entry.effect.when, runtime)) continue
    if (!eventMatchesPattern(event, entry.effect, runtime, state, host.id, prospectiveController)) continue
    if (categoryFor(entry.effect, event, host.id) !== 'self') continue
    pushCandidate(candidates, seen, {
      kind: 'canonical',
      category: 'self',
      instanceId,
      sourceId: host.id,
      sourceName: host.name,
      abilityIndex: entry.abilityIndex,
      effectIndex: entry.effectIndex,
      effect: entry.effect,
      label: host.name,
      optional: entry.effect.optional ?? false,
      chooser: chooserFor(state, event, prospectiveController),
      rulesTimestamp: host.staticRulesTimestamp ?? 0,
    })
  }
}

export const discoverCanonicalModifiers = (
  state: GameState,
  event: GameEvent,
  usedInstanceIds: readonly string[],
  settledOptionalDeclines: readonly string[],
): CanonicalReplacementCandidate[] => {
  const candidates: CanonicalReplacementCandidate[] = []
  const seen = new Set<string>()
  for (const source of Object.values(state.objects)) {
    // A resolved departure replacement survives ability loss, but belongs only
    // to this battlefield incarnation. An exile-and-return effect is unchanged.
    for (const entry of source.continuousEffects ?? []) {
      const effect = entry.effect
      if (effect.kind !== 'redirectDeparture' || source.zone !== 'battlefield' || source.phasedOut
        || source.incarnation !== effect.incarnation || event.type !== 'move'
        || event.objectId !== source.id || event.to === 'battlefield' || event.to === effect.to) continue
      const instanceId = `departure:${source.id}:${effect.incarnation}:${effect.timestamp}`
      if (usedInstanceIds.includes(instanceId) || settledOptionalDeclines.includes(instanceId)) continue
      pushCandidate(candidates, seen, {
        kind: 'canonical', category: 'general', instanceId, sourceId: source.id, sourceName: source.name,
        abilityIndex: -1, effectIndex: effect.timestamp,
        effect: { kind: 'replacement', event: { kind: 'move', filter: { object: { kind: 'contextRef', name: 'source' } } }, transform: { kind: 'redirect', to: effect.to } },
        label: source.name, optional: false, chooser: source.controller, rulesTimestamp: effect.timestamp,
      })
    }
    for (const modifier of source.printedStaticModifiers ?? []) {
      if (modifier.kind !== 'replacement') continue
      if (!printedStaticAbilityActive(state, source, modifier.abilityIndex)) continue
      const instanceId = printedStaticEffectKey(source.id, modifier.abilityIndex, modifier.effectIndex)
      if (usedInstanceIds.includes(instanceId)) continue
      if (settledOptionalDeclines.includes(instanceId)) continue
      const runtime = runtimeFor(state, source.id, source.controller)
      const effect = modifier.effect
      if (effect.when && !evaluateCondition(effect.when, runtime)) continue
      if (!eventMatchesPattern(event, effect, runtime, state, source.id, source.controller)) continue
      pushCandidate(candidates, seen, {
        kind: 'canonical',
        category: categoryFor(effect, event, source.id),
        instanceId,
        sourceId: source.id,
        sourceName: source.name,
        abilityIndex: modifier.abilityIndex,
        effectIndex: modifier.effectIndex,
        effect,
        label: source.name,
        optional: effect.optional ?? false,
        chooser: chooserFor(state, event, source.controller),
        rulesTimestamp: modifier.timestamp,
      })
    }
  }
  discoverProspectiveSelfEntry(state, event, usedInstanceIds, settledOptionalDeclines, seen, candidates)
  return candidates.sort((left, right) => left.rulesTimestamp - right.rulesTimestamp)
}
