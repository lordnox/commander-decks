import type {
  ContinuousEffect,
  CopySnapshot,
  EffectDuration,
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  ReversibleEffect,
} from '../types'
import { copiableColors, reapplyColorChanges } from './colorEffects'
import { expirePreventionInstances } from '../replacement/prevention'
import { counterPtBonus } from '../definitions'
import { applyCopy } from './effectRuntime'
import { printedStaticAbilityActive } from './dsl/staticModifierCore'
import { KEYWORDS } from './dsl/schema/v2'

const EXPIRE_EFFECTS = 'continuousEffects.expire'

export const snapshotCopy = (object: GameObject): CopySnapshot => ({
  name: object.name,
  printedName: object.printedName,
  types: [...object.types],
  subtypes: [...object.subtypes],
  supertypes: [...object.supertypes],
  manaCost: object.manaCost,
  manaValue: object.manaValue,
  colors: copiableColors(object),
  power: object.power,
  toughness: object.toughness,
  printedLoyalty: object.printedLoyalty,
  oracleText: object.oracleText,
  grantedRules: [...object.grantedRules],
  tapProduces: object.tapProduces ? { ...object.tapProduces } : undefined,
  ...(object.ruleDefinition ? { ruleDefinition: structuredClone(object.ruleDefinition) } : {}),
})

const restoreCopy = (object: GameObject, snapshot: CopySnapshot) => {
  object.name = snapshot.name
  object.printedName = snapshot.printedName
  object.types = [...snapshot.types]
  object.subtypes = [...snapshot.subtypes]
  object.supertypes = [...snapshot.supertypes]
  object.manaCost = snapshot.manaCost
  object.manaValue = snapshot.manaValue
  object.colors = snapshot.colors
  object.power = snapshot.power
  object.toughness = snapshot.toughness
  object.printedLoyalty = snapshot.printedLoyalty
  object.oracleText = snapshot.oracleText
  object.grantedRules = [...snapshot.grantedRules]
  object.tapProduces = snapshot.tapProduces ? { ...snapshot.tapProduces } : undefined
  if (snapshot.ruleDefinition) object.ruleDefinition = structuredClone(snapshot.ruleDefinition)
  else delete object.ruleDefinition
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

/**
 * CR 613.4c: +1/+1 and -1/-1 counters modify power and toughness after a layer 7b set.
 * This engine applies them eagerly instead of storing them, so an `animation`
 * keeps both snapshots free of their contribution and re-derives it from the
 * live counter map. Apply and revert therefore stay inverses even when counters
 * arrive or leave while the animation applies.
 */
const withCounters = (object: GameObject, value: number | null) =>
  value === null ? null : value + counterPtBonus(object)

const withoutCounters = (object: GameObject, value: number | null) =>
  value === null ? null : value - counterPtBonus(object)

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
  extra: Parameters<typeof applyCopy>[2] = {},
): ReversibleEffect => {
  const before = snapshotCopy(object)
  applyCopy(object, copied, extra)
  return { kind: 'copy', before, after: snapshotCopy(object) }
}

export const changeController = (
  object: GameObject,
  controller: PlayerId,
): ReversibleEffect => {
  const existing = (object.continuousEffects ?? [])
    .find(({ effect }) => effect.kind === 'controller')
  const base = existing?.effect.kind === 'controller'
    ? existing.effect.base
    : object.controller
  if (object.controller !== controller) {
    // CR 302.6: the new controller has not controlled it since their turn began.
    // CR 506.4: a permanent that changes controllers leaves combat.
    object.summoningSickness = true
    object.attacking = null
    object.blocking = null
  }
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
  extra: Parameters<typeof applyCopy>[2] = {},
) => untilEndOfTurn(object, copyObject(object, copied, extra))

export const linkedExileCardIds = (state: GameState, source: GameObject) =>
  (source.exiledCards ?? []).filter((id) => {
    const card = state.objects[id]
    return card?.zone === 'exile' && card.exiledWith === source.id
  })

const removeLastOracleLine = (object: GameObject, line: string) => {
  const lines = object.oracleText.split('\n')
  const index = lines.lastIndexOf(line)
  if (index < 0) return
  lines.splice(index, 1)
  object.oracleText = lines.join('\n')
}

