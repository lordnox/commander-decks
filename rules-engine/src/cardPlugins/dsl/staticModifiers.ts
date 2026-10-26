import { seatRevealsLibraryTop, syncRevealedLibraryTop } from '../libraryTopKnowledge'
import { CREATURE_TYPES } from '../../creatureTypes'
import type Draft from '../../draft'
import { captureObject } from '../../objectIdentity'
import type { ContinuousEffect, GameObject, GameState, Plugin, ReversibleEffect } from '../../types'
import {
  changeStats,
  reorderContinuousEffects,
  reviseContinuousEffects,
  setStats,
} from '../continuousEffects'
import { evaluateStatDelta } from './compiler/evaluate'
import { amountEvaluationContext, evaluateCondition, evaluateObjectSelector, evaluateCreatureType } from './compiler/runtime'
import { syncStaticPreventionInstances } from '../../replacement/prevention'
import {
  activePrintedStaticModifiers,
  ensureStaticRulesTimestamp,
  isActiveKeywordStatic,
  isRuntimePrintedStaticEffect,
  type RuntimePrintedStaticEffect,
  modifierKey,
  printedStaticAbilityActive,
  printedStaticDuration,
  sourceActiveZones,
  sourceStaticAbilitiesActive,
} from './staticModifierCore'
import type { BasicLandType, ContinuousEffectDefinition, Keyword } from './schema/v2'
import { isCurrentlyBestowed, legalBestowHost } from './bestowRuntime'

const SYNC = 'dslStaticModifiers.sync'

const keywordGrant = (keyword: Keyword): ReversibleEffect => ({
  kind: 'staticKeywords',
  grant: [keyword],
  suppress: [],
})

const landTypeGrant = (landType: BasicLandType): ReversibleEffect => ({
  kind: 'subtypeGrant',
  subtype: landType,
})

const existingPrintedStamp = (
  object: GameObject,
  sourceId: string,
  abilityIndex: number,
  effectIndex: number,
) => (object.continuousEffects ?? []).find(({ duration }) =>
  duration.kind === 'printedStatic'
  && duration.sourceId === sourceId
  && duration.abilityIndex === abilityIndex
  && duration.effectIndex === effectIndex)

const stampEffect = (
  object: GameObject,
  effect: ReversibleEffect,
  duration: ContinuousEffect['duration'],
) => {
  object.continuousEffects = [...(object.continuousEffects ?? []), { effect, duration }]
}

const removePrintedStaticStamp = (
  object: GameObject,
  sourceId: string,
  abilityIndex: number,
  effectIndex: number,
) => {
  reviseContinuousEffects(object, (entry) =>
    entry.duration.kind === 'printedStatic'
    && entry.duration.sourceId === sourceId
    && entry.duration.abilityIndex === abilityIndex
    && entry.duration.effectIndex === effectIndex
      ? undefined
      : entry)
}

const syncKeywordAbility = (
  draft: Draft,
  source: GameObject,
  abilityIndex: number,
  keyword: Keyword,
) => {
  const timestamp = ensureStaticRulesTimestamp(source, () => draft.allocTs())
  const duration = printedStaticDuration(source, abilityIndex, 0, timestamp)
  const existing = existingPrintedStamp(source, source.id, abilityIndex, 0)
  if (existing) {
    const stamped = existing.effect
    if (stamped.kind === 'staticKeywords' && !stamped.grant.includes(keyword)) {
      reviseContinuousEffects(source, (entry) =>
        entry === existing
          ? { ...entry, effect: { ...stamped, grant: [...stamped.grant, keyword] } }
          : entry)
    }
    return
  }
  stampEffect(source, keywordGrant(keyword), duration)
}

const printedGrantStamp = (
  object: GameObject,
  sourceId: string,
  abilityIndex: number,
  effectIndex: number,
) => (object.canonicalGrantedAbilities ?? []).find(grant =>
  grant.sourceId === sourceId
  && grant.printedStatic?.abilityIndex === abilityIndex
  && grant.printedStatic?.effectIndex === effectIndex)

