import { isPermanentType } from '../definitions'
import { captureObject } from '../objectIdentity'
import { poolTotal, type Draft } from '../draft'
import type {
  GameObject,
  GameState,
  GameEvent,
  ManaId,
  ManaPool,
  PlayerId,
  Plugin,
  RestrictedMana,
  TargetRef,
} from '../types'
import type { CastCostCondition } from '../cardPlugins/effectDefinitions'
import { spreeExtraCost, spreeModesOf } from '../spreeCost'
import { searchEffect } from '../cardPlugins/effects'
import { conditionHolds } from '../cardPlugins/effects'
import { effectsOf } from '../cardPlugins/cardRules'
import {
  extraKickMana,
  hasMultikicker,
  timesKickedFromCast,
} from './kickCast'
import {
  alternateCastEffect,
  availableAlternateCastEffect,
  finishedSpellZone,
  printedAlternateManaCost,
  type AlternateCastEffect,
} from '../cardPlugins/alternateCosts'
import { canPlayExiledWithLife } from '../cardPlugins/exiledWith'
import { manaValueOf } from '../cardPlugins/effects'
import { validTargetRef } from '../cardPlugins/targetedResolve'
import { resolveAbility, resolveAction } from '../rules/actions'
import { PENDING_STEAL_CAST } from '../rules/selectCards'
import { ceaseToExist } from '../rules/spellCopies'
import { applyCastFace, resolveCastFace } from './adventure'
import { giftSpecOf } from '../cardPlugins/giftCast'
import { reboundsOnResolution } from './rebound'
import { cantCastSpellWith } from './opponentRestrictions'
import { enchantTargetError } from './enchant'
import { applyRoomDoors } from './rooms'
import { mayCastAsThoughFlash } from './flashGrant'
import { canonicalFlagbearerError, canonicalTargetBindings, canonicalTargetError } from '../cardPlugins/dsl/compiler/targeting'
import { activationPermission, beginSpellAnnouncement, commitAnnouncement, compileCardRuleDefinition, createDefinitionSnapshot, evaluateAnnouncementCostAmount } from '../cardPlugins/dsl/compiler'
import { canonicalManaClassification } from '../cardPlugins/activated'
import type { AnnouncementTransaction } from '../cardPlugins/dsl/compiler/announcement'
import type { Cost } from '../cardPlugins/dsl/schema/v1'
import { evaluateModeCount, modalTargetLayout, resolveModalInputs, selectedDistributionScopeIds, selectedDistributionSpecs, validateScopedDistributions } from '../cardPlugins/dsl/compiler/modes'
import { amountEvaluationContext } from '../cardPlugins/dsl/compiler/runtime'

type InternalCastEvent = Extract<GameEvent, { type: 'castSpell' }>

const modalInputs = (state: GameState, source: GameObject, ability: Extract<import('../cardPlugins/dsl/schema/v1').AbilityDefinition, { kind: 'spell' }>, abilityIndex: number, event: InternalCastEvent) => {
  if (!('modes' in ability)) return undefined
  const layout = resolveModalInputs(ability, abilityIndex, event.modeIndices, {
    state,
    controller: event.seat,
    source: captureObject(source),
    variables: event.x === undefined ? undefined : { X: event.x },
  })
  return {
    targetClauses: layout.map((entry) => entry.clause),
    scopeIds: layout.map((entry) => entry.scopeId),
    modeIndices: layout.map((entry) => entry.modeIndex),
    modeCount: evaluateModeCount(ability.decisions.modes!, {
      state,
      controller: event.seat,
      source: captureObject(source),
      variables: event.x === undefined ? undefined : { X: event.x },
    }),
  }
}