const durationHolds = (
  state: GameState,
  object: GameObject,
  duration: EffectDuration,
  endTurnEffects: boolean,
  anyZone = false,
) => {
  switch (duration.kind) {
    case 'printedStatic': {
      const source = state.objects[duration.sourceId]
      return Boolean(source
        && !source.phasedOut
        && source.incarnation === duration.sourceIncarnation
        && printedStaticAbilityActive(state, source, duration.abilityIndex))
    }
    default: break
  }
  if (!anyZone && object.zone !== 'battlefield' && !(object.zone === 'stack' && duration.kind === 'whileControlUnchanged')) return false
  switch (duration.kind) {
    case 'whileControlUnchanged': return object.controller === duration.controller
    case 'untilCleanup': return !endTurnEffects
    case 'permanent': return true
    case 'whileSourceOnBattlefield': {
      const source = state.objects[duration.sourceId]
      return Boolean(source
        && source.zone === 'battlefield'
        && (duration.sourceIncarnation === undefined || source.incarnation === duration.sourceIncarnation))
    }
    case 'forTurns':
      return state.turn < duration.untilTurn
    case 'untilStep': {
      if (duration.notBeforeTurn !== undefined) {
        if (state.turn < duration.notBeforeTurn) return true
        return !(state.step === duration.step
          && (duration.active === undefined || duration.active === state.active))
      }
      if (state.turn < duration.turn) return true
      if (state.turn > duration.turn) return false
      return !(state.step === duration.step
        && (duration.active === undefined || duration.active === state.active))
    }
    case 'whileSourceTappedAndPowerAtMost': {
      const source = state.objects[duration.sourceId]
      return Boolean(
        source
        && source.zone === 'battlefield'
        && source.tapped
        && object.power !== null
        && source.power !== null
        && object.power <= source.power,
      )
    }
  }
}

const canonicalGrantHolds = (
  state: GameState,
  object: GameObject,
  grant: Omit<NonNullable<GameObject['canonicalGrantedAbilities']>[number], 'ability'>,
  endTurnEffects: boolean,
) => {
  if (object.zone !== 'battlefield') return false
  if (grant.printedStatic) {
    const source = state.objects[grant.sourceId]
    if (!source || !printedStaticAbilityActive(state, source, grant.printedStatic.abilityIndex)) return false
  }
  switch (grant.duration.kind) {
    case 'permanent': return true
    case 'untilCleanup': return !endTurnEffects
    case 'forTurns': return state.turn < (grant.untilTurn ?? grant.createdTurn + 1)
    case 'untilStep': {
      const deadlineTurn = grant.untilStepTurn ?? grant.createdTurn
      if (grant.untilStepNotBeforeTurn !== undefined) {
        if (state.turn < grant.untilStepNotBeforeTurn) return true
        return !(state.step === grant.duration.step
          && (grant.untilStepActive === undefined || grant.untilStepActive === state.active))
      }
      if (state.turn < deadlineTurn) return true
      if (state.turn > deadlineTurn) return false
      return !(state.step === grant.duration.step
        && (grant.untilStepActive === undefined || grant.untilStepActive === state.active))
    }
    case 'whileSourceOnBattlefield': {
      const source = state.objects[grant.sourceId]
      return Boolean(source
        && source.zone === 'battlefield'
        && source.incarnation === grant.sourceIncarnation)
    }
  }
}

const expireCanonicalGrants = (
  state: GameState,
  object: GameObject,
  endTurnEffects: boolean,
) => {
  if (object.canonicalGrantedActivations) object.canonicalGrantedActivations = object.canonicalGrantedActivations.filter(grant => canonicalGrantHolds(state, object, grant, endTurnEffects))
  const grants = object.canonicalGrantedAbilities
  if (!grants) return false
  const remaining = grants.filter((grant) => canonicalGrantHolds(state, object, grant, endTurnEffects))
  if (remaining.length === grants.length) return false
  if (remaining.length > 0) object.canonicalGrantedAbilities = remaining
  else delete object.canonicalGrantedAbilities
  return true
}