const removePrintedGrantStamp = (
  object: GameObject,
  sourceId: string,
  abilityIndex: number,
  effectIndex: number,
) => {
  const remaining = (object.canonicalGrantedAbilities ?? []).filter(grant =>
    !(grant.sourceId === sourceId
      && grant.printedStatic?.abilityIndex === abilityIndex
      && grant.printedStatic?.effectIndex === effectIndex))
  if (remaining.length > 0) object.canonicalGrantedAbilities = remaining
  else delete object.canonicalGrantedAbilities
}

const syncGrantAbility = (
  draft: Draft,
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'grantAbility' }>,
) => {
  const context = {
    state: draft,
    controller: source.controller,
    source: captureObject(source),
  }
  const targetIds = new Set(
    evaluateObjectSelector(effect.targets, context)
      .filter(object => object.zone === 'battlefield')
      .map(object => object.id),
  )
  for (const object of Object.values(draft.objects)) {
    const existing = printedGrantStamp(object, source.id, abilityIndex, effectIndex)
    if (!targetIds.has(object.id)) {
      if (existing) removePrintedGrantStamp(object, source.id, abilityIndex, effectIndex)
      continue
    }
    if (existing) continue
    object.canonicalGrantedAbilities = [...(object.canonicalGrantedAbilities ?? []), {
      ability: structuredClone(effect.ability),
      sourceId: source.id,
      sourceIncarnation: source.incarnation,
      definitionRevision: source.ruleDefinition?.definitionRevision ?? 'unknown',
      duration: { kind: 'whileSourceOnBattlefield' },
      createdTurn: draft.turn,
      printedStatic: { abilityIndex, effectIndex },
    }]
  }
}

const syncActivatedGrant = (
  draft: Draft, source: GameObject, abilityIndex: number, effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'grantActivatedAbility' }>,
) => {
  const targetIds = new Set(evaluateObjectSelector(effect.targets, { state: draft, controller: source.controller, source: captureObject(source) }).filter(object => object.zone === 'battlefield').map(object => object.id))
  for (const object of Object.values(draft.objects)) {
    const grants = object.canonicalGrantedActivations ?? []
    const matching = (grant: typeof grants[number]) => grant.sourceId === source.id && grant.printedStatic?.abilityIndex === abilityIndex && grant.printedStatic?.effectIndex === effectIndex
    if (!targetIds.has(object.id)) {
      object.canonicalGrantedActivations = grants.filter(grant => !matching(grant))
    } else if (!grants.some(matching)) {
      object.canonicalGrantedActivations = [...grants, {
        ability: structuredClone(effect.ability), sourceId: source.id, sourceIncarnation: source.incarnation,
        definitionRevision: source.ruleDefinition?.definitionRevision ?? 'unknown', duration: { kind: 'whileSourceOnBattlefield' }, createdTurn: draft.turn, timestamp: ensureStaticRulesTimestamp(source, () => draft.allocTs()),
        printedStatic: { abilityIndex, effectIndex },
      }]
    }
  }
}

const syncModifyStats = (
  draft: Draft,
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'modifyStats' }>,
  timestamp: number,
) => {
  const context = {
    state: draft,
    controller: source.controller,
    source: captureObject(source),
  }
  const targetIds = new Set(
    modifierTargets(draft, source, effect)
      .map((object) => object.id),
  )
  const duration = printedStaticDuration(source, abilityIndex, effectIndex, timestamp)

  for (const object of Object.values(draft.objects)) {
    const existing = existingPrintedStamp(object, source.id, abilityIndex, effectIndex)
    if (!targetIds.has(object.id)) {
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      continue
    }
    const amountContext = amountEvaluationContext({ ...context, subject: object })
    const power = evaluateStatDelta(effect.power, amountContext)
    const toughness = evaluateStatDelta(effect.toughness, amountContext)
    if (effect.set) {
      if (
        existing
        && existing.effect.kind === 'setPt'
        && existing.effect.after.power === power
        && existing.effect.after.toughness === toughness
      ) continue
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      stampEffect(object, { ...setStats(object, power, toughness), ...(effect.characteristicDefining ? { cda: true as const } : {}) }, duration)
      continue
    }
    if (
      existing
      && existing.effect.kind === 'pump'
      && existing.effect.power === power
      && existing.effect.toughness === toughness
    ) continue
    if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
    stampEffect(object, changeStats(object, power, toughness), duration)
  }
}

