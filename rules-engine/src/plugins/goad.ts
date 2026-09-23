import { hasKeyword } from '../keywords'
import type {
  AttackerDecl,
  GameObject,
  GameState,
  PlayerId,
  TargetRef,
} from '../types'

const targetRef = (target: TargetRef | PlayerId): TargetRef =>
  typeof target === 'string' ? { kind: 'player', player: target } : target

const defenderPlayer = (state: GameState, target: TargetRef): PlayerId | null => {
  if (target.kind === 'player') return target.player
  const object = state.objects[target.objectId]
  if (!object) return null
  return object.types.includes('Battle') ? object.protector ?? null : object.controller
}

export const goadingControllers = (object: GameObject): PlayerId[] => [
  ...new Set(
    (object.continuousEffects ?? [])
      .filter(({ effect }) => effect.kind === 'goad')
      .map(({ effect }) => (effect.kind === 'goad' ? effect.sourceController : null))
      .filter((seat): seat is PlayerId => Boolean(seat)),
  ),
]

export const isGoaded = (object: GameObject) => goadingControllers(object).length > 0

export const canAttackThisCombat = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
) =>
  object.zone === 'battlefield'
  && object.controller === seat
  && object.types.includes('Creature')
  && !object.tapped
  && (!object.summoningSickness || hasKeyword(object, 'haste', state))

const opposingPlayers = (state: GameState, controller: PlayerId) =>
  state.playerOrder.filter(
    (seat) => seat !== controller && !state.players[seat]?.lost,
  )

export const legalDefendersForAttacker = (
  state: GameState,
  attacker: GameObject,
): TargetRef[] => {
  const defenders: TargetRef[] = opposingPlayers(state, attacker.controller).map((player) => ({
    kind: 'player',
    player,
  }))
  for (const object of Object.values(state.objects)) {
    if (object.zone !== 'battlefield' || object.controller === attacker.controller) continue
    if (object.types.includes('Planeswalker') || object.types.includes('Battle')) {
      defenders.push({ kind: 'object', objectId: object.id })
    }
  }
  const goaders = goadingControllers(attacker)
  if (goaders.length === 0) return defenders
  const legalPlayers = new Set(
    defenders
      .map((target) => defenderPlayer(state, target))
      .filter((seat): seat is PlayerId => Boolean(seat)),
  )
  const nonGoadingLegal = [...legalPlayers].filter((seat) => !goaders.includes(seat))
  if (nonGoadingLegal.length === 0) return defenders
  return defenders.filter((target) => {
    const seat = defenderPlayer(state, target)
    return !seat || !goaders.includes(seat)
  })
}

export const defenderLegalForGoadedAttacker = (
  state: GameState,
  attacker: GameObject,
  defender: TargetRef | PlayerId,
) => {
  if (!isGoaded(attacker)) return true
  const ref = targetRef(defender)
  return legalDefendersForAttacker(state, attacker).some((candidate) =>
    candidate.kind === ref.kind
    && (candidate.kind === 'player'
      ? ref.kind === 'player' && candidate.player === ref.player
      : ref.kind === 'object' && candidate.objectId === ref.objectId))
}

const mustAttackIfAble = (state: GameState, object: GameObject, seat: PlayerId) =>
  isGoaded(object)
  && canAttackThisCombat(state, object, seat)
  && legalDefendersForAttacker(state, object).length > 0

export const attackDeclarationError = (
  state: GameState,
  seat: PlayerId,
  attackers: AttackerDecl[],
): string | null => {
  const declared = new Map(attackers.map((declaration) => [declaration.objectId, declaration]))
  for (const object of Object.values(state.objects)) {
    if (!mustAttackIfAble(state, object, seat)) continue
    if (!declared.has(object.id)) {
      return 'a goaded creature must attack if able'
    }
  }
  for (const declaration of attackers) {
    const object = state.objects[declaration.objectId]
    if (!object) continue
    if (!defenderLegalForGoadedAttacker(state, object, declaration.defender)) {
      return 'a goaded creature must attack a player other than the goading player if able'
    }
  }
  return null
}