const effectHolds = (
  state: GameState,
  object: GameObject,
  entry: NonNullable<GameObject['continuousEffects']>[number],
  endTurnEffects: boolean,
) =>
  durationHolds(state, object, entry.duration, endTurnEffects, entry.effect.kind === 'colorChange' || ((entry.effect.kind === 'addTypes' || entry.effect.kind === 'bestowAura') && entry.duration.kind === 'printedStatic') || (entry.effect.kind === 'setPt' && entry.effect.cda === true)
    || (entry.effect.kind === 'staticKeywords' && entry.effect.grant.includes(KEYWORDS.flash)))
  && (entry.effect.kind !== 'colorChange' || entry.effect.incarnation === object.incarnation)
  && (entry.effect.kind !== 'staticKeywords' || entry.effect.incarnation === undefined || entry.effect.incarnation === object.incarnation)
  && (
    entry.effect.kind !== 'controller'
    || (
      Boolean(state.players[entry.effect.controller])
      && !state.players[entry.effect.controller].lost
    )
  )

const revertEffect = (object: GameObject, effect: ReversibleEffect) => {
  switch (effect.kind) {
    case 'colorChange':
      object.colors = effect.before
      return
    default: break
  }
  if (effect.kind === 'removeAbilities') {
    object.oracleText = effect.before.oracleText
    object.grantedRules = [...effect.before.grantedRules]
  } else if (effect.kind === 'addTypes') {
    object.types = [...effect.before.types]
    object.subtypes = [...effect.before.subtypes]
  } else if (effect.kind === 'pump') {
    if (object.power !== null) object.power -= effect.power
    if (object.toughness !== null) object.toughness -= effect.toughness
  } else if (effect.kind === 'animation') {
    object.types = [...effect.before.types]
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'setPt') {
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'oracleLine') {
    removeLastOracleLine(object, effect.line)
  } else if (effect.kind === 'typeChange') {
    object.types = [...effect.before]
  } else if (effect.kind === 'bestowAura') {
    object.types = [...effect.before.types]
    object.subtypes = [...effect.before.subtypes]
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'loseAbilitiesBecome') {
    object.oracleText = effect.before.oracleText
    object.grantedRules = [...effect.before.grantedRules]
    object.subtypes = [...effect.before.subtypes]
    object.power = withCounters(object, effect.before.power)
    object.toughness = withCounters(object, effect.before.toughness)
  } else if (effect.kind === 'copy') {
    restoreCopy(object, effect.before)
  } else if (effect.kind === 'goad') {
    // Status only; combat reads continuousEffects directly.
  } else if (effect.kind === 'regenerationShield' || effect.kind === 'encoreAttack' || effect.kind === 'mustAttackPlayer') {
    // combat restriction metadata only
  } else if (effect.kind === 'subtypeGrant') {
    // Status only; land-type readers inspect continuousEffects.
  }
}

const applyStoredEffect = (object: GameObject, effect: ReversibleEffect) => {
  switch (effect.kind) {
    case 'colorChange':
      // Rebase survivors after an earlier color effect expires.
      effect.before = object.colors
      object.colors = effect.after
      return
    default: break
  }
  if (effect.kind === 'removeAbilities') {
    effect.before = { oracleText: object.oracleText, grantedRules: [...object.grantedRules] }
    object.oracleText = ''
    object.grantedRules = []
    object.effects = []
  } else if (effect.kind === 'addTypes') {
    effect.before = { types: [...object.types], subtypes: [...object.subtypes] }
    object.types = [...new Set([...object.types, ...effect.types])]
    object.subtypes = [...new Set([...object.subtypes, ...effect.subtypes])]
  } else if (effect.kind === 'pump') {
    if (object.power !== null) object.power += effect.power
    if (object.toughness !== null) object.toughness += effect.toughness
  } else if (effect.kind === 'animation') {
    object.types = [...effect.after.types]
    object.power = withCounters(object, effect.after.power)
    object.toughness = withCounters(object, effect.after.toughness)
  } else if (effect.kind === 'setPt') {
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
  } else if (effect.kind === 'bestowAura') {
    effect.before = {
      types: [...object.types],
      subtypes: [...object.subtypes],
      power: withoutCounters(object, object.power),
      toughness: withoutCounters(object, object.toughness),
    }
    object.types = [...new Set([...object.types.filter(type => type !== 'Creature'), 'Enchantment'])]
    object.subtypes = ['Aura']
    object.power = null
    object.toughness = null
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
  } else if (effect.kind === 'regenerationShield' || effect.kind === 'encoreAttack' || effect.kind === 'mustAttackPlayer') {
    // combat restriction metadata only
  } else if (effect.kind === 'subtypeGrant') {
    // Status only; land-type readers inspect continuousEffects.
  } else if (effect.kind === 'protectionFromEverything') {
    // Status only; targeting reads continuousEffects directly.
  } else if (effect.kind === 'controller' && object.zone === 'battlefield') {
    object.controller = effect.controller
  }
}