const modifierTargets = (
  state: GameState,
  source: GameObject,
  effect: Extract<ContinuousEffectDefinition, { kind: 'grantKeyword' | 'suppressKeyword' | 'modifyStats' | 'grantLandType' | 'addTypes' }>,
) => {
  const context = { state, controller: source.controller, source: captureObject(source) }
  if (effect.when && !evaluateCondition(effect.when, context)) return []
  return evaluateObjectSelector(effect.targets, context).filter(object => effect.kind === 'addTypes' || (effect.kind === 'modifyStats' && effect.characteristicDefining) || object.zone === 'battlefield')
}

const syncKeywordModifier = (
  draft: Draft,
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'grantKeyword' | 'suppressKeyword' }>,
  timestamp: number,
) => {
  const targetIds = new Set(modifierTargets(draft, source, effect).map(object => object.id))
  const duration = printedStaticDuration(source, abilityIndex, effectIndex, timestamp)
  for (const object of Object.values(draft.objects)) {
    const existing = existingPrintedStamp(object, source.id, abilityIndex, effectIndex)
    if (!targetIds.has(object.id)) {
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      continue
    }
    if (existing) continue
    const modifier: ReversibleEffect = effect.kind === 'grantKeyword'
      ? keywordGrant(effect.keyword)
      : { kind: 'staticKeywords', grant: [], suppress: [effect.keyword] }
    stampEffect(object, modifier, duration)
  }
}

const syncTypeModifier = (
  draft: Draft, source: GameObject, abilityIndex: number, effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'addTypes' }>, timestamp: number,
) => {
  const selected = effect.creatureType ? evaluateCreatureType(effect.creatureType, { state: draft, source: captureObject(source), controller: source.controller }) : undefined
  const subtypes = [...(effect.allCreatureTypes ? CREATURE_TYPES : effect.subtypes ?? []), ...(selected ? [selected] : [])]
  const targetIds = new Set(modifierTargets(draft, source, effect).map(object => object.id))
  const duration = printedStaticDuration(source, abilityIndex, effectIndex, timestamp)
  for (const object of Object.values(draft.objects)) {
    const existing = existingPrintedStamp(object, source.id, abilityIndex, effectIndex)
    if (!targetIds.has(object.id)) {
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      continue
    }
    if (existing) {
      object.types = [...new Set([...object.types, ...(effect.types ?? [])])]
      object.subtypes = [...new Set([...object.subtypes, ...subtypes])]
      continue
    }
    const before = { types: [...object.types], subtypes: [...object.subtypes] }
    object.types = [...new Set([...object.types, ...(effect.types ?? [])])]
    object.subtypes = [...new Set([...object.subtypes, ...subtypes])]
    stampEffect(object, { kind: 'addTypes', before, types: [...(effect.types ?? [])], subtypes: [...subtypes] }, duration)
  }
}

