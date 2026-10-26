import type { GameObject } from '../../types'
import type { ContinuousEffectDefinition } from './schema/v2'

/** Printed zone mechanics remain part of the canonical definition in hand and exile. */
export const zoneMechanic = <K extends 'foretell' | 'plot' | 'suspend' | 'warp'>(object: GameObject, kind: K) =>
  object.ruleDefinition?.definition.abilities.flatMap(ability => ability.kind === 'static' && ability.activeIn.includes(object.zone)
    ? ability.effects.filter((effect): effect is Extract<ContinuousEffectDefinition, { kind: K }> => effect.kind === kind) : [])[0]
