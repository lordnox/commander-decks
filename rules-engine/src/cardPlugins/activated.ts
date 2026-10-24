import { captureAbilityActivation } from '../rules/triggers'
import { captureCanonicalWardTriggers } from './ward'
import { effectiveActivatedDefinition, activatedGrantAt, canonicalActivationIsActive } from './dsl/activatedGrants'
import { hasUntaxedTapMana } from '../plugins/mana'
import type { GameEvent, GameObject, GameState, Plugin, TargetRef } from '../types'
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
import { evidencePaymentEvents, announcementCostChoices, activatedPermissionFields, activationPermission, beginActivatedAnnouncement, createDefinitionSnapshot, evaluateAnnouncementCostAmount, resolveNonManaCostObjectChoices } from './dsl/compiler'
import { canonicalTargetBindings, canonicalTargetError } from './dsl/compiler/targeting'
import { payCost } from '../plugins/spells'
import { startCanonicalResolution } from '../driver'
import type { AbilityDefinition, TargetClause } from './dsl/schema/v1'
import { evaluateModeCount, resolveModalInputs, selectedDistributionScopeIds, selectedDistributionSpecs, validateScopedDistributions } from './dsl/compiler/modes'
import { amountEvaluationContext } from './dsl/compiler/runtime'
import { canonicalManaAbilityForTap, canonicalManaClassification } from './dsl/manaPrograms'

const MAIN_STEPS = new Set(['precombatMain', 'postcombatMain'])

const groupedActivatedTargets = (
  targetClauses: readonly TargetClause[],
  event: Extract<GameEvent, { type: 'activateAbility' }>,
  partition: () => TargetRef[][] | undefined,
) => {
  if (targetClauses.length === 0) return []
  if (event.targetClauses) return event.targetClauses
  if (targetClauses.length === 1) return [event.targets ?? []]
  return partition()
}

