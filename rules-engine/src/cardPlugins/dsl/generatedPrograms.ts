import { definitionRevisionFor } from './builders/revision'
import { RULE_DSL_SCHEMA_VERSION } from './schema/v1'
import type { InstructionResult, GeneratedAbility, Instruction, ResultField, TriggeredAbilityDefinition } from './schema/v1'
import type { ZoneId } from '../../types'

/**
 * Generated abilities are stored outside a card definition because their
 * recipient is the source permanent.  The canonical driver still expects a
 * definition snapshot, so give each generated program a small, content pinned
 * wrapper.  A delayed program's event/step condition is already matched by
 * the delayed-trigger registry; its wrapper only needs a valid trigger shape.
 */
export const generatedAbilitySnapshot = (
  ability: GeneratedAbility,
  inheritedDecisions: GeneratedAbility['decisions'] = ability.decisions,
  capturedBindings?: TriggeredAbilityDefinition['capturedBindings'],
) => {
  let on: TriggeredAbilityDefinition['on']
  switch (ability.on.kind) {
    case 'abilityActivated':
    case 'becomesTapped':
    case 'tappedForMana':
    case 'attacks':
    case 'dealtDamage':
    case 'playerAttacks':
    case 'stepBegins':
    case 'playLand':
    case 'discard':
    case 'cycle':
    case 'cast':
    case 'enters':
    case 'dies':
    case 'leaves':
    case 'draw':
    case 'gainedLife':
    case 'moved':
    case 'tokenCreated':
    case 'sacrificed':
    case 'manaAdded':
    case 'manaAbilityActivated':
    case 'manaAbilityResolved':
    case 'unlockDoor':
    case 'fullyUnlock':
      on = ability.on
      break
    default:
      on = { kind: 'draw', filter: {} }
  }
  const generated: TriggeredAbilityDefinition = {
    kind: 'triggered',
    generated: true,
    ...(capturedBindings ?? ability.capturedBindings ? { capturedBindings: capturedBindings ?? ability.capturedBindings } : {}),
    activeIn: ['battlefield'],
    on,
    decisions: {
      targets: inheritedDecisions?.targets ?? [],
      ...(inheritedDecisions?.constraints ? { constraints: inheritedDecisions.constraints } : {}),
      ...(inheritedDecisions?.variables ? { variables: inheritedDecisions.variables } : {}),
      ...(inheritedDecisions?.distributions ? { distributions: inheritedDecisions.distributions } : {}),
    },
    instructions: ability.instructions,
  }
  const definitionRevision = definitionRevisionFor({
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    abilities: [generated],
  })
  return {
    schemaVersion: RULE_DSL_SCHEMA_VERSION,
    definitionRevision,
    definition: {
      schemaVersion: RULE_DSL_SCHEMA_VERSION,
      definitionRevision,
      abilities: [generated],
    },
  }
}

type CapturedChoice = readonly (({ kind: 'object' } & { objectId: string; incarnation?: number; zone?: ZoneId }) | { kind: 'player'; playerId: string })[]

type RewrittenInstructions = {
  instructions: Instruction[]
  shadowed: Set<string>
}

type CapturedOccurrenceBinding = 'player' | 'object.before' | 'object.after' | 'source'

export const occurrenceBindingsForPattern = (pattern: { kind: string; active?: unknown }): CapturedOccurrenceBinding[] => {
  switch (pattern.kind) {
    case 'becomesTapped':
    case 'tappedForMana':
    case 'attacks':
    case 'cast': return ['player', 'object.after']
    case 'dealtDamage': return ['player', 'object.after', 'source']
    case 'abilityActivated':
    case 'playerAttacks': return ['player']
    case 'stepBegins':
    case 'playLand':
    case 'discard': return ['player']
    case 'cycle': return ['player', 'object.after']
    case 'draw':
    case 'gainedLife': return ['player']
    case 'moved': return ['object.before', 'object.after']
    case 'tokenCreated':
    case 'enters': return ['object.after']
    case 'sacrificed': return ['object.before', 'object.after']
    case 'unlockDoor':
    case 'fullyUnlock': return ['player', 'object.after']
    case 'dies': return ['object.before', 'object.after']
    case 'leaves': return ['object.before']
    case 'step': return pattern.active === undefined ? [] : ['player']
    default: return []
  }
}

const bindingAlias = (kind: 'choice' | 'result', binding: string, used: Set<string>) => {
  const safe = binding.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'binding'
  let candidate = `captured${kind === 'choice' ? 'Choice' : 'Result'}_${safe}`
  let suffix = 2
  while (used.has(candidate)) candidate = `captured${kind === 'choice' ? 'Choice' : 'Result'}_${safe}_${suffix++}`
  used.add(candidate)
  return candidate
}

