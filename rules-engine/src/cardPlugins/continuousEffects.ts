import type {
  ContinuousEffect,
  CopySnapshot,
  EffectDuration,
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  ReversibleEffect,
  ZoneId,
} from '../types'
import { effectsFor } from './cardRules'
import type { CardEffect } from './effectDefinitions'
import { applyCopy, serializableEffects } from './effectRuntime'

const EXPIRE_EFFECTS = 'continuousEffects.expire'

/** CR 208.2 / 604.3: CDAs apply wherever power and toughness are defined. */
export const zoneHasPowerToughness = (zone: ZoneId) =>
  zone === 'battlefield'
  || zone === 'stack'
  || zone === 'hand'
  || zone === 'graveyard'
  || zone === 'exile'
  || zone === 'command'
  || zone === 'library'

export const snapshotCopy = (object: GameObject): CopySnapshot => ({
  name: object.name,
  printedName: object.printedName,
  types: [...object.types],
  subtypes: [...object.subtypes],
  supertypes: [...object.supertypes],
  manaCost: object.manaCost,
  manaValue: object.manaValue,
  colors: [...object.colors],
  power: object.power,
  toughness: object.toughness,
  printedLoyalty: object.printedLoyalty,
  oracleText: object.oracleText,
  grantedRules: [...object.grantedRules],
  tapProduces: object.tapProduces ? { ...object.tapProduces } : undefined,
  effects: object.effects ? structuredClone(object.effects) : undefined,
})

const restoreCopy = (object: GameObject, snapshot: CopySnapshot) => {
  object.name = snapshot.name
  object.printedName = snapshot.printedName
  object.types = [...snapshot.types]
  object.subtypes = [...snapshot.subtypes]
  object.supertypes = [...snapshot.supertypes]
  object.manaCost = snapshot.manaCost
  object.manaValue = snapshot.manaValue
  object.colors = [...snapshot.colors]
  object.power = snapshot.power
  object.toughness = snapshot.toughness
  object.printedLoyalty = snapshot.printedLoyalty
  object.oracleText = snapshot.oracleText
  object.grantedRules = [...snapshot.grantedRules]
  object.tapProduces = snapshot.tapProduces ? { ...snapshot.tapProduces } : undefined
  object.effects = snapshot.effects ? structuredClone(snapshot.effects) : undefined
}

export const changeStats = (
  object: GameObject,
  power: number,
  toughness: number,
): ReversibleEffect => {
  if (object.power !== null) object.power += power
  if (object.toughness !== null) object.toughness += toughness
  return { kind: 'pump', power, toughness }
}

const counterBonus = (object: GameObject) => object.counters['+1/+1'] ?? 0

/**
 * CR 613.4c: +1/+1 counters modify power and toughness after a layer 7b set.
 * This engine applies them eagerly instead of storing them, so an `animation`
 * keeps both snapshots free of their contribution and re-derives it from the
 * live counter map. Apply and revert therefore stay inverses even when counters
 * arrive or leave while the animation applies.
 */
const withCounters = (object: GameObject, value: number | null) =>
  value === null ? null : value + counterBonus(object)

const withoutCounters = (object: GameObject, value: number | null) =>
  value === null ? null : value - counterBonus(object)

export const becomeCreature = (
  object: GameObject,
  power: number,
  toughness: number,
): ReversibleEffect => {
  const before = {
    types: [...object.types],
    power: withoutCounters(object, object.power),
    toughness: withoutCounters(object, object.toughness),
  }
  if (!object.types.includes('Creature')) object.types.push('Creature')
  object.power = withCounters(object, power)
  object.toughness = withCounters(object, toughness)
  return {
    kind: 'animation',
    before,
    after: {
      types: [...object.types],
      power,
      toughness,
    },
  }
}

export const grantOracleLine = (
  object: GameObject,
  line: string,
): ReversibleEffect | undefined => {
  const alreadyGranted = (object.continuousEffects ?? []).some(
    ({ effect }) => effect.kind === 'oracleLine' && effect.line === line,
  )
  if (object.oracleText.split('\n').includes(line)) {
    return alreadyGranted ? { kind: 'oracleLine', line } : undefined
  }
  object.oracleText = object.oracleText
    ? `${object.oracleText}\n${line}`
    : line
  return { kind: 'oracleLine', line }
}