/** Build the server-owned payment frame before any planned mana event runs. */
export const preparePlannedSpellAnnouncement = (state: import('../types').GameState, event: InternalCastEvent) => {
  if (!event.manaActivations?.length) return { ok: false as const, error: 'mana payment plan is empty' }
  const source = state.objects[event.objectId]
  if (!source?.ruleDefinition) return { ok: false as const, error: 'planned payment requires a canonical spell' }
  const compiled = compileCardRuleDefinition(source.ruleDefinition.definition)
  const ability = compiled.definition.abilities.find((candidate) => candidate.kind === 'spell')
  if (!ability) return { ok: false as const, error: 'spell ability does not exist' }
  const abilityIndex = compiled.definition.abilities.findIndex((candidate) => candidate.kind === 'spell')
  const modal = modalInputs(state, source, ability, abilityIndex, event)
  const targetClauses = modal?.targetClauses ?? ability.decisions.targets
  const groupedTargets = targetClauses.length === 0
    ? []
    : event.targetClauses ?? (targetClauses.length === 1 ? [event.targets ?? []] : undefined)
  if (!groupedTargets) return { ok: false as const, error: 'targets are required for the spell' }
  const locked = beginSpellAnnouncement(
    state,
    source,
    event.seat,
    ability,
    groupedTargets,
    event.x,
    [...(event.discard ?? []), ...(event.sacrifice ?? [])],
    {
      selectedOptional: event.selectedOptionalCosts,
      selectedAlternative: event.selectedAlternativeCost,
      deferPayment: true,
      targetClauses,
      genericAdjustment: canonicalGenericAdjustment(source, spellCost(state, source, {
        additionalGeneric: event.additionalGeneric,
        x: event.x,
        castOption: event.castOption,
        kicked: event.kicked,
        spreeModes: event.spreeModes,
        timesKicked: event.timesKicked,
        targets: event.targets,
        seat: event.seat,
        withoutPayingMana: event.alternativeCost === 'withoutPayingMana' || event.withoutPayingMana,
      }), event.x),
    },
  )
  if (!locked.ok) return locked
  const targetBindings = canonicalTargetBindings(
    state,
    source,
    compiled.definition,
    abilityIndex,
    event.targets ?? event.targetClauses?.flat() ?? [],
    undefined,
    groupedTargets,
    event.seat,
    event.x,
    modal?.targetClauses,
    modal?.scopeIds,
    modal?.modeIndices,
  )
  let distributionBindings = event.distributionBindings
  const distributionSpecs = selectedDistributionSpecs(ability, event.modeIndices)
  if (distributionSpecs.length > 0) {
    distributionBindings = validateScopedDistributions(
      distributionSpecs,
      event.distributionBindings ?? [],
      (scopeId, clauseIndex) => targetBindings.find((binding) => binding.scopeId === scopeId && binding.clauseIndex === clauseIndex)?.recipients ?? [],
      amountEvaluationContext({ state, controller: event.seat, source: captureObject(source), variables: event.x === undefined ? undefined : { X: event.x } }),
      selectedDistributionScopeIds(abilityIndex, ability, event.modeIndices),
    )
  }
  const activations: Array<Extract<GameEvent, { type: 'activateAbility' }>> = []
  for (const plan of event.manaActivations) {
    const paymentSource = state.objects[plan.objectId]
    if (!paymentSource?.ruleDefinition) return { ok: false as const, error: 'planned payment source is not canonical' }
    const paymentCompiled = compileCardRuleDefinition(paymentSource.ruleDefinition.definition)
    const index = /^\$\.abilities\[(\d+)\]$/.exec(plan.abilityId)?.[1]
    const paymentAbility = index === undefined ? undefined : paymentCompiled.definition.abilities[Number(index)]
    if (!paymentAbility || paymentAbility.kind !== 'activated') return { ok: false as const, error: 'planned payment ability does not exist' }
    const permissionError = activationPermission({
      state, sourceId: paymentSource.id, payer: event.seat, action: 'manaPlanning', availableFrom: paymentAbility.availableFrom,
    })
    if (permissionError) return { ok: false as const, error: permissionError }
    const classification = canonicalManaClassification(paymentAbility)
    if (!classification.isManaAbility) return { ok: false as const, error: 'planned payment ability is not a mana ability' }
    activations.push({
      type: 'activateAbility', seat: event.seat, objectId: plan.objectId, abilityId: plan.abilityId,
      manaAbility: true, ...(plan.choices ? { choices: plan.choices } : {}), ...(plan.x !== undefined ? { x: plan.x } : {}),
    })
  }
  const { manaActivations: _plan, ...cast } = event
  return {
    ok: true as const,
    transaction: { ...locked.transaction, targetBindings, ...(distributionBindings ? { distributionBindings } : {}), ...(modal?.modeCount !== undefined ? { modeCount: modal.modeCount } : {}) },
    source: captureObject(source),
    definitionSnapshot: createDefinitionSnapshot(compiled),
    activations,
    continuation: { ...cast, canonicalTransaction: { ...locked.transaction, targetBindings, ...(distributionBindings ? { distributionBindings } : {}), ...(modal?.modeCount !== undefined ? { modeCount: modal.modeCount } : {}) } } as Extract<GameEvent, { type: 'castSpell' }>,
  }
}

const compiledCanonicalHasCost = (object: GameObject, kind: Cost['kind']): boolean => {
  if (!object.ruleDefinition) return false
  const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
  const spell = compiled.definition.abilities.find((ability) => ability.kind === 'spell')
  return spell?.costs.some((cost) => cost.kind === kind) ?? false
}
import { pinTarget } from '../objectIdentity'

const MANA_ORDER: ManaId[] = ['C', 'W', 'U', 'B', 'R', 'G']
const MANA_SYMBOLS = new Set<ManaId>(MANA_ORDER)

const targetKey = (state: GameState, target: TargetRef) => {
  const pinned = pinTarget(state, target)
  switch (pinned.kind) {
    case 'player': return `player:${pinned.player}`
    case 'stackItem': return `stack:${pinned.stackId}`
    case 'object': return `object:${pinned.objectId}:${pinned.incarnation ?? ''}:${pinned.zone ?? ''}`
  }
}

const targetInputsAgree = (state: GameState, event: Extract<import('../types').GameEvent, { type: 'castSpell' }>) => {
  if (!event.targets || !event.targetClauses) return true
  const flat = event.targetClauses.flat()
  return flat.length === event.targets.length
    && flat.every((target, index) => targetKey(state, target) === targetKey(state, event.targets![index]))
}

const genericCost = (manaCost: string) =>
  [...manaCost.matchAll(/\{(\d+)\}/g)].reduce((total, match) => total + Number(match[1]), 0)

const canonicalGenericAdjustment = (object: GameObject, adjustedMana: string, x = 0) => {
  const base = object.manaCost.replaceAll('{X}', x > 0 ? `{${x}}` : '')
  return genericCost(adjustedMana) - genericCost(base)
}

const xManaKind = (object: GameObject) =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.xMana ? [effect.xMana] : [])[0]

export { kickerCostOf, multikickerCostOf, hasMultikicker } from './kickCast'

export const reduceGenericManaCost = (manaCost: string, amount: number) => {
  const reduced = Math.max(0, genericCost(manaCost) - amount)
  const nonGeneric = manaCost.replaceAll(/\{\d+\}/g, '')
  return `${reduced > 0 ? `{${reduced}}` : ''}${nonGeneric}`
}

const reductionApplies = (
  state: GameState,
  object: GameObject,
  condition: CastCostCondition,
  targets: TargetRef[],
  seat: PlayerId,
) => {
  if (condition.kind !== 'target') return conditionHolds(condition, state, object)
  return targets.some((target) =>
    validTargetRef(state, target, condition.filter, seat))
}

export const spellCost = (
  state: GameState,
  object: GameObject,
  options: {
    additionalGeneric?: number
    x?: number
    castOption?: string
    kicked?: boolean
    spreeModes?: string[]
    timesKicked?: number
    targets?: TargetRef[]
    seat?: PlayerId
    selected?: AlternateCastEffect
    withoutPayingMana?: boolean
  } = {},
) => {
  const seat = options.seat ?? object.controller
  const selected = options.selected ?? (
    options.castOption
      ? availableAlternateCastEffect(state, seat, object, options.castOption)
      : undefined
  ) ?? alternateCastEffect(object, options.castOption)
  const bestowed = options.castOption === 'bestow'
    ? effectsOf(object).find((effect) => effect.op === 'bestow')
    : undefined
  const x = options.x ?? 0
  const xCost = xManaKind(object) === 'black'
    ? '{B}'.repeat(x)
    : x > 0 ? `{${x}}` : ''
  const withX = (manaCost: string) => manaCost.replaceAll('{X}', xCost)
  const base = options.withoutPayingMana || options.castOption === 'exiledWithLife'
    ? ''
    : (selected ? withX(printedAlternateManaCost(selected, object)) : undefined)
      ?? bestowed?.cost
      ?? withX(object.manaCost)
  const total = `${base}${
    (options.additionalGeneric ?? 0) > 0 ? `{${options.additionalGeneric}}` : ''
  }${
    options.spreeModes && options.spreeModes.length > 0
      ? spreeExtraCost(spreeModesOf(object) ?? [], options.spreeModes)
      : ''
  }${extraKickMana(object, timesKickedFromCast(options))}`
  const reduction = effectsOf(object).reduce((amount, effect) =>
    effect.op === 'castCost'
      && effect.reduceGeneric
      && reductionApplies(
        state,
        object,
        effect.reduceGeneric.if,
        options.targets ?? [],
        options.seat ?? object.controller,
      )
      ? amount + effect.reduceGeneric.amount
      : amount, 0)
  return reduceGenericManaCost(total, reduction)
}

