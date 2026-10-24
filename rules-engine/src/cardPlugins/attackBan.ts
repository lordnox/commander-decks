import { matchesTargetFilter } from './targetedResolve'
import type { TargetFilter } from './effectDefinitions'
import type Draft from '../draft'
import type { AttackerDecl, CapturedObject, GameState, PlayerId, TargetRef } from '../types'
import type { ObjectSelector } from './dsl/schema/v1'
import { objectMatchesSelector } from './dsl/compiler/runtime'

export const ATTACK_BANS = 'combat.attackBansUntilEot'

export type AttackBanEntry = {
  turn: number
  defenderFilter?: TargetFilter
  defenderSelector?: ObjectSelector
  protectorController: PlayerId
  source?: CapturedObject
}

const targetRef = (target: TargetRef | PlayerId): TargetRef =>
  typeof target === 'string' ? { kind: 'player', player: target } : target

const bansFor = (state: Pick<GameState, 'players'>, seat: PlayerId): AttackBanEntry[] => {
  const value = state.players[seat]?.data[ATTACK_BANS]
  return Array.isArray(value) ? value as AttackBanEntry[] : []
}

export type AttackBanAdd = AttackBanEntry & { attackerController: PlayerId }

export const addAttackBan = (
  draft: Draft,
  entry: AttackBanAdd,
) => {
  const player = draft.players[entry.attackerController]
  if (!player) return
  const existing = bansFor(draft, entry.attackerController)
  const { attackerController: _, ...stored } = entry
  player.data[ATTACK_BANS] = [...existing, stored]
}

export const clearAttackBans = (draft: Draft) => {
  for (const seat of draft.playerOrder) {
    delete draft.players[seat].data[ATTACK_BANS]
  }
}

export const attackDeclarationBanned = (
  state: GameState,
  seat: PlayerId,
  declaration: AttackerDecl,
): string | null => {
  const declaredTarget = targetRef(declaration.defender)
  if (declaredTarget.kind !== 'object') return null
  const defender = state.objects[declaredTarget.objectId]
  if (!defender) return null
  for (const ban of bansFor(state, seat)) {
    if (ban.turn !== state.turn) continue
    if (ban.defenderSelector && ban.source) {
      if (objectMatchesSelector(defender, ban.defenderSelector, {
        state,
        controller: ban.protectorController,
        source: ban.source,
      })) {
        return 'creatures you control cannot attack that permanent this turn'
      }
      continue
    }
    if (
      ban.defenderFilter
      && matchesTargetFilter(
        state,
        defender,
        ban.defenderFilter,
        ban.protectorController,
      )
    ) {
      return 'creatures you control cannot attack that permanent this turn'
    }
  }
  return null
}
