import { finishedSpellZone } from './cardPlugins/alternateCosts'
import { isSameObject } from './objectIdentity'
import {
  evaluatePlayerReference,
  evaluatePlayerSelector,
  evaluateRuntimeAmount,
  type RuleDslRuntimeContext,
} from './cardPlugins/dsl/compiler/runtime'
import { loadDefinitionSnapshot } from './cardPlugins/dsl/compiler'
import type {
  Instruction,
  PlayerRecipient,
  SpellAbilityDefinition,
} from './cardPlugins/dsl/schema/v1'
import type Draft from './draft'
import type {
  GameEvent,
  GameState,
  CanonicalResolutionFrame,
  StackItem,
} from './types'

export const CANONICAL_RUNTIME_INSTRUCTIONS = [
  'draw',
  'gainLife',
  'loseLife',
] as const

const spellAbility = (item: StackItem): { ability: SpellAbilityDefinition; index: number } | undefined => {
  const snapshot = item.execution?.definitionSnapshot
  if (!snapshot) return
  const compiled = loadDefinitionSnapshot(snapshot)
  const spells = compiled.definition.abilities.flatMap((ability, index) =>
    ability.kind === 'spell' ? [{ ability, index }] : [])
  if (spells.length !== 1) {
    throw new Error(`canonical spell requires exactly one spell ability; found ${spells.length}`)
  }
  return spells[0]
}

const preflightInstructions = (
  instructions: readonly Instruction[],
  path: string,
) => {
  instructions.forEach((instruction, index) => {
    const instructionPath = `${path}[${index}]`
    if (instruction.kind === 'sequence') {
      preflightInstructions(instruction.instructions, `${instructionPath}.instructions`)
      return
    }
    if (!['draw', 'gainLife', 'loseLife'].includes(instruction.kind)) {
      throw new Error(`${instructionPath}: ${instruction.kind} is not executable in Part 03`)
    }
  })
}

const pathError = (frame: CanonicalResolutionFrame, path: string, message: string) =>
  new Error(`${frame.declarationPath}${path}: ${message}`)

export const canonicalResolutionCandidate = (state: GameState) => {
  const item = state.stack[0]
  return item?.kind === 'spell' && item.execution?.definitionSnapshot ? item : undefined
}

export const startCanonicalResolution = (
  draft: Draft,
  item: StackItem,
): CanonicalResolutionFrame => {
  const selected = spellAbility(item)
  if (!selected) throw new Error('canonical spell is missing its pinned definition')
  const { ability, index: abilityIndex } = selected
  const declarationPath = `$.abilities[${abilityIndex}]`
  if (ability.decisions.targets.length > 0 || item.targets.length > 0) {
    throw new Error(`${declarationPath}.decisions.targets: Part 03 executes only untargeted spells`)
  }
  if ('modes' in ability) {
    throw new Error(`${declarationPath}.modes: modal execution begins in Part 09`)
  }
  if (ability.decisions.modes || ability.decisions.distributions) {
    throw new Error(`${declarationPath}.decisions: Part 03 executes only fully supplied plain programs`)
  }
  const source = item.execution?.source
  const definitionSnapshot = item.execution?.definitionSnapshot
  if (!source || !definitionSnapshot) throw new Error('canonical spell is missing execution context')
  const variables = ability.decisions.variables ?? []
  for (const variable of variables) {
    const value = item.x
    if (value === undefined || value < variable.min || value > variable.max) {
      throw new Error(`${declarationPath}.decisions.variables: ${variable.name} is outside its declared bounds`)
    }
  }
  preflightInstructions(ability.instructions, `${declarationPath}.instructions`)
  const frame: CanonicalResolutionFrame = {
    version: 1,
    kind: 'canonicalSpell',
    stackId: item.id,
    controller: item.controller,
    intendedPriority: draft.active,
    definitionSnapshot: structuredClone(definitionSnapshot),
    declarationPath,
    source: structuredClone(source),
    scopes: [{
      path: '.instructions',
      instructions: structuredClone(ability.instructions),
      cursor: 0,
    }],
    phase: 'running',
  }
  draft.resolution = frame
  draft.priority = null
  draft.passedInRow = []
  return frame
}

