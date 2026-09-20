import type {
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  StackItem,
  TargetRef,
} from '../types'
import { isPermanentType } from '../definitions'
import { hasKeyword } from '../keywords'
import { isPhasedOut } from '../plugins/phasing'
import { hasProtectionFromEverything } from '../plugins/protectionFromEverything'
import { putIntoGraveyardFromBattlefieldThisTurn } from '../plugins/fromBattlefieldThisTurn'
import { effectsOf } from './cardRules'
import { spellWasKicked } from '../plugins/kickCast'
import { runInstructions, type TargetFilter } from './effects'
import { openStackCopyChoice } from './stackCopy'
import { finishedSpellZone } from './alternateCosts'

const controlledPermanentTarget = (
  state: GameState,
  item: StackItem,
  controller: PlayerId,
) => item.targets.some((target) => {
  if (target.kind !== 'object') return false
  const object = state.objects[target.objectId]
  return object?.zone === 'battlefield' && object.controller === controller
})

/** Permanent filter match without targeting restrictions (hexproof, etc.). */
export const matchesTargetFilter = (
  state: GameState,
  object: GameObject | undefined,
  filter: TargetFilter,
  controller: PlayerId,
  castOption?: string,
  excludeSourceId?: string,
) => {
  if (!object) return false
  if (filter.other && excludeSourceId && object.id === excludeSourceId) return false
  if (filter.excludeSubtypes?.some((subtype) => object.subtypes.includes(subtype))) {
    return false
  }
  if (isPhasedOut(object)) return false
  if (filter.zone && object.zone !== filter.zone) return false
  if (filter.zones && !filter.zones.includes(object.zone)) return false
  if (filter.castFromNot) {
    const item = state.stack.find((candidate) => candidate.objectId === object.id)
    if (!item || item.kind !== 'spell' || item.castFrom === filter.castFromNot) return false
  }
  if (filter.type && !object.types.includes(filter.type)) return false
  if (filter.types && !filter.types.some((type) => object.types.includes(type))) return false
  if (filter.supertype && !object.supertypes.includes(filter.supertype)) return false
  if (filter.controller === 'you' && object.controller !== controller) return false
  if (filter.controller === 'opponent' && object.controller === controller) return false
  if (filter.controller === 'notController' && object.controller === controller) return false
  if (filter.nonland && object.types.includes('Land')) return false
  if (filter.noncreature && object.types.includes('Creature')) return false
  if (filter.nonblack && object.colors.includes('B')) return false
  if (filter.nonlegendary && object.supertypes.includes('Legendary')) return false
  if (filter.permanent && !isPermanentType(object.types)) return false
  if (filter.fromBattlefieldThisTurn && !putIntoGraveyardFromBattlefieldThisTurn(object)) {
    return false
  }
  if (filter.attacking && object.attacking === null) return false
  if (filter.spellTargetsControlledPermanent) {
    const item = state.stack.find((candidate) => candidate.objectId === object.id)
    if (!item || !controlledPermanentTarget(state, item, controller)) return false
  }
  if (
    filter.bracketed
    && castOption !== 'cleave'
    && !matchesTargetFilter(state, object, filter.bracketed, controller, castOption, excludeSourceId)
  ) return false
  return true
}

export const validTarget = (
  state: GameState,
  object: GameObject | undefined,
  filter: TargetFilter,
  controller: PlayerId,
  castOption?: string,
  excludeSourceId?: string,
) => {
  if (!matchesTargetFilter(state, object, filter, controller, castOption, excludeSourceId)) {
    return false
  }
  if (hasProtectionFromEverything(state, object)) return false
  if (object && object.controller !== controller && hasKeyword(object, 'hexproof', state)) {
    return false
  }
  return true
}

export const validTargetRef = (
  state: GameState,
  target: TargetRef | undefined,
  filter: TargetFilter,
  controller: PlayerId,
  castOption?: string,
  excludeSourceId?: string,
) => {
  if (target?.kind === 'player') {
    return Boolean(
      filter.players
      && state.players[target.player]
      && !state.players[target.player].lost
      && (filter.players !== 'opponent' || target.player !== controller)
      && !hasProtectionFromEverything(state, undefined, target.player),
    )
  }
  return target?.kind === 'object'
    && validTarget(
      state,
      state.objects[target.objectId],
      filter,
      controller,
      castOption,
      excludeSourceId,
    )
}

