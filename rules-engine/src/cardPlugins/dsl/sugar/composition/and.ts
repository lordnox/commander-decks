import type { Instruction } from '../../schema/v1'
import { sequence } from '../../builders'

export const and = (...instructions: readonly Instruction[]): Instruction => sequence(...instructions)
