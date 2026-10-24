import type { GameObject } from '../types'
import {
  alternateCast,
  createTokenInstruction,
  gift,
  ifGiftPromised,
  grantProtectionFromEverything,
  lifeTotalCannotChange,
  phaseOutControlled,
  handler,
  handlerIdsFromEffects,
  onResolve,
  pluginIdsFromEffects,
  staticGrant,
  targetOnResolve,
  type CardEffect,
  type CardInstruction,
} from './effects'

const bird = createTokenInstruction({
  name: 'Bird',
  types: ['Creature'],
  subtypes: ['Bird'],
  power: 2,
  toughness: 2,
  oracleText: 'Flying',
})

const perchBirds = (): CardInstruction[] => [bird, bird, bird, bird]

// Keep leftover registrations sorted by Unicode card name until this object is removed.
export const CARD_RULES: Record<string, CardEffect[]> = {
  'Concordant Crossroads': [staticGrant('sharedHaste'), handler('sharedHaste')],
  'Everybody Lives!': [handler('combatPreventionCards')],
  'Perch Protection': [
    gift({ label: 'Gift an extra turn', extraTurn: true }),
    onResolve(
      ...perchBirds(),
      ifGiftPromised(
        phaseOutControlled(),
        grantProtectionFromEverything(),
        lifeTotalCannotChange(),
      ),
    ),
  ],
  'Snuff Out': [
    alternateCast('pay-4-life', 'Pay 4 life', '', {
      life: 4,
      controlledSubtype: 'Swamp',
    }),
    targetOnResolve('destroy', { zone: 'battlefield', type: 'Creature', nonblack: true }),
  ],
}

export const effectsFor = (name: string): CardEffect[] => CARD_RULES[name] ?? []

/** Every handler module a host has to load for this table's cards. */
export const allHandlerIds = () =>
  [...new Set(Object.values(CARD_RULES).flatMap(handlerIdsFromEffects))].sort()

/** Handlers required by the named cards, not the whole Oracle table. */
export const handlerIdsForNames = (names: string[]) =>
  [...new Set(names.flatMap((name) => handlerIdsFromEffects(effectsFor(name))))].sort()

export const effectsOf = (
  object: Pick<GameObject, 'name'> & Partial<Pick<GameObject, 'effects' | 'ruleDefinition'>>,
) => {
  if (object.ruleDefinition && !(object.effects && object.effects.length > 0)) return []
  return object.effects && object.effects.length > 0 ? object.effects : effectsFor(object.name)
}

export const cardDefinition = (name: string) => {
  const effects = CARD_RULES[name]
  if (!effects) return
  return {
    name,
    pluginIds: pluginIdsFromEffects(effects),
    handlerIds: handlerIdsFromEffects(effects),
    effects,
  }
}
