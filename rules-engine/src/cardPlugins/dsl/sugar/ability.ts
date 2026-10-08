import type {
  Instruction,
  OccurrencePattern,
  TriggeredAbilityDefinition,
  WheneverConfiguration,
} from '../schema/v1'
import { whenever } from '../builders'

type WheneverSugar = {
  (on: OccurrencePattern, instruction: Instruction, ...rest: readonly Instruction[]): TriggeredAbilityDefinition
  (on: OccurrencePattern, configuration: WheneverConfiguration): TriggeredAbilityDefinition
}

const wheneverSugar: WheneverSugar = (
  on: OccurrencePattern,
  instructionOrConfiguration: Instruction | WheneverConfiguration,
  ...rest: readonly Instruction[]
): TriggeredAbilityDefinition => {
  if ('kind' in instructionOrConfiguration) {
    return whenever(on, { instructions: [instructionOrConfiguration, ...rest] })
  }
  if (rest.length > 0) throw new TypeError('ability.whenever cannot mix a configuration with instruction arguments')
  return whenever(on, instructionOrConfiguration)
}

export const ability = Object.freeze({ whenever: wheneverSugar })
