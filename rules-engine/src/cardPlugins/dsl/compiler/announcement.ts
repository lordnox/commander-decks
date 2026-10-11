import { payCost } from '../../../plugins/spells'
import type { Cost, TargetClause } from '../schema/v1'
import type { GameState, ManaId, ManaPool, PlayerId, TargetRef } from '../../../types'

/** A mana unit committed by a proposal. `sourceId` is deliberately unique. */
export type AnnouncementManaPayment = {
  sourceId: string
  mana: ManaId
  amount?: number
}

export type CostPlan = {
  mandatory: readonly Cost[]
  optional?: readonly Cost[]
  alternative?: readonly Cost[]
  increases?: readonly ManaCostIncrease[]
  reductions?: readonly ManaCostReduction[]
}

export type ManaCostIncrease = { amount: string; reason?: string }
export type ManaCostReduction = { generic: number; reason?: string }

export type AnnouncementProposal = {
  payer: PlayerId
  sourceId: string
  targetClauses?: readonly TargetClause[]
  targets?: readonly (readonly TargetRef[])[]
  variables?: Readonly<Partial<Record<'X', number>>>
  costs: CostPlan
  payment?: readonly AnnouncementManaPayment[]
  /** Sources already authorized by the active ability/permission check. */
  eligibleManaSources?: readonly string[]
  /** Optional client answer; the server still rechecks all candidates. */
  selectedOptional?: readonly number[]
  selectedAlternative?: number
}

export type LockedAnnouncementCost = {
  mana?: string
  nonMana: readonly Cost[]
  x?: number
}

export type AnnouncementTransaction = {
  readonly id: string
  readonly proposal: AnnouncementProposal
  readonly lockedCost: LockedAnnouncementCost
  readonly payment: readonly AnnouncementManaPayment[]
  readonly status: 'provisional' | 'committed' | 'rolledBack'
  readonly waitingFor?: 'proposal' | 'targets' | 'payment' | 'replacement'
}

export type AnnouncementValidation =
  | { ok: true; transaction: AnnouncementTransaction }
  | { ok: false; error: string; transaction?: AnnouncementTransaction }

export type PrepareActionOffer = {
  kind: 'prepareAction'
  action: 'cast' | 'activate' | 'tapForMana'
  sourceId: string
  payer: PlayerId
  targetClauses: readonly TargetClause[]
  lockedCost?: LockedAnnouncementCost
  requiresInput: boolean
}

export type ManaAbilityKind = 'mana' | 'nonMana' | 'triggeredMana'

export type ManaAbilityClassification = {
  kind: ManaAbilityKind
  isManaAbility: boolean
  /** CR 605.1a: an activated ability that could add mana. */
  addsMana: boolean
  /** CR 605.1b: a triggered ability that could add mana. */
  triggered: boolean
}

export const classifyManaAbility = (input: {
  addsMana?: boolean
  triggered?: boolean
  abilityKind?: 'activated' | 'triggered' | 'static'
  hasOtherInstruction?: boolean
}): ManaAbilityClassification => {
  const addsMana = input.addsMana === true
  const triggered = input.triggered === true || input.abilityKind === 'triggered'
  // A trigger is a mana ability only when its trigger condition and effect meet
  // CR 605.1b; merely mentioning addMana in an unrelated program is insufficient.
  const isManaAbility = addsMana && !input.hasOtherInstruction
    && (input.abilityKind === 'activated' || triggered)
  return {
    kind: isManaAbility ? (triggered ? 'triggeredMana' : 'mana') : 'nonMana',
    isManaAbility,
    addsMana,
    triggered,
  }
}

