import type { TriggerBindingIf, ZoneId } from '../types'
import type { CardCondition, CardEffect, CardInstruction, PlayerFilter, TargetFilter } from './effectDefinitions'

export type TriggerOptions = {
  filter?: TargetFilter
  player?: 'you' | 'opponent' | 'any' | PlayerFilter
  from?: ZoneId | ZoneId[]
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

/** Declarative trigger on a kernel event type (`discard`, `draw`, `end`, …). */
export const triggerOn = (
  on: Extract<CardEffect, { op: 'trigger' }>['on'],
  options: TriggerOptions & { do: CardInstruction[] },
): CardEffect => trigger(on, options, ...options.do)
