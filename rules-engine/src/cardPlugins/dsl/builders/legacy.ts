import type { CardEffect, CardInstruction, PlayerSelector as LegacyPlayerSelector } from '../../effectDefinitions'
import type { Instruction, PlayerRecipient, TriggeredAbilityDefinition } from '../schema/v1'
import { inspectJsonData } from '../compiler/data'
import { RuleDslValidationError } from '../compiler/errors'
import { damage, draw, draws, gainLife, loseLife, players, ref, whenever, enters, dies } from './index'

const unsupported = (path: string, message: string): never => {
  throw new RuleDslValidationError([{ path, code: 'unsupported-legacy-adapter', message }])
}

const requireJsonData = (value: unknown): void => {
  const diagnostics = inspectJsonData(value)
  if (diagnostics.length > 0) throw new RuleDslValidationError(diagnostics)
}

const assertOnlyFields = (value: object, allowed: readonly string[], path: string): void => {
  const unsupportedField = Object.keys(value).find((key) => !allowed.includes(key))
  if (unsupportedField) unsupported(`${path}.${unsupportedField}`, 'legacy feature has no canonical Part 01 translation')
}

const playerSelector = (selector: LegacyPlayerSelector) => players(selector.filter)

const playerRecipient = (
  who: 'controller' | 'triggeringPlayer' | undefined,
  to: LegacyPlayerSelector | undefined,
  path: string,
): PlayerRecipient => {
  if (to) return playerSelector(to)
  if (who === undefined || who === 'controller') return ref('controller')
  if (who === 'triggeringPlayer') return ref('triggering.player')
  return unsupported(path, `legacy player recipient ${String(who)} needs a later scoped adapter`)
}

export const adaptLegacyPlayerInstruction = (
  instruction: CardInstruction,
  path = '$legacyInstruction',
): Instruction => {
  requireJsonData(instruction)
  switch (instruction.kind) {
    case 'draw':
      assertOnlyFields(instruction, ['kind', 'count', 'seat', 'who'], path)
      if (instruction.seat !== undefined || instruction.who === 'target') {
        return unsupported(path, 'seat snapshots and positional legacy draw targets are not representable in the Part 01 adapter')
      }
      return draw({
        count: instruction.count,
        targets: playerRecipient(instruction.who, undefined, `${path}.who`),
      })
    case 'gainLife':
      assertOnlyFields(instruction, ['kind', 'count', 'to'], path)
      if (instruction.count === 'triggerAmount') return unsupported(path, 'legacy triggerAmount requires an explicitly scoped canonical event amount')
      return gainLife({
        amount: instruction.count,
        targets: instruction.to ? playerSelector(instruction.to) : ref('controller'),
      })
    case 'damage':
      assertOnlyFields(instruction, ['kind', 'amount', 'to'], path)
      return damage({ amount: instruction.amount, targets: playerSelector(instruction.to), source: ref('source') })
    case 'loseLife':
      assertOnlyFields(instruction, ['kind', 'amount', 'who', 'to'], path)
      if (instruction.amount === 'triggerAmount') return unsupported(path, 'legacy triggerAmount requires an explicitly scoped canonical event amount')
      return loseLife({
        amount: instruction.amount,
        targets: playerRecipient(instruction.who, instruction.to, `${path}.who`),
      })
    default:
      return unsupported(path, `legacy instruction ${instruction.kind} has no pure Part 01 translation`)
  }
}

export const adaptLegacyTrigger = (
  effect: Extract<CardEffect, { op: 'trigger' }>,
  path = '$legacyTrigger',
): TriggeredAbilityDefinition => {
  requireJsonData(effect)
  if (effect.op !== 'trigger') unsupported(`${path}.op`, 'legacy adapter requires a trigger effect')
  if (!Array.isArray(effect.do)) unsupported(`${path}.do`, 'legacy trigger instructions must be an array')
  if (effect.on !== 'draw') {
    const scopedPlayerInstruction = effect.do.find((instruction) =>
      (instruction.kind === 'draw' || instruction.kind === 'loseLife')
      && instruction.who === 'triggeringPlayer')
    if (scopedPlayerInstruction) {
      unsupported(`${path}.do`, `legacy ${effect.on} does not expose triggeringPlayer in the canonical Part 01 scope`)
    }
  }
  const instructions = effect.do.map((instruction, index) =>
    adaptLegacyPlayerInstruction(instruction, `${path}.do[${index}]`))
  if (effect.on === 'enters' || effect.on === 'dies') {
    assertOnlyFields(effect, ['op', 'on', 'do'], path)
    return effect.on === 'enters'
      ? whenever(enters({ filter: ref('self') }), { instructions })
      : whenever(dies({ filter: ref('self') }), { instructions })
  }
  if (effect.on === 'draw') {
    assertOnlyFields(effect, ['op', 'on', 'do', 'player'], path)
    const filter = typeof effect.player === 'string'
      ? { relation: effect.player }
      : effect.player ?? { relation: 'any' as const }
    return whenever(draws({ player: players(filter) }), { instructions })
  }
  return unsupported(`${path}.on`, `legacy trigger ${effect.on} has no pure Part 01 translation`)
}