const runtimeContext = (
  state: GameState,
  frame: CanonicalResolutionFrame,
  item: StackItem,
): RuleDslRuntimeContext => ({
  state,
  controller: frame.controller,
  source: frame.source,
  stackItemId: item.id,
  ...(item.x === undefined ? {} : { variables: { X: item.x } }),
})

const recipients = (
  recipient: PlayerRecipient,
  context: RuleDslRuntimeContext,
) => recipient.kind === 'players'
  ? evaluatePlayerSelector(recipient, context)
  : evaluatePlayerReference(recipient, context)

const actionEvents = (
  instruction: Instruction,
  context: RuleDslRuntimeContext,
  frame: CanonicalResolutionFrame,
  path: string,
): GameEvent[] => {
  if (instruction.kind === 'draw') {
    const targets = recipients(instruction.targets, context)
    const amount = evaluateRuntimeAmount(instruction.count, context)
    if (amount === 0) return []
    return targets.map((seat) => ({ type: 'draw' as const, seat, count: amount }))
  }
  if (instruction.kind === 'gainLife' || instruction.kind === 'loseLife') {
    const targets = recipients(instruction.targets, context)
    const amount = evaluateRuntimeAmount(instruction.amount, context)
    if (amount === 0) return []
    return instruction.kind === 'gainLife'
      ? targets.map((seat) => ({
          type: 'gainLife' as const,
          seat,
          amount,
          source: frame.source.ref.objectId,
        }))
      : targets.map((seat) => ({
          type: 'loseLife' as const,
          seat,
          amount,
          source: frame.source.ref.objectId,
        }))
  }
  throw pathError(frame, path, `${instruction.kind} is not executable in Part 03`)
}

export type DriverStep =
  | { kind: 'events'; events: GameEvent[] }
  | { kind: 'complete'; event?: GameEvent }

/**
 * Advance data-only cursors until one semantic instruction is ready. The caller
 * commits the returned events before changing `phase` back to `running`.
 */
export const prepareResolutionStep = (draft: Draft): DriverStep => {
  const frame = draft.resolution
  if (!frame) throw new Error('no resolution frame is active')
  if (frame.kind !== 'canonicalSpell') throw new Error('active resolution is not canonical')
  const item = draft.stack.find((candidate) => candidate.id === frame.stackId)
  if (!item) throw new Error(`resolution stack item ${frame.stackId} is missing`)
  while (frame.scopes.length > 0) {
    const scope = frame.scopes.at(-1)!
    if (scope.cursor >= scope.instructions.length) {
      frame.scopes.pop()
      continue
    }
    const index = scope.cursor
    const instruction = scope.instructions[index]
    scope.cursor += 1
    const path = `${scope.path}[${index}]`
    if (instruction.kind === 'sequence') {
      frame.scopes.push({
        path: `${path}.instructions`,
        instructions: structuredClone(instruction.instructions),
        cursor: 0,
      })
      continue
    }
    frame.phase = 'committing'
    const events = actionEvents(instruction, runtimeContext(draft, frame, item), frame, path)
    frame.pendingEvents = structuredClone(events)
    return {
      kind: 'events',
      events,
    }
  }
  const object = draft.object(item.objectId)
  const event = object?.zone === 'stack' && isSameObject(object, frame.source.ref)
    ? {
        type: 'move' as const,
        objectId: object.id,
        to: finishedSpellZone(
          item,
          (item.adventureCast ? 'exile' : 'graveyard'),
        ),
      }
    : undefined
  return { kind: 'complete', event }
}

export const finishResolution = (draft: Draft) => {
  const frame = draft.resolution
  if (!frame) return
  draft.stack = draft.stack.filter((item) => item.id !== frame.stackId)
  draft.priority = frame.intendedPriority
  draft.passedInRow = []
  delete draft.resolution
}
