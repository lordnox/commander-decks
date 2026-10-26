import type { Instruction } from '../../schema/v2'
import { sequence } from '../../builders'

export const and = (...instructions: readonly Instruction[]): Instruction => sequence(...instructions)