export const addTypes = (
  object: GameObject,
  ...types: string[]
): ReversibleEffect => {
  const before = [...object.types]
  object.types = [...new Set([...object.types, ...types])]
  return { kind: 'typeChange', before, after: [...object.types] }
}

/** Enduring-style return: drop Creature and P/T; keep other types (e.g. Enchantment). */
export const returnAsEnchantmentOnly = (object: GameObject) => {
  object.types = [...new Set([
    ...object.types.filter((type) => type !== 'Creature'),
    'Enchantment',
  ])]
  object.power = null
  object.toughness = null
}

export type LoseAbilitiesBecomeParams = {
  extraSubtype: string
  power: number
  toughness: number
}

export const loseAbilitiesBecome = (
  object: GameObject,
  { extraSubtype, power, toughness }: LoseAbilitiesBecomeParams,
): ReversibleEffect => {
  const before = {
    oracleText: object.oracleText,
    grantedRules: [...object.grantedRules],
    effects: object.effects?.length
      ? serializableEffects(object.effects)
      : undefined,
    subtypes: [...object.subtypes],
    power: withoutCounters(object, object.power),
    toughness: withoutCounters(object, object.toughness),
  }
  object.oracleText = ''
  object.grantedRules = []
  object.effects = []
  object.subtypes = [...new Set([...object.subtypes, extraSubtype])]
  if (object.power !== null) object.power = withCounters(object, power)
  if (object.toughness !== null) object.toughness = withCounters(object, toughness)
  return { kind: 'loseAbilitiesBecome', before, extraSubtype, power, toughness }
}

export const copyObject = (
  object: GameObject,
  copied: GameObject,
  extra: { notLegendary?: boolean } = {},
): ReversibleEffect => {
  const before = snapshotCopy(object)
  applyCopy(object, copied, extra)
  return { kind: 'copy', before, after: snapshotCopy(object) }
}

const baseEffects = (object: GameObject) =>
  object.effects && object.effects.length > 0 ? object.effects : effectsFor(object.name)

const triggersMatch = (left: CardEffect, right: CardEffect) =>
  JSON.stringify(left) === JSON.stringify(right)

export const grantTrigger = (
  object: GameObject,
  trigger: Extract<CardEffect, { op: 'trigger' }>,
  sourceId: string,
  grantId: string,
): ReversibleEffect => {
  const stamped = structuredClone(trigger)
  object.effects = [...baseEffects(object), stamped]
  return { kind: 'triggerGrant', sourceId, grantId, trigger: stamped }
}

export const grantTriggerWhileSourceOnBattlefield = (
  object: GameObject,
  trigger: Extract<CardEffect, { op: 'trigger' }>,
  sourceId: string,
  grantId: string,
) => withDuration(
  object,
  grantTrigger(object, trigger, sourceId, grantId),
  { kind: 'whileSourceOnBattlefield', sourceId },
)

export const changeController = (
  object: GameObject,
  controller: PlayerId,
): ReversibleEffect => {
  const existing = (object.continuousEffects ?? [])
    .find(({ effect }) => effect.kind === 'controller')
  const base = existing?.effect.kind === 'controller'
    ? existing.effect.base
    : object.controller
  object.controller = controller
  return { kind: 'controller', controller, base }
}

const withDuration = (
  object: GameObject,
  effect: ReversibleEffect | undefined,
  duration: EffectDuration,
) => {
  if (!effect) return
  object.continuousEffects = [
    ...(object.continuousEffects ?? []),
    { effect, duration },
  ]
}

export const untilEndOfTurn = (
  object: GameObject,
  effect: ReversibleEffect | undefined,
) => withDuration(object, effect, { kind: 'untilCleanup' })

export const changeControllerPermanent = (
  object: GameObject,
  controller: PlayerId,
) => withDuration(object, changeController(object, controller), { kind: 'permanent' })
export const permanent = (
  object: GameObject,
  effect: ReversibleEffect | undefined,
) => withDuration(object, effect, { kind: 'permanent' })