const syncBestow = (
  draft: Draft,
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  timestamp: number,
) => {
  const duration = printedStaticDuration(source, abilityIndex, effectIndex, timestamp)
  const existing = existingPrintedStamp(source, source.id, abilityIndex, effectIndex)
  if (!isCurrentlyBestowed(draft, source)) {
    if (!legalBestowHost(draft, source)) {
      source.attachedTo = null
      delete source.attachedToRef
    }
    if (existing) removePrintedStaticStamp(source, source.id, abilityIndex, effectIndex)
    return
  }
  if (existing) return
  const before = {
    types: [...source.types],
    subtypes: [...source.subtypes],
    power: source.power,
    toughness: source.toughness,
  }
  source.types = [...new Set([...source.types.filter(type => type !== 'Creature'), 'Enchantment'])]
  source.subtypes = ['Aura']
  source.power = null
  source.toughness = null
  stampEffect(source, { kind: 'bestowAura', before }, duration)
}

const syncLandTypeModifier = (
  draft: Draft,
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'grantLandType' }>,
  timestamp: number,
) => {
  const targetIds = new Set(modifierTargets(draft, source, effect).map(object => object.id))
  const duration = printedStaticDuration(source, abilityIndex, effectIndex, timestamp)
  for (const object of Object.values(draft.objects)) {
    const existing = existingPrintedStamp(object, source.id, abilityIndex, effectIndex)
    if (!targetIds.has(object.id)) {
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      continue
    }
    if (existing) continue
    stampEffect(object, landTypeGrant(effect.landType), duration)
  }
}

const syncRuntimePrintedModifier = (
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  effect: RuntimePrintedStaticEffect,
  timestamp: number,
) => {
  const base = {
    abilityIndex,
    effectIndex,
    timestamp,
    sourceRef: captureObject(source).ref,
    activeIn: sourceActiveZones(source, abilityIndex),
  }
  switch (effect.kind) {
    case 'prohibitActivation':
      return { ...base, kind: 'prohibitActivation' as const, filter: effect.filter }
    case 'replacement':
      return { ...base, kind: 'replacement' as const, effect }
    case 'prevention':
      return { ...base, kind: 'prevention' as const, effect }
  }
}

const syncSource = (draft: Draft, source: GameObject) => {
  if (!source.ruleDefinition) {
    delete source.printedStaticModifiers
    return
  }
  if (!sourceStaticAbilitiesActive(source)) {
    delete source.printedStaticModifiers
    for (const object of Object.values(draft.objects)) {
      reviseContinuousEffects(object, (entry) =>
        entry.duration.kind === 'printedStatic' && entry.duration.sourceId === source.id
          ? undefined
          : entry)
    }
    return
  }

  const timestamp = ensureStaticRulesTimestamp(source, () => draft.allocTs())
  const preservedTimestamps = new Map(
    (source.printedStaticModifiers ?? []).map((modifier) =>
      [modifierKey(modifier.abilityIndex, modifier.effectIndex), modifier.timestamp]),
  )
  const nextModifiers = [] as NonNullable<GameObject['printedStaticModifiers']>

  for (const entry of activePrintedStaticModifiers(draft, source)) {
    if (isActiveKeywordStatic(entry)) {
      if (entry.keyword === 'changeling') {
        syncTypeModifier(draft, source, entry.abilityIndex, 0, { kind: 'addTypes', targets: { kind: 'objects', filter: { among: { kind: 'contextRef', name: 'source' } } }, allCreatureTypes: true }, timestamp)
      } else syncKeywordAbility(draft, source, entry.abilityIndex, entry.keyword)
      continue
    }
    const { abilityIndex, effectIndex } = entry
    const effectTimestamp = preservedTimestamps.get(modifierKey(abilityIndex, effectIndex)) ?? timestamp
    if (isRuntimePrintedStaticEffect(entry)) {
      nextModifiers.push(syncRuntimePrintedModifier(source, abilityIndex, effectIndex, entry.effect, effectTimestamp))
      continue
    }
    const { effect } = entry
    if (effect.kind === 'modifyStats') {
      syncModifyStats(draft, source, abilityIndex, effectIndex, effect, effectTimestamp)
    }
    if (effect.kind === 'grantKeyword' || effect.kind === 'suppressKeyword') {
      syncKeywordModifier(draft, source, abilityIndex, effectIndex, effect, effectTimestamp)
    }
    if (effect.kind === 'addTypes') syncTypeModifier(draft, source, abilityIndex, effectIndex, effect, effectTimestamp)
    if (effect.kind === 'bestow') syncBestow(draft, source, abilityIndex, effectIndex, effectTimestamp)
    if (effect.kind === 'grantLandType') {
      syncLandTypeModifier(draft, source, abilityIndex, effectIndex, effect, effectTimestamp)
    }
    if (effect.kind === 'grantActivatedAbility') syncActivatedGrant(draft, source, abilityIndex, effectIndex, effect)
    if (effect.kind === 'grantAbility') {
      syncGrantAbility(draft, source, abilityIndex, effectIndex, effect)
    }
  }

  if (nextModifiers.length > 0) source.printedStaticModifiers = nextModifiers
  else delete source.printedStaticModifiers

  for (const object of Object.values(draft.objects)) {
    reviseContinuousEffects(object, (entry) =>
      entry.duration.kind === 'printedStatic'
      && entry.duration.sourceId === source.id
      && !printedStaticAbilityActive(draft, source, entry.duration.abilityIndex)
        ? undefined
        : entry)
  }
}

