import type { CapturedObject, GameState, PlayerId } from '../../types'
import type { Cost } from './schema/v1'
import { activationPermission, beginActivatedAnnouncement } from './compiler/announcement'
import { canonicalManaClassification } from '../activated'
import { compileCardRuleDefinition, evaluateObjectSelector, type RuleDslRuntimeContext } from './compiler'
import { payCost } from '../../plugins/spells'

export type ResolutionPaymentBindings = Pick<RuleDslRuntimeContext, 'targets' | 'targetLegality' | 'choices' | 'results' | 'variables' | 'scopeId' | 'occurrence'>

export type ResolutionManaActivation = {
  objectId: string
  abilityId: string
  label: string
}

export const resolutionPaymentCandidates = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'discard' | 'sacrifice' }>,
  source: CapturedObject,
  bindings: ResolutionPaymentBindings = {},
) => {
  const candidates = evaluateObjectSelector(cost.filter, {
    state,
    controller: payer,
    source,
    ...bindings,
  })
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
) => {
  // Resolution payments are not spell casts.  Restricted mana whose effect
  // says it may be spent only to cast a qualifying spell therefore cannot be
  // consumed merely because the parent source happens to be a spell.
  const pool = state.players[payer]?.mana
  const paid = pool ? payCost(pool, cost.amount) : null
  return paid ? { pool: paid, restrictedMana: state.players[payer].restrictedMana ?? [] } : null
}

export const canPayResolutionMana = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'mana' }>,
  source: CapturedObject,
) => Boolean(payResolutionMana(state, payer, cost, source))

export const eligibleResolutionManaAbilities = (
  state: GameState,
  payer: PlayerId,
) => Object.values(state.objects).flatMap((object) => {
  if (object.controller !== payer || object.zone !== 'battlefield' || object.phasedOut || !object.ruleDefinition) return []
  const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
  return compiled.definition.abilities.flatMap((ability, index) => {
    if (ability.kind !== 'activated' || !canonicalManaClassification(ability).isManaAbility) return []
    const error = activationPermission({
      state,
      sourceId: object.id,
      payer,
      action: 'nestedPayment',
      sorcerySpeed: ability.timing === 'sorcery',
      availableFrom: ability.availableFrom,
    })
    if (error) return []
    const announcement = beginActivatedAnnouncement(state, object, payer, ability, [], undefined, undefined, { targetClauses: [] })
    if (!announcement.ok) return []
    return [{ objectId: object.id, abilityId: `$.abilities[${index}]`, label: `Activate ${object.name}` }]
  })
})
