import { hasUntaxedTapMana } from '../plugins/mana'
import type { GameObject, Plugin, TargetRef } from '../types'
import {
  activateEffect,
  conditionHolds,
  runInstructions,
  type CardEffect,
  type TargetFilter,
} from './effects'
import {
  activationCostError,
  costPicksFromChoices,
  payActivationCosts,
} from './activationCosts'
import { effectsOf } from './cardRules'
import { manaChoicePools } from './manaChoice'
import { validTargetRef } from './targetedResolve'
import { captureObject, targetObject } from '../objectIdentity'
import { activationPermission, beginActivatedAnnouncement, classifyManaAbility, compileCardRuleDefinition, createDefinitionSnapshot } from './dsl/compiler'
import { canonicalTargetBindings, canonicalTargetError } from './dsl/compiler/targeting'
import { payCost } from '../plugins/spells'

const MAIN_STEPS = new Set(['precombatMain', 'postcombatMain'])

const canonicalManaClassification = (ability: Extract<ReturnType<typeof compileCardRuleDefinition>['definition']['abilities'][number], { kind: 'activated' }>) => {
  const movesLibrary = (ability.instructions ?? []).some((instruction) => {
    if (instruction.kind === 'draw' || instruction.kind === 'mill') return true
    return instruction.kind === 'move'
      && instruction.targets.kind === 'objects'
      && instruction.targets.filter.zone === 'library'
  })
  return classifyManaAbility({
    addsMana: (ability.instructions ?? []).some((instruction) => instruction.kind === 'addMana'),
    abilityKind: 'activated',
    hasTargets: ability.decisions.targets.length > 0,
    hasLoyaltyCost: false,
    movesCards: movesLibrary,
  })
}

const immediateManaInstructions = (instructions: readonly import('./dsl/schema/v1').Instruction[]): readonly import('./dsl/schema/v1').Instruction[] =>
  instructions.flatMap((instruction) => instruction.kind === 'sequence'
    ? immediateManaInstructions(instruction.instructions)
    : [instruction])

const legalActivateTarget = (
  state: { objects: Record<string, GameObject | undefined> },
  target: TargetRef | undefined,
  kind: 'creature' | 'land' | 'room' | 'legendary',
) => {
  if (target?.kind !== 'object') return false
  const object = targetObject(state, target)
  if (!object || object.zone !== 'battlefield') return false
  switch (kind) {
    case 'room': return object.subtypes.includes('Room')
    case 'legendary': return object.supertypes.includes('Legendary')
    case 'creature': return object.types.includes('Creature')
    case 'land': return object.types.includes('Land')
  }
}

/** A filtered target is checked again on resolution (CR 608.2b), so the stack item keeps its filter. */
const activatedTargetFilter = (
  targets: Extract<CardEffect, { op: 'activate' }>['targets'],
) => {
  if (!targets) return undefined
  if (typeof targets === 'string') {
    switch (targets) {
      case 'creature': return { zone: 'battlefield', type: 'Creature' } satisfies TargetFilter
      case 'land': return { zone: 'battlefield', type: 'Land' } satisfies TargetFilter
      case 'room': return { zone: 'battlefield', subtype: 'Room' } satisfies TargetFilter
      case 'legendary': return { zone: 'battlefield', supertype: 'Legendary' } satisfies TargetFilter
      default: return undefined
    }
  }
  return 'filter' in targets ? targets.filter : targets
}

export const SKULL_PROPHET_MILL = 'selfMill.skullProphet'
export const MILLIKIN_MANA = 'selfMill.millikin'
export const GHOST_TOWN_RETURN = 'selfBounceLand.ghostTown'
export const OBORO_RETURN = 'selfBounceLand.oboro'
export const AFTERMATH_RECLAIM = 'graveyardLands.aftermath'
export const YURLOK_MANA_RAIN = 'yurlok.mana-rain'

