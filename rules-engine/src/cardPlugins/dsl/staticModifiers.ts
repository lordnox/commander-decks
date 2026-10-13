import type Draft from '../../draft'
import { captureObject } from '../../objectIdentity'
import type { ContinuousEffect, GameObject, GameState, Plugin, ReversibleEffect } from '../../types'
import {
  changeStats,
  reorderContinuousEffects,
  reviseContinuousEffects,
  setStats,
} from '../continuousEffects'
import { evaluateAmount } from './compiler/evaluate'
import { amountEvaluationContext, evaluateObjectSelector } from './compiler/runtime'
import {
  activePrintedStaticModifiers,
  ensureStaticRulesTimestamp,
  isActiveKeywordStatic,
  modifierKey,
  printedStaticAbilityActive,
  printedStaticDuration,
  sourceActiveZones,
  sourceStaticAbilitiesActive,
} from './staticModifierCore'
import type { ContinuousEffectDefinition, Keyword } from './schema/v1'

const SYNC = 'dslStaticModifiers.sync'

const keywordGrant = (keyword: Keyword): ReversibleEffect => ({
  kind: 'staticKeywords',
  grant: [keyword],
  suppress: [],
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
  const amountContext = amountEvaluationContext(context)
  const power = evaluateAmount(effect.power, amountContext)
  const toughness = evaluateAmount(effect.toughness, amountContext)
  const targetIds = new Set(
    evaluateObjectSelector(effect.targets, context)
      .filter((object) => object.zone === 'battlefield')
      .map((object) => object.id),
  )
  const duration = printedStaticDuration(source, abilityIndex, effectIndex, timestamp)

  for (const object of Object.values(draft.objects)) {
    const existing = existingPrintedStamp(object, source.id, abilityIndex, effectIndex)
    if (!targetIds.has(object.id)) {
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      continue
    }
    if (effect.set) {
      if (
        existing
        && existing.effect.kind === 'setPt'
        && existing.effect.after.power === power
        && existing.effect.after.toughness === toughness
      ) continue
      if (existing) removePrintedStaticStamp(object, source.id, abilityIndex, effectIndex)
      stampEffect(object, setStats(object, power, toughness), duration)
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

const syncProhibitActivation = (
  source: GameObject,
  abilityIndex: number,
  effectIndex: number,
  effect: Extract<ContinuousEffectDefinition, { kind: 'prohibitActivation' }>,
  timestamp: number,
) => ({
  abilityIndex,
  effectIndex,
  timestamp,
  sourceRef: captureObject(source).ref,
  activeIn: sourceActiveZones(source, abilityIndex),
  kind: 'prohibitActivation' as const,
  filter: effect.filter,
})

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
      syncKeywordAbility(draft, source, entry.abilityIndex, entry.keyword)
      continue
    }
    const { abilityIndex, effectIndex, effect } = entry
    const effectTimestamp = preservedTimestamps.get(modifierKey(abilityIndex, effectIndex)) ?? timestamp
    if (effect.kind === 'prohibitActivation') {
      nextModifiers.push(syncProhibitActivation(source, abilityIndex, effectIndex, effect, effectTimestamp))
      continue
    }
    if (effect.kind === 'modifyStats') {
      syncModifyStats(draft, source, abilityIndex, effectIndex, effect, effectTimestamp)
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
    case 'setPt': return 1
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
    const prohibit = active.filter((entry) => !isActiveKeywordStatic(entry) && entry.effect.kind === 'prohibitActivation')
    if ((source.printedStaticModifiers?.length ?? 0) !== prohibit.length) return true
    for (const entry of active) {
      if (isActiveKeywordStatic(entry)) {
        if (printedStaticAbilityActive(state, source, entry.abilityIndex)
          && !existingPrintedStamp(source, source.id, entry.abilityIndex, 0)) return true
        continue
      }
      if (entry.effect.kind === 'modifyStats') {
        const runtime = { state, controller: source.controller, source: captureObject(source) }
        const targets = evaluateObjectSelector(entry.effect.targets, runtime)
          .filter((object) => object.zone === 'battlefield')
        for (const target of targets) {
          if (!existingPrintedStamp(target, source.id, entry.abilityIndex, entry.effectIndex)) return true
        }
        for (const object of Object.values(state.objects)) {
          const stale = existingPrintedStamp(object, source.id, entry.abilityIndex, entry.effectIndex)
          if (stale && !targets.some((target) => target.id === object.id)) return true
        }
      }
    }
  }
  return false
}

export const dslStaticModifiers: Plugin = {
  id: 'dslStaticModifiers',
  apply: ({ draft }) => {
    syncAll(draft)
  },
  recompute: ({ draft }) =>
    modifiersOutOfSync(draft) ? [{ type: 'custom', name: SYNC }] : [],
}