const integer = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`)
}

const sumMana = (payments: readonly AnnouncementManaPayment[]): ManaPool => {
  const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  const seen = new Set<string>()
  for (const payment of payments) {
    if (seen.has(payment.sourceId)) throw new TypeError(`mana source ${payment.sourceId} is used twice`)
    seen.add(payment.sourceId)
    const amount = payment.amount ?? 1
    integer(amount, `payment from ${payment.sourceId}`)
    pool[payment.mana] += amount
  }
  return pool
}

const validatePaymentSources = (proposal: AnnouncementProposal) => {
  if (!proposal.eligibleManaSources) return
  const eligible = new Set(proposal.eligibleManaSources)
  for (const payment of proposal.payment ?? []) {
    if (!eligible.has(payment.sourceId)) throw new TypeError(`mana source ${payment.sourceId} is not eligible for this payment`)
  }
}

const genericMana = (mana: string) => [...mana.matchAll(/\{(\d+)\}/g)]
  .reduce((total, match) => total + Number(match[1]), 0)

const lockedManaCost = (plan: CostPlan) => {
  const mana = [
    ...(plan.mandatory.filter((cost): cost is Extract<Cost, { kind: 'mana' }> => cost.kind === 'mana').map((cost) => cost.amount)),
    ...(plan.optional ?? []).filter((cost): cost is Extract<Cost, { kind: 'mana' }> => cost.kind === 'mana').map((cost) => cost.amount),
    ...(plan.increases ?? []).map((increase) => increase.amount),
  ].join('')
  const genericReduction = (plan.reductions ?? []).reduce((total, reduction) => {
    integer(reduction.generic, 'generic reduction')
    return total + reduction.generic
  }, 0)
  if (genericReduction === 0) return mana
  const generic = Math.max(0, genericMana(mana) - genericReduction)
  const nonGeneric = mana.replaceAll(/\{\d+\}/g, '')
  return `${generic > 0 ? `{${generic}}` : ''}${nonGeneric}`
}

const selectedCosts = (proposal: AnnouncementProposal) => {
  const optional = (proposal.selectedOptional ?? []).map((index) => proposal.costs.optional?.[index])
  if (optional.some((cost) => !cost)) throw new TypeError('optional cost selection is out of range')
  const alternative = proposal.selectedAlternative === undefined
    ? proposal.costs.mandatory
    : proposal.costs.alternative?.length
      ? proposal.costs.alternative
      : undefined
  if (!alternative) throw new TypeError('alternative cost selection is unavailable')
  return [...alternative, ...(optional as Cost[])]
}

const validateVariables = (variables: AnnouncementProposal['variables']) => {
  const x = variables?.X
  if (x !== undefined) integer(x, 'X')
}

const targetIdentity = (target: TargetRef) => {
  switch (target.kind) {
    case 'player': return `player:${target.player}`
    case 'stackItem': return `stack:${target.stackId}`
    case 'object': return `object:${target.objectId}:${target.incarnation ?? ''}:${target.zone ?? ''}`
  }
}

const validateTargets = (proposal: AnnouncementProposal) => {
  if (!proposal.targetClauses) return
  const targets = proposal.targets ?? []
  if (targets.length !== proposal.targetClauses.length) throw new TypeError('target clauses must be supplied in declaration order')
  targets.forEach((clauseTargets, index) => {
    const clause = proposal.targetClauses![index]
    const min = clause.min.kind === 'constant' ? clause.min.value : undefined
    const max = clause.max.kind === 'constant' ? clause.max.value : undefined
    if (min !== undefined && clauseTargets.length < min) throw new TypeError(`target clause ${index} has too few targets`)
    if (max !== undefined && clauseTargets.length > max) throw new TypeError(`target clause ${index} has too many targets`)
    if (new Set(clauseTargets.map(targetIdentity)).size !== clauseTargets.length) throw new TypeError(`target clause ${index} contains a duplicate target`)
  })
}

/** Validate and lock an announcement without changing the supplied GameState. */
export const beginAnnouncement = (
  state: Pick<GameState, 'players'>,
  proposal: AnnouncementProposal,
  id = 'announcement',
): AnnouncementValidation => {
  try {
    validateVariables(proposal.variables)
    validateTargets(proposal)
    validatePaymentSources(proposal)
    if (!state.players[proposal.payer]) return { ok: false, error: `unknown payer ${proposal.payer}` }
    const costs = selectedCosts(proposal)
    const plan: CostPlan = { mandatory: costs, increases: proposal.costs.increases, reductions: proposal.costs.reductions }
    const mana = lockedManaCost(plan)
    const payment = proposal.payment ?? []
    const pool = sumMana(payment)
    if (mana && !payCost(pool, mana)) return { ok: false, error: 'payment does not cover the locked total cost' }
    const transaction: AnnouncementTransaction = {
      id,
      proposal: structuredClone(proposal),
      lockedCost: { ...(mana ? { mana } : {}), nonMana: costs.filter((cost) => cost.kind !== 'mana'), ...(proposal.variables?.X !== undefined ? { x: proposal.variables.X } : {}) },
      payment: structuredClone(payment),
      status: 'provisional',
    }
    return { ok: true, transaction }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const commitAnnouncement = (transaction: AnnouncementTransaction): AnnouncementTransaction => {
  if (transaction.status !== 'provisional') throw new Error('announcement transaction is no longer provisional')
  return { ...transaction, status: 'committed' }
}

export const rollbackAnnouncement = (transaction: AnnouncementTransaction): AnnouncementTransaction => {
  if (transaction.status !== 'provisional') throw new Error('announcement transaction is no longer provisional')
  return { ...transaction, status: 'rolledBack' }
}

export const paymentFrame = (transaction: AnnouncementTransaction) => ({
  transactionId: transaction.id,
  lockedCost: transaction.lockedCost,
  payment: transaction.payment,
  /** Replacement choices belong to this frame; they cannot mutate the proposal. */
  replacementChoices: [] as readonly string[],
})

export const prepareAction = (
  state: Pick<GameState, 'players'>,
  input: Omit<PrepareActionOffer, 'kind' | 'requiresInput'> & { proposal?: AnnouncementProposal },
): PrepareActionOffer => ({
  kind: 'prepareAction',
  action: input.action,
  sourceId: input.sourceId,
  payer: input.payer,
  targetClauses: input.targetClauses,
  ...(input.proposal ? (() => {
    const result = beginAnnouncement(state, input.proposal)
    return result.ok ? { lockedCost: result.transaction.lockedCost } : {}
  })() : {}),
  requiresInput: input.proposal === undefined || (input.targetClauses.length > 0 && input.proposal.targets === undefined),
})

export type ActivationPermissionInput = {
  state: Pick<GameState, 'objects' | 'stack' | 'active' | 'step'>
  sourceId: string
  payer: PlayerId
  action: 'activate' | 'tapForMana' | 'nestedPayment' | 'manaPlanning'
  sorcerySpeed?: boolean
}

/** Shared gate used before ordinary, mana, nested-payment, and planning activations. */
export const activationPermission = (input: ActivationPermissionInput): string | undefined => {
  const source = input.state.objects[input.sourceId]
  if (!source) return 'activation source does not exist'
  if (source.zone !== 'battlefield') return `${source.name} is not on the battlefield`
  if (source.phasedOut) return `${source.name} is phased out`
  if (source.controller !== input.payer) return `${input.payer} does not control ${source.name}`
  if (input.action === 'tapForMana' && source.tapped) return `${source.name} is already tapped`
  if (input.sorcerySpeed && (
    input.state.active !== input.payer
    || !['precombatMain', 'postcombatMain'].includes(input.state.step)
    || input.state.stack.length > 0
  )) return `${source.name} can be activated only as a sorcery`
  return undefined
}

