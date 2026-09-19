import { createToken } from '../cardPlugins/effects'
import type { GameState, Plugin, RuleInstance, TargetRef } from '../types'

const protectedPlayer = (
  state: GameState,
  target: TargetRef,
  controller: string,
) => target.kind === 'player'
  ? target.player === controller
  : state.objects[target.objectId]?.types.includes('Planeswalker') === true
    && state.objects[target.objectId]?.controller === controller

const sourceController = (state: GameState, sourceId: string) =>
  state.objects[sourceId]?.controller

const hasMode = (state: GameState, mode: string) =>
  state.rules.some((rule) =>
    rule.pluginId === 'advancedCombatPrevention' && rule.params.mode === mode)

export const everybodyLives = (state: GameState) => hasMode(state, 'everybodyLives')

const comeuppanceReplacement = (
  state: GameState,
  event: Extract<Parameters<NonNullable<Plugin['replace']>>[0]['event'], { type: 'dealDamage' }>,
  rule: RuleInstance,
) => {
  const controller = typeof rule.params.controller === 'string'
    ? rule.params.controller
    : undefined
  const sourceId = typeof rule.params.cardSourceId === 'string'
    ? rule.params.cardSourceId
    : undefined
  if (
    !controller
    || !sourceId
    || sourceController(state, event.sourceId) === controller
    || !protectedPlayer(state, event.target, controller)
  ) {
    return
  }
  const damageSource = state.objects[event.sourceId]
  if (!damageSource) return null
  return {
    type: 'dealDamage' as const,
    sourceId,
    target: damageSource.types.includes('Creature')
      ? { kind: 'object' as const, objectId: damageSource.id }
      : { kind: 'player' as const, player: damageSource.controller },
    amount: event.amount,
  }
}

export const advancedCombatPrevention: Plugin = {
  id: 'advancedCombatPrevention',
  legal: ({ state, event }) => {
    if (
      (event.type !== 'castSpell' && event.type !== 'activateAbility')
      || !everybodyLives(state)
    ) {
      return
    }
    for (const target of event.targets ?? []) {
      if (
        target.kind === 'player'
        && target.player !== event.seat
        && state.players[target.player]
      ) {
        return `${target.player} has hexproof`
      }
    }
  },
  replace: ({ state, event, rule }) => {
    if (rule.params.mode === 'everybodyLives' && event.type === 'loseLife') return null
    if (event.type !== 'dealDamage') return
    if (rule.params.mode === 'comeuppance') {
      return comeuppanceReplacement(state, event, rule)
    }
    if (
      rule.params.mode === 'inkshield'
      && event.combat === true
      && event.target.kind === 'player'
      && event.target.player === rule.params.controller
    ) {
      const controller = String(rule.params.controller)
      return Array.from({ length: event.amount }, () => ({
        type: 'createToken' as const,
        controller,
        token: {
          name: 'Inkling',
          types: ['Creature'],
          subtypes: ['Inkling'],
          colors: ['W', 'B'],
          power: 2,
          toughness: 1,
          oracleText: 'Flying',
        },
      }))
    }
  },
  apply: ({ event, draft, rule }) => {
    if (event.type !== 'createToken' || rule.params.mode) return
    createToken(draft, event.controller, {
      name: event.token.name,
      types: event.token.types,
      subtypes: event.token.subtypes ?? [],
      colors: event.token.colors ?? [],
      power: event.token.power ?? null,
      toughness: event.token.toughness ?? null,
      oracleText: event.token.oracleText ?? '',
    })
  },
}
