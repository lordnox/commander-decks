import {
  eventsForAvailableAction,
  eventsForCombatDeclaration,
  legalActsFor,
  sameLegalAct,
  type GameEvent,
  type GameState,
} from '../../rules-engine/src/index'
import type { LobbyState } from './lobby'
import { isSeatId, type InboxMessage, type SeatId } from './protocol'
import { kernelActions, kernelPriority, type KernelHandle } from './kernelHandle'

export const applyKernelAct = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
  message: Extract<InboxMessage, { type: 'act' }>,
) => {
  const state = kernel.history.current()
  if (message.kind === 'declareAttackers' || message.kind === 'declareBlockers') {
    const available = legalActsFor(state, seat).find(
      (candidate) => candidate.kind === message.kind,
    )
    if (!available || !('objectIds' in available)) {
      throw new Error(
        message.kind === 'declareAttackers'
          ? 'Attackers cannot be declared now'
          : 'Blockers cannot be declared now',
      )
    }
    const eligible = new Set(available.objectIds)
    let declaration:
      | Extract<GameEvent, { type: 'declareAttackers' }>
      | Extract<GameEvent, { type: 'declareBlockers' }>
    if (message.kind === 'declareAttackers') {
      const attackers = message.attackers ?? []
      if (new Set(attackers.map((attacker) => attacker.objectId)).size !== attackers.length) {
        throw new Error('An attacker can only be declared once')
      }
      declaration = {
        type: 'declareAttackers',
        seat,
        attackers: attackers.map(({ objectId, defenderId }) => {
          if (!eligible.has(objectId)) throw new Error('That creature cannot attack now')
          return {
            objectId,
            defender: isSeatId(defenderId)
              ? defenderId
              : { kind: 'object', objectId: defenderId },
          }
        }),
      }
    } else {
      const blockers = message.blockers ?? []
      const attackerIds = new Set(
        available.kind === 'declareBlockers' ? available.attackerIds : [],
      )
      if (new Set(blockers.map((blocker) => blocker.blockerId)).size !== blockers.length) {
        throw new Error('A blocker can only be declared once')
      }
      if (new Set(blockers.map((blocker) => blocker.attackerId)).size !== blockers.length) {
        throw new Error('Only one blocker per attacker is supported')
      }
      declaration = {
        type: 'declareBlockers',
        seat,
        blockers: blockers.map(({ blockerId, attackerId }) => {
          if (!eligible.has(blockerId)) throw new Error('That creature cannot block now')
          if (!attackerIds.has(attackerId)) throw new Error('That creature is not attacking you')
          return { blockerId, attackerId }
        }),
      }
    }
    const events = eventsForCombatDeclaration(state, declaration)
    if (!events) throw new Error('The combat tax cannot be paid')
    const event = events[0]
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
    const current = kernel.history.current()
    lobby.actions = kernelActions(current)
    const declarations = message.kind === 'declareAttackers'
      ? message.attackers ?? []
      : message.blockers ?? []
    const noun = message.kind === 'declareAttackers' ? 'attacker' : 'blocker'
    lobby.privateJudge = {
      [seat]: declarations.length > 0
        ? `${declarations.length} ${noun}${declarations.length === 1 ? '' : 's'} declared.`
        : `No ${noun}s declared.`,
    }
    lobby.judge = `${lobby.occupants[seat]?.name ?? seat} declares ${noun}s.`
    lobby.waiting =
      `${lobby.occupants[kernelPriority(current) ?? seat]?.name ?? seat}: act or pass.`
    lobby.privateWaiting = {}
    return events
  }
  const action = legalActsFor(state, seat).find((candidate) =>
    sameLegalAct(candidate, message))
  if (!action) throw new Error('That action is not available now')
  const activationGroups = action.kind === 'activateAbility'
    ? action.targetGroups ?? []
    : []
  const costGroups = activationGroups.filter(({ purpose }) => purpose === 'cost')
  const costChoiceCount = costGroups
    .reduce((total, group) => total + group.max, 0)
  const activationChoices = (message.targetObjectIds ?? []).slice(0, costChoiceCount)
  const activationTargets = (message.targetObjectIds ?? []).slice(costChoiceCount)
  let costChoiceOffset = 0
  for (const group of costGroups) {
    const selected = activationChoices.slice(costChoiceOffset, costChoiceOffset + group.max)
    if (
      selected.length < group.min
      || selected.some((objectId) =>
        !group.targets.some((target) => target.objectId === objectId))
    ) {
      throw new Error(`Invalid selection for ${group.label}`)
    }
    costChoiceOffset += group.max
  }
  const events = action.kind === 'activateAbility' && action.targetGroups
    ? [{
        type: 'activateAbility' as const,
        seat,
        objectId: action.objectId,
        abilityId: action.abilityId ?? '',
        targets: activationTargets.map((objectId) => {
          const group = activationGroups.find((candidate) =>
            candidate.purpose !== 'cost'
            && candidate.targets.some((target) => target.objectId === objectId))
          return (
            group?.kind === 'player'
              ? { kind: 'player' as const, player: objectId }
              : { kind: 'object' as const, objectId }
          )
        }),
        choices: activationChoices,
      }]
    : action.kind === 'castSpell' && action.targetGroups
      ? [{
          type: 'castSpell' as const,
          seat,
          objectId: action.objectId,
          ...(action.phyrexianLife ? { phyrexianLife: action.phyrexianLife } : {}),
          targets: (message.targetObjectIds ?? []).map((objectId) => ({
            kind: 'object' as const,
            objectId,
          })),
        }]
    : eventsForAvailableAction(state, seat, action)
  if (!events) throw new Error('That action now needs a judge decision')

  let dryRun = state
  for (const event of events) {
    const result = kernel.rules(dryRun, event)
    if (!result.ok) throw new Error(result.error)
    dryRun = result.state
  }
  for (const event of events) {
    const result = kernel.dispatch(event)
    if (!result.ok) throw new Error(result.error)
  }

  const current = kernel.history.current()
  const actionName = 'name' in action ? action.name : action.kind
  lobby.actions = kernelActions(current)
  lobby.privateJudge = {
    [seat]: `${actionName} was applied through ${events.length} kernel event(s).`,
  }
  lobby.judge = `${lobby.occupants[seat]?.name ?? seat} acted.`
  lobby.waiting = `${lobby.occupants[kernelPriority(current) ?? seat]?.name ?? seat}: act, pass, or advance.`
  lobby.privateWaiting = {}
  return events
}