const applyStoredEffects = (object: GameObject, entries: readonly ContinuousEffect[]) => {
  for (const entry of entries) {
    if (entry.effect.kind !== 'colorChange') applyStoredEffect(object, entry.effect)
  }
  for (const entry of entries) {
    if (entry.effect.kind === 'colorChange') applyStoredEffect(object, entry.effect)
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
  if (effect.kind === 'copy') reapplyColorChanges(object)
  if (effect.kind !== 'controller' || object.zone !== 'battlefield') return
  const activeControl = lastControlEffect(object.continuousEffects)
  object.controller = activeControl?.controller ?? effect.base
}

const resetEffects = (
  object: GameObject,
  effects: NonNullable<GameObject['continuousEffects']>,
) => {
  // Undo layer 5 before layer 1, independently of creation order.
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    if (effects[index].effect.kind === 'colorChange') revertEffect(object, effects[index].effect)
  }
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    if (effects[index].effect.kind !== 'colorChange') revertEffect(object, effects[index].effect)
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
  applyStoredEffects(object, revised)

  if (revised.length > 0) object.continuousEffects = revised
  else delete object.continuousEffects
}

/** Drop or rewrite stored-effect order, then reapply so later stamps still sit on top. */
export const reorderContinuousEffects = (
  object: GameObject,
  order: (effects: readonly ContinuousEffect[]) => ContinuousEffect[],
) => {
  const effects = object.continuousEffects ?? []
  const next = order(effects)
  if (next.length === effects.length && next.every((entry, index) => entry === effects[index])) return
  resetEffects(object, effects)
  applyStoredEffects(object, next)
  if (next.length > 0) object.continuousEffects = next
  else delete object.continuousEffects
}

/** Layer 7b set-P/T with independent power and toughness (CR 613.4b). */
export const setStats = (
  object: GameObject,
  power: number,
  toughness: number,
) => {
  const before = {
    power: withoutCounters(object, object.power),
    toughness: withoutCounters(object, object.toughness),
  }
  object.power = withCounters(object, power)
  object.toughness = withCounters(object, toughness)
  return { kind: 'setPt' as const, before, after: { power, toughness } }
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
  applyStoredEffects(object, remaining)

  if (remaining.length > 0) object.continuousEffects = remaining
  else delete object.continuousEffects
  return true
}

const hasExpiredEffects = (state: GameState) =>
  Object.values(state.objects).some((object) =>
    (object.continuousEffects ?? []).some(
      (entry) => !effectHolds(state, object, entry, false),
    ))

export const continuousEffects: Plugin = {
  id: 'continuousEffects',
  apply: ({ event, draft }) => {
    const endTurnEffects = event.type === 'custom'
      && event.name === 'advanceStep'
      && draft.step === 'cleanup'
    if (event.type === 'custom' && event.name === EXPIRE_EFFECTS) {
      const expired = expirePreventionInstances(draft, false)
      draft.preventionInstances = expired.preventionInstances
      for (const object of Object.values(draft.objects)) {
        expireEffects(draft, object, false)
        expireCanonicalGrants(draft, object, false)
      }
      return
    }
    const expired = expirePreventionInstances(draft, endTurnEffects)
    draft.preventionInstances = expired.preventionInstances
    for (const object of Object.values(draft.objects)) {
      expireEffects(draft, object, endTurnEffects)
      expireCanonicalGrants(draft, object, endTurnEffects)
    }
  },
  // Recheck after every reducer pass so a condition changed by a later plugin
  // expires before the game next reaches a stable priority window.
  recompute: ({ draft }) =>
    hasExpiredEffects(draft)
      || Object.values(draft.objects).some((object) =>
        [...(object.canonicalGrantedAbilities ?? []), ...(object.canonicalGrantedActivations ?? [])].some((grant) => !canonicalGrantHolds(draft, object, grant, false)))
      ? [{ type: 'custom', name: EXPIRE_EFFECTS }]
      : [],
}
