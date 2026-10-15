import { ref } from '../../rules-engine/src/cardPlugins/dsl/v1'
import type { Instruction } from '../../rules-engine/src/cardPlugins/dsl/v1'
import type { GameState } from '../../rules-engine/src/types'
import type { PendingOptionSelection } from '../../rules-engine/src/rules/selectOptions'

const CONTROLLER_REFERENCE = ref('controller')

// Explicit return type is needed for recursive sequence inference.
const onlyControllerDraws = (instructions: readonly Instruction[]): boolean =>
  instructions.length > 0 && instructions.every((instruction) => {
    switch (instruction.kind) {
      case 'sequence': return onlyControllerDraws(instruction.instructions)
      case 'draw': return instruction.targets.kind === 'contextRef' && instruction.targets.name === CONTROLLER_REFERENCE.name
      default: return false
    }
  })

/** Host policy: offer saved draw preferences only for a standalone controller draw. */
export const optionalDrawOffer = (state: GameState, pending: PendingOptionSelection) => {
  const action = pending.action
  const optional = pending.optionalAction
  const frame = state.resolution
  if (!optional || action.kind !== 'canonicalInstructionChoice'
    || frame?.kind !== 'canonicalSpell' || frame.stackId !== action.stackId
    || pending.seat !== frame.controller || frame.scopes.length !== 1) return
  const scope = frame.scopes[0]
  if (scope.path !== '.instructions' || scope.instructions.length !== 1) return
  const accepted = action.options[optional.acceptSlot]?.instructions
  const declined = action.options[optional.declineSlot]?.instructions
  if (!accepted || !onlyControllerDraws(accepted) || declined?.length !== 0) return
  return { ...optional, label: `${pending.source ?? 'Ability'} — optional draw` }
}