export const activated: Plugin = {
  id: 'activated',
  legal: ({ state, event }) => {
    if (event.type === 'tapForMana') {
      const source = state.objects[event.objectId]
      if (!source) return
      const manaEffect = effectsOf(source).find((effect) => effect.op === 'mana')
      if (manaEffect && !conditionHolds(manaEffect.if, state, source)) {
        return `${source.name} cannot be activated now`
      }
      const millMana = effectsOf(source).find((effect): effect is Extract<typeof effect, { op: 'activate' }> =>
        effect.op === 'activate' && Boolean(effect.manaAbility))
      if (millMana) {
        // Older journals embedded Firdoch's choice as an activate effect.
        // The generic tapForMana event now carries that choice directly.
        if (millMana.do.some((instruction) => instruction.kind === 'addChosenColorMana')) {
          return
        }
        if ((millMana.costs.mill ?? 0) > 0) {
          return `${source.name} mana must mill a card as an activation cost`
        }
        if (hasUntaxedTapMana(source)) return
        return `${source.name} mana must use its printed mana ability`
      }
      return
    }
    if (event.type !== 'activateAbility') return
    const source = state.objects[event.objectId]
    if (!source) return 'no such object'
    if (source.ruleDefinition) {
      const compiled = compileCardRuleDefinition(source.ruleDefinition.definition)
      const abilityIndex = /^\$\.abilities\[(\d+)\]$/.exec(event.abilityId)?.[1]
      const canonical = abilityIndex === undefined ? undefined : compiled.definition.abilities[Number(abilityIndex)]
      const activatedCanonical = canonical?.kind === 'activated' ? canonical : undefined
      if (activatedCanonical) {
        const manaClassification = canonicalManaClassification(activatedCanonical)
        if (event.manaAbility && !manaClassification.isManaAbility) return `${source.name} is not a mana ability`
        const permissionError = activationPermission({
          state,
          sourceId: source.id,
          payer: event.seat,
          action: event.manaAbility ? 'nestedPayment' : 'activate',
          sorcerySpeed: activatedCanonical.timing === 'sorcery',
          availableFrom: activatedCanonical.availableFrom,
        })
        if (permissionError) return permissionError
        const canonicalTargetErrorMessage = canonicalTargetError(
          state,
          source,
          compiled.definition,
          Number(abilityIndex),
          event.targets ?? event.targetClauses?.flat() ?? [],
          undefined,
          event.targetClauses,
          event.seat,
          event.x,
        )
        if (canonicalTargetErrorMessage) return canonicalTargetErrorMessage
        const groupedTargets = activatedCanonical.decisions.targets.length === 0
          ? []
          : event.targetClauses
            ?? (activatedCanonical.decisions.targets.length === 1 ? [event.targets ?? []] : undefined)
        if (groupedTargets !== undefined) {
          const announcement = beginActivatedAnnouncement(state, source, event.seat, activatedCanonical, groupedTargets, event.x, event.choices)
          if (!announcement.ok) return `announcement: ${announcement.error}`
        }
      }
    }
    const effect = activateEffect(effectsOf(source), event.abilityId)
    if (!effect) return
    if (effect.costs.loyalty !== undefined || effect.costs.loyaltyX) return
    const requiredZone = effect.zone ?? 'battlefield'
    if (source.zone !== requiredZone) return `${source.name} is not in ${requiredZone}`
    if (requiredZone === 'graveyard' && source.owner !== event.seat) {
      return `${source.name} is not in ${event.seat}'s graveyard`
    }
    if (requiredZone === 'battlefield' && source.phasedOut) {
      return `${source.name} is phased out`
    }
    if (source.controller !== event.seat) {
      return `${event.seat} does not control ${source.name}`
    }
    if (effect.manaAbility && !event.manaAbility) {
      return `${source.name} is a mana ability`
    }
    const picks = costPicksFromChoices(effect.costs, event.choices)
    if (effect.costs.xMana && (!Number.isSafeInteger(event.x) || (event.x ?? 0) < 1)) {
      return `${source.name} requires X greater than 0`
    }
    const costError = activationCostError(state, source, event.seat, effect.costs, {
      picks,
      requirePicks: true,
      x: event.x,
    })
    if (costError) return costError
    if (!conditionHolds(effect.if, state, source)) {
      if (effect.if?.kind === 'notActivePlayer') {
        return `${source.name} can be returned only when it is not your turn`
      }
      return `${source.name} cannot be activated now`
    }
    if (effect.sorcery
      && (
        state.active !== event.seat
        || !MAIN_STEPS.has(state.step)
        || state.stack.length > 0
      )
    ) {
      return `${source.name} can be activated only as a sorcery`
    }
    if (
      effect.targets
      && typeof effect.targets === 'object'
      && 'filter' in effect.targets
    ) {
      const targets = event.targets ?? []
      if (
        targets.length !== 1
        || !validTargetRef(
          state,
          targets[0],
          effect.targets.filter,
          event.seat,
          undefined,
          event.objectId,
        )
      ) {
        return `${source.name} needs one legal target`
      }
    } else if (
      effect.targets === 'creature'
      || effect.targets === 'land'
      || effect.targets === 'room'
      || effect.targets === 'legendary'
    ) {
      const targets = event.targets ?? []
      if (targets.length !== 1 || !legalActivateTarget(state, targets[0], effect.targets)) {
        return `${source.name} needs one ${effect.targets} target`
      }
    }
    if (effect.do.some((instruction) => instruction.kind === 'lockOrUnlockDoor')
      && event.door !== 'left' && event.door !== 'right') {
      return `${source.name} needs a door to lock or unlock`
    }
    if (effect.targets === 'opponent') {
      const targets = event.targets ?? []
      const target = targets[0]
      if (
        targets.length !== 1
        || target?.kind !== 'player'
        || !state.opponents[event.seat].includes(target.player)
        || !state.players[target.player]
        || state.players[target.player].lost
      ) {
        return `${source.name} needs one opponent target`
      }
    } else if (
      effect.targets
      && typeof effect.targets === 'object'
      && !('filter' in effect.targets)
    ) {
      const targets = event.targets ?? []
      if (
        targets.length !== 1
        || !validTargetRef(state, targets[0], effect.targets, event.seat)
      ) {
        return `${source.name} needs one legal target`
      }
    }
    const colorMana = effect.do.find((instruction) => instruction.kind === 'addChosenColorMana')
    if (colorMana?.kind === 'addChosenColorMana') {
      const allowed = colorMana.colors ?? ['W', 'U', 'B', 'R', 'G']
      const choice = event.choices?.[0]
      if (!choice || !allowed.includes(choice as typeof allowed[number])) {
        return `${source.name} needs a mana color`
      }
    }
    const poolChoice = effect.do.find((instruction) => instruction.kind === 'addManaChoice')
    const named = event.choices?.[0]
    if (poolChoice && named && !manaChoicePools(poolChoice.options)[named]) {
      return `${source.name} cannot add ${named}`
    }
  },
  apply: ({ event, draft }) => {
    if (event.type !== 'activateAbility') return
    const source = draft.object(event.objectId)
    if (!source) return
    if (source.ruleDefinition) {
      const compiled = compileCardRuleDefinition(source.ruleDefinition.definition)
      const abilityIndex = /^\$\.abilities\[(\d+)\]$/.exec(event.abilityId)?.[1]
      const candidate = abilityIndex === undefined ? undefined : compiled.definition.abilities[Number(abilityIndex)]
      const canonical = candidate?.kind === 'activated' ? candidate : undefined
      if (canonical) {
        const manaClassification = canonicalManaClassification(canonical)
        const groupedTargets = canonical.decisions.targets.length === 0
          ? []
          : event.targetClauses
            ?? (canonical.decisions.targets.length === 1 ? [event.targets ?? []] : undefined)
        if (groupedTargets === undefined) return
        const announcement = beginActivatedAnnouncement(draft, source, event.seat, canonical, groupedTargets, event.x, event.choices)
        if (!announcement.ok) return
        const committed = announcement.transaction
        if (committed.lockedCost.mana) {
          const paid = payCost(draft.players[event.seat].mana, committed.lockedCost.mana)
          if (!paid) return
          draft.players[event.seat].mana = paid
        }
        for (const costPart of committed.lockedCost.nonMana) {
          if (costPart.kind === 'life') {
            draft.enqueue({ type: 'payLife', seat: event.seat, amount: costPart.amount.kind === 'constant' ? costPart.amount.value : event.x ?? 0, source: source.name })
          }
        }
        let choiceIndex = 0
        for (const costPart of committed.lockedCost.nonMana) {
          if (costPart.kind !== 'discard' && costPart.kind !== 'sacrifice') continue
          const count = costPart.count.kind === 'constant' ? costPart.count.value : event.x ?? 0
          for (const objectId of (event.choices ?? []).slice(choiceIndex, choiceIndex + count)) {
            draft.enqueue(costPart.kind === 'discard'
              ? { type: 'discard', seat: event.seat, objectId }
              : { type: 'sacrifice', objectId })
          }
          choiceIndex += count
        }
        if (manaClassification.isManaAbility) {
          for (const instruction of immediateManaInstructions(canonical.instructions ?? [])) {
            if (instruction.kind === 'move' && instruction.targets.kind === 'objects') {
              for (const object of Object.values(draft.objects)) {
                const filter = instruction.targets.filter
                if (object.zone === filter.zone && (!filter.type || object.types.includes(filter.type))
                  && object.controller === event.seat) draft.move(object.id, instruction.to)
              }
            }
            if (instruction.kind === 'addMana') {
              const targetSeats = instruction.targets.kind === 'contextRef' && instruction.targets.name === 'controller'
                ? [event.seat]
                : []
              for (const seat of targetSeats) {
                const manaPool = draft.players[seat].mana
                for (const [symbol, amount] of Object.entries(instruction.amount)) {
                  const manaKey = symbol as keyof typeof manaPool
                  if (amount.kind === 'constant') manaPool[manaKey] += amount.value
                  else if (amount.kind === 'variable' && event.x !== undefined) manaPool[manaKey] += event.x
                }
              }
            }
          }
          for (const instruction of immediateManaInstructions(canonical.instructions ?? [])) {
            if (instruction.kind !== 'gainLife' && instruction.kind !== 'loseLife') continue
            if (instruction.targets.kind === 'contextRef' && instruction.targets.name === 'controller'
              && instruction.amount.kind === 'constant') {
              draft.enqueue({ type: instruction.kind, seat: event.seat, amount: instruction.amount.value, source: source.id })
            }
          }
          return
        }
        draft.addToStack({
          kind: 'ability',
          objectId: source.id,
          controller: event.seat,
          name: source.name,
          targets: event.targets ?? event.targetClauses?.flat() ?? [],
          abilityId: event.abilityId,
          payload: { instructions: canonical.instructions ?? [] },
          execution: {
            controller: event.seat,
            source: captureObject(source),
            definitionSnapshot: createDefinitionSnapshot(compiled),
            abilityIndex: Number(abilityIndex),
            targetBindings: canonicalTargetBindings(
              draft,
              source,
              compiled.definition,
              Number(abilityIndex),
              event.targets ?? event.targetClauses?.flat() ?? [],
              undefined,
              event.targetClauses,
              event.seat,
              event.x,
            ),
            announcement: {
              id: committed.id,
              sourceId: committed.proposal.sourceId,
              phase: 'committed',
              lockedCost: committed.lockedCost,
              payment: committed.payment,
            },
          },
          ...(event.x !== undefined ? { x: event.x } : {}),
        })
        draft.passedInRow = []
        draft.priority = event.seat
        draft.note(`${event.seat} activates ${source.name}`)
        return
      }
    }
    const effect = activateEffect(effectsOf(source), event.abilityId)
    if (!effect) return
    if (effect.costs.loyalty !== undefined || effect.costs.loyaltyX) return
    payActivationCosts(
      draft,
      source,
      event.seat,
      effect.costs,
      costPicksFromChoices(effect.costs, event.choices),
      event.x ?? 0,
    )
    if (effect.manaAbility || event.manaAbility) {
      runInstructions(draft, source, effect.do, {
        id: event.objectId,
        kind: 'ability',
        objectId: event.objectId,
        controller: event.seat,
        name: source.name,
        targets: event.targets ?? [],
        abilityId: event.abilityId,
        ...(event.choices ? { choices: event.choices } : {}),
        ...(event.door ? { door: event.door } : {}),
      })
    } else {
      const targetFilter = activatedTargetFilter(effect.targets)
      draft.addToStack({
        kind: 'ability',
        objectId: source.id,
        controller: event.seat,
        name: source.name,
        targets: event.targets ?? [],
        abilityId: event.abilityId,
        // The ability outlives its source, which a token leaves behind when sacrificed to pay for it.
        payload: {
          instructions: effect.do,
          abilityEffect: effect,
          ...(targetFilter ? { targetFilter } : {}),
        },
        ...(event.x !== undefined ? { x: event.x } : {}),
        ...(event.choices ? { choices: event.choices } : {}),
        ...(event.door ? { door: event.door } : {}),
      })
      draft.passedInRow = []
      draft.priority = event.seat
    }
    draft.note(`${event.seat} activates ${source.name}`)
  },
}
