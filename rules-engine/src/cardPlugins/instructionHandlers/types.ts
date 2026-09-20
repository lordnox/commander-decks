import type Draft from '../../draft'
import type { GameObject, PlayerId, StackItem } from '../../types'
import type { CardInstruction } from '../effects'

export type BufferedStackAction =
  | { kind: 'draw'; remaining: number; seat?: PlayerId }
  | { kind: 'discard'; count: number; who?: 'controller' | 'target' }

export type InstructionContext = {
  draft: Draft
  source: GameObject
  item?: StackItem
  buffer?: BufferedStackAction[]
  run: (instructions: CardInstruction[], source?: GameObject) => void
}

export type InstructionKind = CardInstruction['kind']
export type InstructionFor<K extends InstructionKind> = Extract<CardInstruction, { kind: K }>
export type InstructionHandler<K extends InstructionKind> = (
  ctx: InstructionContext,
  instruction: InstructionFor<K>,
) => void

export type InstructionHandlers = {
  [K in InstructionKind]: InstructionHandler<K>
}