const cannotBeCountered = (object: GameObject) =>
  effectsOf(object).some((effect) =>
    effect.op === 'spellTrait' && effect.uncounterable)

type ColoredCost = {
  choices: ManaId[]
  phyrexianIndex?: number
}

const coloredCosts = (manaCost: string) => {
  let phyrexianIndex = 0
  return [...manaCost.matchAll(/\{([^}]+)\}/g)].flatMap((match): ColoredCost[] => {
    const parts = match[1].split('/')
    const choices = parts.filter((symbol) => MANA_SYMBOLS.has(symbol as ManaId)) as ManaId[]
    if (choices.length === 0) return []
    if (!parts.includes('P')) return [{ choices }]
    return [{ choices, phyrexianIndex: phyrexianIndex++ }]
  })
}

export const phyrexianSymbols = (manaCost: string) =>
  [...manaCost.matchAll(/\{([^{}]+\/P)\}/g)].map((match) => match[1])

export const phyrexianSymbolCount = (manaCost: string) =>
  phyrexianSymbols(manaCost).length

const validPhyrexianLife = (manaCost: string, paidWithLife: number[]) => {
  const count = phyrexianSymbolCount(manaCost)
  return new Set(paidWithLife).size === paidWithLife.length
    && paidWithLife.every((index) => Number.isSafeInteger(index) && index >= 0 && index < count)
}

export const convokeColors = (object: GameObject) =>
  object.colors.filter((color): color is ManaId =>
    color !== 'C' && MANA_SYMBOLS.has(color as ManaId))

const payColored = (pool: ManaPool, costs: ManaId[][], index = 0): ManaPool | null => {
  if (index === costs.length) return pool
  for (const symbol of costs[index]) {
    if (pool[symbol] < 1) continue
    const next = { ...pool, [symbol]: pool[symbol] - 1 }
    const paid = payColored(next, costs, index + 1)
    if (paid) return paid
  }
  return null
}

const payRemainingCost = (pool: ManaPool, generic: number, costs: ManaId[][]) => {
  const colored = payColored(pool, costs)
  if (!colored) return null
  const remaining = { ...colored }

  if (poolTotal(remaining) < generic) return null
  let unpaid = generic
  for (const symbol of MANA_ORDER) {
    const amount = Math.min(remaining[symbol], unpaid)
    remaining[symbol] -= amount
    unpaid -= amount
  }
  return remaining
}

type PayCostHelp = number[] | { creatures?: ManaId[][]; phyrexianLife?: number[] }

const payCostHelp = (extras: PayCostHelp) =>
  Array.isArray(extras)
    ? { phyrexianLife: extras, creatures: [] as ManaId[][] }
    : {
      phyrexianLife: extras.phyrexianLife ?? [],
      creatures: extras.creatures ?? [],
    }

export const payCost = (
  pool: ManaPool,
  manaCost: string,
  extras: PayCostHelp = {},
): ManaPool | null => {
  const { phyrexianLife, creatures } = payCostHelp(extras)
  if (!validPhyrexianLife(manaCost, phyrexianLife)) return null
  const lifeSymbols = new Set(phyrexianLife)
  const remainingColored = coloredCosts(manaCost)
    .filter((cost) =>
      cost.phyrexianIndex === undefined || !lifeSymbols.has(cost.phyrexianIndex))
    .map((cost) => cost.choices)

  const payWithConvoke = (
    index: number,
    generic: number,
    costs: ManaId[][],
  ): ManaPool | null => {
    if (index === creatures.length) return payRemainingCost(pool, generic, costs)
    if (generic > 0) {
      const paid = payWithConvoke(index + 1, generic - 1, costs)
      if (paid) return paid
    }
    for (let costIndex = 0; costIndex < costs.length; costIndex += 1) {
      if (!costs[costIndex].some((symbol) => creatures[index].includes(symbol))) continue
      const paid = payWithConvoke(
        index + 1,
        generic,
        costs.filter((_, candidate) => candidate !== costIndex),
      )
      if (paid) return paid
    }
    return null
  }

  return payWithConvoke(0, genericCost(manaCost), remainingColored)
}

const hasAllCreatureTypes = (state: GameState, seat: PlayerId) =>
  Object.values(state.objects).some((object) =>
    object.zone === 'battlefield'
    && !object.phasedOut
    && object.controller === seat
    && effectsOf(object).some((effect) => effect.op === 'static' && effect.allCreatureTypes))

/** Whether mana with a spending restriction may pay for this spell. */
export const restrictedManaFits = (
  mana: Pick<RestrictedMana, 'creatureType' | 'legendary'>,
  spell: Pick<GameObject, 'types' | 'subtypes' | 'supertypes'> | undefined,
  everyCreatureType: boolean,
) => {
  if (!spell) return false
  if (mana.legendary) return spell.supertypes.includes('Legendary')
  return spell.types.includes('Creature')
    && Boolean(mana.creatureType)
    && (everyCreatureType || spell.subtypes.includes(mana.creatureType!))
}

