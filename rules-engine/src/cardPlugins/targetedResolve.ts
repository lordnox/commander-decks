import type {
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  StackItem,
  TargetRef,
  ZoneId,
} from '../types'
import type Draft from '../draft'
import { isPermanentType } from '../definitions'
import { hasKeyword } from '../keywords'
import { isPhasedOut } from '../plugins/phasing'
import { hasProtectionFromEverything } from '../plugins/protectionFromEverything'
import { putIntoGraveyardFromBattlefieldThisTurn } from '../plugins/fromBattlefieldThisTurn'
import { effectsOf } from './cardRules'
import { spellWasKicked } from '../plugins/kickCast'
import { runInstructions, type CardEffect, type TargetFilter } from './effects'
import { openStackCopyChoice } from './stackCopy'
import { finishedSpellZone } from './alternateCosts'
import { openCardSelection } from '../rules/selectCards'
import type { InstructionHandler } from './instructionHandlers/types'

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
  if (filter.nonbasic && object.supertypes.includes('Basic')) return false
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

type TargetedResolveEffect = Extract<CardEffect, { op: 'targetedResolve' }>

const targetedEffects = (object: GameObject) =>
  effectsOf(object).filter((effect): effect is TargetedResolveEffect =>
    effect.op === 'targetedResolve')

export const targetedEffectFilter = (
  effect: TargetedResolveEffect,
  kicked: boolean,
) => kicked && effect.kickedFilter ? effect.kickedFilter : effect.filter

export const targetedSlotCount = (effects: TargetedResolveEffect[]) =>
  effects.reduce((total, effect) => total + (effect.count ?? 1), 0)

export const targetedEffectForIndex = (
  effects: CardEffect[],
  index: number,
) => {
  for (const effect of effects) {
    if (effect.op !== 'targetedResolve') continue
    const count = effect.count ?? 1
    if (index >= effect.target && index < effect.target + count) return effect
  }
}

const eachTargetedSlot = (
  effects: TargetedResolveEffect[],
  targets: TargetRef[] | undefined,
  kicked: boolean,
  visit: (effect: TargetedResolveEffect, target: TargetRef | undefined, filter: TargetFilter) => void,
) => {
  for (const effect of effects) {
    const filter = targetedEffectFilter(effect, kicked)
    const count = effect.count ?? 1
    for (let offset = 0; offset < count; offset += 1) {
      visit(effect, targets?.[effect.target + offset], filter)
    }
  }
}

const destinationFor = (
  action: TargetedResolveEffect['action'],
  removedFromStack?: StackItem,
): ZoneId => {
  const normal = action === 'exile'
    ? 'exile'
    : action === 'bounce'
      ? 'hand'
      : action === 'libraryBottom'
        ? 'library'
      : action === 'reanimate'
        ? 'battlefield'
        : 'graveyard'
  return finishedSpellZone(removedFromStack, normal)
}

const applyTargetedAction = (
  draft: Draft,
  state: GameState,
  source: GameObject,
  item: StackItem,
  effect: TargetedResolveEffect,
  target: TargetRef,
) => {
  if (effect.action === 'select') {
    if (effect.do) runInstructions(draft, source, effect.do, item)
    const targetName = target.kind === 'player'
      ? target.player
      : state.objects[target.objectId]?.name ?? target.objectId
    draft.note(`${source.name} targets ${targetName}`)
    return
  }
  if (target.kind !== 'object') return
  const object = state.objects[target.objectId]
  if (!object) return
  if (effect.action === 'counter') {
    const targetItem = draft.stack.find((candidate) => candidate.objectId === object.id)
    if (targetItem?.uncounterable) {
      draft.note(`${source.name} cannot counter ${object.name}`)
      return
    }
    const index = draft.stack.findIndex((candidate) => candidate.objectId === object.id)
    if (index < 0) return
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
    if (!stackItem || object.zone !== 'stack') return
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
      return
    }
    let removedFromStack: StackItem | undefined
    if (effect.action === 'bounce' && object.zone === 'stack') {
      const index = draft.stack.findIndex((candidate) => candidate.objectId === object.id)
      if (index >= 0) {
        const [removed] = draft.stack.splice(index, 1)
        removedFromStack = removed
      }
    }
    const destination = destinationFor(effect.action, removedFromStack)
    draft.enqueue({
      type: 'move',
      objectId: object.id,
      to: destination,
      ...(destination === 'battlefield' ? { controller: item.controller } : {}),
      ...(effect.action === 'libraryBottom' ? { position: 'bottom' as const } : {}),
    })
    if (effect.tapped && destination === 'battlefield') {
      draft.enqueue({ type: 'tap', objectId: object.id })
    }
  }
  if (effect.do) runInstructions(draft, source, effect.do, item)
  draft.note(`${source.name} ${effect.action}s ${object.name}`)
}