export const whileSourceTappedAndPowerAtMost = (
  state: GameState,
  object: GameObject,
  effect: ReversibleEffect | undefined,
  sourceId: string,
) => {
  if (!effect) return
  const duration = {
    kind: 'whileSourceTappedAndPowerAtMost' as const,
    sourceId,
  }
  // CR 611.2b: a "for as long as" effect does nothing if its duration
  // never starts; do not leave even a momentary control change behind.
  if (!durationHolds(state, object, duration, false)) {
    revertUnregisteredEffect(object, effect)
    return
  }
  withDuration(object, effect, duration)
}

export const changeStatsUntilEndOfTurn = (
  object: GameObject,
  power: number,
  toughness: number,
) => untilEndOfTurn(object, changeStats(object, power, toughness))

export const animateUntilEndOfTurn = (
  object: GameObject,
  power: number,
  toughness: number,
) => untilEndOfTurn(object, becomeCreature(object, power, toughness))

export const pumpWhileSourceOnBattlefield = (
  object: GameObject,
  power: number,
  toughness: number,
  sourceId: string,
) => withDuration(
  object,
  changeStats(object, power, toughness),
  { kind: 'whileSourceOnBattlefield', sourceId },
)

export const animateWhileSourceOnBattlefield = (
  object: GameObject,
  power: number,
  toughness: number,
  sourceId: string,
) => withDuration(
  object,
  becomeCreature(object, power, toughness),
  { kind: 'whileSourceOnBattlefield', sourceId },
)

export const grantOracleLineUntilEndOfTurn = (
  object: GameObject,
  line: string,
) => untilEndOfTurn(object, grantOracleLine(object, line))

const hasGoadFrom = (object: GameObject, sourceController: PlayerId) =>
  (object.continuousEffects ?? []).some(
    ({ effect }) =>
      effect.kind === 'goad' && effect.sourceController === sourceController,
  )

export const goadUntilEndOfTurn = (object: GameObject, sourceController: PlayerId) => {
  untilEndOfTurn(object, { kind: 'goad', sourceController })
}

export const goadPermanent = (object: GameObject, sourceController: PlayerId) => {
  if (hasGoadFrom(object, sourceController)) return
  withDuration(object, { kind: 'goad', sourceController }, { kind: 'permanent' })
}

export const copyUntilEndOfTurn = (
  object: GameObject,
  copied: GameObject,
  extra: { notLegendary?: boolean } = {},
) => untilEndOfTurn(object, copyObject(object, copied, extra))

export const linkedExileCardIds = (state: GameState, source: GameObject) =>
  (source.exiledCards ?? []).filter((id) => {
    const card = state.objects[id]
    return card?.zone === 'exile' && card.exiledWith === source.id
  })

const objectSupportsPumpPerLinkedExile = (object: GameObject) =>
  object.zone === 'battlefield'
  && object.types.includes('Creature')
  && object.power !== null
  && object.toughness !== null

const removeLastOracleLine = (object: GameObject, line: string) => {
  const lines = object.oracleText.split('\n')
  const index = lines.lastIndexOf(line)
  if (index < 0) return
  lines.splice(index, 1)
  object.oracleText = lines.join('\n')
}

const objectSupportsCdaLifePt = (object: GameObject) =>
  zoneHasPowerToughness(object.zone)
  && (object.types.includes('Creature') || object.power !== null || object.toughness !== null)

const durationHolds = (
  state: GameState,
  object: GameObject,
  duration: EffectDuration,
  endTurnEffects: boolean,
) => {
  if (duration.kind === 'cdaLifePt') {
    return objectSupportsCdaLifePt(object)
  }
  if (duration.kind === 'pumpPerLinkedExile') {
    return objectSupportsPumpPerLinkedExile(object)
  }
  if (object.zone !== 'battlefield') return false
  if (duration.kind === 'untilCleanup') return !endTurnEffects
  if (duration.kind === 'permanent') return true
  const source = state.objects[duration.sourceId]
  if (duration.kind === 'whileSourceOnBattlefield') {
    return source?.zone === 'battlefield'
  }
  return Boolean(
    source
    && source.zone === 'battlefield'
    && source.tapped
    && object.power !== null
    && source.power !== null
    && object.power <= source.power,
  )
}

