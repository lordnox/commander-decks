import { payCost } from '../../../plugins/spells'
import type { ActivatedAbilityDefinition, Amount, Cost, SpellAbilityDefinition, TargetClause } from '../schema/v1'
import type { GameState, ManaId, ManaPool, PlayerId, TargetRef } from '../../../types'
import { captureObject } from '../../../objectIdentity'
import { evaluateObjectSelector, evaluatePlayerSelector } from './runtime'

/** A mana unit committed by a proposal. `sourceId` is deliberately unique. */
export type AnnouncementManaPayment = {
  sourceId: string
  mana: ManaId
  amount?: number
  restricted?: boolean
}

export type CostPlan = {
  mandatory: readonly Cost[]
  optional?: readonly Cost[]
  alternative?: readonly (readonly Cost[])[]
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
  nonManaChoices?: readonly string[]
  /** Optional client answer; the server still rechecks all candidates. */
  selectedOptional?: readonly number[]
  selectedAlternative?: number
  excludeSourceFromCosts?: boolean
  /** Server-computed generic adjustment from format and legacy cost modifiers. */
  genericAdjustment?: number
  /** Server-only planned payment may lock before mana activations run. */
  deferPayment?: boolean
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
  readonly targetBindings?: readonly import('../../../types').CanonicalTargetBinding[]
  readonly distributionBindings?: readonly import('./modes').DistributionAllocation[]
  readonly modeCount?: number
  readonly distributionBounds?: readonly { total: number; minEach: number }[]
  status: 'provisional' | 'committed' | 'rolledBack'
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
  hasTargets?: boolean
  hasLoyaltyCost?: boolean
  movesCards?: boolean
  triggeredManaEligible?: boolean
}): ManaAbilityClassification => {
  const addsMana = input.addsMana === true
  const triggered = input.triggered === true || input.abilityKind === 'triggered'
  // A trigger is a mana ability only when its trigger condition and effect meet
  // CR 605.1b; merely mentioning addMana in an unrelated program is insufficient.
  // CR 605 allows additional non-library/non-target instructions alongside
  // mana production; only targets, loyalty, and card movement disqualify it.
  const structurallyMana = addsMana
    && !input.hasTargets && !input.hasLoyaltyCost
    && (triggered || !input.movesCards)
  const isManaAbility = structurallyMana && (
    input.abilityKind === 'activated'
      || (triggered && input.triggeredManaEligible === true)
  )
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

const genericMana = (mana: string) => [...mana.matchAll(/\{(\d+)\}/g)]
  .reduce((total, match) => total + Number(match[1]), 0)

const lockedManaCost = (plan: CostPlan, x = 0, genericAdjustment = 0) => {
  const mana = [
    ...(plan.mandatory.filter((cost): cost is Extract<Cost, { kind: 'mana' }> => cost.kind === 'mana').map((cost) => cost.amount)),
    ...(plan.optional ?? []).filter((cost): cost is Extract<Cost, { kind: 'mana' }> => cost.kind === 'mana').map((cost) => cost.amount),
    ...(plan.increases ?? []).map((increase) => increase.amount),
  ].join('').replaceAll('{X}', `{${x}}`)
  const genericReduction = (plan.reductions ?? []).reduce((total, reduction) => {
    integer(reduction.generic, 'generic reduction')
    return total + reduction.generic
  }, 0)
  const generic = Math.max(0, genericMana(mana) + genericAdjustment - genericReduction)
  if (generic === genericMana(mana) && genericReduction === 0) return mana
  const nonGeneric = mana.replaceAll(/\{\d+\}/g, '')
  return `${generic > 0 ? `{${generic}}` : ''}${nonGeneric}`
}

const selectedCosts = (proposal: AnnouncementProposal) => {
  if ((proposal.selectedOptional ?? []).length !== new Set(proposal.selectedOptional ?? []).size) {
    throw new TypeError('optional cost selection contains a duplicate')
  }
  const optional = (proposal.selectedOptional ?? []).map((index) => proposal.costs.optional?.[index])
  if (optional.some((cost) => !cost)) throw new TypeError('optional cost selection is out of range')
  const alternative = proposal.selectedAlternative === undefined
    ? proposal.costs.mandatory
    : proposal.costs.alternative?.[proposal.selectedAlternative]
      ? proposal.costs.alternative[proposal.selectedAlternative]
      : undefined
  if (!alternative) throw new TypeError('alternative cost selection is unavailable')
  return [...alternative, ...(optional as Cost[])]
}

const validateVariables = (variables: AnnouncementProposal['variables']) => {
  const x = variables?.X
  if (x !== undefined) integer(x, 'X')
}

const costAmount = (amount: Amount, x: number | undefined) => {
  if (amount.kind === 'constant') return amount.value
  if (amount.kind === 'variable') {
    if (x === undefined) throw new TypeError(`amount variable ${amount.name} is not bound`)
    return x
  }
  throw new TypeError('cost amount must be a constant or X variable')
}

export const evaluateAnnouncementCostAmount = (amount: Amount, x: number | undefined) => costAmount(amount, x)

const matchesCostFilter = (object: GameState['objects'][string], filter: Extract<Cost, { kind: 'discard' | 'sacrifice' }>['filter']['filter']) => {
  if (filter.zone && object.zone !== filter.zone) return false
  if (filter.type && !object.types.includes(filter.type)) return false
  if (filter.name && object.name !== filter.name) return false
  if (filter.token !== undefined && object.token !== filter.token) return false
  return true
}

const validateNonManaCosts = (state: Pick<GameState, 'players' | 'objects'>, payer: PlayerId, sourceId: string, costs: readonly Cost[], x: number | undefined, choices: readonly string[] | undefined) => {
  let choiceIndex = 0
  let lifeTotal = 0
  const selectedObjects = new Set<string>()
  for (const cost of costs) {
    if (cost.kind === 'life') {
      lifeTotal += costAmount(cost.amount, x)
      continue
    }
    if (cost.kind !== 'discard' && cost.kind !== 'sacrifice') continue
    const requiredZone = cost.kind === 'discard' ? 'hand' : 'battlefield'
    const candidates = Object.values(state.objects).filter((object) => (sourceId === '' || object.id !== sourceId) && object.controller === payer && object.zone === requiredZone && matchesCostFilter(object, cost.filter.filter))
    if (candidates.length < costAmount(cost.count, x)) throw new TypeError(`not enough cards to ${cost.kind} as a cost`)
    const count = costAmount(cost.count, x)
    const selected = choices?.slice(choiceIndex, choiceIndex + count)
    if (!selected || selected.length !== count || new Set(selected).size !== count) throw new TypeError(`${cost.kind} cost needs ${count} distinct selected cards`)
    if (selected.some((id) => !candidates.some((candidate) => candidate.id === id))) throw new TypeError(`illegal ${cost.kind} cost selection`)
    for (const id of selected) {
      if (selectedObjects.has(id)) throw new TypeError(`cost object ${id} is selected more than once`)
      selectedObjects.add(id)
    }
    choiceIndex += count
  }
  if (state.players[payer].life < lifeTotal) throw new TypeError(`payer cannot pay ${lifeTotal} life`)
  if (choices && choiceIndex !== choices.length) throw new TypeError('unused nonmana cost selection')
}

const targetIdentity = (target: TargetRef) => {
  switch (target.kind) {
    case 'player': return `player:${target.player}`
    case 'stackItem': return `stack:${target.stackId}`
    case 'object': return `object:${target.objectId}:${target.incarnation ?? ''}:${target.zone ?? ''}`
  }
}

const validateTargets = (state: Pick<GameState, 'players' | 'objects' | 'stack'>, proposal: AnnouncementProposal) => {
  if (!proposal.targetClauses) return
  const targets = proposal.targets ?? []
  if (targets.length !== proposal.targetClauses.length) throw new TypeError('target clauses must be supplied in declaration order')
  targets.forEach((clauseTargets, index) => {
    const clause = proposal.targetClauses![index]
    const bound = (amount: TargetClause['min']) => {
      if (amount.kind === 'constant') return amount.value
      if (amount.kind === 'variable') return proposal.variables?.[amount.name]
      return undefined
    }
    const min = bound(clause.min)
    const max = bound(clause.max)
    if (min === undefined || max === undefined) throw new TypeError(`target clause ${index} has an unbound cardinality`)
    if (min !== undefined && clauseTargets.length < min) throw new TypeError(`target clause ${index} has too few targets`)
    if (max !== undefined && clauseTargets.length > max) throw new TypeError(`target clause ${index} has too many targets`)
    if (new Set(clauseTargets.map(targetIdentity)).size !== clauseTargets.length) throw new TypeError(`target clause ${index} contains a duplicate target`)
    for (const target of clauseTargets) {
      if (clause.filter.kind === 'players' && target.kind !== 'player') throw new TypeError(`target clause ${index} requires players`)
      if (clause.filter.kind === 'objects' && target.kind !== 'object') throw new TypeError(`target clause ${index} requires objects`)
      if (clause.filter.kind === 'stackItems' && target.kind !== 'stackItem') throw new TypeError(`target clause ${index} requires stack items`)
      switch (target.kind) {
        case 'player':
          if (!state.players[target.player]) throw new TypeError(`target player ${target.player} does not exist`)
          break
        case 'object': {
          const object = state.objects[target.objectId]
          if (!object || (target.incarnation !== undefined && object.incarnation !== target.incarnation)
            || (target.zone !== undefined && object.zone !== target.zone)) throw new TypeError(`target object ${target.objectId} is stale or missing`)
          const filter = clause.filter.kind === 'objects' ? clause.filter.filter : undefined
          if (filter && filter.zone && object.zone !== filter.zone) throw new TypeError(`target object ${target.objectId} does not satisfy its zone filter`)
          if (filter && filter.type && !object.types.includes(filter.type)) throw new TypeError(`target object ${target.objectId} does not satisfy its type filter`)
          if (filter && filter.name && object.name !== filter.name) throw new TypeError(`target object ${target.objectId} does not satisfy its name filter`)
          break
        }
        case 'stackItem':
          if (!state.stack.some((item) => item.id === target.stackId)) throw new TypeError(`target stack item ${target.stackId} is missing`)
          break
      }
    }
  })
}

/** Validate and lock an announcement without changing the supplied GameState. */
export const beginAnnouncement = (
  state: Pick<GameState, 'players' | 'objects' | 'stack'>,
  proposal: AnnouncementProposal,
  id = 'announcement',
): AnnouncementValidation => {
  try {
    validateVariables(proposal.variables)
    validateTargets(state, proposal)
    if (!state.players[proposal.payer]) return { ok: false, error: `unknown payer ${proposal.payer}` }
    const costs = selectedCosts(proposal)
    const plan: CostPlan = { mandatory: costs, increases: proposal.costs.increases, reductions: proposal.costs.reductions }
    validateNonManaCosts(state, proposal.payer, proposal.excludeSourceFromCosts ? proposal.sourceId : '', costs, proposal.variables?.X, proposal.nonManaChoices)
    const mana = lockedManaCost(plan, proposal.variables?.X ?? 0, proposal.genericAdjustment)
    const payment = proposal.payment ?? []
    const pool = sumMana(payment)
    const availableMana = state.players[proposal.payer].mana
    if (!proposal.deferPayment && availableMana) {
      for (const symbol of Object.keys(pool) as ManaId[]) {
        const unrestricted = payment.filter((entry) => !entry.restricted && entry.mana === symbol)
          .reduce((total, entry) => total + (entry.amount ?? 1), 0)
        if (unrestricted > availableMana[symbol]) return { ok: false, error: `payment spends more ${symbol} mana than the payer has` }
      }
    }
    if (!proposal.deferPayment && mana && !payCost(pool, mana)) return { ok: false, error: 'payment does not cover the locked total cost' }
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

/** Build the authoritative proposal used by the canonical spell legal/apply paths. */
export const beginSpellAnnouncement = (
  state: GameState,
  source: { id: string },
  payer: PlayerId,
  ability: SpellAbilityDefinition,
  targets: readonly (readonly TargetRef[])[] | undefined,
  x: number | undefined,
  nonManaChoices?: readonly string[],
  options: { selectedOptional?: readonly number[]; selectedAlternative?: number; genericAdjustment?: number; deferPayment?: boolean; targetClauses?: readonly TargetClause[] } = {},
) => {
  const payment = (Object.entries(state.players[payer].mana) as [ManaId, number][])
    .filter(([, amount]) => amount > 0)
    .map(([mana, amount]) => ({ sourceId: `${payer}.pool.${mana}`, mana, amount }))
    .concat((state.players[payer].restrictedMana ?? []).map((mana, index) => ({
      sourceId: `${mana.sourceId}#${index}`,
      mana: mana.mana,
      amount: 1,
      restricted: true,
    })))
  return beginAnnouncement(state, {
    payer,
    sourceId: source.id,
    targetClauses: options.targetClauses ?? ability.decisions.targets,
    targets,
    ...(ability.decisions.variables?.length ? { variables: { X: x } } : {}),
    costs: {
      mandatory: ability.costs,
      optional: ability.optionalCosts,
      alternative: ability.alternativeCosts,
      increases: ability.costIncreases,
      reductions: ability.costReductions,
    },
    excludeSourceFromCosts: true,
    payment,
    nonManaChoices,
    ...options,
    ...(options.deferPayment ? { deferPayment: true } : {}),
  }, `spell:${source.id}`)
}

export const beginActivatedAnnouncement = (
  state: GameState,
  source: { id: string },
  payer: PlayerId,
  ability: ActivatedAbilityDefinition,
  targets: readonly (readonly TargetRef[])[] | undefined,
  x: number | undefined,
  nonManaChoices?: readonly string[],
  options: { selectedOptional?: readonly number[]; selectedAlternative?: number; genericAdjustment?: number; deferPayment?: boolean; targetClauses?: readonly TargetClause[] } = {},
) => {
  const payment = (Object.entries(state.players[payer].mana) as [ManaId, number][])
    .filter(([, amount]) => amount > 0)
    .map(([mana, amount]) => ({ sourceId: `${payer}.pool.${mana}`, mana, amount }))
  return beginAnnouncement(state, {
    payer,
    sourceId: source.id,
    targetClauses: options.targetClauses ?? ability.decisions.targets,
    targets,
    ...(ability.decisions.variables?.length ? { variables: { X: x } } : {}),
    costs: {
      mandatory: ability.costs,
      optional: ability.optionalCosts,
      alternative: ability.alternativeCosts,
      increases: ability.costIncreases,
      reductions: ability.costReductions,
    },
    payment,
    nonManaChoices,
    ...options,
  }, `activation:${source.id}`)
}

export const commitAnnouncement = (transaction: AnnouncementTransaction): AnnouncementTransaction => {
  if (transaction.status !== 'provisional') throw new Error('announcement transaction is no longer provisional')
  transaction.status = 'committed'
  return transaction
}

export const rollbackAnnouncement = (transaction: AnnouncementTransaction): AnnouncementTransaction => {
  if (transaction.status !== 'provisional') throw new Error('announcement transaction is no longer provisional')
  transaction.status = 'rolledBack'
  return transaction
}

export const paymentFrame = (transaction: AnnouncementTransaction) => ({
  transactionId: transaction.id,
  lockedCost: transaction.lockedCost,
  payment: transaction.payment,
  /** Replacement choices belong to this frame; they cannot mutate the proposal. */
  replacementChoices: [] as readonly string[],
})

export const prepareAction = (
  state: Pick<GameState, 'players' | 'objects' | 'stack'>,
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
  state: Pick<GameState, 'objects' | 'stack' | 'active' | 'step' | 'opponents' | 'playerOrder' | 'players'>
  sourceId: string
  payer: PlayerId
  action: 'activate' | 'tapForMana' | 'nestedPayment' | 'manaPlanning'
  sorcerySpeed?: boolean
  availableFrom?: readonly GameState['objects'][string]['zone'][]
}

/** Shared gate used before ordinary, mana, nested-payment, and planning activations. */
export const activationPermission = (input: ActivationPermissionInput): string | undefined => {
  const source = input.state.objects[input.sourceId]
  if (!source) return 'activation source does not exist'
  if (input.availableFrom && !input.availableFrom.includes(source.zone)) return `${source.name} is not in an available zone`
  if (!input.availableFrom && source.zone !== 'battlefield') return `${source.name} is not on the battlefield`
  if (source.phasedOut) return `${source.name} is phased out`
  if (source.controller !== input.payer) return `${input.payer} does not control ${source.name}`
  const prohibited = Object.values(input.state.objects).some((watcher) => {
    const definition = watcher.ruleDefinition?.definition as import('../schema/v1').CardRuleDefinitionV1 | undefined
    if (!definition || !watcher.zone || !watcher.controller || watcher.phasedOut) return false
    const runtime = { state: input.state as GameState, controller: watcher.controller, source: captureObject(watcher) }
    return definition.abilities.some((ability) => ability.kind === 'static'
      && ability.activeIn.includes(watcher.zone as import('../schema/v1').Zone)
      && ability.effects.some((effect) => effect.kind === 'prohibitActivation'
        && (!effect.filter.abilitySource || evaluateObjectSelector({ kind: 'objects', filter: effect.filter.abilitySource }, runtime).some((object) => object.id === source.id))
        && (!effect.filter.activator || evaluatePlayerSelector({ kind: 'players', filter: effect.filter.activator }, runtime).includes(input.payer))) )
  })
  if (prohibited) return `${source.name} activation is prohibited`
  if (input.action === 'tapForMana' && source.tapped) return `${source.name} is already tapped`
  if (input.sorcerySpeed && (
    input.state.active !== input.payer
    || !['precombatMain', 'postcombatMain'].includes(input.state.step)
    || input.state.stack.length > 0
  )) return `${source.name} can be activated only as a sorcery`
  return undefined
}
