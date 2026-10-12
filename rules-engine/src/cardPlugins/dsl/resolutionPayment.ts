import type { CapturedObject, GameState, PlayerId } from '../../types'
import { paySpellCostForResolution } from '../../plugins/spells'
import type { Cost } from './schema/v1'
import { evaluateObjectSelector } from './compiler/runtime'

export const resolutionPaymentCandidates = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'discard' | 'sacrifice' }>,
  source: CapturedObject,
) => evaluateObjectSelector(cost.filter, {
  state,
  controller: payer,
  source,
}).filter((object) => object.controller === payer && object.zone === (cost.kind === 'discard' ? 'hand' : 'battlefield'))

/** Reuses the spell payment implementation, including restricted mana eligibility. */
export const payResolutionMana = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'mana' }>,
  source: CapturedObject,
) => paySpellCostForResolution(state, payer, source.snapshot, cost.amount)

export const canPayResolutionMana = (
  state: GameState,
  payer: PlayerId,
  cost: Extract<Cost, { kind: 'mana' }>,
  source: CapturedObject,
) => Boolean(payResolutionMana(state, payer, cost, source))