const targetedEffects = (object: GameObject) =>
  effectsOf(object).filter((effect) => effect.op === 'targetedResolve')

export const targetedEffectFilter = (
  effect: ReturnType<typeof targetedEffects>[number],
  kicked: boolean,
) => kicked && effect.kickedFilter ? effect.kickedFilter : effect.filter

export const targetedResolve: Plugin = {
  id: 'targetedResolve',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!source) return
    const effects = targetedEffects(source)
    if (effects.length === 0) return
    if ((event.targets?.length ?? 0) !== effects.length) {
      return `${source.name} requires ${effects.length} target`
    }
    for (const effect of effects) {
      const target = event.targets?.[effect.target]
      const filter = targetedEffectFilter(effect, spellWasKicked(event))
      if (!validTargetRef(state, target, filter, event.seat, event.castOption)) {
        return `illegal target for ${source.name}`
      }
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const source = item ? state.objects[item.objectId] : undefined
    if (!item || !source) return
    for (const effect of targetedEffects(source)) {
      const target = item.targets[effect.target]
      const filter = targetedEffectFilter(effect, spellWasKicked(item))
      if (!validTargetRef(
        state,
        target,
        filter,
        item.controller,
        item.castOption,
      )) continue

      if (effect.action === 'select') {
        if (effect.do) runInstructions(draft, source, effect.do, item)
        const targetName = target.kind === 'player'
          ? target.player
          : state.objects[target.objectId]?.name ?? target.objectId
        draft.note(`${source.name} targets ${targetName}`)
        continue
      }
      if (target.kind !== 'object') continue
      const object = state.objects[target.objectId]
      if (!object) continue
      if (effect.action === 'counter') {
        const targetItem = draft.stack.find((candidate) => candidate.objectId === object.id)
        if (targetItem?.uncounterable) {
          draft.note(`${source.name} cannot counter ${object.name}`)
          continue
        }
        const index = draft.stack.findIndex((candidate) => candidate.objectId === object.id)
        if (index < 0) continue
        const stealToBattlefield = Boolean(
          effect.filter.stealIfTypes?.some((type) => object.types.includes(type)),
        )
        const [countered] = draft.stack.splice(index, 1)
        draft.enqueue({
          type: 'move',
          objectId: object.id,
          to: stealToBattlefield
            ? 'battlefield'
            : finishedSpellZone(countered, 'graveyard'),
          ...(stealToBattlefield ? { controller: item.controller } : {}),
        })
      } else if (effect.action === 'copy') {
        const stackItem = state.stack.find((candidate) => candidate.objectId === object.id)
        if (!stackItem || object.zone !== 'stack') continue
        openStackCopyChoice(draft, {
          sourceId: source.id,
          source: source.name,
          seat: item.controller,
          stackId: stackItem.id,
          cost: '{0}',
          optional: false,
        })
      } else {
        if (effect.action === 'destroy' && hasKeyword(object, 'indestructible', state)) {
          draft.note(`${source.name} cannot destroy indestructible ${object.name}`)
          continue
        }
        let removedFromStack: StackItem | undefined
        if (effect.action === 'bounce' && object.zone === 'stack') {
          const index = draft.stack.findIndex((candidate) => candidate.objectId === object.id)
          if (index >= 0) {
            const [removed] = draft.stack.splice(index, 1)
            removedFromStack = removed
          }
        }
        const normalDestination = effect.action === 'exile'
          ? 'exile'
          : effect.action === 'bounce'
            ? 'hand'
            : effect.action === 'libraryBottom'
              ? 'library'
            : effect.action === 'reanimate'
              ? 'battlefield'
              : 'graveyard'
        const destination = finishedSpellZone(removedFromStack, normalDestination)
        draft.enqueue({
          type: 'move',
          objectId: object.id,
          to: destination,
          ...(destination === 'battlefield' ? { controller: item.controller } : {}),
          ...(effect.action === 'libraryBottom' ? { position: 'bottom' as const } : {}),
        })
      }
      if (effect.do) runInstructions(draft, source, effect.do, item)
      draft.note(`${source.name} ${effect.action}s ${object.name}`)
    }
  },
}
