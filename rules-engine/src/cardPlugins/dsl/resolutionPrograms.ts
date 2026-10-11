import type { Cost, EffectDuration, Instruction, PlayerReference, CreatedEffect, DelayedPattern } from './schema/v1'

/** The durable context carried by a program created while another program resolves. */
export type ProgramContext = {
  definitionRevision: string
  source: { objectId: string; incarnation: number; name: string }
  controller: string
  parentStackId: string
}

export type ResolutionPaymentFrame = {
  id: string
  payer: PlayerReference
  cost: Cost
  resultBinding: string
  context: ProgramContext
  decision: 'waiting' | 'paid' | 'declined'
  /** The outcome is recorded independently of the destination chosen by replacement effects. */
  outcome?: { paid: boolean; actionSucceeded?: boolean; destination?: string }
  ifPaid: readonly Instruction[]
  ifDeclined: readonly Instruction[]
  whenPaid: readonly Instruction[]
}

export type TemporaryEffectInstance = {
  id: string
  source: ProgramContext
  targets: readonly string[]
  effect: CreatedEffect
  duration: EffectDuration
  createdAt: number
}

export type DelayedProgram = {
  id: string
  source: ProgramContext
  condition: DelayedPattern
  instructions: readonly Instruction[]
  recurring?: boolean
}

export type ReflexiveProgram = {
  id: string
  source: ProgramContext
  instructions: readonly Instruction[]
  /** The payment outcome that caused this program, available to target selection. */
  payment: { binding: string; paid: true }
}

export const openResolutionPayment = (
  input: Omit<ResolutionPaymentFrame, 'decision' | 'outcome'>,
): ResolutionPaymentFrame => ({ ...input, decision: 'waiting' })

export const settleResolutionPayment = (
  frame: ResolutionPaymentFrame,
  outcome: { paid: boolean; actionSucceeded?: boolean; destination?: string },
): ResolutionPaymentFrame => {
  if (frame.decision !== 'waiting') throw new Error('resolution payment is already settled')
  return { ...frame, decision: outcome.paid ? 'paid' : 'declined', outcome: { ...outcome } }
}

/** A reflexive program is queued separately, so declining a cost creates nothing. */
export const reflexiveFromPayment = (
  frame: ResolutionPaymentFrame,
): ReflexiveProgram | undefined => frame.decision === 'paid' && frame.outcome?.paid
  ? {
      id: `${frame.id}:reflexive`,
      source: structuredClone(frame.context),
      instructions: structuredClone(frame.whenPaid),
      payment: { binding: frame.resultBinding, paid: true },
    }
  : undefined

export const temporaryEffect = (input: Omit<TemporaryEffectInstance, 'id'> & { id?: string }): TemporaryEffectInstance => ({
  id: input.id ?? `${input.source.parentStackId}:effect:${input.createdAt}`,
  source: structuredClone(input.source),
  targets: [...input.targets],
  effect: structuredClone(input.effect),
  duration: structuredClone(input.duration),
  createdAt: input.createdAt,
})

export const delayedProgram = (input: Omit<DelayedProgram, 'id'> & { id?: string }): DelayedProgram => ({
  id: input.id ?? `${input.source.parentStackId}:delayed:${input.source.definitionRevision}`,
  source: structuredClone(input.source),
  condition: structuredClone(input.condition),
  instructions: structuredClone(input.instructions),
  ...(input.recurring ? { recurring: true } : {}),
})