const effectHolds = (
  state: GameState,
  object: GameObject,
  entry: NonNullable<GameObject['continuousEffects']>[number],
  endTurnEffects: boolean,
) =>
  durationHolds(state, object, entry.duration, endTurnEffects)
  && (
    entry.effect.kind !== 'controller'
    || (
      Boolean(state.players[entry.effect.controller])
      && !state.players[entry.effect.controller].lost
    )
  )

const revertEffect = (object: GameObject, effect: ReversibleEffect) => {
  if (effect.kind === 'pump') {
    if (object.power !== null) object.power -= effect.power
    if (object.toughness !== null) object.toughness -= effect.toughness
  } else if (effect.kind === 'animation') {
    object.types = [...effect.before.types]
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'cdaLifePt') {
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'pumpPerLinkedExile') {
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'oracleLine') {
    removeLastOracleLine(object, effect.line)
  } else if (effect.kind === 'typeChange') {
    object.types = [...effect.before]
  } else if (effect.kind === 'loseAbilitiesBecome') {
    object.oracleText = effect.before.oracleText
    object.grantedRules = [...effect.before.grantedRules]
    object.effects = effect.before.effects
      ? serializableEffects(effect.before.effects)
      : undefined
    object.subtypes = [...effect.before.subtypes]
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'copy') {
    restoreCopy(object, effect.before)
  } else if (effect.kind === 'goad') {
    // Status only; combat reads continuousEffects directly.
  } else if (effect.kind === 'encoreAttack') {
    // combat restriction metadata only
  } else if (effect.kind === 'triggerGrant') {
    const effects = object.effects ?? []
    const index = effects.findIndex((entry) => triggersMatch(entry, effect.trigger))
    if (index < 0) return
    const next = [...effects]
    next.splice(index, 1)
    if (next.length > 0) object.effects = next
    else delete object.effects
  }
}

const applyStoredEffect = (object: GameObject, effect: ReversibleEffect) => {
  if (effect.kind === 'pump') {
    if (object.power !== null) object.power += effect.power
    if (object.toughness !== null) object.toughness += effect.toughness
  } else if (effect.kind === 'animation') {
    object.types = [...effect.after.types]
    object.power = withCounters(object, effect.after.power)
    object.toughness = withCounters(object, effect.after.toughness)
  } else if (effect.kind === 'cdaLifePt') {
    object.power = withCounters(object, effect.after.power)
    object.toughness = withCounters(object, effect.after.toughness)
  } else if (effect.kind === 'pumpPerLinkedExile') {
    object.power = withCounters(object, effect.after.power)
    object.toughness = withCounters(object, effect.after.toughness)
  } else if (effect.kind === 'oracleLine') {
    if (!object.oracleText.split('\n').includes(effect.line)) {
      object.oracleText = object.oracleText
        ? `${object.oracleText}\n${effect.line}`
        : effect.line
    }
  } else if (effect.kind === 'typeChange') {
    object.types = [...effect.after]
  } else if (effect.kind === 'loseAbilitiesBecome') {
    object.oracleText = ''
    object.grantedRules = []
    object.effects = []
    object.subtypes = [...new Set([...object.subtypes, effect.extraSubtype])]
    if (object.power !== null) object.power = withCounters(object, effect.power)
    if (object.toughness !== null) object.toughness = withCounters(object, effect.toughness)
  } else if (effect.kind === 'copy') {
    restoreCopy(object, effect.after)
  } else if (effect.kind === 'goad') {
    // Status only; combat reads continuousEffects directly.
  } else if (effect.kind === 'encoreAttack') {
    // combat restriction metadata only
  } else if (effect.kind === 'triggerGrant') {
    const effects = baseEffects(object)
    if (!effects.some((entry) => triggersMatch(entry, effect.trigger))) {
      object.effects = [...effects, structuredClone(effect.trigger)]
    }
  } else if (effect.kind === 'protectionFromEverything') {
    // Status only; targeting reads continuousEffects directly.
  } else if (effect.kind === 'controller' && object.zone === 'battlefield') {
    object.controller = effect.controller
  }
}

const lastControlEffect = (effects: GameObject['continuousEffects']) => {
  for (let index = (effects?.length ?? 0) - 1; index >= 0; index -= 1) {
    const effect = effects?.[index].effect
    if (effect?.kind === 'controller') return effect
  }
}

