import { expandVariableMana, variableManaColor } from '../variableMana'
import { payCost, validPhyrexianLifePayment } from '../../../plugins/spells'
import { hasKeyword } from '../../../keywords'
import { captureObject } from '../../../objectIdentity'
import type { ActivatedAbilityDefinition, Amount, Condition, Cost, CostOptionCondition, CostReduction, ObjectRecipient, SpellAbilityDefinition, TargetClause } from '../schema/v1'
import type { CanonicalTargetBinding, GameObject, GameState, ManaId, ManaPool, PlayerId, TargetRef } from '../../../types'
import type { DistributionAllocation } from './modes'
import { activationRestrictionMessage, activePrintedStaticModifiers } from '../staticModifierCore'
import { amountEvaluationContext, evaluateCondition, evaluateObjectReference, evaluateObjectSelector, evaluatePlayerSelector, evaluateRuntimeAmount } from './runtime'
import type { BoundRecipient, RuleDslRuntimeContext } from './runtime'
import { evaluateAmount, MAX_EXPRESSION_DEPTH } from './evaluate'
import { AMOUNT_DEPTH_ERROR_MESSAGE } from './constants'

/** A mana unit committed by a proposal. `sourceId` is deliberately unique. */
export type AnnouncementManaPayment = {
  sourceId: string
  mana: ManaId
  amount?: number
  restricted?: boolean
}

export const isSourceObjectCost = (cost: Cost) =>
  (cost.kind === 'sacrifice' || cost.kind === 'discard')
  && cost.filter.kind === 'contextRef'
  && cost.filter.name === 'source'

export const isSourceSacrificeCost = (cost: Cost) =>
  cost.kind === 'sacrifice' && isSourceObjectCost(cost)

