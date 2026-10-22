import type { GameObject, GameState, ManaId } from '../../types'
import type { RuleDslRuntimeContext } from './compiler/runtime'
import { MANA_QUERY_BASIS } from './schema/v1'
import type { Instruction, ManaQueryBasis, ObjectSelector } from './schema/v1'
import { captureObject } from '../../objectIdentity'
import { activatedManaOptions } from '../manaChoice'
import { hasForestOverlay } from '../../plugins/forestOverlay'
import { hasSwampOverlay } from '../../plugins/swampOverlay'
import { manaModes } from '../../plugins/mana'
import { evaluateCondition, evaluateObjectSelector, evaluateRuntimeAmount } from './compiler/runtime'

export const MANA_TYPES = ['W', 'U', 'B', 'R', 'G', 'C'] as const
const BASIC_TYPES: Readonly<Record<string, ManaId>> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

const selectedCardColors = (of: ObjectSelector, context: RuleDslRuntimeContext) => {
  const cards = evaluateObjectSelector(of, context)
  return MANA_TYPES.filter(type => type !== 'C' && cards.some(card => card.colors.includes(type)))
}

/** Production queries ignore activation costs; color queries read the selected cards' current colors. */
export const availableManaTypes = (state: GameState, source: GameObject, of: ObjectSelector, colorsOnly: boolean, context?: RuleDslRuntimeContext, basis: ManaQueryBasis = MANA_QUERY_BASIS.production) => {
  if (basis === MANA_QUERY_BASIS.colors) return selectedCardColors(of, context ?? { state, controller: source.controller, source: captureObject(source) })
  const permanents = Object.values(state.objects).filter(object => object.zone === 'battlefield' && !object.phasedOut)
  const known = new Map(permanents.map(object => [object.id, new Set<ManaId>()]))
  const contextFor = (object: GameObject) => ({ state, controller: object.controller, source: captureObject(object) })
  const queried = (object: GameObject, selector: ObjectSelector, colors: boolean) => {
    const selected = evaluateObjectSelector(selector, contextFor(object))
    return MANA_TYPES.filter(type => (!colors || type !== 'C') && selected.some(candidate => known.get(candidate.id)?.has(type)))
  }
  // A monotone fixed point has at most six new facts per permanent. Cycles alone
  // contribute nothing; a real producer propagates through every connected query.
  let changed = true
  while (changed) {
    changed = false
    for (const object of permanents) {
      const types = known.get(object.id)!
      const add = (type: ManaId) => { if (!types.has(type)) { types.add(type); changed = true } }
      if (object.types.includes('Land')) {
        for (const subtype of object.subtypes) if (BASIC_TYPES[subtype]) add(BASIC_TYPES[subtype])
        if (hasForestOverlay(state)) add('G')
        if (hasSwampOverlay(state)) add('B')
      }
      if (!object.ruleDefinition) {
        for (const pool of [...manaModes(object, state), ...activatedManaOptions(state, object).map(option => option.pool)]) for (const type of MANA_TYPES) if ((pool[type] ?? 0) > 0) add(type)
        continue
      }
      const producerContext = contextFor(object)
      // The recursive instruction walk needs an explicit return type for inference.
      const walk = (instructions: readonly Instruction[]): void => {
        for (const instruction of instructions) {
          switch (instruction.kind) {
            case 'addMana':
              for (const type of MANA_TYPES) if (instruction.amount[type] && evaluateRuntimeAmount(instruction.amount[type]!, producerContext) > 0) add(type)
              break
            case 'addManaFrom':
              if (evaluateRuntimeAmount(instruction.amount, producerContext) > 0) for (const type of instruction.basis === MANA_QUERY_BASIS.colors ? selectedCardColors(instruction.of, producerContext) : queried(object, instruction.of, instruction.colorsOnly)) add(type)
              break
            case 'sequence':
            case 'forEach':
            case 'forEachPlayer': walk(instruction.instructions); break
            case 'chooseInstructions': for (const option of instruction.options) walk(option.instructions); break
            case 'if': walk(evaluateCondition(instruction.condition, producerContext) ? instruction.then : instruction.otherwise); break
          }
        }
      }
      for (const ability of object.ruleDefinition.definition.abilities) {
        if (ability.kind === 'activated' && ability.availableFrom.includes('battlefield')) walk(ability.instructions ?? ability.modes?.flatMap(mode => mode.instructions) ?? [])
      }
    }
  }
  if (!context) return queried(source, of, colorsOnly)
  const selected = evaluateObjectSelector(of, context)
  return MANA_TYPES.filter(type => (!colorsOnly || type !== 'C') && selected.some(object => known.get(object.id)?.has(type)))
}

export const manaFromPools = (state: GameState, source: GameObject, instruction: Extract<Instruction, { kind: 'addManaFrom' }>) => {
  const amount = evaluateRuntimeAmount(instruction.amount, { state, controller: source.controller, source: captureObject(source) })
  return amount > 0 ? availableManaTypes(state, source, instruction.of, instruction.colorsOnly, undefined, instruction.basis).map(type => ({ [type]: amount })) : []
}