const revertUnregisteredEffect = (object: GameObject, effect: ReversibleEffect) => {
  revertEffect(object, effect)
  if (effect.kind !== 'controller' || object.zone !== 'battlefield') return
  const activeControl = lastControlEffect(object.continuousEffects)
  object.controller = activeControl?.controller ?? effect.base
}

const resetEffects = (
  object: GameObject,
  effects: NonNullable<GameObject['continuousEffects']>,
) => {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    revertEffect(object, effects[index].effect)
  }
  const control = effects.find(({ effect }) => effect.kind === 'controller')
  if (control?.effect.kind === 'controller' && object.zone === 'battlefield') {
    object.controller = control.effect.base
  }
}

/**
 * Drop or rewrite stored effects, then reapply the survivors in stored order so
 * anything recorded after a rewritten entry still lands on top of it.
 * Returning the same entry leaves it, and its applied result, untouched.
 */
export const reviseContinuousEffects = (
  object: GameObject,
  revise: (entry: ContinuousEffect) => ContinuousEffect | undefined,
) => {
  const effects = object.continuousEffects ?? []
  const revised = effects.flatMap((entry) => revise(entry) ?? [])
  if (
    revised.length === effects.length
    && revised.every((entry, index) => entry === effects[index])
  ) return

  resetEffects(object, effects)
  for (const entry of revised) applyStoredEffect(object, entry.effect)

  if (revised.length > 0) object.continuousEffects = revised
  else delete object.continuousEffects
}

const expireEffects = (
  state: GameState,
  object: GameObject,
  endTurnEffects: boolean,
) => {
  const effects = object.continuousEffects ?? []
  const remaining = effects.filter((entry) =>
    endTurnEffects
      ? entry.duration.kind !== 'untilCleanup'
      : effectHolds(state, object, entry, false))
  if (remaining.length === effects.length) return false

  resetEffects(object, effects)
  for (const entry of remaining) applyStoredEffect(object, entry.effect)

  if (remaining.length > 0) object.continuousEffects = remaining
  else delete object.continuousEffects
  return true
}

const hasExpiredEffects = (state: GameState) =>
  Object.values(state.objects).some((object) =>
    (object.continuousEffects ?? []).some(
      (entry) => !effectHolds(state, object, entry, false),
    ))

const cdaLifePtEntry = (object: GameObject) =>
  object.continuousEffects?.find(({ effect, duration }) =>
    effect.kind === 'cdaLifePt' && duration.kind === 'cdaLifePt')

export const lifeTotalForCda = (
  state: GameState,
  object: GameObject,
  who: 'controller' | 'owner',
) => state.players[who === 'controller' ? object.controller : object.owner]?.life ?? 0

const makeCdaLifePtEffect = (
  object: GameObject,
  who: 'controller' | 'owner',
  life: number,
): ReversibleEffect => {
  const before = {
    power: withoutCounters(object, object.power),
    toughness: withoutCounters(object, object.toughness),
  }
  object.power = withCounters(object, life)
  object.toughness = withCounters(object, life)
  return {
    kind: 'cdaLifePt',
    who,
    before,
    after: { power: life, toughness: life },
  }
}

/** Install or refresh the layer-7a life CDA on one object from its stamped static effect. */
export const refreshCdaLifePt = (
  state: GameState,
  object: GameObject,
  who: 'controller' | 'owner',
) => {
  const life = lifeTotalForCda(state, object, who)
  const active = objectSupportsCdaLifePt(object)
  const existing = cdaLifePtEntry(object)

  if (!active) {
    if (existing) {
      reviseContinuousEffects(object, (entry) =>
        entry === existing ? undefined : entry)
    }
    return
  }

  if (!existing) {
    withDuration(
      object,
      makeCdaLifePtEffect(object, who, life),
      { kind: 'cdaLifePt' },
    )
    return
  }

  if (
    existing.effect.kind === 'cdaLifePt'
    && existing.effect.after.power === life
    && existing.effect.after.toughness === life
    && existing.effect.who === who
  ) return

  reviseContinuousEffects(object, (entry) => {
    if (entry !== existing || existing.effect.kind !== 'cdaLifePt') return entry
    return {
      ...entry,
      effect: { ...existing.effect, who, after: { power: life, toughness: life } },
    }
  })
}