export type CostPlan = {
  xManaColor?: ManaId
  mandatory: readonly Cost[]
  additional?: readonly Cost[]
  conditions?: readonly CostOptionCondition[]
  optionalBounds?: { min: number; max?: number }
  optional?: readonly Cost[]
  repeatableOptional?: readonly number[]
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
  /** One separately paid selection per collect-evidence cost, in cost order. */
  evidence?: readonly (readonly string[])[]
  /** Cast sources are already on the stack during payment; graveyard activations may spend their source. */
  excludeSourceFromEvidence?: boolean
  /** Optional client answer; the server still rechecks all candidates. */
  selectedOptional?: readonly number[]
  selectedAlternative?: number
  selectedPlayers?: Readonly<Record<number, PlayerId>>
  excludeSourceFromCosts?: boolean
  /** Server-computed generic adjustment from format and legacy cost modifiers. */
  genericAdjustment?: number
  /** Server-only planned payment may lock before mana activations run. */
  deferPayment?: boolean
  /** Indexes of Phyrexian mana symbols paid with 2 life each. */
  phyrexianLife?: number[]
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
  readonly targetBindings?: readonly CanonicalTargetBinding[]
  readonly distributionBindings?: readonly DistributionAllocation[]
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

export const lockedManaCost = (plan: CostPlan, x = 0, genericAdjustment = 0) => {
  const printed = [
    ...(plan.mandatory.filter((cost): cost is Extract<Cost, { kind: 'mana' }> => cost.kind === 'mana').map((cost) => cost.amount)),
    ...(plan.optional ?? []).filter((cost): cost is Extract<Cost, { kind: 'mana' }> => cost.kind === 'mana').map((cost) => cost.amount),
    ...(plan.increases ?? []).map((increase) => increase.amount),
  ].join('')
  const mana = expandVariableMana(printed, x)
  const genericReduction = (plan.reductions ?? []).reduce((total, reduction) => {
    integer(reduction.generic, 'generic reduction')
    return total + reduction.generic
  }, 0)
  const generic = Math.max(0, genericMana(mana) + genericAdjustment - genericReduction)
  if (plan.xManaColor) {
    // A spending restriction does not turn X into a colored cost: reductions
    // still reduce its generic portion before the remaining payment is restricted.
    const variableAmount = [...printed.matchAll(/\{X\}/g)].length * x
    const restricted = Math.max(0, Math.min(generic, variableAmount + Math.min(0, genericAdjustment - genericReduction)))
    const otherGeneric = generic - restricted
    return `${otherGeneric > 0 ? `{${otherGeneric}}` : ''}${mana.replaceAll(/\{\d+\}/g, '')}${`{${plan.xManaColor}}`.repeat(restricted)}`
  }
  if (generic === genericMana(mana) && genericReduction === 0) return mana
  const nonGeneric = mana.replaceAll(/\{\d+\}/g, '')
  return `${generic > 0 ? `{${generic}}` : ''}${nonGeneric}`
}

const selectedCosts = (proposal: Pick<AnnouncementProposal, 'costs' | 'selectedOptional' | 'selectedAlternative' | 'selectedPlayers'>) => {
  const selections = proposal.selectedOptional ?? []
  if (selections.length < (proposal.costs.optionalBounds?.min ?? 0) || selections.length > (proposal.costs.optionalBounds?.max ?? Infinity)) throw new TypeError('optional cost selection does not satisfy its bounds')
  const seen = new Set<number>()
  for (const index of selections) {
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('optional cost selection is out of range')
    if (seen.has(index) && !proposal.costs.repeatableOptional?.includes(index)) throw new TypeError('optional cost selection contains a duplicate')
    seen.add(index)
  }
  const optional = (proposal.selectedOptional ?? []).map((index) => proposal.costs.optional?.[index])
  if (optional.some((cost) => !cost)) throw new TypeError('optional cost selection is out of range')
  const alternative = proposal.selectedAlternative === undefined
    ? proposal.costs.mandatory
    : proposal.costs.alternative?.[proposal.selectedAlternative]
      ? proposal.costs.alternative[proposal.selectedAlternative]
      : undefined
  if (!alternative) throw new TypeError('alternative cost selection is unavailable')
  return [...alternative, ...(proposal.costs.additional ?? []), ...(optional as Cost[])]
}

/** One selection routine for legality, previews, and final payment. */
export const chosenAbilityCosts = (
  ability: Pick<SpellAbilityDefinition, 'costs' | 'additionalCosts' | 'optionalCostBounds' | 'optionalCosts' | 'repeatableOptionalCosts' | 'alternativeCosts'>,
  choices: Pick<AnnouncementProposal, 'selectedOptional' | 'selectedAlternative' | 'selectedPlayers'> = {},
) => selectedCosts({ costs: { mandatory: ability.costs, additional: ability.additionalCosts, optionalBounds: ability.optionalCostBounds, optional: ability.optionalCosts, repeatableOptional: ability.repeatableOptionalCosts, alternative: ability.alternativeCosts }, ...choices })

const validateVariables = (variables: AnnouncementProposal['variables']) => {
  const x = variables?.X
  if (x !== undefined) integer(x, 'X')
}

const announcementRuntime = (
  state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules'>>,
  payer: PlayerId,
  sourceId: string,
  x: number | undefined,
) => {
  const source = state.objects[sourceId]
  if (!source) return
  const playerOrder = 'playerOrder' in state && Array.isArray((state as GameState).playerOrder)
    ? (state as GameState).playerOrder
    : Object.keys(state.players)
  return {
    state: { ...state, playerOrder } as GameState,
    controller: payer,
    source: captureObject(source),
    ...(x === undefined ? {} : { variables: { X: x } }),
  }
}

// The explicit return type is needed for recursive locking of divided cost amounts.
const lockAmount = (amount: Amount, x: number | undefined, runtime: RuleDslRuntimeContext | undefined, depth = 0): Extract<Amount, { kind: 'constant' }> => {
  if (depth > MAX_EXPRESSION_DEPTH) throw new TypeError(AMOUNT_DEPTH_ERROR_MESSAGE)
  switch (amount.kind) {
    case 'constant':
      return amount
    case 'variable': {
      if (x === undefined) throw new TypeError(`amount variable ${amount.name} is not bound`)
      return { kind: 'constant' as const, value: x }
    }
    case 'multiply':
    case 'minimum':
    case 'add': {
      if (runtime) return { kind: 'constant', value: evaluateRuntimeAmount(amount, runtime) }
      return { kind: 'constant', value: evaluateAmount({ ...amount, left: lockAmount(amount.left, x, runtime, depth + 1), right: lockAmount(amount.right, x, runtime, depth + 1) }, { count: () => 0, greatest: () => 0, characteristic: () => 0 }) }
    }
    case 'divide': {
      if (runtime) return { kind: 'constant', value: evaluateRuntimeAmount(amount, runtime) }
      return { kind: 'constant', value: evaluateAmount({ ...amount, value: lockAmount(amount.value, x, runtime, depth + 1) }, { count: () => 0, greatest: () => 0, characteristic: () => 0 }) }
    }
    case 'count':
    case 'greatest': {
      if (!runtime) throw new TypeError('cost amount count requires an announcement source')
      return { kind: 'constant' as const, value: evaluateRuntimeAmount(amount, runtime) }
    }
    default:
      throw new TypeError('cost amount must be a constant, X variable, count, or arithmetic expression')
  }
}

const lockCost = (cost: Cost, x: number | undefined, runtime: RuleDslRuntimeContext | undefined) => {
  switch (cost.kind) {
    case 'mill':
    case 'draw':
    case 'discard':
    case 'sacrifice':
      return { ...cost, count: lockAmount(cost.count, x, runtime) }
    case 'crew':
      return { ...cost, power: lockAmount(cost.power, x, runtime) }
    case 'collectEvidence':
    case 'life':
    case 'loyalty':
      return { ...cost, amount: lockAmount(cost.amount, x, runtime) }
    default:
      return cost
  }
}

const costAmount = (amount: Amount, x: number | undefined, runtime?: RuleDslRuntimeContext) =>
  lockAmount(amount, x, runtime).value

export const evaluateAnnouncementCostAmount = (amount: Amount, x: number | undefined) => costAmount(amount, x)

const isSourceCostRecipient = (filter: ObjectRecipient) =>
  filter.kind === 'contextRef' && filter.name === 'source'

const objectCostCandidates = (
  cost: Extract<Cost, { kind: 'discard' | 'sacrifice' }>,
  runtime: RuleDslRuntimeContext,
  payer: PlayerId,
  excludedSourceId: string,
) => {
  const resolved = cost.filter.kind === 'objects'
    ? evaluateObjectSelector(cost.filter, runtime)
    : evaluateObjectReference(cost.filter, runtime)
  return resolved.filter((object) =>
    object.controller === payer
    && object.zone === (cost.kind === 'discard' ? 'hand' : 'battlefield')
    && (!excludedSourceId || object.id !== excludedSourceId || isSourceCostRecipient(cost.filter)))
}

export const resolveNonManaCostObjectChoices = (
  state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules'>>,
  payer: PlayerId,
  excludedSourceId: string,
  costs: readonly Cost[],
  x: number | undefined,
  choices: readonly string[] | undefined,
  runtimeSourceId: string,
) => {
  const runtime = announcementRuntime(state, payer, runtimeSourceId, x)
  const resolved: string[] = []
  let choiceIndex = 0
  for (const cost of costs) {
    if (cost.kind === 'crew') {
      if (!runtime) throw new TypeError('crew requires an announcement source')
      const selected = choices ?? []
      const candidates = crewCandidates(state, payer, runtimeSourceId)
      if (new Set(selected).size !== selected.length || selected.some(id => !candidates.some(candidate => candidate.id === id))) throw new TypeError('crew requires distinct other untapped creatures you control')
      const power = selected.reduce((sum, id) => sum + (state.objects[id]!.power ?? 0), 0)
      if (power < costAmount(cost.power, x, runtime)) throw new TypeError('insufficient creature power to crew')
      resolved.push(...selected)
      continue
    }
    if (cost.kind !== 'discard' && cost.kind !== 'sacrifice') continue
    if (!runtime) throw new TypeError(`${cost.kind} costs require an announcement source`)
    const candidates = objectCostCandidates(cost, runtime, payer, excludedSourceId)
    const count = costAmount(cost.count, x, runtime)
    if (candidates.length < count) throw new TypeError(`not enough cards to ${cost.kind} as a cost`)
    let selected = choices?.slice(choiceIndex, choiceIndex + count)
    if ((!selected || selected.length !== count)
      && isSourceCostRecipient(cost.filter)
      && count === 1
      && candidates.length === 1) {
      selected = [candidates[0]!.id]
    }
    if (!selected || selected.length !== count || new Set(selected).size !== count) {
      throw new TypeError(`${cost.kind} cost needs ${count} distinct selected cards`)
    }
    if (selected.some((id) => !candidates.some((candidate) => candidate.id === id))) {
      throw new TypeError(`illegal ${cost.kind} cost selection`)
    }
    resolved.push(...selected)
    choiceIndex += count
  }
  return resolved
}

export const crewCandidates = (state: Pick<GameState, 'objects'>, payer: PlayerId, sourceId: string) => Object.values(state.objects).filter(object => object.id !== sourceId && object.zone === 'battlefield' && object.controller === payer && object.types.includes('Creature') && !object.tapped && !object.phasedOut)

/** Validate each evidence payment independently; one card cannot pay two costs. */
const evidenceCostChoices = (
  state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules'>>,
  payer: PlayerId,
  sourceId: string,
  costs: readonly Cost[],
  x: number | undefined,
  evidence: readonly (readonly string[])[] = [],
  excludeSource = true,
) => {
  const required = costs.filter(cost => cost.kind === 'collectEvidence')
  if (evidence.length !== required.length) throw new TypeError('one card selection is required for each collect-evidence cost')
  const runtime = announcementRuntime(state, payer, sourceId, x)
  const used = new Set<string>()
  return required.map((cost, index) => {
    const selected = [...evidence[index]!]
    let total = 0
    for (const id of selected) {
      const object = state.objects[id]
      if (used.has(id)) throw new TypeError('an evidence card cannot pay more than once')
      if (!object || object.zone !== 'graveyard' || object.owner !== payer || object.token || (excludeSource && id === sourceId)) throw new TypeError('evidence requires cards in your graveyard')
      used.add(id)
      total += object.manaValue
    }
    if (total < costAmount(cost.amount, x, runtime)) throw new TypeError('insufficient total mana value to collect evidence')
    return selected
  })
}

/** Planned mana abilities can change the graveyard before costs are actually paid. */
export const validateEvidencePayment = (state: GameState, transaction: AnnouncementTransaction) => {
  evidenceCostChoices(state, transaction.proposal.payer, transaction.proposal.sourceId, transaction.lockedCost.nonMana, transaction.lockedCost.x, transaction.proposal.evidence, transaction.proposal.excludeSourceFromEvidence)
}

export const evidencePaymentEvents = (proposal: Pick<AnnouncementProposal, 'evidence'>) =>
  (proposal.evidence ?? []).flatMap(ids => ids.map(objectId => ({ type: 'move' as const, objectId, to: 'exile' as const })))

const validateNonManaCosts = (
  state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules' | 'turn'>>,
  payer: PlayerId,
  sourceId: string,
  costs: readonly Cost[],
  x: number | undefined,
  choices: readonly string[] | undefined,
  runtimeSourceId: string,
  evidence?: readonly (readonly string[])[],
  excludeSourceFromEvidence = true,
) => {
  const runtime = announcementRuntime(state, payer, runtimeSourceId, x)
  let millTotal = 0
  let lifeTotal = 0
  const selectedObjects = new Set<string>()
  let sourceTapped = false
  let sourceExiled = false
  for (const cost of costs) {
    switch (cost.kind) {
      case 'exileSource': {
        const source = state.objects[runtimeSourceId]
        if (!source || source.zone !== cost.from || (source.zone === 'battlefield' ? source.controller : source.owner) !== payer || sourceExiled) throw new TypeError('source cannot be exiled to pay this cost')
        sourceExiled = true
        break
      }
      case 'mill':
        millTotal += costAmount(cost.count, x, runtime)
        break
      case 'life':
        lifeTotal += costAmount(cost.amount, x, runtime)
        break
      case 'loyalty': {
        const source = state.objects[runtimeSourceId]
        if (!source || source.zone !== 'battlefield' || source.phasedOut || source.controller !== payer) {
          throw new TypeError('loyalty cost requires a controlled planeswalker on the battlefield')
        }
        if (!source.types.includes('Planeswalker')) throw new TypeError('loyalty cost requires a planeswalker')
        if (state.turn !== undefined && source.loyaltyActivatedTurn === state.turn) {
          throw new TypeError(`${source.name} already activated a loyalty ability this turn`)
        }
        const amount = costAmount(cost.amount, x, runtime)
        if (cost.minus && (source.counters.loyalty ?? 0) < amount) {
          throw new TypeError(`${source.name} does not have enough loyalty`)
        }
        break
      }
      case 'draw':
        costAmount(cost.count, x, runtime)
        break
      case 'tapSource': {
        const source = state.objects[runtimeSourceId]
        if (!source || source.zone !== 'battlefield' || source.phasedOut || source.controller !== payer) {
          throw new TypeError('tap cost requires a controlled permanent on the battlefield')
        }
        if (source.tapped || sourceTapped) throw new TypeError('tap cost source is already tapped')
        if (source.types.includes('Creature') && source.summoningSickness
          && !hasKeyword(source, 'haste', state.rules ? { rules: state.rules } : undefined)) {
          throw new TypeError('tap cost source has summoning sickness')
        }
        sourceTapped = true
        break
      }
    }
  }
  const explicitObjectCosts = costs.filter((cost) => cost.kind === 'discard' || cost.kind === 'sacrifice' || cost.kind === 'crew')
  if (explicitObjectCosts.length > 0) {
    const objectChoices = resolveNonManaCostObjectChoices(
      state,
      payer,
      sourceId,
      costs,
      x,
      choices,
      runtimeSourceId,
    )
    for (const id of objectChoices) {
      if (selectedObjects.has(id)) throw new TypeError(`cost object ${id} is selected more than once`)
      selectedObjects.add(id)
    }
    const explicitChoiceCount = explicitObjectCosts.reduce(
      (total, cost) => total + (cost.kind === 'crew' ? objectChoices.length : costAmount(cost.count, x, runtime)),
      0,
    )
    if (choices && choices.length !== explicitChoiceCount) throw new TypeError('unused nonmana cost selection')
  }
  for (const id of evidenceCostChoices(state, payer, runtimeSourceId, costs, x, evidence, excludeSourceFromEvidence).flat()) {
    if (selectedObjects.has(id)) throw new TypeError(`cost object ${id} is selected more than once`)
    selectedObjects.add(id)
  }
  if (Object.values(state.objects).filter(object => object.zone === 'library' && object.owner === payer).length < millTotal) throw new TypeError('payer cannot mill enough cards for the cost')
  if (state.players[payer].life < lifeTotal) throw new TypeError(`payer cannot pay ${lifeTotal} life`)
}

const targetIdentity = (target: TargetRef) => {
  switch (target.kind) {
    case 'player': return `player:${target.player}`
    case 'stackItem': return `stack:${target.stackId}`
    case 'object': return `object:${target.objectId}:${target.incarnation ?? ''}:${target.zone ?? ''}`
  }
}

const validateTargets = (state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules'>>, proposal: AnnouncementProposal) => {
  if (!proposal.targetClauses) return
  const targets = proposal.targets ?? []
  if (targets.length !== proposal.targetClauses.length) throw new TypeError('target clauses must be supplied in declaration order')
  targets.forEach((clauseTargets, index) => {
    const clause = proposal.targetClauses![index]
    const source = state.objects[proposal.sourceId]
    const bound = (amount: TargetClause['min']) => {
      if (amount.kind === 'constant') return amount.value
      if (amount.kind === 'variable') return proposal.variables?.[amount.name]
      if (!source) return undefined
      try {
        return evaluateAmount(amount, amountEvaluationContext({
          state: state as GameState,
          controller: proposal.payer,
          source: captureObject(source),
          variables: proposal.variables,
          paidCosts: proposalCostChoices(proposal),
        }))
      } catch {
        return undefined
      }
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
  state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules'>>,
  proposal: AnnouncementProposal,
  id = 'announcement',
): AnnouncementValidation => {
  try {
    validateVariables(proposal.variables)
    validateTargets(state, proposal)
    if (!state.players[proposal.payer]) return { ok: false, error: `unknown payer ${proposal.payer}` }
    for (const condition of proposal.costs.conditions ?? []) {
      const selected = condition.cost === 'optional'
        ? proposal.selectedOptional?.includes(condition.index)
        : proposal.selectedAlternative === condition.index
      if (!selected) continue
      const context = announcementRuntime(state, proposal.payer, proposal.sourceId, proposal.variables?.X)
      if (!context || !evaluateCondition(condition.when, { ...context, paidCosts: proposalCostChoices(proposal) })) return { ok: false, error: 'selected cost option is not permitted' }
    }
    const costs = selectedCosts(proposal)
    const playerChoices = proposal.selectedPlayers ?? {}
    for (const key of Object.keys(playerChoices)) {
      const index = Number(key)
      if (!Number.isInteger(index) || String(index) !== key || !proposal.selectedOptional?.includes(index)
        || proposal.costs.optional?.[index]?.kind !== 'choosePlayer') return { ok: false, error: 'unexpected cost player choice' }
    }
    for (const index of proposal.selectedOptional ?? []) {
      const cost = proposal.costs.optional?.[index]
      if (cost?.kind !== 'choosePlayer') continue
      const context = announcementRuntime(state, proposal.payer, proposal.sourceId, proposal.variables?.X)
      const player = playerChoices[index]
      if (!context || !player || !evaluatePlayerSelector(cost.players, context).includes(player)) return { ok: false, error: 'illegal cost player choice' }
    }
    const plan: CostPlan = { xManaColor: proposal.costs.xManaColor, mandatory: costs, increases: proposal.costs.increases, reductions: proposal.costs.reductions }
    validateNonManaCosts(
      state,
      proposal.payer,
      proposal.excludeSourceFromCosts ? proposal.sourceId : '',
      costs,
      proposal.variables?.X,
      proposal.nonManaChoices,
      proposal.sourceId,
      proposal.evidence,
      proposal.excludeSourceFromEvidence,
    )
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
    const phyrexianLife = proposal.phyrexianLife ?? []
    if (mana) {
      if (!validPhyrexianLifePayment(mana, phyrexianLife)) {
        return { ok: false, error: 'invalid Phyrexian mana payment' }
      }
      if (phyrexianLife.length * 2 > state.players[proposal.payer].life) {
        return { ok: false, error: 'not enough life for Phyrexian mana' }
      }
    }
    if (!proposal.deferPayment && mana && !payCost(pool, mana, phyrexianLife)) {
      return { ok: false, error: 'payment does not cover the locked total cost' }
    }
    const transaction: AnnouncementTransaction = {
      id,
      proposal: structuredClone(proposal),
      lockedCost: {
        ...(mana ? { mana } : {}),
        nonMana: costs.filter((cost) => cost.kind !== 'mana').map((cost) =>
          lockCost(cost, proposal.variables?.X, announcementRuntime(state, proposal.payer, proposal.sourceId, proposal.variables?.X))),
        ...(proposal.variables?.X !== undefined ? { x: proposal.variables.X } : {}),
      },
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
  source: { id: string; manaCost?: string },
  payer: PlayerId,
  ability: SpellAbilityDefinition,
  targets: readonly (readonly TargetRef[])[] | undefined,
  x: number | undefined,
  nonManaChoices?: readonly string[],
  options: {
    evidence?: readonly (readonly string[])[]
    selectedOptional?: readonly number[]
    selectedAlternative?: number
    selectedPlayers?: Readonly<Record<number, PlayerId>>
    genericAdjustment?: number
    deferPayment?: boolean
    targetClauses?: readonly TargetClause[]
    phyrexianLife?: number[]
  } = {},
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
      xManaColor: variableManaColor(ability.decisions.variables),
      mandatory: ability.costs.some(cost => cost.kind === 'mana') || !source.manaCost
        ? ability.costs
        : [{ kind: 'mana' as const, amount: source.manaCost }, ...ability.costs],
      additional: ability.additionalCosts,
      conditions: ability.costConditions,
      optionalBounds: ability.optionalCostBounds,
      optional: ability.optionalCosts,
      repeatableOptional: ability.repeatableOptionalCosts,
      alternative: ability.alternativeCosts,
      increases: ability.costIncreases,
      reductions: planReductions(state, source.id, payer, ability, x, targets),
    },
    excludeSourceFromCosts: true,
    payment,
    nonManaChoices,
    ...options,
    ...(options.evidence ? { evidence: options.evidence.map(ids => [...ids]) } : {}),
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
  options: { evidence?: readonly (readonly string[])[]; selectedOptional?: readonly number[]; selectedAlternative?: number; genericAdjustment?: number; deferPayment?: boolean; targetClauses?: readonly TargetClause[] } = {},
) => {
  for (const variable of ability.decisions.variables ?? []) {
    if (x === undefined || !Number.isSafeInteger(x) || x < variable.min || x > variable.max) return { ok: false as const, error: `${variable.name} must be a safe integer from ${variable.min} to ${variable.max}` }
  }
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
      xManaColor: variableManaColor(ability.decisions.variables),
      mandatory: ability.costs,
      additional: ability.additionalCosts,
      conditions: ability.costConditions,
      optionalBounds: ability.optionalCostBounds,
      optional: ability.optionalCosts,
      repeatableOptional: ability.repeatableOptionalCosts,
      alternative: ability.alternativeCosts,
      increases: ability.costIncreases,
      reductions: planReductions(state, source.id, payer, ability, x, targets),
    },
    excludeSourceFromCosts: true,
    excludeSourceFromEvidence: false,
    payment,
    nonManaChoices,
    ...options,
    ...(options.evidence ? { evidence: options.evidence.map(ids => [...ids]) } : {}),
  }, `activation:${source.id}`)
}

const proposalCostChoices = (choices: Pick<AnnouncementProposal, 'selectedOptional' | 'selectedAlternative' | 'selectedPlayers'>) => ({
  optional: [...(choices.selectedOptional ?? [])],
  ...(choices.selectedPlayers ? { players: { ...choices.selectedPlayers } } : {}),
  ...(choices.selectedAlternative !== undefined ? { alternative: choices.selectedAlternative } : {}),
})

/** A private proposal view lets targeting inspect announced choices before payment. */
export const proposedCostSource = (source: GameObject, choices: Pick<AnnouncementProposal, 'selectedOptional' | 'selectedAlternative' | 'selectedPlayers'>) => ({
  ...source, castCostChoices: proposalCostChoices(choices),
})

export const announcementCostChoices = (transaction: AnnouncementTransaction) => proposalCostChoices(transaction.proposal)

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
  state: Pick<GameState, 'players' | 'objects' | 'stack'> & Partial<Pick<GameState, 'rules'>>,
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
  state: Pick<GameState, 'objects' | 'stack' | 'active' | 'step' | 'opponents' | 'playerOrder' | 'players' | 'zoneOrder'> & Partial<Pick<GameState, 'priority' | 'resolution' | 'provisionalAnnouncement'>>
  sourceId: string
  payer: PlayerId
  action: 'activate' | 'tapForMana' | 'nestedPayment' | 'manaPlanning'
  instantSpeed?: boolean
  sorcerySpeed?: boolean
  availableFrom?: readonly GameState['objects'][string]['zone'][]
  when?: Condition
}

export const activatedPermissionFields = (ability: ActivatedAbilityDefinition) => ({
  instantSpeed: ability.timing === 'instant',
  sorcerySpeed: ability.timing === 'sorcery',
  availableFrom: ability.availableFrom,
  ...(ability.when ? { when: ability.when } : {}),
})

const announcementContext = (
  state: GameState,
  sourceId: string,
  payer: PlayerId,
  x?: number,
): RuleDslRuntimeContext | undefined => {
  const source = state.objects[sourceId]
  if (!source) return
  return {
    state,
    controller: payer,
    source: captureObject(source),
    ...(x === undefined ? {} : { variables: { X: x } }),
  }
}

const evaluatedReductions = (
  reductions: readonly CostReduction[] | undefined,
  context: RuleDslRuntimeContext,
): ManaCostReduction[] =>
  (reductions ?? []).filter(reduction => !reduction.when || evaluateCondition(reduction.when, context)).map((reduction) => ({
    generic: evaluateRuntimeAmount(reduction.generic, context),
    ...(reduction.reason ? { reason: reduction.reason } : {}),
  }))

export const printedActivationCostReductions = (
  state: GameState,
  source: GameObject,
): ManaCostReduction[] => {
  const reductions: ManaCostReduction[] = []
  for (const watcher of Object.values(state.objects)) {
    for (const entry of activePrintedStaticModifiers(state, watcher)) {
      if (!('effect' in entry) || entry.effect.kind !== 'reduceActivationCost') continue
      const runtime = { state, controller: watcher.controller, source: captureObject(watcher) }
      if (!evaluateObjectSelector(entry.effect.targets, runtime).some((object) => object.id === source.id)) continue
      reductions.push({ generic: evaluateRuntimeAmount(entry.effect.generic, runtime) })
    }
  }
  return reductions
}

// Recursive traversal requires an explicit return type. Input is validated DSL data.
export const costsDependOnTargets = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  if ('kind' in value && value.kind === 'targetRef') return true
  return Object.values(value).some(costsDependOnTargets)
}