const openResolutionSacrifice = (
  draft: Draft,
  state: GameState,
  source: GameObject,
  item: StackItem,
  effects: TargetedResolveEffect[],
) => {
  const spec = effects.find((effect) => effect.sacrificeThen)?.sacrificeThen
  if (!spec) return false

  const objectIds: string[] = []
  let tapped = false
  let to: ZoneId = 'battlefield'
  eachTargetedSlot(effects, item.targets, spellWasKicked(item), (effect, target, filter) => {
    if (!validTargetRef(state, target, filter, item.controller, item.castOption)) return
    if (target?.kind !== 'object') return
    objectIds.push(target.objectId)
    tapped = Boolean(effect.tapped)
    to = destinationFor(effect.action)
  })
  if (objectIds.length === 0) return true

  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.controller === item.controller
      && object.types.includes(spec.type))
    .map((object) => object.id)
  if (candidates.length === 0) return true

  openCardSelection(draft, {
    seat: item.controller,
    kind: 'sacrifice',
    count: 1,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: `Sacrifice a ${spec.type.toLowerCase()}. If you do, return the chosen cards.`,
    destinations: ['battlefield', 'sacrifice'],
    fromSeat: item.controller,
    ifYouDo: {
      objectIds,
      to,
      ...(to === 'battlefield' ? { controller: item.controller } : {}),
      ...(tapped ? { tapped: true } : {}),
    },
  })
  return true
}

const ifYouDoExileFromGraveyard: InstructionHandler<'ifYouDoExileFromGraveyard'> = (
  { draft, source, item },
  instruction,
) => {
  const targetIds = item?.targets.flatMap((target) =>
    target.kind === 'object' ? [target.objectId] : []) ?? []
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'graveyard'
      && object.owner === source.controller
      && validTarget(draft, object, instruction.filter, source.controller))
    .map((object) => object.id)
  if (candidates.length === 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 0,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: 'You may exile a creature card from your graveyard. If you do, exile the targeted permanent.',
    destinations: ['target'],
    fromSeat: source.controller,
    fromZone: 'graveyard',
    targetFilter: instruction.filter,
    moveSelectedTo: 'exile',
    ifYouDo: { objectIds: targetIds, to: 'exile' },
  })
}

export const targetedResolveInstructionHandlers = {
  ifYouDoExileFromGraveyard,
}

export const targetedResolve: Plugin = {
  id: 'targetedResolve',
  legal: ({ state, event }) => {
    if (event.type !== 'castSpell') return
    const source = state.objects[event.objectId]
    if (!source) return
    const effects = targetedEffects(source)
    if (effects.length === 0) return
    const required = targetedSlotCount(effects)
    if ((event.targets?.length ?? 0) !== required) {
      return `${source.name} requires ${required} target${required === 1 ? '' : 's'}`
    }
    const objectIds = (event.targets ?? [])
      .flatMap((target) => target.kind === 'object' ? [target.objectId] : [])
    if (new Set(objectIds).size !== objectIds.length) {
      return `illegal target for ${source.name}`
    }
    let illegal = false
    eachTargetedSlot(effects, event.targets, spellWasKicked(event), (effect, target, filter) => {
      if (!validTargetRef(state, target, filter, event.seat, event.castOption)) {
        illegal = true
      }
    })
    if (illegal) return `illegal target for ${source.name}`
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    const source = item ? state.objects[item.objectId] : undefined
    if (!item || !source) return
    const effects = targetedEffects(source)
    if (effects.length === 0) return
    if (openResolutionSacrifice(draft, state, source, item, effects)) return
    eachTargetedSlot(effects, item.targets, spellWasKicked(item), (effect, target, filter) => {
      if (!target) return
      if (!validTargetRef(state, target, filter, item.controller, item.castOption)) return
      applyTargetedAction(draft, state, source, item, effect, target)
    })
  },
}
