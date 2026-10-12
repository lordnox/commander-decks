import { compileCardRuleDefinition } from '../cardPlugins/dsl/compiler'
import {
  evaluateCondition,
  evaluateObjectReference,
  evaluateObjectSelector,
  evaluatePlayerSelector,
  type RuleDslRuntimeContext,
} from '../cardPlugins/dsl/compiler/runtime'
import { captureObject } from '../objectIdentity'
import type { CardRuleDefinitionV1, ReplacementEffectDefinition } from '../cardPlugins/dsl/schema/v1'
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
}

const runtimeFor = (state: GameState, sourceId: string, controller: string): RuleDslRuntimeContext => {
  const source = state.objects[sourceId]
  if (!source) throw new Error('replacement source is missing')
  return { state, controller, source: captureObject(source) }
}

const eventMatchesPattern = (event: GameEvent, effect: ReplacementEffectDefinition, runtime: RuleDslRuntimeContext) => {
  switch (effect.event.kind) {
    case 'draw': {
      if (event.type !== 'draw') return false
      const filter = effect.event.filter
      if (filter.player && typeof filter.player === 'object' && 'kind' in filter.player && filter.player.kind === 'players') {
        const seats = evaluatePlayerSelector(filter.player, runtime)
        if (!seats.includes(event.seat)) return false
      }
      return true
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
    case 'move': {
      if (event.type !== 'move') return false
      if (effect.event.filter.to && event.to !== effect.event.filter.to) return false
      const object = runtime.state.objects[event.objectId]
      if (!object) return false
      if (effect.event.filter.object) {
        const filter = effect.event.filter.object
        if (typeof filter === 'object' && 'kind' in filter && filter.kind !== 'objects') {
          return evaluateObjectReference(filter as Extract<typeof filter, { kind: 'contextRef' | 'targetRef' | 'choiceRef' }>, runtime)
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
      return event.seat
    case 'move':
    case 'destroy':
    case 'sacrifice': {
      const object = state.objects[event.objectId]
      return object?.controller ?? object?.owner ?? controller
    }
    default:
      return controller
  }
}

const modifiersFromDefinition = (
  state: GameState,
  sourceId: string,
  definition: CardRuleDefinitionV1,
): CanonicalReplacementCandidate[] => {
  const source = state.objects[sourceId]
  if (!source?.controller) return []
  const runtime = runtimeFor(state, sourceId, source.controller)
  const results: CanonicalReplacementCandidate[] = []
  definition.abilities.forEach((ability, abilityIndex) => {
    if (ability.kind !== 'static') return
    if (!ability.activeIn.includes(source.zone as typeof ability.activeIn[number])) return
    ability.effects.forEach((effect, effectIndex) => {
      if (effect.kind !== 'replacement') return
      results.push({
        kind: 'canonical',
        category: 'general',
        instanceId: `${sourceId}:${abilityIndex}:${effectIndex}`,
        sourceId,
        sourceName: source.name,
        abilityIndex,
        effectIndex,
        effect,
        label: source.name,
        optional: effect.optional ?? false,
        chooser: source.controller,
      })
    })
  })
  return results.filter((candidate) => {
    if (candidate.effect.when && !evaluateCondition(candidate.effect.when, runtime)) return false
    return true
  })
}

export const discoverCanonicalModifiers = (
  state: GameState,
  event: GameEvent,
  usedInstanceIds: readonly string[],
  settledOptionalDeclines: readonly string[],
): CanonicalReplacementCandidate[] => {
  const candidates: CanonicalReplacementCandidate[] = []
  for (const object of Object.values(state.objects)) {
    if (!object.ruleDefinition || object.zone !== 'battlefield' || object.phasedOut) continue
    const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
    for (const candidate of modifiersFromDefinition(state, object.id, compiled.definition)) {
      if (usedInstanceIds.includes(candidate.instanceId)) continue
      if (settledOptionalDeclines.includes(candidate.instanceId)) continue
      const runtime = runtimeFor(state, object.id, object.controller)
      if (!eventMatchesPattern(event, candidate.effect, runtime)) continue
      candidates.push({
        ...candidate,
        category: categoryFor(candidate.effect, event, object.id),
        chooser: chooserFor(state, event, object.controller),
      })
    }
  }
  return candidates
}
