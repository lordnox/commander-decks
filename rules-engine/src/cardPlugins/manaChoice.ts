import { availableManaTypes } from './dsl/manaTypes'
import { openOptionSelection, pendingOptionSelection } from '../rules/selectOptions'
import type { GameObject, GameState, ManaId, ManaPool, Plugin } from '../types'
import { reducedActivationMana } from './activationCosts'
import { effectsOf } from './cardRules'
import { conditionHolds } from './effects'
import { captureObject } from '../objectIdentity'
import { evaluateCreatureType, evaluatePlayerReference, evaluatePlayerSelector, evaluateRuntimeAmount, isSourceSacrificeCost, loadDefinitionSnapshot, lockedManaCost } from './dsl/compiler'
import type { Instruction } from './dsl/schema/v2'
import type { InstructionHandler } from './instructionHandlers/types'

const MANA_ORDER: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

type Pool = Partial<ManaPool>

/** Option id of a pool: its symbols in WUBRGC order, so `{G}{U}` is `UG`. */
export const manaOptionId = (pool: Pool) =>
  MANA_ORDER.flatMap((symbol) => Array<ManaId>(pool[symbol] ?? 0).fill(symbol)).join('')

const manaOptionLabel = (pool: Pool) =>
  [...manaOptionId(pool)].map((symbol) => `{${symbol}}`).join('')

export const manaChoicePools = (options: Pool[]) =>
  Object.fromEntries(options.map((pool) => [manaOptionId(pool), pool]))

// Hoist the compatibility handler: mana queries also read legacy production options.
export function addManaChoiceInstruction(
  { draft, source, item }: Parameters<InstructionHandler<'addManaChoice'>>[0],
  instruction: Parameters<InstructionHandler<'addManaChoice'>>[1],
) {
  const pools = manaChoicePools(instruction.options)
  const named = item?.choices?.[0]
  if (named && pools[named]) {
    draft.enqueue({ type: 'addMana', seat: source.controller, mana: pools[named], sourceId: source.id })
    return
  }
  openOptionSelection(draft, {
    seat: source.controller,
    sourceId: source.id,
    source: source.name,
    prompt: `Choose the mana ${source.name} adds.`,
    options: Object.entries(pools).map(([id, pool]) => ({ id, label: manaOptionLabel(pool) })),
    action: { kind: 'mana-choice', pools },
  })
}

export const manaChoice: Plugin = {
  id: 'manaChoice',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'selectOption') return
    const pending = pendingOptionSelection(state, event.seat)
    if (pending?.action.kind !== 'mana-choice') return
    draft.enqueue({
      type: 'addMana',
      seat: event.seat,
      mana: pending.action.pools[event.optionId],
      sourceId: pending.sourceId,
    })
    draft.note(`${event.seat} adds ${event.optionId}`)
  },
}

export type ActivatedManaOption = {
  abilityId: string
  /** Mana paid from the pool before the ability adds `pool`. */
  cost?: string
  pool: Pool
  /** The `choices[0]` that selects this pool, for abilities that offer several. */
  choice?: string
  /** The ability sacrifices its source as a cost. */
  sacrifices: boolean
  /** Spend this pool only on matching spells (chosen creature type or legendary). */
  restriction?: { creatureType?: string; legendary?: boolean }
}

const addPools = (left: Pool, right: Pool) => {
  const sum: Pool = { ...left }
  for (const symbol of MANA_ORDER) {
    if (right[symbol]) sum[symbol] = (sum[symbol] ?? 0) + right[symbol]
  }
  return sum
}

const spendRestriction = (
  instructions: readonly Instruction[],
  context: Parameters<typeof evaluateCreatureType>[1],
): ActivatedManaOption['restriction'] => {
  for (const instruction of instructions) {
    if (instruction.kind === 'addMana' && instruction.restriction) {
      const creatureType = instruction.restriction.creatureType
        ? evaluateCreatureType(instruction.restriction.creatureType, context)
        : undefined
      if (!instruction.restriction.legendary && !creatureType) continue
      return {
        ...(instruction.restriction.legendary ? { legendary: true } : {}),
        ...(creatureType ? { creatureType } : {}),
      }
    }
    if (instruction.kind === 'sequence' || instruction.kind === 'forEach') {
      const nested = spendRestriction(instruction.instructions, context)
      if (nested) return nested
    }
  }
  return undefined
}

// Recursive sequence evaluation needs an explicit result type.
const fixedCanonicalMana = (
  state: GameState, object: GameObject, instructions: readonly Instruction[],
): Pool | undefined => {
  let pool: Pool = {}
  const context = { state, controller: object.controller, source: captureObject(object) }
  for (const instruction of instructions) {
    switch (instruction.kind) {
      case 'sequence':
      case 'forEach': {
        const nested = fixedCanonicalMana(state, object, instruction.instructions)
        if (!nested) return undefined
        pool = addPools(pool, nested)
        break
      }
      case 'addMana': {
        const recipients = instruction.targets.kind === 'players'
          ? evaluatePlayerSelector(instruction.targets, context) : evaluatePlayerReference(instruction.targets, context)
        if (recipients.length !== 1 || recipients[0] !== object.controller) return undefined
        for (const symbol of MANA_ORDER) {
          const expression = instruction.amount[symbol]
          if (!expression) continue
          const amount = evaluateRuntimeAmount(expression, context)
          if (amount < 0) return undefined
          pool[symbol] = (pool[symbol] ?? 0) + amount
        }
        break
      }
      default: return undefined
    }
  }
  return MANA_ORDER.some(symbol => (pool[symbol] ?? 0) > 0) ? pool : undefined
}

