import type {
  CopySnapshot,
  EffectDuration,
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  ReversibleEffect,
} from '../types'
import { applyCopy } from './effectRuntime'

const EXPIRE_EFFECTS = 'continuousEffects.expire'

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

export const becomeCreature = (
  object: GameObject,
  power: number,
  toughness: number,
): ReversibleEffect => {
  const before = {
    types: [...object.types],
    power: object.power,
    toughness: object.toughness,
  }
  const counterBonus = object.counters['+1/+1'] ?? 0
  const pumpEffects = (object.continuousEffects ?? [])
    .map(({ effect }) => effect)
    .filter((effect) => effect.kind === 'pump')
  const finalPower = power
    + counterBonus
    + pumpEffects.reduce((total, effect) => total + effect.power, 0)
  const finalToughness = toughness
    + counterBonus
    + pumpEffects.reduce((total, effect) => total + effect.toughness, 0)
  if (!object.types.includes('Creature')) object.types.push('Creature')
  object.power = finalPower
  object.toughness = finalToughness
  return {
    kind: 'animation',
    before,
    after: {
      types: [...object.types],
      power: finalPower,
      toughness: finalToughness,
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

export const copyObject = (
  object: GameObject,
  copied: GameObject,
  extra: { notLegendary?: boolean } = {},
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

export const copyUntilEndOfTurn = (
  object: GameObject,
  copied: GameObject,
  extra: { notLegendary?: boolean } = {},
) => untilEndOfTurn(object, copyObject(object, copied, extra))

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
) => {
  if (object.zone !== 'battlefield') return false
  if (duration.kind === 'untilCleanup') return !endTurnEffects
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
    object.power = effect.before.power
    object.toughness = effect.before.toughness
  } else if (effect.kind === 'oracleLine') {
    removeLastOracleLine(object, effect.line)
  } else if (effect.kind === 'typeChange') {
    object.types = [...effect.before]
  } else if (effect.kind === 'copy') {
    restoreCopy(object, effect.before)
  }
}

const applyStoredEffect = (object: GameObject, effect: ReversibleEffect) => {
  if (effect.kind === 'pump') {
    if (object.power !== null) object.power += effect.power
    if (object.toughness !== null) object.toughness += effect.toughness
  } else if (effect.kind === 'animation') {
    object.types = [...effect.after.types]
    object.power = effect.after.power
    object.toughness = effect.after.toughness
  } else if (effect.kind === 'oracleLine') {
    if (!object.oracleText.split('\n').includes(effect.line)) {
      object.oracleText = object.oracleText
        ? `${object.oracleText}\n${effect.line}`
        : effect.line
    }
  } else if (effect.kind === 'typeChange') {
    object.types = [...effect.after]
  } else if (effect.kind === 'copy') {
    restoreCopy(object, effect.after)
  } else if (object.zone === 'battlefield') {
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

export const removeContinuousEffects = (
  object: GameObject,
  remove: (entry: NonNullable<GameObject['continuousEffects']>[number]) => boolean,
) => {
  const effects = object.continuousEffects ?? []
  const remaining = effects.filter((entry) => !remove(entry))
  if (remaining.length === effects.length) return

  resetEffects(object, effects)
  for (const entry of remaining) applyStoredEffect(object, entry.effect)

  if (remaining.length > 0) object.continuousEffects = remaining
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
