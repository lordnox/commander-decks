import { ATTACK_REQUIREMENT_ERROR } from './attackRequirementConstants'
import { attackDeclarationBanned } from '../cardPlugins/attackBan'
import { attackTaxAmount } from '../cardPlugins/combatTax'
import { hasKeyword } from '../keywords'
import { pinTarget } from '../objectIdentity'
import type { AttackerDecl, GameObject, GameState, PlayerId, TargetRef } from '../types'

export const playerAttackRequirements = (object: GameObject) =>
  (object.continuousEffects ?? []).flatMap(({ effect }) => effect.kind === 'mustAttackPlayer' ? [effect.defender] : [])

const eligible = (state: GameState, object: GameObject, seat: PlayerId) =>
  object.zone === 'battlefield' && !object.phasedOut && object.controller === seat
  && object.types.includes('Creature') && !object.tapped
  && !hasKeyword(object, 'defender')
  && (!object.summoningSickness || hasKeyword(object, 'haste'))

/** CR 508.1c–d: maximize requirements within restrictions; paying attack costs is optional. */
export const playerAttackDeclarationError = (state: GameState, seat: PlayerId, attackers: readonly AttackerDecl[]) => {
  for (const object of Object.values(state.objects)) {
    const required = playerAttackRequirements(object)
    if (!required.length || object.controller !== seat) continue
    const declared = attackers.find(attacker => attacker.objectId === object.id)
    if (!eligible(state, object, seat)) {
      if (declared) return ATTACK_REQUIREMENT_ERROR.cannotAttack
      continue
    }
    const opponents = (state.opponents[seat] ?? []).filter(player => !state.players[player]?.lost)
    const defenders: TargetRef[] = [
      ...opponents.map(player => ({ kind: 'player' as const, player })),
      ...Object.values(state.objects).flatMap(defender => {
        if (defender.zone !== 'battlefield' || defender.phasedOut) return []
        const defendingPlayer = defender.types.includes('Battle') ? defender.protector : defender.controller
        return defendingPlayer && opponents.includes(defendingPlayer)
          && (defender.types.includes('Planeswalker') || defender.types.includes('Battle'))
          ? [pinTarget(state, { kind: 'object', objectId: defender.id })] : []
      }),
    ].filter(defender => !attackDeclarationBanned(state, seat, { objectId: object.id, defender }))
    const goaders = [...new Set((object.continuousEffects ?? []).flatMap(({ effect }) => effect.kind === 'goad' ? [effect.sourceController] : []))]
    const score = (defender?: TargetRef) => {
      if (!defender) return 0
      const player = defender.kind === 'player' ? defender.player : undefined
      return required.filter(requiredPlayer => requiredPlayer === player).length
        + goaders.length + (player ? goaders.filter(goader => goader !== player).length : 0)
    }
    const maximum = Math.max(0, ...defenders.filter(defender => attackTaxAmount(state, [{ objectId: object.id, defender }]) === 0).map(score))
    const target = declared?.defender
    const actual = score(typeof target === 'string' ? { kind: 'player', player: target } : target)
    if (actual < maximum) return ATTACK_REQUIREMENT_ERROR.unsatisfied
  }
}
