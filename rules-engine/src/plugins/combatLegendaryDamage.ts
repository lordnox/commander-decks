import type { GameObject, PlayerState } from '../types'

/** Controllers whose legendary creatures dealt combat damage to this player this turn. */
export const LEGENDARY_COMBAT_DAMAGE_FROM = 'combat.legendaryDamageFrom'

export const legendaryCombatDamageFrom = (player: Pick<PlayerState, 'data'>) => {
  const value = player.data[LEGENDARY_COMBAT_DAMAGE_FROM]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, true>
}

export const isLegendaryCreature = (source: GameObject | undefined) =>
  Boolean(
    source
    && source.types.includes('Creature')
    && source.supertypes.includes('Legendary'),
  )

export const noteLegendaryCombatDamageToPlayer = (
  player: PlayerState,
  sourceController: string,
) => {
  player.data[LEGENDARY_COMBAT_DAMAGE_FROM] = {
    ...legendaryCombatDamageFrom(player),
    [sourceController]: true,
  }
}
