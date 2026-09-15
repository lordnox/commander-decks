import { payCost } from './spells'
import type { GameEvent, HookCtx, Plugin } from '../types'

export type ActivateAbilityEvent = Extract<GameEvent, { type: 'activateAbility' }>

export type AbilityCtx = HookCtx & { event: ActivateAbilityEvent }

export type AbilityCheck = (ctx: AbilityCtx) => string | void

const isActivate = (
  ctx: HookCtx,
  abilityId: string,
): ctx is AbilityCtx =>
  ctx.event.type === 'activateAbility'
  && ctx.event.abilityId === abilityId
  && (!ctx.rule.sourceId || ctx.rule.sourceId === ctx.event.objectId)

export const sourceOf = (ctx: AbilityCtx) => ctx.state.objects[ctx.event.objectId]

export const whenAbility = (abilityId: string, ...checks: AbilityCheck[]): Plugin['legal'] =>
  (ctx) => {
    if (!isActivate(ctx, abilityId)) return
    for (const check of checks) {
      const error = check(ctx)
      if (error) return error
    }
  }

export const applyAbility = (
  abilityId: string,
  apply: (ctx: AbilityCtx) => void,
): Plugin['apply'] =>
  (ctx) => {
    if (!isActivate(ctx, abilityId)) return
    apply(ctx)
  }

export const sourceNamed = (name: string): AbilityCheck => (ctx) => {
  const source = sourceOf(ctx)
  if (!source || source.name !== name) return `that is not ${name}`
}

export const sourceOnBattlefield = (): AbilityCheck => (ctx) => {
  const source = sourceOf(ctx)
  if (!source) return 'no such object'
  if (source.zone !== 'battlefield') return `${source.name} is not on the battlefield`
}

export const controlledByActivator = (): AbilityCheck => (ctx) => {
  const source = sourceOf(ctx)
  if (!source) return 'no such object'
  if (source.controller !== ctx.event.seat) {
    return `${ctx.event.seat} does not control ${source.name}`
  }
}

export const sourceCanTap = (): AbilityCheck => (ctx) => {
  const source = sourceOf(ctx)
  if (!source) return 'no such object'
  if (source.tapped) return `${source.name} is already tapped`
  if (source.types.includes('Creature') && source.summoningSickness) {
    return `${source.name} has summoning sickness`
  }
}

export const canPay = (manaCost: string): AbilityCheck => (ctx) => {
  const pool = ctx.state.players[ctx.event.seat]?.mana
  if (!pool || !payCost(pool, manaCost)) {
    return `not enough mana to activate ${sourceOf(ctx)?.name ?? 'that ability'}`
  }
}

/** This activated ability is a mana ability: the host must mark the event. */
export const asManaAbility = (): AbilityCheck => (ctx) => {
  if (!ctx.event.manaAbility) {
    return `${sourceOf(ctx)?.name ?? 'that ability'} is a mana ability`
  }
}

/**
 * Always-on timing for activateAbility.
 * Mana abilities skip priority; the host owns that window.
 * Other activations need priority.
 */
const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'activateAbility') return
  if (event.manaAbility) return
  if (state.priority !== event.seat) {
    return `${event.seat} does not have priority to activate`
  }
}

export const abilities: Plugin = { id: 'abilities', legal }
