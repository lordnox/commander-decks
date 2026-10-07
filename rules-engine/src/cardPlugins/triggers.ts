import type { TriggerBindingIf, ZoneId } from '../types'
import type { CardCondition, CardEffect, CardInstruction, ModalSpec, PlayerFilter, TargetFilter } from './effectDefinitions'

export const onBecomesMonstrous = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'becomesMonstrous',
  do: instructions,
})

export type TriggerOptions = {
  filter?: TargetFilter
  player?: 'you' | 'opponent' | 'any' | PlayerFilter
  from?: ZoneId | ZoneId[]
  nthThisTurn?: number
  if?: CardCondition | TriggerBindingIf
  targets?: Extract<CardEffect, { op: 'trigger' }>['targets']
  onceEachTurn?: boolean
}

/** Shared event binding; matching is separate from the instructions run on resolution. */
export const trigger = (
  on: Extract<CardEffect, { op: 'trigger' }>['on'],
  options: TriggerOptions,
  ...instructions: CardInstruction[]
): Extract<CardEffect, { op: 'trigger' }> => ({
  op: 'trigger',
  on: options.filter && on === 'enters' ? 'permanentEnters'
    : options.filter && on === 'dies' ? 'permanentDies'
      : options.filter && on === 'leaves' ? 'permanentLeaves' : on,
  do: instructions,
  ...(options.filter ? { watch: options.filter } : {}),
  ...(options.player ? { player: options.player } : {}),
  ...(options.from ? { from: options.from } : {}),
  ...(options.nthThisTurn !== undefined ? { nthThisTurn: options.nthThisTurn } : {}),
  ...(options.if ? { if: options.if } : {}),
  ...(options.targets ? { targets: options.targets } : {}),
  ...(options.onceEachTurn ? { onceEachTurn: true } : {}),
})

export type EntersOptions = TriggerOptions & {
  /** Watch any entering permanent matching this filter, including the source. */
  filter: TargetFilter
  /** Require token creation, excluding ordinary entry such as permanent spell copies (CR 111.13). */
  createdOnly?: boolean
}

/** Without options, trigger on the source's own entry; with a filter, watch matching permanents. */
export function enters(...instructions: CardInstruction[]): CardEffect

export function enters(options: EntersOptions, ...instructions: CardInstruction[]): CardEffect

export function enters(
  ...args: [EntersOptions, ...CardInstruction[]] | CardInstruction[]
): CardEffect {
  const first = args[0]
  if (first && !('kind' in first)) {
    const [options, ...instructions] = args as [EntersOptions, ...CardInstruction[]]
    return trigger(options.createdOnly ? 'tokenCreated' : 'permanentEnters', options, ...instructions)
  }
  return { op: 'trigger', on: 'enters', do: args as CardInstruction[] }
}

export const entersTargeting = (
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: { filter },
  do: instructions,
})

export const entersTargetingUpTo = (
  max: number,
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: { filter, min: 0, max },
  do: instructions,
})

export const entersTargetingUpToOne = (
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => entersTargetingUpTo(1, filter, ...instructions)

export const entersIfCastOption = (
  castOption: string,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  do: instructions,
  if: { kind: 'castOption', id: castOption },
})

export const entersTargetingOpponent = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: 'opponent',
  do: instructions,
})

export const entersTarget = (
  filter: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'enters',
  targets: { filter },
  do: instructions,
})

export function dies(...instructions: CardInstruction[]): CardEffect

export function dies(options: TriggerOptions, ...instructions: CardInstruction[]): CardEffect

export function dies(...args: Array<TriggerOptions | CardInstruction>): CardEffect {
  const first = args[0]
  if (first && !('kind' in first)) {
    return trigger('permanentDies', { ...first, filter: first.filter ?? {} }, ...args.slice(1) as CardInstruction[])
  }
  return trigger('dies', {}, ...args as CardInstruction[])
}

/** When this dies as a creature, return under its owner's control as a noncreature enchantment. */
export const diesReturnAsEnchantment = (): CardEffect => ({
  op: 'trigger',
  on: 'dies',
  if: { kind: 'wasCreature' },
  do: [{ kind: 'returnSelfAsEnchantment' }],
})

/**
 * CR 702.79 persist: when this dies, if it had no -1/-1 counters on it, return
 * it under its owner's control with a -1/-1 counter. The condition is checked
 * against last-known information when the trigger is put on the stack.
 */
export const persist = (): CardEffect => ({
  op: 'trigger',
  on: 'dies',
  if: { kind: 'lacksCounter', counter: '-1/-1' },
  do: [{ kind: 'returnSelfWithCounter', counter: '-1/-1' }],
})

export function leaves(...instructions: CardInstruction[]): CardEffect

export function leaves(options: TriggerOptions, ...instructions: CardInstruction[]): CardEffect

export function leaves(...args: Array<TriggerOptions | CardInstruction>): CardEffect {
  const first = args[0]
  if (first && !('kind' in first)) {
    return trigger('permanentLeaves', { ...first, filter: first.filter ?? {} }, ...args.slice(1) as CardInstruction[])
  }
  return trigger('leaves', {}, ...args as CardInstruction[])
}

