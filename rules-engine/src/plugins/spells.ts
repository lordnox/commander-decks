import { isPermanentType } from '../definitions'
import { poolTotal, type Draft } from '../draft'
import type { GameObject, ManaId, ManaPool, Plugin } from '../types'
import { searchEffect } from '../cardPlugins/effects'
import { effectsOf } from '../cardPlugins/cardRules'
import { alternateCastEffect } from '../cardPlugins/alternateCosts'
import { resolveAbility, resolveAction } from '../rules/actions'
import { applyFace, castFaceOf } from './doubleFaced'

const MANA_ORDER: ManaId[] = ['C', 'W', 'U', 'B', 'R', 'G']
const MANA_SYMBOLS = new Set<ManaId>(MANA_ORDER)

const genericCost = (manaCost: string) =>
  [...manaCost.matchAll(/\{(\d+)\}/g)].reduce((total, match) => total + Number(match[1]), 0)

const xManaKind = (object: GameObject) =>
  effectsOf(object).flatMap((effect) =>
    effect.op === 'castCost' && effect.xMana ? [effect.xMana] : [])[0]

const spellCost = (
  object: GameObject,
  additionalGeneric = 0,
  x = 0,
  castOption?: string,
) => {
  const selected = alternateCastEffect(object, castOption)
  const xCost = xManaKind(object) === 'black'
    ? '{B}'.repeat(x)
    : x > 0 ? `{${x}}` : ''
  const base = selected?.manaCost ?? object.manaCost.replaceAll('{X}', xCost)
  return `${base}${
    additionalGeneric > 0 ? `{${additionalGeneric}}` : ''
  }`
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

export const hasConvoke = (object: GameObject) =>
  effectsOf(object).some((effect) => effect.op === 'castCost' && effect.convoke)

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
      const face = castFaceOf(object)
      const spell = face ? { ...object, ...face } : object
      if (!state.castableZones.includes(object.zone)) return 'spell is not in a castable zone'
      if (object.owner !== event.seat || object.controller !== event.seat) {
        return 'spell is not owned and controlled by that seat'
      }
      if (state.priority !== event.seat) return 'seat does not have priority'
      if (event.castOption && !alternateCastEffect(spell, event.castOption)) {
        return `${object.name} has no casting option ${event.castOption}`
      }

      if (!spell.types.includes('Instant')) {
        if (state.active !== event.seat) return 'non-instant spells require the active player'
        if (state.step !== 'precombatMain' && state.step !== 'postcombatMain') {
          return 'non-instant spells require a main phase'
        }
        if (state.stack.length > 0) return 'non-instant spells require an empty stack'
      }

      if (
        spell.manaCost.includes('{X}')
        && (!Number.isSafeInteger(event.x) || (event.x ?? -1) < 0)
      ) {
        return `${spell.name} requires a nonnegative integer X`
      }
      const cost = spellCost(spell, event.additionalGeneric, event.x ?? 0, event.castOption)
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
      if (!payCost(state.players[event.seat].mana, cost, {
        creatures: creatures.map(convokeColors),
        phyrexianLife,
      })) return 'not enough mana'
      const search = searchEffect(effectsOf(object))
      const needed = search?.via === 'spell' ? search.spec.sacrificeLands : undefined
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
    if (event.type === 'castSpell') {
      const object = draft.object(event.objectId)
      if (!object) return
      const face = castFaceOf(object)
      if (face) applyFace(object, face)
      const cost = spellCost(object, event.additionalGeneric, event.x ?? 0, event.castOption)
      const creatures = (event.convoke ?? [])
        .map((objectId) => draft.object(objectId))
        .filter((creature): creature is GameObject => Boolean(creature))
      const phyrexianLife = event.phyrexianLife ?? []
      const paid = payCost(draft.players[event.seat].mana, cost, {
        creatures: creatures.map(convokeColors),
        phyrexianLife,
      })
      if (!paid) return

      const manaSpent = Object.fromEntries(
        MANA_ORDER
          .map((symbol) => [symbol, draft.players[event.seat].mana[symbol] - paid[symbol]] as const)
          .filter(([, amount]) => amount > 0),
      )
      draft.players[event.seat].mana = paid
      for (const creature of creatures) draft.enqueue({ type: 'tap', objectId: creature.id })
      if (phyrexianLife.length > 0) {
        draft.enqueue({
          type: 'payLife',
          seat: event.seat,
          amount: phyrexianLife.length * 2,
          source: object.name,
        })
      }
      draft.stack.unshift({
        id: draft.allocId('s'),
        kind: 'spell',
        objectId: object.id,
        controller: event.seat,
        name: object.name,
        targets: event.targets ?? [],
        manaSpent,
        ...(event.kicked ? { kicked: true } : {}),
        ...(event.castOption ? { castOption: event.castOption } : {}),
        ...(cannotBeCountered(object) ? { uncounterable: true } : {}),
        ...(event.x !== undefined ? { x: event.x } : {}),
        ...(event.sacrifice ? { sacrificed: event.sacrifice.length } : {}),
        castFrom: object.zone,
      })
      draft.move(object.id, 'stack')
      for (const objectId of event.sacrifice ?? []) {
        draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
      }
      draft.passedInRow = []
      draft.priority = event.seat
      return
    }

    if (event.type === 'resolveTop') {
      const item = draft.stack[0]
      if (!item) return
      if (item.kind === 'action') {
        resolveAction(draft, item, state)
        return
      }
      draft.stack.shift()
      if (item.kind === 'ability') {
        resolveAbility(draft, item)
        draft.passedInRow = []
        draft.priority = state.active
        return
      }
      const object = draft.object(item.objectId)
      if (!object) return
      if (item.copy) {
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

      if (isPermanentType(object.types)) {
        object.enteredWithCastOption = item.castOption
        draft.move(object.id, 'battlefield')
        object.summoningSickness = true
        if (
          object.types.includes('Planeswalker')
          && object.printedLoyalty !== null
        ) {
          object.counters.loyalty = object.printedLoyalty
        }
        installGrantedRules(draft, object)
      } else {
        // CR 608.2: instructions run while the spell is still on the stack;
        // the card is put into the graveyard only after those events apply.
        draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
      }
      draft.passedInRow = []
      draft.priority = state.active
      return
    }

  },
}
