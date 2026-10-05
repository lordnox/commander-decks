import { openOptionSelection, pendingOptionSelection } from '../rules/selectOptions'
import type { GameObject, GameState, ManaId, ManaPool, Plugin } from '../types'
import { reducedActivationMana } from './activationCosts'
import { effectsOf } from './cardRules'
import { conditionHolds } from './effects'
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

export const addManaChoiceInstruction: InstructionHandler<'addManaChoice'> = (
  { draft, source, item },
  instruction,
) => {
  const pools = manaChoicePools(instruction.options)
  const named = item?.choices?.[0]
  if (named && pools[named]) {
    draft.enqueue({ type: 'addMana', seat: source.controller, mana: pools[named] })
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
    })
    draft.note(`${event.seat} adds ${event.optionId}`)
  },
}

export type ActivatedManaOption = {
  abilityId: string
  /** Mana paid from the pool before the ability adds `pool`. */
  cost: string
  pool: Pool
  /** The `choices[0]` that selects this pool, for abilities that offer several. */
  choice?: string
}

const addPools = (left: Pool, right: Pool) => {
  const sum: Pool = { ...left }
  for (const symbol of MANA_ORDER) {
    if (right[symbol]) sum[symbol] = (sum[symbol] ?? 0) + right[symbol]
  }
  return sum
}

/**
 * The costed mana abilities of a battlefield source whose result is known in
 * advance: `{1}, {T}: Add {G}{U}` (Signet) and
 * `{G/U}, {T}: Add {G}{G}, {G}{U}, or {U}{U}` (filter land). Their cost keeps
 * them out of `manaModes`; the planner activates them as mana abilities.
 */
export const activatedManaOptions = (
  state: GameState,
  object: GameObject,
): ActivatedManaOption[] =>
  effectsOf(object).flatMap((effect): ActivatedManaOption[] => {
    if (
      effect.op !== 'activate'
      || !effect.manaAbility
      || !effect.costs.mana
      || !Object.keys(effect.costs).every((key) => key === 'mana' || key === 'tap')
      || (effect.zone ?? 'battlefield') !== object.zone
      || !conditionHolds(effect.if, state, object)
    ) return []
    const choices = effect.do.filter((instruction) => instruction.kind === 'addManaChoice')
    const fixed = effect.do.filter((instruction) => instruction.kind === 'addMana')
    if (choices.length > 1 || choices.length + fixed.length !== effect.do.length) return []
    const base = fixed.reduce((pool, instruction) => addPools(pool, instruction.mana), {} as Pool)
    const cost = reducedActivationMana(state, object, effect.costs.mana)!
    return choices.length === 0
      ? [{ abilityId: effect.id, cost, pool: base }]
      : choices[0].options.map((pool) => ({
          abilityId: effect.id,
          cost,
          pool: addPools(base, pool),
          choice: manaOptionId(pool),
        }))
  })