const printedStaticTimestamp = (entry: ContinuousEffect, fallback: number) =>
  entry.duration.kind === 'printedStatic' ? entry.duration.timestamp : fallback

const powerToughnessSublayer = (entry: ContinuousEffect) => {
  switch (entry.effect.kind) {
    case 'cdaLifePt': return 0
    case 'setPt': return entry.effect.cda ? 0 : 1
    case 'pump':
    case 'pumpPerLinkedExile': return 2
    default: return undefined
  }
}

/** CR 613.4b-c: apply all 7b setters before 7c modifiers, then timestamp within a sublayer. */
const applyLayer7Order = (object: GameObject) => {
  reorderContinuousEffects(object, (effects) => {
    const ranked = effects.map((entry, index) => ({
      entry,
      index,
      sublayer: powerToughnessSublayer(entry),
    }))
    const pt = ranked.filter((item) => item.sublayer !== undefined)
    if (pt.length < 2) return [...effects]
    const sortedPt = [...pt].sort((left, right) =>
      (left.sublayer ?? 0) - (right.sublayer ?? 0)
      || printedStaticTimestamp(left.entry, left.index) - printedStaticTimestamp(right.entry, right.index)
      || left.index - right.index)
    let nextPt = 0
    return ranked.map((item) =>
      item.sublayer === undefined ? item.entry : sortedPt[nextPt++].entry)
  })
}

export const syncCanonicalStaticModifiers = (draft: Draft) => {
  for (const source of Object.values(draft.objects)) syncSource(draft, source)
  for (const object of Object.values(draft.objects)) applyLayer7Order(object)
  const synced = syncStaticPreventionInstances(draft)
  if (synced.preventionInstances) draft.preventionInstances = synced.preventionInstances
  else delete draft.preventionInstances
}

const syncAll = (draft: Draft) => {
  syncCanonicalStaticModifiers(draft)
}

