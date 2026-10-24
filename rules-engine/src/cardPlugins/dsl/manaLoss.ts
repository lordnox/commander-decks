import type { GameEvent, GameState } from '../../types'

/** Static consequences of actually losing unspent mana; spending is a different event. */
export const manaLossConsequences = (state: GameState) => Object.values(state.objects).flatMap(source => {
  if (source.zone !== 'battlefield' || source.phasedOut) return []
  return (source.ruleDefinition?.definition.abilities ?? []).flatMap(ability => ability.kind === 'static' && ability.activeIn.includes('battlefield')
    ? ability.effects.flatMap(effect => effect.kind === 'loseLifeOnManaLoss' ? Object.values(state.players).flatMap(player => {
      const amount = Object.values(player.mana).reduce((sum, value) => sum + value, 0) + (player.restrictedMana?.length ?? 0)
      return amount > 0 && !player.lost ? [{ type: 'loseLife' as const, seat: player.id, amount, source: source.id } satisfies GameEvent] : []
    }) : []) : [])
})