const inspectBindings = (
  value: unknown,
  choices: Set<string>,
  results: Map<string, Set<string>>,
  occurrences: Set<CapturedOccurrenceBinding>,
  used: Set<string>,
) => {
  if (Array.isArray(value)) {
    value.forEach((part) => inspectBindings(part, choices, results, occurrences, used))
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  switch (node.kind) {
    case 'choiceRef':
      if (typeof node.binding === 'string') choices.add(node.binding)
      break
    case 'resultRef': {
      if (typeof node.binding !== 'string') break
      const fields = results.get(node.binding) ?? new Set<string>()
      if (typeof node.field === 'string') fields.add(node.field)
      results.set(node.binding, fields)
      break
    }
    case 'contextRef':
      if (node.name === 'triggering.player') occurrences.add('player')
      if (node.name === 'triggering.object.before') occurrences.add('object.before')
      if (node.name === 'triggering.object.after') occurrences.add('object.after')
      if (node.name === 'triggering.source') occurrences.add('source')
      break
  }
  if (typeof node.bindChoice === 'string') used.add(node.bindChoice)
  if (typeof node.bindResult === 'string') used.add(node.bindResult)
  if (typeof node.bindCount === 'string') used.add(node.bindCount)
  Object.values(node).forEach((part) => inspectBindings(part, choices, results, occurrences, used))
}

const rewriteInstructions = (
  instructions: readonly Instruction[],
  choiceAliases: Readonly<Record<string, string>>,
  resultAliases: Readonly<Record<string, string>>,
  inheritedShadowed = new Set<string>(),
): RewrittenInstructions => {
  const shadowed = new Set(inheritedShadowed)
  const rewriteValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteValue)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, unknown>
    if (node.kind === 'choiceRef' && typeof node.binding === 'string') {
      const alias = choiceAliases[node.binding]
      return alias && !shadowed.has(node.binding) ? { ...node, binding: alias } : node
    }
    if (node.kind === 'resultRef' && typeof node.binding === 'string') {
      const alias = resultAliases[node.binding]
      return alias && !shadowed.has(node.binding) ? { ...node, binding: alias } : node
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, rewriteValue(child)]))
  }
  const rewritten = instructions.map((instruction) => {
    switch (instruction.kind) {
      case 'sequence': {
        const nested = rewriteInstructions(instruction.instructions, choiceAliases, resultAliases, shadowed)
        nested.shadowed.forEach((name) => shadowed.add(name))
        return { ...instruction, instructions: nested.instructions }
      }
      case 'forEachPlayer': {
        const nested = rewriteInstructions(instruction.instructions, choiceAliases, resultAliases, shadowed)
        const bindMax = instruction.bindMax
          ? {
              ...instruction.bindMax,
              as: resultAliases[instruction.bindMax.as] ?? instruction.bindMax.as,
            }
          : undefined
        return {
          ...instruction,
          of: rewriteValue(instruction.of) as typeof instruction.of,
          instructions: nested.instructions,
          ...(bindMax ? { bindMax } : {}),
        }
      }
      case 'forEach': {
        const nested = rewriteInstructions(instruction.instructions, choiceAliases, resultAliases, shadowed)
        nested.shadowed.forEach((name) => shadowed.add(name))
        return {
          ...instruction,
          of: rewriteValue(instruction.of) as typeof instruction.of,
          instructions: nested.instructions,
        }
      }
      case 'if':
        return {
          ...instruction,
          condition: rewriteValue(instruction.condition) as typeof instruction.condition,
          then: rewriteInstructions(instruction.then, choiceAliases, resultAliases, new Set(shadowed)).instructions,
          otherwise: rewriteInstructions(instruction.otherwise, choiceAliases, resultAliases, new Set(shadowed)).instructions,
        }
      case 'repeat': {
        const nested = rewriteInstructions(instruction.instructions, choiceAliases, resultAliases, shadowed)
        return { ...instruction, count: rewriteValue(instruction.count) as typeof instruction.count, instructions: nested.instructions }
      }
      case 'repeatWhile': {
        const nested = rewriteInstructions(instruction.instructions, choiceAliases, resultAliases, shadowed)
        nested.shadowed.forEach((name) => shadowed.add(name))
        return {
          ...instruction,
          condition: rewriteValue(instruction.condition) as typeof instruction.condition,
          instructions: nested.instructions,
        }
      }
      case 'chooseInstructions':
        return {
          ...instruction,
          chooser: rewriteValue(instruction.chooser) as typeof instruction.chooser,
          options: instruction.options.map((option) => ({
            ...option,
            instructions: rewriteInstructions(option.instructions, choiceAliases, resultAliases, new Set(shadowed)).instructions,
          })),
        }
      default:
        break
    }
    const rewrittenInstruction = rewriteValue(instruction) as Instruction
    if ('bindChoice' in instruction && typeof instruction.bindChoice === 'string') shadowed.add(instruction.bindChoice)
    if ('bindResult' in instruction && typeof instruction.bindResult === 'string') shadowed.add(instruction.bindResult)
    if ('bindCount' in instruction && typeof instruction.bindCount === 'string') shadowed.add(instruction.bindCount)
    return rewrittenInstruction
  })
  return { instructions: rewritten, shadowed }
}

