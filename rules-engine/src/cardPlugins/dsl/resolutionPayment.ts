import type { CapturedObject, GameState, ManaId, PlayerId } from '../../types'
import type { Cost, ResolutionCost } from './schema/v2'
import { activatedPermissionFields, activationPermission, beginActivatedAnnouncement, lockedManaCost } from './compiler/announcement'
import { canonicalManaAbilityForTap } from './manaPrograms'
import { evaluateObjectReference, evaluateObjectSelector, type RuleDslRuntimeContext } from './compiler'
import { manaModes, tapForManaError } from '../../plugins/mana'
import { payCost } from '../../plugins/spells'

export const resolutionManaCost = (cost: ResolutionCost) => {
  switch (cost.kind) {
    case 'mana': return cost
    case 'manaAndLife': return { kind: 'mana' as const, amount: cost.mana }
    default: return undefined
  }
}

export const resolutionCostLabel = (cost: ResolutionCost, amount: number) => {
  switch (cost.kind) {
    case 'mana': return cost.amount
    case 'manaAndLife': return `${cost.mana} and ${amount} life`
    default: return cost.kind
  }
}

export type ResolutionPaymentBindings = Pick<RuleDslRuntimeContext, 'targets' | 'targetLegality' | 'choices' | 'results' | 'variables' | 'scopeId' | 'occurrence' | 'capturedOccurrence' | 'capturedOccurrenceBindings'>

export type ResolutionManaActivation =
  | {
    kind: 'activateAbility'
    objectId: string
    abilityId: string
    label: string
  }
  | {
    kind: 'tapForMana'
    objectId: string
    mana?: ManaId
    label: string
  }

export const resolutionPaymentCandidates = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'discard' | 'sacrifice' }>,
  source: CapturedObject,
  bindings: ResolutionPaymentBindings = {},
) => {
  const runtime = {
    state,
    controller: payer,
    source,
    ...bindings,
  }
  const candidates = cost.kind === 'sacrifice' && cost.filter.kind !== 'objects'
    ? evaluateObjectReference(cost.filter, runtime)
    : evaluateObjectSelector(cost.filter as Extract<typeof cost.filter, { kind: 'objects' }>, runtime)
  let zone: 'hand' | 'battlefield'
  switch (cost.kind) {
    case 'discard': zone = 'hand'; break
    case 'sacrifice': zone = 'battlefield'; break
  }
  return candidates.filter((object) => object.controller === payer && object.zone === zone)
}

/** Pays a resolution mana cost from the ordinary pool; cast-only restrictions do not apply. */
export const payResolutionMana = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'mana' }>,
  _source: CapturedObject,
  bindings: ResolutionPaymentBindings = {},
) => {
  // Resolution payments are not spell casts.  Restricted mana whose effect
  // says it may be spent only to cast a qualifying spell therefore cannot be
  // consumed merely because the parent source happens to be a spell.
  const pool = state.players[payer]?.mana
  const amount = lockedManaCost({ mandatory: [cost] }, bindings.variables?.X ?? 0)
  const paid = pool ? payCost(pool, amount) : null
  return paid ? { pool: paid, restrictedMana: state.players[payer].restrictedMana ?? [] } : null
}

export const canPayResolutionMana = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'mana' }>,
  source: CapturedObject,
  bindings: ResolutionPaymentBindings = {},
) => Boolean(payResolutionMana(state, payer, cost, source, bindings))

export const eligibleResolutionManaAbilities = (
  state: GameState,
  payer: PlayerId,
) => Object.values(state.objects).flatMap<ResolutionManaActivation>((object) => {
  if (object.controller !== payer || object.phasedOut) return []
  const canonicalMana = canonicalManaAbilityForTap(object)
  if (canonicalMana && object.ruleDefinition) {
    const ability = canonicalMana.ability
    const error = activationPermission({
      state,
      sourceId: object.id,
      payer,
      action: 'nestedPayment',
      ...activatedPermissionFields(ability),
    })
    if (error) return []
    const announcement = beginActivatedAnnouncement(state, object, payer, ability, [], undefined, undefined, { targetClauses: [] })
    if (!announcement.ok) return []
    return [{ kind: 'activateAbility' as const, objectId: object.id, abilityId: `$.abilities[${canonicalMana.index}]`, label: `Activate ${object.name}` }]
  }
  if (object.zone !== 'battlefield') return []
  const permissionError = activationPermission({ state, sourceId: object.id, payer, action: 'tapForMana' })
  if (permissionError) return []
  const modes = manaModes(object, state)
  return modes.flatMap((mode) => {
    const mana = Object.keys(mode)[0] as ManaId | undefined
    if (!mana || tapForManaError(state, payer, object.id, modes.length === 1 ? undefined : mana)) return []
    return [{
      kind: 'tapForMana' as const,
      objectId: object.id,
      ...(modes.length === 1 ? {} : { mana }),
      label: `Tap ${object.name} for ${mana}`,
    }]
  })
})