const COMBAT_STEPS = new Set([
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
  'endCombat',
])

const advanceTarget = (state: GameState) => {
  if (['untap', 'upkeep', 'draw'].includes(state.step)) return 'precombatMain'
  if (state.step === 'precombatMain') return 'beginCombat'
  if (state.step === 'beginCombat') return 'declareAttackers'
  if (COMBAT_STEPS.has(state.step)) return 'postcombatMain'
  if (state.step === 'postcombatMain') return 'end'
  return null
}

export const applyKernelAdvance = (
  kernel: KernelHandle,
  lobby: LobbyState,
  seat: SeatId,
) => {
  let current = kernel.history.current()
  const target = advanceTarget(current)
  if (
    !target
    || current.active !== seat
    || current.priority !== seat
    || current.stack.length > 0
  ) {
    return false
  }

  for (let guard = 0; current.step !== target && guard < 16; guard += 1) {
    const result = kernel.dispatch({ type: 'advanceStep' })
    if (!result.ok) return false
    current = kernel.history.current()
    if (current.stack.length > 0) break
  }

  lobby.actions = kernelActions(current)
  lobby.privateJudge = {}
  lobby.privateWaiting = {}
  lobby.judge = `${lobby.occupants[seat]?.name ?? seat} advances.`
  lobby.waiting = current.stack.length > 0
    ? 'A triggered object is waiting on the stack.'
    : `${lobby.occupants[kernelPriority(current) ?? seat]?.name ?? seat}: act, pass, or advance.`
  return true
}