const pumpPerLinkedExileEntry = (object: GameObject) =>
  object.continuousEffects?.find(({ effect, duration }) =>
    effect.kind === 'pumpPerLinkedExile' && duration.kind === 'pumpPerLinkedExile')

const expectedPumpPerLinkedExileAfter = (
  before: { power: number | null; toughness: number | null },
  linked: number,
  perCard: { power: number; toughness: number },
) => ({
  power: (before.power ?? 0) + linked * perCard.power,
  toughness: (before.toughness ?? 0) + linked * perCard.toughness,
})

/** True when the stamped per-linked-exile pump does not match live exiledCards. */
export const pumpPerLinkedExileOutOfSync = (
  state: GameState,
  object: GameObject,
  perCard: { power: number; toughness: number },
) => {
  const linked = linkedExileCardIds(state, object).length
  const active = objectSupportsPumpPerLinkedExile(object)
  const existing = pumpPerLinkedExileEntry(object)
  if (!active) return existing !== undefined
  if (!existing || existing.effect.kind !== 'pumpPerLinkedExile') return true
  const nextAfter = expectedPumpPerLinkedExileAfter(existing.effect.before, linked, perCard)
  return (
    existing.effect.after.power !== nextAfter.power
    || existing.effect.after.toughness !== nextAfter.toughness
    || existing.effect.perCard.power !== perCard.power
    || existing.effect.perCard.toughness !== perCard.toughness
  )
}

const makePumpPerLinkedExileEffect = (
  object: GameObject,
  perCard: { power: number; toughness: number },
  linked: number,
): ReversibleEffect => {
  const bonusPower = linked * perCard.power
  const bonusToughness = linked * perCard.toughness
  const before = {
    power: withoutCounters(object, object.power),
    toughness: withoutCounters(object, object.toughness),
  }
  object.power = withCounters(object, (before.power ?? 0) + bonusPower)
  object.toughness = withCounters(object, (before.toughness ?? 0) + bonusToughness)
  return {
    kind: 'pumpPerLinkedExile',
    perCard,
    before,
    after: {
      power: (before.power ?? 0) + bonusPower,
      toughness: (before.toughness ?? 0) + bonusToughness,
    },
  }
}

/** Install or refresh +N/+N per card exiled with this permanent. */
export const refreshPumpPerLinkedExile = (
  state: GameState,
  object: GameObject,
  perCard: { power: number; toughness: number },
) => {
  const linked = linkedExileCardIds(state, object).length
  const active = objectSupportsPumpPerLinkedExile(object)
  const existing = pumpPerLinkedExileEntry(object)

  if (!active) {
    if (existing) {
      reviseContinuousEffects(object, (entry) =>
        entry === existing ? undefined : entry)
    }
    return
  }

  if (!existing) {
    withDuration(
      object,
      makePumpPerLinkedExileEffect(object, perCard, linked),
      { kind: 'pumpPerLinkedExile' },
    )
    return
  }

  if (!pumpPerLinkedExileOutOfSync(state, object, perCard)) return

  if (existing.effect.kind !== 'pumpPerLinkedExile') return
  const before = existing.effect.before
  const nextAfter = expectedPumpPerLinkedExileAfter(before, linked, perCard)

  reviseContinuousEffects(object, (entry) => {
    if (entry !== existing || entry.effect.kind !== 'pumpPerLinkedExile') return entry
    return {
      ...entry,
      effect: { ...entry.effect, perCard, after: nextAfter },
    }
  })
}

export const continuousEffects: Plugin = {
  id: 'continuousEffects',
  apply: ({ event, draft }) => {
    const endTurnEffects = event.type === 'custom'
      && event.name === 'advanceStep'
      && draft.step === 'cleanup'
    if (event.type === 'custom' && event.name === EXPIRE_EFFECTS) {
      for (const object of Object.values(draft.objects)) {
        expireEffects(draft, object, false)
      }
      return
    }
    for (const object of Object.values(draft.objects)) {
      expireEffects(draft, object, endTurnEffects)
    }
  },
  // Recheck after every reducer pass so a condition changed by a later plugin
  // expires before the game next reaches a stable priority window.
  sba: ({ draft }) =>
    hasExpiredEffects(draft)
      ? [{ type: 'custom', name: EXPIRE_EFFECTS }]
      : [],
}