const planReductions = (
  state: GameState,
  sourceId: string,
  payer: PlayerId,
  ability: SpellAbilityDefinition | ActivatedAbilityDefinition,
  x?: number,
  targets?: readonly (readonly TargetRef[])[],
): ManaCostReduction[] => {
  const context = announcementContext(state, sourceId, payer, x)
  if (!context) return []
  context.targets = Object.fromEntries((targets ?? []).map((entries, index) => [index, entries.flatMap<BoundRecipient>(target => {
    switch (target.kind) {
      case 'player': return [{ kind: 'player' as const, playerId: target.player }]
      case 'stackItem': return [{ kind: 'stackItem' as const, stackId: target.stackId }]
      case 'object': {
        const object = state.objects[target.objectId]
        return object ? [{ kind: 'object' as const, objectId: object.id, incarnation: object.incarnation, zone: object.zone }] : []
      }
    }
  })]))
  const reductions = ability.costReductions?.filter(reduction => targets?.length || !costsDependOnTargets(reduction))
  const printed = evaluatedReductions(reductions, context)
  if (ability.kind !== 'activated') return printed
  const source = state.objects[sourceId]
  return source ? [...printed, ...printedActivationCostReductions(state, source)] : printed
}

/** Shared gate used before ordinary, mana, nested-payment, and planning activations. */
export const activationPermission = (input: ActivationPermissionInput): string | undefined => {
  const source = input.state.objects[input.sourceId]
  if (!source) return 'activation source does not exist'
  if (input.availableFrom && !input.availableFrom.includes(source.zone)) {
    return input.availableFrom.length === 1 && input.availableFrom[0] === 'hand'
      ? `${source.name} is not in hand`
      : `${source.name} is not in an available zone`
  }
  if (!input.availableFrom && source.zone !== 'battlefield') return `${source.name} is not on the battlefield`
  if (source.phasedOut) return `${source.name} is phased out`
  if (source.controller !== input.payer) return `${input.payer} does not control ${source.name}`
  const prohibited = activationRestrictionMessage(input)
  if (prohibited) return prohibited
  if (input.action === 'tapForMana' && source.tapped) return `${source.name} is already tapped`
  if (input.instantSpeed && (input.state.priority !== input.payer || input.state.resolution || input.state.provisionalAnnouncement)) return `${source.name} can be activated only as an instant`
  if (input.sorcerySpeed && (
    input.state.active !== input.payer
    || !['precombatMain', 'postcombatMain'].includes(input.state.step)
    || input.state.stack.length > 0
  )) return `${source.name} can be activated only as a sorcery`
  if (input.when) {
    try {
      if (!evaluateCondition(input.when, {
        state: input.state as GameState,
        controller: input.payer,
        source: captureObject(source),
      })) return `${source.name} cannot be activated now`
    } catch {
      return `${source.name} cannot be activated now`
    }
  }
  return undefined
}

export const spellCastPermission = (
  state: GameState,
  source: GameObject,
  ability: SpellAbilityDefinition,
  seat: PlayerId,
): string | undefined => {
  if (!ability.when) return
  try {
    if (!evaluateCondition(ability.when, {
      state,
      controller: seat,
      source: captureObject(source),
    })) return `${source.name} cannot be cast now`
  } catch {
    return `${source.name} cannot be cast now`
  }
}