const paySpellCost = (
  state: GameState,
  seat: PlayerId,
  object: GameObject,
  cost: string,
  extras: PayCostHelp = {},
) => {
  const stored = state.players[seat].restrictedMana ?? []
  const allTypes = hasAllCreatureTypes(state, seat)
  const eligible = stored.filter((mana) => restrictedManaFits(mana, object, allTypes))
  const combined = { ...state.players[seat].mana }
  for (const mana of eligible) combined[mana.mana] += 1
  const paid = payCost(combined, cost, extras)
  if (!paid) return null

  const consumedBySymbol = Object.fromEntries(
    MANA_ORDER.map((symbol) => [symbol, combined[symbol] - paid[symbol]]),
  ) as ManaPool
  const consumed = new Set<number>()
  const remainingToAssign = { ...consumedBySymbol }
  eligible.forEach((mana, index) => {
    if (remainingToAssign[mana.mana] < 1) return
    consumed.add(stored.indexOf(mana, index))
    remainingToAssign[mana.mana] -= 1
  })
  const pool = { ...state.players[seat].mana }
  for (const symbol of MANA_ORDER) {
    pool[symbol] -= Math.max(0, consumedBySymbol[symbol] - (
      [...consumed].filter((index) => stored[index]?.mana === symbol).length
    ))
  }
  return {
    pool,
    restrictedMana: stored.filter((_, index) => !consumed.has(index)),
    usedRestricted: [...consumed].map((index) => stored[index]),
  }
}

export const hasConvoke = (object: GameObject) =>
  effectsOf(object).some((effect) => effect.op === 'castCost' && effect.convoke)

export const hasDelve = (object: GameObject) =>
  effectsOf(object).some((effect) => effect.op === 'castCost' && effect.delve)

const installGrantedRules = (draft: Draft, object: GameObject) => {
  for (const pluginId of object.grantedRules) {
    draft.rules.push({
      instanceId: draft.allocId('rule'),
      pluginId,
      sourceId: object.id,
      timestamp: draft.allocTs(),
      params: {},
    })
  }
}