export const rewriteCapturedReferences = (
  value: unknown,
  choiceAliases: Readonly<Record<string, string>>,
  resultAliases: Readonly<Record<string, string>>,
) => {
  const rewrite = (part: unknown): unknown => {
    if (Array.isArray(part)) return part.map(rewrite)
    if (!part || typeof part !== 'object') return part
    const node = part as Record<string, unknown>
    if (node.kind === 'choiceRef' && typeof node.binding === 'string' && choiceAliases[node.binding]) {
      return { ...node, binding: choiceAliases[node.binding] }
    }
    if (node.kind === 'resultRef' && typeof node.binding === 'string' && resultAliases[node.binding]) {
      return { ...node, binding: resultAliases[node.binding] }
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, rewrite(child)]))
  }
  return rewrite(value)
}

/** Capture parent lexical bindings as ordinary generated-program locals.
 *
 * Choices remain choice references throughout compilation and resolution.  The
 * generated snapshot metadata declares the aliases to the compiler, while
 * resolution supplies their captured frame values. Aliases isolate parent
 * locals from bindings declared by the generated program itself.
 */
export const captureLexicalBindings = (
  instructions: readonly Instruction[],
  choices: Readonly<Record<string, CapturedChoice>> = {},
  results: Readonly<Record<string, InstructionResult>> = {},
  additionalValues: readonly unknown[] = [],
  localOccurrenceBindings: readonly CapturedOccurrenceBinding[] = [],
  playerChoiceBindings: readonly string[] = [],
) => {
  const referencedChoices = new Set<string>()
  const referencedResults = new Map<string, Set<string>>()
  const referencedOccurrences = new Set<CapturedOccurrenceBinding>()
  const usedBindings = new Set<string>([...Object.keys(choices), ...Object.keys(results)])
  inspectBindings(instructions, referencedChoices, referencedResults, referencedOccurrences, usedBindings)
  additionalValues.forEach((value) => inspectBindings(value, referencedChoices, referencedResults, referencedOccurrences, usedBindings))
  localOccurrenceBindings.forEach((binding) => referencedOccurrences.delete(binding))
  const choiceAliases: Record<string, string> = {}
  const resultAliases: Record<string, string> = {}
  referencedChoices.forEach((binding) => {
    if (choices[binding] !== undefined) choiceAliases[binding] = bindingAlias('choice', binding, usedBindings)
  })
  referencedResults.forEach((_fields, binding) => {
    if (results[binding] !== undefined) resultAliases[binding] = bindingAlias('result', binding, usedBindings)
  })
  const playerAliases = Object.entries(choiceAliases).filter(([binding]) => playerChoiceBindings.includes(binding) || choices[binding]?.[0]?.kind === 'player').map(([, alias]) => alias)
  const rewritten = rewriteInstructions(instructions, choiceAliases, resultAliases)
  const rewrittenAdditionalValues = additionalValues.map((value) => rewriteCapturedReferences(value, choiceAliases, resultAliases))
  return {
    instructions: rewritten.instructions,
    choiceAliases,
    resultAliases,
    rewrittenAdditionalValues,
    capturedBindings: {
      ...(playerAliases.length ? { playerChoices: playerAliases } : {}),
      ...(Object.keys(choiceAliases).length > 0 ? { choices: Object.values(choiceAliases) } : {}),
      ...(Object.keys(resultAliases).length > 0
        ? {
            results: Object.fromEntries(Object.entries(resultAliases).map(([original, alias]) => [
              alias,
              [...(referencedResults.get(original) ?? new Set<string>())] as ResultField[],
            ])),
          }
        : {}),
      ...(referencedOccurrences.size > 0 ? { occurrence: [...referencedOccurrences] } : {}),
    },
  }
}