const activatedModalInputs = (state: GameState, source: GameObject, ability: Extract<AbilityDefinition, { kind: 'activated' }>, abilityIndex: number, event: Extract<GameEvent, { type: 'activateAbility' }>) => {
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

export const MILLIKIN_MANA = 'selfMill.millikin'
export const YURLOK_MANA_RAIN = 'yurlok.mana-rain'

export const activated: Plugin = {
  id: 'activated',
  legal: ({ state, event }) => {
    if (event.type === 'tapForMana') {
      const source = state.objects[event.objectId]
      if (!source) return
      const canonicalMana = canonicalManaAbilityForTap(source, event.mana)
      if (canonicalMana) {
        const permissionError = activationPermission({
          state,
          sourceId: source.id,
          payer: event.seat,
          action: 'tapForMana',
          ...activatedPermissionFields(canonicalMana.ability),
        })
        if (permissionError) return permissionError
        return
      }
      const permissionError = activationPermission({
        state,
        sourceId: source.id,
        payer: event.seat,
        action: 'tapForMana',
      })
      if (permissionError) return permissionError
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
    if (source.ruleDefinition || source.canonicalGrantedActivations?.length) {
      const compiled = effectiveActivatedDefinition(source)
      const abilityIndex = /^\$\.abilities\[(\d+)\]$/.exec(event.abilityId)?.[1]
      const canonical = abilityIndex === undefined ? undefined : compiled.definition.abilities[Number(abilityIndex)]
      const activatedCanonical = canonical?.kind === 'activated' ? canonical : undefined
      if (activatedCanonical) {
        if (!canonicalActivationIsActive(source, Number(abilityIndex))) return 'this object has lost that activated ability'
        let modal: ReturnType<typeof activatedModalInputs>
        try {
          modal = activatedModalInputs(state, source, activatedCanonical, Number(abilityIndex), event)
        } catch (error) {
          return `announcement: ${error instanceof Error ? error.message : String(error)}`
        }
        const targetClauses = modal?.targetClauses ?? activatedCanonical.decisions.targets
        const manaClassification = canonicalManaClassification(activatedCanonical)
        if (event.manaAbility && !manaClassification.isManaAbility) return `${source.name} is not a mana ability`
        const permissionError = activationPermission({
          state,
          sourceId: source.id,
          payer: event.seat,
          action: event.manaAbility ? 'nestedPayment' : 'activate',
          ...activatedPermissionFields(activatedCanonical),
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
          modal?.targetClauses,
          modal?.scopeIds,
          modal?.modeIndices,
        )
        if (canonicalTargetErrorMessage) return canonicalTargetErrorMessage
        if ((activatedCanonical.instructions ?? []).some(instruction => instruction.kind === 'lockOrUnlockDoor')
          && event.door !== 'left' && event.door !== 'right') {
          return `${source.name} needs a door to lock or unlock`
        }
        const groupedTargets = groupedActivatedTargets(targetClauses, event, () => {
          try {
            return canonicalTargetBindings(
              state, source, compiled.definition, Number(abilityIndex),
              event.targets ?? event.targetClauses?.flat() ?? [], undefined, undefined,
              event.seat, event.x, modal?.targetClauses, modal?.scopeIds, modal?.modeIndices,
            ).map(binding => binding.recipients)
          } catch {
            return undefined
          }
        })
        if (groupedTargets !== undefined) {
          if (selectedDistributionSpecs(activatedCanonical, event.modeIndices).length > 0) {
            try {
              const bindings = canonicalTargetBindings(
                state, source, compiled.definition, Number(abilityIndex),
                event.targets ?? event.targetClauses?.flat() ?? [], undefined, groupedTargets,
                event.seat, event.x, modal?.targetClauses, modal?.scopeIds, modal?.modeIndices,
              )
              validateScopedDistributions(
                selectedDistributionSpecs(activatedCanonical, event.modeIndices),
                event.distributionBindings ?? [],
                (scopeId, clauseIndex) => bindings.find((binding) => binding.scopeId === scopeId && binding.clauseIndex === clauseIndex)?.recipients ?? [],
                amountEvaluationContext({ state, controller: event.seat, source: captureObject(source), variables: event.x === undefined ? undefined : { X: event.x } }),
                selectedDistributionScopeIds(Number(abilityIndex), activatedCanonical, event.modeIndices),
              )
            } catch (error) {
              return `announcement: ${error instanceof Error ? error.message : String(error)}`
            }
          }
          const programChoice = activatedCanonical.instructions?.length === 1 ? activatedCanonical.instructions[0] : undefined
        if (canonicalManaClassification(activatedCanonical).isManaAbility && programChoice?.kind === 'chooseInstructions' && activatedCanonical.costs.every(cost => cost.kind !== 'discard' && cost.kind !== 'sacrifice') && event.choices?.[0]
          && !programChoice.options.some(option => option.label === event.choices![0])) return `${source.name} cannot add ${event.choices[0]}`
        const announcement = beginActivatedAnnouncement(state, source, event.seat, activatedCanonical, groupedTargets, event.x, event.choices, {
            evidence: event.evidence, selectedOptional: event.selectedOptionalCosts,
            selectedAlternative: event.selectedAlternativeCost,
            targetClauses,
          })
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
  apply: ({ event, draft, state }) => {
    if (event.type === 'tapForMana') {
      const source = draft.object(event.objectId)
      const canonicalMana = source && canonicalManaAbilityForTap(source, event.mana)
      if (source && canonicalMana) {
        draft.enqueue({
          type: 'activateAbility',
          seat: event.seat,
          objectId: source.id,
          abilityId: `$.abilities[${canonicalMana.index}]`,
          ...(canonicalMana.modeIndices ? { modeIndices: canonicalMana.modeIndices } : {}),
          ...(event.mana && canonicalMana.ability.instructions?.some(instruction => instruction.kind === 'addManaFrom' || (instruction.kind === 'chooseInstructions' && instruction.options.some(option => option.label === event.mana))) ? { choices: [event.mana] } : {}),
          manaAbility: true,
        })
      }
      return
    }
    if (event.type !== 'activateAbility') return
    const source = draft.object(event.objectId)
    if (!source) return
    if (source.ruleDefinition || source.canonicalGrantedActivations?.length) {
      const compiled = effectiveActivatedDefinition(source)
      const abilityIndex = /^\$\.abilities\[(\d+)\]$/.exec(event.abilityId)?.[1]
      const candidate = abilityIndex === undefined ? undefined : compiled.definition.abilities[Number(abilityIndex)]
      const canonical = candidate?.kind === 'activated' ? candidate : undefined
      if (canonical) {
        const manaClassification = canonicalManaClassification(canonical)
        const modal = activatedModalInputs(draft, source, canonical, Number(abilityIndex), event)
        const targetClauses = modal?.targetClauses ?? canonical.decisions.targets
        const groupedTargets = groupedActivatedTargets(targetClauses, event, () => {
          try {
            return canonicalTargetBindings(
              draft, source, compiled.definition, Number(abilityIndex),
              event.targets ?? event.targetClauses?.flat() ?? [], undefined, undefined,
              event.seat, event.x, modal?.targetClauses, modal?.scopeIds, modal?.modeIndices,
            ).map(binding => binding.recipients)
          } catch {
            return undefined
          }
        })
        if (groupedTargets === undefined) return
        const announcement = beginActivatedAnnouncement(draft, source, event.seat, canonical, groupedTargets, event.x, event.choices, {
          evidence: event.evidence, selectedOptional: event.selectedOptionalCosts,
          selectedAlternative: event.selectedAlternativeCost,
          targetClauses,
        })
        if (!announcement.ok) return
        let committed = announcement.transaction
        if (committed.lockedCost.mana) {
          const paid = payCost(draft.players[event.seat].mana, committed.lockedCost.mana)
          if (!paid) return
          draft.players[event.seat].mana = paid
        }
        const costEvents: GameEvent[] = evidencePaymentEvents(committed.proposal)
        for (const costPart of committed.lockedCost.nonMana) {
          switch (costPart.kind) {
            case 'crew':
              costEvents.push({ type: 'actionGroup', events: (event.choices ?? []).map(objectId => ({ type: 'tap' as const, objectId })) })
              break
            case 'tapSource':
              costEvents.push({ type: 'tap', objectId: source.id })
              break
            case 'life':
              costEvents.push({
                type: 'payLife', seat: event.seat,
                amount: evaluateAnnouncementCostAmount(costPart.amount, event.x), source: source.name,
              })
              break
            case 'loyalty': {
              const amount = evaluateAnnouncementCostAmount(costPart.amount, committed.lockedCost.x)
              source.counters.loyalty = (source.counters.loyalty ?? 0) + (costPart.minus ? -amount : amount)
              source.loyaltyActivatedTurn = state.turn
              break
            }
          }
        }
        const costObjectIds = resolveNonManaCostObjectChoices(
          draft,
          event.seat,
          committed.proposal.excludeSourceFromCosts ? committed.proposal.sourceId : '',
          committed.lockedCost.nonMana,
          committed.lockedCost.x,
          event.choices,
          committed.proposal.sourceId,
        )
        if (costObjectIds.length > 0) {
          committed = {
            ...committed,
            proposal: {
              ...committed.proposal,
              nonManaChoices: costObjectIds,
            },
          }
        }
        let choiceIndex = 0
        let millIndex = 0
        for (const costPart of committed.lockedCost.nonMana) {
          if (costPart.kind === 'mill') {
            const count = evaluateAnnouncementCostAmount(costPart.count, event.x)
            for (const objectId of draft.zoneOrder[event.seat]!.library.slice(millIndex, millIndex + count)) costEvents.push({ type: 'mill', seat: event.seat, objectId })
            millIndex += count
            continue
          }
          if (costPart.kind === 'draw') {
            const count = evaluateAnnouncementCostAmount(costPart.count, event.x)
            for (let i = 0; i < count; i += 1) {
              costEvents.push({ type: 'draw', seat: event.seat, count: 1 })
            }
            continue
          }
          if (costPart.kind !== 'discard' && costPart.kind !== 'sacrifice') continue
          const count = evaluateAnnouncementCostAmount(costPart.count, event.x)
          for (const objectId of costObjectIds.slice(choiceIndex, choiceIndex + count)) {
            costEvents.push(costPart.kind === 'discard'
              ? { type: 'discard', seat: event.seat, objectId }
              : { type: 'sacrifice', objectId })
          }
          choiceIndex += count
        }
        const resolvedTargets = event.targets ?? event.targetClauses?.flat() ?? []
        const activationGrant = activatedGrantAt(source, Number(abilityIndex))
        const canonicalExecution = {
          ...(activationGrant ? { ...activationGrant.execution, grantSource: { objectId: activationGrant.sourceId, incarnation: activationGrant.sourceIncarnation }, ...(activationGrant.execution?.choices ? { choices: structuredClone(activationGrant.execution.choices) } : {}), ...(activationGrant.execution?.results ? { results: structuredClone(activationGrant.execution.results) } : {}) } : {}),
          controller: event.seat,
          source: captureObject(source),
          definitionSnapshot: createDefinitionSnapshot(compiled),
          abilityIndex: Number(abilityIndex),
          targetBindings: canonicalTargetBindings(
            draft,
            source,
            compiled.definition,
            Number(abilityIndex),
            resolvedTargets,
            undefined,
            groupedTargets,
            event.seat,
            event.x,
            modal?.targetClauses,
            modal?.scopeIds,
            modal?.modeIndices,
          ),
          announcement: {
            id: committed.id,
            sourceId: committed.proposal.sourceId,
            phase: 'committed' as const,
            costChoices: announcementCostChoices(committed),
            lockedCost: committed.lockedCost,
            payment: committed.payment,
          },
          ...(event.modeIndices ? { modeIndices: [...event.modeIndices] } : {}),
          ...(modal?.modeCount !== undefined ? { modeCount: modal.modeCount } : {}),
          ...(event.distributionBindings ? { distributionBindings: structuredClone(event.distributionBindings) } : {}),
        }
        const canonicalInstructions = canonical?.kind === 'activated' && canonical.modes
          ? (modal?.modeIndices ?? []).flatMap((modeIndex) => canonical.modes?.[modeIndex]?.instructions ?? [])
          : canonical?.kind === 'activated' ? canonical.instructions ?? [] : []
        const activationItem = {
          kind: 'ability' as const,
          objectId: source.id,
          controller: event.seat,
          name: source.name,
          targets: resolvedTargets,
          abilityId: event.abilityId,
          payload: { instructions: canonicalInstructions },
          execution: canonicalExecution,
          ...(event.x !== undefined ? { x: event.x } : {}),
          ...(event.door ? { door: event.door } : {}),
        }
        if (costEvents.length > 0) {
          const pendingActivation = manaClassification.isManaAbility
            ? { ...activationItem, ...(event.choices ? { choices: event.choices } : {}) }
            : activationItem
          if (draft.provisionalAnnouncement && manaClassification.isManaAbility) {
            draft.provisionalAnnouncement.nestedManaPayment = {
              transaction: committed,
              pendingActivation,
              plannedPaymentCursor: 0,
              source: captureObject(source),
              definitionSnapshot: createDefinitionSnapshot(compiled),
            }
            return
          }
          if (!state.provisionalAnnouncement) {
            draft.provisionalAnnouncement = {
              id: committed.id,
              payer: event.seat,
              transaction: committed,
              baseline: structuredClone(state),
              pendingActivation,
              plannedPaymentCursor: 0,
              source: captureObject(source),
              definitionSnapshot: createDefinitionSnapshot(compiled),
              ...(manaClassification.isManaAbility ? { inlineManaAbility: true } : {}),
            }
            draft.priority = null
            return
          }
        }
        if (manaClassification.isManaAbility) {
          const inlineItem = {
            id: draft.allocId('inline'),
            ...activationItem,
            ...(event.choices ? { choices: event.choices } : {}),
          }
          startCanonicalResolution(draft, inlineItem, { inline: true })
          if (draft.resolution?.kind === 'canonicalSpell') {
            draft.resolution.pendingEvents = costEvents
            draft.resolution.phase = costEvents.length > 0 ? 'committing' : 'running'
          }
          draft.priority = null
          return
        }
        draft.addToStack(activationItem)
        captureAbilityActivation(state, draft, draft.stack[0]!)
        captureCanonicalWardTriggers(state, draft, event, draft.stack[0]!)
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
      captureAbilityActivation(state, draft, draft.stack[0]!)
      draft.passedInRow = []
      draft.priority = event.seat
    }
    if (effect.cycling) draft.enqueue({ type: 'cycle', seat: event.seat, objectId: source.id })
    draft.note(`${event.seat} activates ${source.name}`)
  },
}
