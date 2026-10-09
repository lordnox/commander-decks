import { isPermanentType } from '../definitions'
import { poolTotal, type Draft } from '../draft'
import type {
  GameObject,
  GameState,
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
import { compileCardRuleDefinition } from '../cardPlugins/dsl/compiler'
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
  legal: ({ state, event }) => {
    if (event.type === 'castSpell') {
      const object = state.objects[event.objectId]
      if (!object) return 'spell object does not exist'
      if (event.copy && !object.spellCopy) return 'spell copy object does not exist'
      const face = resolveCastFace(object, event)
      const spell = face ? { ...object, ...face } : object
      if (object.ruleDefinition && !event.copy) {
        if (!targetInputsAgree(state, event)) return 'targets and targetClauses disagree'
        const compiled = compileCardRuleDefinition(object.ruleDefinition.definition)
        const abilityIndex = compiled.definition.abilities.findIndex((ability) => ability.kind === 'spell')
        const ability = abilityIndex >= 0 ? compiled.definition.abilities[abilityIndex] : undefined
        if (ability && 'decisions' in ability) {
          const variables = ability.decisions.variables ?? []
          for (const variable of variables) {
            const x = event.x
            if (x === undefined || !Number.isSafeInteger(x) || x < variable.min || x > variable.max) {
              return `${variable.name} must be a safe integer from ${variable.min} to ${variable.max}`
            }
          }
          const targetError = canonicalTargetError(
            state,
            spell,
            compiled.definition,
            abilityIndex,
            event.targets ?? event.targetClauses?.flat() ?? [],
            undefined,
            event.targetClauses,
            event.seat,
            event.x,
          )
          if (targetError) return targetError
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
      const fullCost = spellCost(state, spell, {
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
      if (!paySpellCost(state, event.seat, spell, cost, {
        creatures: creatures.map(convokeColors),
        phyrexianLife,
      })) return 'not enough mana'
      const search = searchEffect(effectsOf(object))
      const needed = search?.via === 'spell' ? search.spec.sacrificeLands : undefined
      if ((event.discard?.length ?? 0) > 0 && !selected?.discard) {
        return `${object.name} has no discard cost`
      }
      if ((event.sacrifice?.length ?? 0) > 0 && !selected?.sacrifice && !needed) {
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
      const cost = reduceGenericManaCost(spellCost(state, object, {
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
          stacked.execution.targetBindings = canonicalTargetBindings(
            state,
            object,
            compiled.definition,
            abilityIndex,
            event.targets ?? event.targetClauses?.flat() ?? [],
            stacked,
            event.targetClauses,
            event.seat,
            event.x,
          )
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
      for (const objectId of event.sacrifice ?? []) {
        draft.enqueue({ type: 'sacrifice', objectId })
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
