import { hasKeyword } from '../keywords'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import type {
  AttackerDecl,
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  TargetRef,
} from '../types'
import {
  grantOracleLineUntilEndOfTurn,
  untilEndOfTurn,
} from './continuousEffects'
import { copyTokenTemplate, createToken } from './effects'
import type { InstructionHandler } from './instructionHandlers/types'

const targetRef = (target: TargetRef | PlayerId): TargetRef =>
  typeof target === 'string' ? { kind: 'player', player: target } : target

export const encoreDefender = (object: GameObject): PlayerId | null => {
  const entry = (object.continuousEffects ?? []).find(
    ({ effect }) => effect.kind === 'encoreAttack',
  )
  return entry?.effect.kind === 'encoreAttack' ? entry.effect.defender : null
}

const opposingPlayers = (state: GameState, controller: PlayerId) =>
  state.playerOrder.filter(
    (seat) => seat !== controller && !state.players[seat]?.lost,
  )

const canAttackThisCombat = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
) =>
  object.zone === 'battlefield'
  && object.controller === seat
  && object.types.includes('Creature')
  && !object.tapped
  && (!object.summoningSickness || hasKeyword(object, 'haste', state))

const defenderPlayer = (state: GameState, target: TargetRef): PlayerId | null => {
  if (target.kind === 'player') return target.player
  const object = state.objects[target.objectId]
  if (!object) return null
  return object.types.includes('Battle') ? object.protector ?? null : object.controller
}

export const defenderLegalForEncoreAttacker = (
  state: GameState,
  attacker: GameObject,
  defender: TargetRef | PlayerId,
) => {
  const required = encoreDefender(attacker)
  if (!required) return true
  const ref = targetRef(defender)
  if (ref.kind !== 'player') return false
  return ref.player === required
}

const mustEncoreAttackIfAble = (state: GameState, object: GameObject, seat: PlayerId) => {
  const defender = encoreDefender(object)
  if (!defender) return false
  if (!canAttackThisCombat(state, object, seat)) return false
  if (state.players[defender]?.lost) return false
  return true
}

export const encoreAttackDeclarationError = (
  state: GameState,
  seat: PlayerId,
  attackers: AttackerDecl[],
): string | null => {
  const declared = new Map(attackers.map((declaration) => [declaration.objectId, declaration]))
  for (const object of Object.values(state.objects)) {
    if (!mustEncoreAttackIfAble(state, object, seat)) continue
    const defender = encoreDefender(object)
    if (!declared.has(object.id)) {
      return 'an encore token must attack if able'
    }
    const declaration = declared.get(object.id)
    if (
      declaration
      && defender
      && defenderPlayer(state, targetRef(declaration.defender)) !== defender
    ) {
      return 'an encore token must attack its designated opponent if able'
    }
  }
  for (const declaration of attackers) {
    const object = state.objects[declaration.objectId]
    if (!object) continue
    if (!defenderLegalForEncoreAttacker(state, object, declaration.defender)) {
      return 'an encore token must attack its designated opponent if able'
    }
  }
  return null
}

const encoreTokens: InstructionHandler<'encoreTokens'> = ({ draft, source }) => {
  const tokenIds: string[] = []
  for (const opponent of opposingPlayers(draft, source.controller)) {
    const token = createToken(draft, source.controller, copyTokenTemplate(source))
    grantOracleLineUntilEndOfTurn(token, 'Haste')
    untilEndOfTurn(token, { kind: 'encoreAttack', defender: opponent })
    tokenIds.push(token.id)
  }
  if (tokenIds.length === 0) return
  registerDelayedTrigger(
    draft,
    source,
    { kind: 'step', step: 'end' },
    [{ kind: 'sacrificeObjectIds', objectIds: tokenIds }],
  )
}

const sacrificeObjectIds: InstructionHandler<'sacrificeObjectIds'> = (
  { draft },
  instruction,
) => {
  for (const objectId of instruction.objectIds) {
    const object = draft.object(objectId)
    if (object?.zone === 'battlefield') {
      draft.enqueue({ type: 'sacrifice', objectId })
    }
  }
}

export const encoreHandlers = {
  encoreTokens,
  sacrificeObjectIds,
}

/** Marker plugin so handlerIdsFromEffects can load encore instruction handlers. */
export const encore: Plugin = {
  id: 'encore',
}