/** Exile from any zone; options select watched objects, while no options watches the source itself. */
export function exiled(...instructions: CardInstruction[]): CardEffect

export function exiled(options: TriggerOptions, ...instructions: CardInstruction[]): CardEffect

export function exiled(...args: Array<TriggerOptions | CardInstruction>): CardEffect {
  const first = args[0]
  if (first && !('kind' in first)) {
    return trigger('exiled', { ...first, filter: first.filter ?? {} }, ...args.slice(1) as CardInstruction[])
  }
  return trigger('exiled', {}, ...args as CardInstruction[])
}

export const draws = (options: TriggerOptions, ...instructions: CardInstruction[]): CardEffect =>
  trigger('draw', { player: 'you', ...options }, ...instructions)

export const discards = (options: TriggerOptions, ...instructions: CardInstruction[]): CardEffect =>
  trigger('discard', { player: 'you', ...options }, ...instructions)

export const landfall = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  do: instructions,
})

export const landfallOnceEachTurn = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  do: instructions,
  onceEachTurn: true,
})

export const landfallResolveNth = (
  nth: number,
  base: CardInstruction[],
  alternate: CardInstruction[],
): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  do: base,
  whenResolvedNth: { nth, do: alternate },
})

export const landfallTargeting = (
  targets: Extract<CardEffect, { op: 'trigger' }>['targets'],
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'landfall',
  targets,
  do: instructions,
})

/** "Whenever players finish voting", for any vote at the table. */
export const onVotesFinished = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'votesFinished',
  do: instructions,
})

export const onUnlock = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'unlock',
  do: instructions,
})

export const attacks = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'attacks',
  do: instructions,
})

/** Annihilator N: whenever this attacks, the defending player sacrifices N permanents of their choice. */
export const annihilator = (count: number): CardEffect =>
  attacks({ kind: 'defendingPlayerSacrifices', count })

/**
 * Whenever a permanent matching `watch` enters, whether or not it is the source.
 * `watch.controller` is relative to the source's controller.
 */
export const permanentEnters = (
  watch: TargetFilter,
  options: { if?: CardCondition; do: CardInstruction[] },
): CardEffect => enters({ filter: watch, if: options.if }, ...options.do)

/** Whenever a permanent matching `watch` is sacrificed; the player who sacrificed it is the triggering player. */
export const permanentSacrificed = (
  watch: TargetFilter,
  ...instructions: CardInstruction[]
): CardEffect => trigger('permanentSacrificed', { filter: watch }, ...instructions)

export const landToGraveyard = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landToGraveyard',
  do: instructions,
})

export const landToGraveyardOnce = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'landToGraveyard',
  do: instructions,
  firstTimeEachTurn: true,
})

/** Declarative trigger on a kernel event type (`discard`, `draw`, `end`, …). */
export const triggerOn = (
  on: Extract<CardEffect, { op: 'trigger' }>['on'],
  options: TriggerOptions & { do: CardInstruction[] },
): CardEffect => trigger(on, options, ...options.do)

export const upkeep = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
})

export const yourUpkeep = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
  if: { kind: 'controllerIsActive' },
})

export const yourFirstMain = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'precombatMain',
  do: instructions,
  if: { kind: 'controllerIsActive' },
})

export const yourUpkeepTarget = (
  filter: TargetFilter,
  instructions: CardInstruction[],
): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
  if: { kind: 'controllerIsActive' },
  targets: { filter },
})

export const yourUpkeepIf = (
  condition: CardCondition,
  ...instructions: CardInstruction[]
): CardEffect => ({
  op: 'trigger',
  on: 'upkeep',
  do: instructions,
  if: condition,
})

type CastFilters = TriggerOptions & {
  creatureOnly?: boolean
  noncreatureOnly?: boolean
  castBy?: 'opponent'
}

const castFilters = (options: CastFilters = {}): TriggerOptions => ({
  ...options,
  player: options.player ?? (options.castBy === 'opponent' ? 'opponent' : 'you'),
  filter: {
    ...(options.creatureOnly ? { type: 'Creature' } : {}),
    ...(options.noncreatureOnly ? { noncreature: true } : {}),
    ...options.filter,
  },
})

/** Accept options first, or the legacy options-last form. */
export const casts = (...args: Array<CardInstruction | CastFilters>): CardEffect => {
  const first = args[0]
  const last = args.at(-1)
  const options = first && !('kind' in first)
    ? args.shift() as CastFilters
    : last && !('kind' in last) ? args.pop() as CastFilters : {}
  return trigger('cast', castFilters(options), ...args as CardInstruction[])
}

export const castModal = (modal: ModalSpec, options: CastFilters = {}): CardEffect => ({
  ...trigger('cast', castFilters(options)),
  modal,
})

export const yourEndTargetingOpponent = (...instructions: CardInstruction[]): CardEffect => ({
  op: 'trigger',
  on: 'end',
  targets: 'opponent',
  do: instructions,
  if: { kind: 'controllerIsActive' },
})