const canonicalManaOptions = (state: GameState, object: GameObject) => {
  if (!object.ruleDefinition) return []
  return loadDefinitionSnapshot(object.ruleDefinition).definition.abilities.flatMap<ActivatedManaOption>((ability, index) => {
    if (ability.kind !== 'activated' || ability.modes || ability.decisions.targets.length > 0
      || ability.decisions.variables?.length || !ability.availableFrom.includes(object.zone)
      || ability.costs.some(cost => cost.kind !== 'mill' && cost.kind !== 'mana' && cost.kind !== 'life' && cost.kind !== 'tapSource' && !isSourceSacrificeCost(cost))) return []
    try {
      const runtime = { state, controller: object.controller, source: captureObject(object) }
      const mill = ability.costs.reduce((total, cost) => total + (cost.kind === 'mill' ? evaluateRuntimeAmount(cost.count, runtime) : 0), 0)
      if (mill > state.zoneOrder[object.controller]!.library.length) return []
      if (ability.instructions?.length === 1 && ability.instructions[0]?.kind === 'chooseInstructions') return ability.instructions[0].options.flatMap(option => {
        const pool = fixedCanonicalMana(state, object, option.instructions)
        const restriction = spendRestriction(option.instructions, runtime)
        return pool && option.label ? [{ abilityId: `$.abilities[${index}]`, cost: lockedManaCost({ mandatory: ability.costs }), pool, choice: option.label, sacrifices: ability.costs.some(isSourceSacrificeCost), ...(restriction ? { restriction } : {}) }] : []
      })
      const instruction = ability.instructions?.length === 1 ? ability.instructions[0] : undefined
      if (instruction?.kind === 'addManaFrom') {
        const amount = evaluateRuntimeAmount(instruction.amount, { state, controller: object.controller, source: captureObject(object) })
        return amount > 0 ? availableManaTypes(state, object, instruction.of, instruction.colorsOnly, undefined, instruction.basis).map(type => ({ abilityId: `$.abilities[${index}]`, cost: lockedManaCost({ mandatory: ability.costs }), pool: { [type]: amount }, choice: type, sacrifices: ability.costs.some(isSourceSacrificeCost) })) : []
      }
      const pool = fixedCanonicalMana(state, object, ability.instructions ?? [])
      const restriction = spendRestriction(ability.instructions ?? [], runtime)
      return pool ? [{ abilityId: `$.abilities[${index}]`, cost: lockedManaCost({ mandatory: ability.costs }), pool,
        sacrifices: ability.costs.some(isSourceSacrificeCost), ...(restriction ? { restriction } : {}) }] : []
    } catch {
      return []
    }
  })
}

/**
 * The costed mana abilities of a battlefield source whose result is known in
 * advance: `{1}, {T}: Add {G}{U}` (Signet),
 * `{G/U}, {T}: Add {G}{G}, {G}{U}, or {U}{U}` (filter land) and
 * `Sacrifice this token: Add {C}` (Eldrazi Spawn). Their cost keeps them out
 * of `manaModes`; the planner activates them as mana abilities.
 */
export const activatedManaOptions = (
  state: GameState,
  object: GameObject,
): ActivatedManaOption[] =>
  [...canonicalManaOptions(state, object), ...effectsOf(object).flatMap((effect): ActivatedManaOption[] => {
    if (
      effect.op !== 'activate'
      || !effect.manaAbility
      || !(effect.costs.mana || effect.costs.sacrifice)
      || !Object.keys(effect.costs).every((key) => ['mana', 'tap', 'sacrifice'].includes(key))
      || (effect.zone ?? 'battlefield') !== object.zone
      || !conditionHolds(effect.if, state, object)
    ) return []
    const choices = effect.do.filter((instruction) => instruction.kind === 'addManaChoice')
    const fixed = effect.do.filter((instruction) => instruction.kind === 'addMana')
    if (choices.length > 1 || choices.length + fixed.length !== effect.do.length) return []
    const base = fixed.reduce((pool, instruction) => addPools(pool, instruction.mana), {} as Pool)
    const cost = reducedActivationMana(state, object, effect.costs.mana)
    const sacrifices = Boolean(effect.costs.sacrifice)
    return choices.length === 0
      ? [{ abilityId: effect.id, cost, pool: base, sacrifices }]
      : choices[0].options.map((pool) => ({
          abilityId: effect.id,
          cost,
          pool: addPools(base, pool),
          choice: manaOptionId(pool),
          sacrifices,
        }))
  })]