const modifiersOutOfSync = (state: GameState) => {
  for (const source of Object.values(state.objects)) {
    if (!source.ruleDefinition) {
      if (source.printedStaticModifiers?.length) return true
      continue
    }
    const active = activePrintedStaticModifiers(state, source)
    const runtimePrinted = active.filter((entry) =>
      !isActiveKeywordStatic(entry) && isRuntimePrintedStaticEffect(entry))
    if ((source.printedStaticModifiers?.length ?? 0) !== runtimePrinted.length) return true
    const activeKeys = new Set(active.map((entry) => `${entry.abilityIndex}:${entry.effectIndex}`))
    for (const object of Object.values(state.objects)) {
      for (const entry of object.continuousEffects ?? []) {
        if (entry.duration.kind !== 'printedStatic' || entry.duration.sourceId !== source.id) continue
        if (!activeKeys.has(`${entry.duration.abilityIndex}:${entry.duration.effectIndex}`)) return true
      }
    }
    for (const entry of active) {
      if (isActiveKeywordStatic(entry)) {
        if (printedStaticAbilityActive(state, source, entry.abilityIndex)
          && !existingPrintedStamp(source, source.id, entry.abilityIndex, 0)) return true
        continue
      }
      if (entry.effect.kind === 'bestow') {
        const should = isCurrentlyBestowed(state, source)
        if (should !== Boolean(existingPrintedStamp(source, source.id, entry.abilityIndex, entry.effectIndex))) return true
        if (should && !source.subtypes.includes('Aura')) return true
        continue
      }
      if (entry.effect.kind === 'grantKeyword' || entry.effect.kind === 'suppressKeyword' || entry.effect.kind === 'grantLandType' || entry.effect.kind === 'addTypes') {
        const targetIds = new Set(modifierTargets(state, source, entry.effect).map(object => object.id))
        for (const object of Object.values(state.objects)) {
          if (targetIds.has(object.id) !== Boolean(existingPrintedStamp(object, source.id, entry.abilityIndex, entry.effectIndex))) return true
          if (targetIds.has(object.id) && entry.effect.kind === 'addTypes' && ((entry.effect.types ?? []).some(type => !object.types.includes(type)) || (entry.effect.allCreatureTypes ? CREATURE_TYPES : entry.effect.subtypes ?? []).some(type => !object.subtypes.includes(type)))) return true
        }
      }
      if (entry.effect.kind === 'modifyStats' || entry.effect.kind === 'grantAbility') {
        const runtime = { state, controller: source.controller, source: captureObject(source) }
        const targets = entry.effect.kind === 'modifyStats'
          ? modifierTargets(state, source, entry.effect)
          : evaluateObjectSelector(entry.effect.targets, runtime).filter(object => object.zone === 'battlefield')
        for (const target of targets) {
          if (entry.effect.kind === 'modifyStats') {
            const existing = existingPrintedStamp(target, source.id, entry.abilityIndex, entry.effectIndex)
            const context = amountEvaluationContext({ ...runtime, subject: target })
            const power = evaluateStatDelta(entry.effect.power, context)
            const toughness = evaluateStatDelta(entry.effect.toughness, context)
            if (existing?.effect.kind === 'setPt' && (existing.effect.after.power !== power || existing.effect.after.toughness !== toughness)) return true
            if (existing?.effect.kind === 'pump' && (existing.effect.power !== power || existing.effect.toughness !== toughness)) return true
          }
          if (entry.effect.kind === 'modifyStats'
            ? !existingPrintedStamp(target, source.id, entry.abilityIndex, entry.effectIndex)
            : !printedGrantStamp(target, source.id, entry.abilityIndex, entry.effectIndex)) return true
        }
        for (const object of Object.values(state.objects)) {
          const stale = entry.effect.kind === 'modifyStats'
            ? existingPrintedStamp(object, source.id, entry.abilityIndex, entry.effectIndex)
            : printedGrantStamp(object, source.id, entry.abilityIndex, entry.effectIndex)
          if (stale && !targets.some((target) => target.id === object.id)) return true
        }
      }
    }
  }
  return false
}

export const dslStaticModifiers: Plugin = {
  id: 'dslStaticModifiers',
  apply: ({ draft, state }) => {
    syncAll(draft)
    syncRevealedLibraryTop(draft, draft.playerOrder.filter(seat => seatRevealsLibraryTop(state, seat) || seatRevealsLibraryTop(draft, seat)))
  },
  recompute: ({ draft }) =>
    modifiersOutOfSync(draft) ? [{ type: 'custom', name: SYNC }] : [],
}