export const spells: Plugin = {
  id: 'spells',
  replace: ({ state, event }) => {
    if (event.type !== 'castSpell' || event.canonicalTransaction || event.copy) return
    if (event.manaActivations && event.manaActivations.length > 0) {
      return
    }
    const object = state.objects[event.objectId]
    if (!object?.ruleDefinition) return
    const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
    const ability = compiled.definition.abilities.find((candidate) => candidate.kind === 'spell')
    if (!ability) return
    const canonicalAbilityIndex = compiled.definition.abilities.findIndex((candidate) => candidate.kind === 'spell')
    const modal = modalInputs(state, object, ability, canonicalAbilityIndex, event)
    const targetClauses = modal?.targetClauses ?? ability.decisions.targets
    const groupedTargets = targetClauses.length === 0
      ? []
      : event.targetClauses ?? (targetClauses.length === 1 ? [event.targets ?? []] : undefined)
    if (!groupedTargets) return
    const announcement = beginSpellAnnouncement(
      state,
      object,
      event.seat,
      ability,
      groupedTargets,
      event.x,
      [...(event.discard ?? []), ...(event.sacrifice ?? [])],
      {
        selectedOptional: event.selectedOptionalCosts,
        selectedAlternative: event.selectedAlternativeCost,
        targetClauses,
        genericAdjustment: canonicalGenericAdjustment(object, spellCost(state, object, {
          additionalGeneric: event.additionalGeneric,
          x: event.x,
          castOption: event.castOption,
          kicked: event.kicked,
          spreeModes: event.spreeModes,
          timesKicked: event.timesKicked,
          targets: event.targets,
          seat: event.seat,
          withoutPayingMana: event.alternativeCost === 'withoutPayingMana' || event.withoutPayingMana,
        }), event.x),
      },
    )
    if (!announcement.ok) return
    const committedBase = commitAnnouncement(announcement.transaction)
    const committed = canonicalAbilityIndex >= 0 && ability.kind === 'spell'
      ? {
        ...committedBase,
        ...(modal?.modeCount !== undefined ? { modeCount: modal.modeCount } : {}),
        targetBindings: canonicalTargetBindings(
        state,
        object,
        compiled.definition,
        canonicalAbilityIndex,
        event.targets ?? event.targetClauses?.flat() ?? [],
        undefined,
        groupedTargets,
        event.seat,
        event.x,
        modal?.targetClauses,
        modal?.scopeIds,
        modal?.modeIndices,
        ),
      }
      : committedBase
    const choices = [...(event.discard ?? []), ...(event.sacrifice ?? [])]
    let choiceIndex = 0
    const costs: GameEvent[] = []
    for (const cost of committed.lockedCost.nonMana) {
      if (cost.kind === 'life') {
        const amount = evaluateAnnouncementCostAmount(cost.amount, event.x)
        costs.push({ type: 'payLife', seat: event.seat, amount, source: object.id })
      } else if (cost.kind === 'discard' || cost.kind === 'sacrifice') {
        const count = evaluateAnnouncementCostAmount(cost.count, event.x)
        for (const objectId of choices.slice(choiceIndex, choiceIndex + count)) {
          costs.push(cost.kind === 'discard' ? { type: 'discard', seat: event.seat, objectId } : { type: 'sacrifice', objectId })
        }
        choiceIndex += count
      }
    }
    return costs.length > 0
      ? (() => {
        return [...costs, { ...event, canonicalTransaction: committed } as InternalCastEvent]
      })()
      : undefined
  },
  legal: ({ state, event }) => {
    if (event.type === 'castSpell') {
      if (Object.hasOwn(event, 'canonicalCostsPaid')) return 'canonical transaction state is server-private'
      if (event.canonicalTransaction !== undefined
        && (typeof event.canonicalTransaction !== 'object' || event.canonicalTransaction === null
          || typeof event.canonicalTransaction.id !== 'string'
          || !event.canonicalTransaction.lockedCost
          || !event.canonicalTransaction.payment)) {
        return 'canonical transaction state is server-private'
      }
      const object = state.objects[event.objectId]
      if (!object) return 'spell object does not exist'
      if (event.copy && !object.spellCopy) return 'spell copy object does not exist'
      const face = resolveCastFace(object, event)
      const spell = face ? { ...object, ...face } : object
      let canonicalLockedManaCost: string | undefined
      if (object.ruleDefinition && !event.copy) {
        if (!targetInputsAgree(state, event)) return 'targets and targetClauses disagree'
        const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
        const abilityIndex = compiled.definition.abilities.findIndex((ability) => ability.kind === 'spell')
        const ability = abilityIndex >= 0 ? compiled.definition.abilities[abilityIndex] : undefined
        const precommitted = event.canonicalTransaction
        if (ability && 'decisions' in ability) {
          const modal = ability.kind === 'spell' ? modalInputs(state, spell, ability, abilityIndex, event) : undefined
          const targetClauses = modal?.targetClauses ?? ability.decisions.targets
          const variables = ability.decisions.variables ?? []
          for (const variable of variables) {
            const x = event.x
            if (x === undefined || !Number.isSafeInteger(x) || x < variable.min || x > variable.max) {
              return `${variable.name} must be a safe integer from ${variable.min} to ${variable.max}`
            }
          }
          const targetError = precommitted ? undefined : canonicalTargetError(
            state,
            spell,
            compiled.definition,
            abilityIndex,
            event.targets ?? event.targetClauses?.flat() ?? [],
            undefined,
            modal ? event.targetClauses : event.targetClauses,
            event.seat,
            event.x,
            modal?.targetClauses,
            modal?.scopeIds,
            modal?.modeIndices,
          )
          if (targetError) return targetError
          const groupedTargets = ability.kind === 'spell'
            ? event.targetClauses
              ?? (targetClauses.length === 0 ? [] : targetClauses.length === 1 ? [event.targets ?? []] : undefined)
            : undefined
          if (ability.kind === 'spell' && groupedTargets !== undefined && !precommitted && selectedDistributionSpecs(ability, event.modeIndices).length > 0) {
            try {
              const bindings = canonicalTargetBindings(
                state, spell, compiled.definition, abilityIndex,
                event.targets ?? event.targetClauses?.flat() ?? [], undefined, groupedTargets,
                event.seat, event.x, modal?.targetClauses, modal?.scopeIds, modal?.modeIndices,
              )
              validateScopedDistributions(
                selectedDistributionSpecs(ability, event.modeIndices),
                event.distributionBindings ?? [],
                (scopeId, clauseIndex) => bindings.find((binding) => binding.scopeId === scopeId && binding.clauseIndex === clauseIndex)?.recipients ?? [],
                amountEvaluationContext({ state, controller: event.seat, source: captureObject(spell), variables: event.x === undefined ? undefined : { X: event.x } }),
                selectedDistributionScopeIds(abilityIndex, ability, event.modeIndices),
              )
            } catch (error) {
              return `announcement: ${error instanceof Error ? error.message : String(error)}`
            }
          }
          if (precommitted) canonicalLockedManaCost = precommitted.lockedCost.mana
          if (ability.kind === 'spell' && groupedTargets !== undefined && !precommitted) {
            const announcement = beginSpellAnnouncement(
              state,
              object,
              event.seat,
              ability,
              groupedTargets,
              event.x,
              [...(event.discard ?? []), ...(event.sacrifice ?? [])],
              {
                selectedOptional: event.selectedOptionalCosts,
                selectedAlternative: event.selectedAlternativeCost,
                deferPayment: Boolean(event.manaActivations),
                targetClauses,
                genericAdjustment: canonicalGenericAdjustment(spell, spellCost(state, spell, {
                  additionalGeneric: event.additionalGeneric,
                  x: event.x,
                  castOption: event.castOption,
                  kicked: event.kicked,
                  spreeModes: event.spreeModes,
                  timesKicked: event.timesKicked,
                  targets: event.targets,
                  seat: event.seat,
                  withoutPayingMana: event.alternativeCost === 'withoutPayingMana' || event.withoutPayingMana,
                }), event.x),
              },
            )
            if (!announcement.ok) return `announcement: ${announcement.error}`
            canonicalLockedManaCost = announcement.transaction.lockedCost.mana
          }
          const flagbearerError = canonicalFlagbearerError(
            state,
            spell,
            compiled.definition,
            abilityIndex,
            event.targets ?? event.targetClauses?.flat() ?? [],
            event.targetClauses,
            event.seat,
            event.x,
          )
          if (flagbearerError) return flagbearerError
        }
      }
      const selected = availableAlternateCastEffect(
        state,
        event.seat,
        spell,
        event.castOption,
      )
      const freeCast = event.alternativeCost === 'withoutPayingMana' || event.withoutPayingMana
      const steal = state.players[event.seat]?.data[PENDING_STEAL_CAST]
      const stealCast = Boolean(
        steal
        && typeof steal === 'object'
        && (steal as { objectId?: string }).objectId === object.id
        && (steal as { seat?: string }).seat === event.seat,
      )
      if (event.castOption === 'exiledWithLife') {
        if (!canPlayExiledWithLife(state, event.seat, object)) {
          return 'card cannot be played from exile this way'
        }
        if (manaValueOf(object) > state.players[event.seat].life) {
          return 'not enough life'
        }
      } else if (selected?.fromZone) {
        if (object.zone !== selected.fromZone) return `${event.castOption} requires ${selected.fromZone}`
      } else if (
        !state.castableZones.includes(object.zone)
        && !(freeCast && object.zone === 'exile')
        && !(object.adventured && object.zone === 'exile' && !event.adventureCast)
        && !(stealCast && object.zone === 'hand')
      ) {
        return 'spell is not in a castable zone'
      }
      if (
        !stealCast
        && event.castOption !== 'exiledWithLife'
        && (object.owner !== event.seat || object.controller !== event.seat)
      ) {
        return 'spell is not owned and controlled by that seat'
      }
      if (state.priority !== event.seat) return 'seat does not have priority'
      // CR 202.3e: while a spell is on the stack, each {X} counts as the chosen X.
      const spellManaValue = manaValueOf(spell)
        + (event.x ?? 0) * [...spell.manaCost.matchAll(/\{X\}/g)].length
      // A copy is created, not cast, so it ignores "can't cast" restrictions.
      if (!event.copy && cantCastSpellWith(state, event.seat, spellManaValue)) {
        return `${spell.name} cannot be cast: an opponent's permanent forbids spells with mana value ${spellManaValue}`
      }
      const bestow = event.castOption === 'bestow'
        && effectsOf(spell).some((effect) => effect.op === 'bestow')
      if (
        event.castOption
        && !selected
        && !bestow
        && !(event.castOption === 'exiledWithLife' && canPlayExiledWithLife(state, event.seat, object))
      ) {
        return `${object.name} has no casting option ${event.castOption}`
      }
      if (
        effectsOf(object).some((effect) =>
          effect.op === 'alternateCast' && effect.id === 'adventure')
        && event.castOption !== 'adventure'
      ) {
        return `${object.name} must use its Adventure casting option`
      }

      if (
        !spell.types.includes('Instant')
        && !mayCastAsThoughFlash(state, event.seat)
        && !(freeCast && !stealCast)
        && event.castOption !== 'exiledWithLife'
      ) {
        if (state.active !== event.seat) return 'non-instant spells require the active player'
        if (state.step !== 'precombatMain' && state.step !== 'postcombatMain') {
          return 'non-instant spells require a main phase'
        }
        if (state.stack.length > 0) return 'non-instant spells require an empty stack'
      }

      if (
        spell.manaCost.includes('{X}')
        && !freeCast
        && (!Number.isSafeInteger(event.x) || (event.x ?? -1) < 0)
      ) {
        return `${spell.name} requires a nonnegative integer X`
      }
      if (
        freeCast
        && spell.manaCost.includes('{X}')
        && event.x !== undefined
        && event.x !== 0
      ) {
        return `${spell.name} requires X to be 0 when cast without paying its mana cost`
      }
      if (event.giftPromised && !giftSpecOf(spell)) {
        return `${spell.name} has no gift cost`
      }
      if (
        hasMultikicker(spell)
        && event.timesKicked !== undefined
        && (!Number.isSafeInteger(event.timesKicked) || event.timesKicked < 0)
      ) {
        return `${spell.name} requires a nonnegative integer multikicker count`
      }
      const fullCost = canonicalLockedManaCost ?? spellCost(state, spell, {
        additionalGeneric: event.additionalGeneric,
        x: event.x,
        castOption: event.castOption,
        kicked: event.kicked,
        spreeModes: event.spreeModes,
        timesKicked: event.timesKicked,
        targets: event.targets,
        seat: event.seat,
        selected,
        withoutPayingMana: freeCast,
      })
      const enchantError = !event.copy && enchantTargetError(state, spell, event.targets)
      if (enchantError) return enchantError
      const delve = event.delve ?? []
      if (delve.length > 0 && !hasDelve(object)) return `${object.name} does not have delve`
      if (new Set(delve).size !== delve.length) return 'duplicate delve card'
      const graveyard = state.zoneOrder[event.seat].graveyard
      if (delve.some((objectId) => objectId === object.id || !graveyard.includes(objectId))) {
        return 'illegal delve card'
      }
      if (delve.length > genericCost(fullCost)) return 'delve exceeds the generic mana cost'
      const cost = reduceGenericManaCost(fullCost, delve.length)
      const convoke = event.convoke ?? []
      if (new Set(convoke).size !== convoke.length) return 'duplicate convoke creature'
      if (convoke.length > 0 && !hasConvoke(object)) return `${object.name} does not have convoke`
      const creatures = convoke.map((objectId) => state.objects[objectId])
      if (creatures.some((creature) =>
        !creature
        || creature.zone !== 'battlefield'
        || creature.controller !== event.seat
        || !creature.types.includes('Creature')
        || creature.tapped
      )) {
        return 'illegal convoke creature'
      }
      const phyrexianLife = event.phyrexianLife ?? []
      if (!validPhyrexianLife(cost, phyrexianLife)) return 'invalid Phyrexian mana payment'
      if (phyrexianLife.length * 2 > state.players[event.seat].life) {
        return 'not enough life for Phyrexian mana'
      }
      if (!event.manaActivations && !paySpellCost(state, event.seat, spell, cost, {
        creatures: creatures.map(convokeColors),
        phyrexianLife,
      })) return 'not enough mana'
      const search = searchEffect(effectsOf(object))
      const needed = search?.via === 'spell' ? search.spec.sacrificeLands : undefined
      const canonicalHasDiscard = Boolean(object.ruleDefinition && selected?.discard === undefined
        && compiledCanonicalHasCost(object, 'discard'))
      const canonicalHasSacrifice = Boolean(object.ruleDefinition && selected?.sacrifice === undefined
        && compiledCanonicalHasCost(object, 'sacrifice'))
      if ((event.discard?.length ?? 0) > 0 && !selected?.discard && !canonicalHasDiscard) {
        return `${object.name} has no discard cost`
      }
      if ((event.sacrifice?.length ?? 0) > 0 && !selected?.sacrifice && !needed && !canonicalHasSacrifice) {
        return `${object.name} has no sacrifice cost`
      }
      if (needed) {
        const sacrificed = event.sacrifice ?? []
        if (sacrificed.length !== needed) {
          return `${object.name} requires sacrificing ${needed} land(s)`
        }
        if (sacrificed.some((objectId) => {
          const land = state.objects[objectId]
          return !land || land.controller !== event.seat || !land.types.includes('Land')
            || land.zone !== 'battlefield'
        })) {
          return 'illegal land sacrifice'
        }
      }
    }

    if (event.type === 'resolveTop' && state.stack.length === 0) return 'stack is empty'
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'move') {
      const moved = draft.object(event.objectId)
      if (moved?.spellCopy && moved.zone !== 'stack') ceaseToExist(draft, moved)
      return
    }

    if (event.type === 'castSpell') {
      const object = draft.object(event.objectId)
      if (!object) return
      if (event.door) applyRoomDoors(object, [event.door])
      else applyCastFace(object, event)
      const selected = availableAlternateCastEffect(
        state,
        event.seat,
        object,
        event.castOption,
      ) ?? availableAlternateCastEffect(
        state,
        event.seat,
        state.objects[event.objectId],
        event.castOption,
      )
      let canonicalLockedCost: string | undefined
      let canonicalNonManaCosts: readonly Cost[] = []
      let canonicalTransaction: AnnouncementTransaction | undefined
      if (object.ruleDefinition && !event.copy) {
        const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
        const ability = compiled.definition.abilities.find((candidate) => candidate.kind === 'spell')
        const abilityIndex = compiled.definition.abilities.findIndex((candidate) => candidate.kind === 'spell')
        const precommitted = event.canonicalTransaction
        const modal = ability?.kind === 'spell'
          ? precommitted?.modeCount !== undefined && event.modeIndices
            ? (() => {
                const layout = modalTargetLayout(ability, abilityIndex, event.modeIndices)
                return {
                  targetClauses: layout.map((entry) => entry.clause),
                  scopeIds: layout.map((entry) => entry.scopeId),
                  modeIndices: layout.map((entry) => entry.modeIndex),
                  modeCount: precommitted.modeCount,
                }
              })()
            : modalInputs(state, object, ability, abilityIndex, event)
          : undefined
        const targetClauses = modal?.targetClauses ?? ability?.decisions.targets ?? []
        const groupedTargets = ability?.kind === 'spell'
          ? event.targetClauses
            ?? (targetClauses.length === 0 ? [] : targetClauses.length === 1 ? [event.targets ?? []] : undefined)
          : undefined
        if (ability?.kind === 'spell' && groupedTargets !== undefined && !precommitted) {
          const announcement = beginSpellAnnouncement(state, object, event.seat, ability, groupedTargets, event.x, [...(event.discard ?? []), ...(event.sacrifice ?? [])], {
            selectedOptional: event.selectedOptionalCosts,
            selectedAlternative: event.selectedAlternativeCost,
            deferPayment: Boolean(event.manaActivations),
            targetClauses,
            genericAdjustment: canonicalGenericAdjustment(object, spellCost(state, object, {
              additionalGeneric: event.additionalGeneric,
              x: event.x,
              castOption: event.castOption,
              kicked: event.kicked,
              spreeModes: event.spreeModes,
              timesKicked: event.timesKicked,
              targets: event.targets,
              seat: event.seat,
              selected,
              withoutPayingMana: event.alternativeCost === 'withoutPayingMana' || event.withoutPayingMana,
            }), event.x),
          })
          if (!announcement.ok) return
          const committed = commitAnnouncement(announcement.transaction)
          canonicalTransaction = committed
          canonicalLockedCost = committed.lockedCost.mana
          canonicalNonManaCosts = committed.lockedCost.nonMana
        }
        if (precommitted) {
          canonicalTransaction = precommitted
          canonicalLockedCost = precommitted.lockedCost.mana
          canonicalNonManaCosts = precommitted.lockedCost.nonMana
        }
      }
      const cost = reduceGenericManaCost(canonicalLockedCost ?? spellCost(state, object, {
        additionalGeneric: event.additionalGeneric,
        x: event.x,
        castOption: event.castOption,
        kicked: event.kicked,
        spreeModes: event.spreeModes,
        timesKicked: event.timesKicked,
        targets: event.targets,
        seat: event.seat,
        selected,
        withoutPayingMana: event.alternativeCost === 'withoutPayingMana' || event.withoutPayingMana,
      }), event.delve?.length ?? 0)
      const timesKicked = timesKickedFromCast(event)
      const creatures = (event.convoke ?? [])
        .map((objectId) => draft.object(objectId))
        .filter((creature): creature is GameObject => Boolean(creature))
      const phyrexianLife = event.phyrexianLife ?? []
      const payment = paySpellCost(state, event.seat, object, cost, {
        creatures: creatures.map(convokeColors),
        phyrexianLife,
      })
      if (!payment) return

      const manaSpent = Object.fromEntries(
        MANA_ORDER
          .map((symbol) => [
            symbol,
            draft.players[event.seat].mana[symbol] - payment.pool[symbol]
              + payment.usedRestricted.filter((mana) => mana.mana === symbol).length,
          ] as const)
          .filter(([, amount]) => amount > 0),
      )
      draft.players[event.seat].mana = payment.pool
      draft.players[event.seat].restrictedMana = payment.restrictedMana
      for (const creature of creatures) draft.enqueue({ type: 'tap', objectId: creature.id })
      for (const objectId of event.delve ?? []) {
        draft.enqueue({ type: 'move', objectId, to: 'exile' })
      }
      if (phyrexianLife.length > 0) {
        draft.enqueue({
          type: 'payLife',
          seat: event.seat,
          amount: phyrexianLife.length * 2,
          source: object.name,
        })
      }
      for (const costPart of event.canonicalTransaction ? [] : canonicalNonManaCosts) {
        if (costPart.kind === 'life') {
          draft.enqueue({
            type: 'payLife',
            seat: event.seat,
            amount: evaluateAnnouncementCostAmount(costPart.amount, event.x),
            source: object.name,
          })
        }
      }
      const selectedNonMana = object.ruleDefinition && !event.copy
        ? (event.discard ?? []).concat(event.sacrifice ?? [])
        : []
      let selectedIndex = 0
      for (const costPart of event.canonicalTransaction ? [] : canonicalNonManaCosts) {
        if (costPart.kind !== 'discard' && costPart.kind !== 'sacrifice') continue
        const count = evaluateAnnouncementCostAmount(costPart.count, event.x)
        for (const objectId of selectedNonMana.slice(selectedIndex, selectedIndex + count)) {
          if (costPart.kind === 'discard') draft.move(objectId, 'graveyard')
          else draft.move(objectId, 'graveyard')
        }
        selectedIndex += count
      }
      const castFrom = object.zone
      draft.move(object.id, 'stack')
      const stacked = draft.addToStack({
        id: draft.allocId('s'),
        kind: 'spell',
        objectId: object.id,
        controller: event.seat,
        name: object.name,
        targets: event.targets ?? event.targetClauses?.flat() ?? [],
        manaSpent,
        ...(event.kicked ? { kicked: true } : {}),
        ...(event.giftPromised
          ? {
              giftPromised: true,
              ...(event.giftRecipient ? { giftRecipient: event.giftRecipient } : {}),
            }
          : {}),
        ...(event.spreeModes && event.spreeModes.length > 0
          ? { spreeModes: event.spreeModes }
          : {}),
        ...(timesKicked > 0 ? { kicked: true } : {}),
        ...(hasMultikicker(object) || event.timesKicked !== undefined
          ? { timesKicked }
          : {}),
        ...(event.castOption ? { castOption: event.castOption } : {}),
        ...(selected?.exileAfterUse ? { exileAfterUse: true } : {}),
        ...(event.sagaChapter !== undefined ? { sagaChapter: event.sagaChapter } : {}),
        ...(event.door ? { door: event.door } : {}),
        ...(event.adventureCast ? { adventureCast: true } : {}),
        ...(cannotBeCountered(object)
          || payment.usedRestricted.some((mana) => mana.uncounterable)
          ? { uncounterable: true }
          : {}),
        ...(event.x !== undefined ? { x: event.x } : {}),
        ...(event.sacrifice ? { sacrificed: event.sacrifice.length } : {}),
        ...(event.copy ? { copy: true } : {}),
        ...(
          effectsOf(object).some((effect) =>
            effect.op === 'modal' && effect.commanderChooseBoth)
          && Object.values(draft.objects).some((candidate) =>
            candidate.zone === 'battlefield'
            && candidate.controller === event.seat
            && candidate.tags.includes('commander'))
            ? { payload: { commanderCast: true } }
            : {}
        ),
        castFrom,
      })
      if (object.ruleDefinition) {
        const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
        const abilityIndex = compiled.definition.abilities.findIndex((ability) => ability.kind === 'spell')
        if (abilityIndex >= 0 && stacked.execution) {
          const ability = compiled.definition.abilities[abilityIndex]
          const modal = ability.kind === 'spell' ? modalInputs(state, object, ability, abilityIndex, event) : undefined
          const groupedTargets = modal?.targetClauses
            ? event.targetClauses ?? (modal.targetClauses.length === 1 ? [event.targets ?? []] : [])
            : event.targetClauses
          stacked.execution.targetBindings = [...(canonicalTransaction?.targetBindings ?? canonicalTargetBindings(
            state,
            object,
            compiled.definition,
            abilityIndex,
            event.targets ?? event.targetClauses?.flat() ?? [],
            stacked,
            groupedTargets,
            event.seat,
            event.x,
            modal?.targetClauses,
            modal?.scopeIds,
            modal?.modeIndices,
            Boolean(canonicalTransaction),
          ))]
          if (event.modeIndices) stacked.execution.modeIndices = [...event.modeIndices]
          if (modal?.modeCount !== undefined) stacked.execution.modeCount = modal.modeCount
          if (event.distributionBindings) stacked.execution.distributionBindings = structuredClone(event.distributionBindings)
          stacked.execution.announcement = canonicalTransaction
            ? {
                id: canonicalTransaction.id,
                sourceId: canonicalTransaction.proposal.sourceId,
                phase: 'committed',
                lockedCost: canonicalTransaction.lockedCost,
                payment: canonicalTransaction.payment,
              }
            : undefined
        }
      }
      if (event.castOption === 'exiledWithLife') {
        const life = manaValueOf(object)
        if (life > 0) {
          draft.enqueue({
            type: 'loseLife',
            seat: event.seat,
            amount: life,
            source: object.id,
          })
        }
      }
      if (canonicalNonManaCosts.length === 0 && !event.canonicalTransaction) {
        for (const objectId of event.sacrifice ?? []) {
          draft.enqueue({ type: 'sacrifice', objectId })
        }
      }
      draft.passedInRow = []
      draft.priority = event.seat
      delete draft.players[event.seat].data[PENDING_STEAL_CAST]
      return
    }

    if (event.type === 'resolveTop') {
      const item = draft.stack[0]
      if (!item) return
      const heldByDriver = state.resolution?.kind === 'legacy'
        && state.resolution.stackId === item.id
      if (item.kind === 'action') {
        resolveAction(draft, item, state)
        return
      }
      if (!heldByDriver) draft.stack.shift()
      if (item.kind === 'ability') {
        if (item.payload?.canonicalWard === true) {
          draft.enqueue({
            type: 'custom',
            name: 'ward.canonical.begin',
            seat: typeof item.payload.casterSeat === 'string' ? item.payload.casterSeat : item.controller,
            payload: item.payload,
          })
          draft.passedInRow = []
          draft.priority = null
          return
        }
        resolveAbility(draft, item)
        draft.passedInRow = []
        draft.priority = state.active
        return
      }
      const object = draft.object(item.objectId)
      if (!object) return
      if (item.copy) {
        if (object.spellCopy) ceaseToExist(draft, object)
        draft.passedInRow = []
        draft.priority = state.active
        return
      }

      if (object.name === 'Timetwister') {
        for (const player of draft.playerOrder) {
          const pile = [
            ...draft.zoneOrder[player].graveyard,
            ...draft.zoneOrder[player].hand,
          ]
          for (const objectId of pile) {
            draft.enqueue({ type: 'move', objectId, to: 'library' })
          }
          draft.enqueue({ type: 'shuffleLibrary', seat: player })
        }
      }

      if (enchantTargetError(state, object, item.targets)) {
        // CR 608.2b: an Aura spell whose target is gone or illegal does not resolve.
        draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
        draft.passedInRow = []
        draft.priority = state.active
        return
      }

      if (isPermanentType(object.types) && !item.exileAfterUse && item.castOption !== 'adventure') {
        object.enteredWithCastOption = item.castOption
        const resolvedTimesKicked = timesKickedFromCast(item)
        if (hasMultikicker(object) || item.timesKicked !== undefined || item.kicked) {
          object.enteredWithTimesKicked = resolvedTimesKicked
        }
        draft.move(object.id, 'battlefield')
        object.enteredBattlefieldTurn = draft.turn
        object.summoningSickness = true
        const auraTarget = item.targets[0]
        if (object.subtypes.includes('Aura') && auraTarget?.kind === 'object') {
          object.attachedTo = auraTarget.objectId
        }
        if (
          object.types.includes('Planeswalker')
          && object.printedLoyalty !== null
        ) {
          object.counters.loyalty = object.printedLoyalty
        }
        installGrantedRules(draft, object)
      } else {
        // CR 608.2: instructions run while the spell is still on the stack;
        // the card is put into its resolution zone only after those events apply.
        if (item.castOption === 'adventure' && item.exileAfterUse) {
          object.adventureReady = true
        }
        if (!heldByDriver) {
          draft.enqueue({
            type: 'move',
            objectId: object.id,
            to: finishedSpellZone(
              item,
              (item.adventureCast || reboundsOnResolution(object, item)) ? 'exile' : 'graveyard',
            ),
          })
        }
      }
      draft.passedInRow = []
      draft.priority = state.active
      return
    }

  },
}
