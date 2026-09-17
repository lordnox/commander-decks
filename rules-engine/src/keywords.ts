import type { GameObject } from './types'

/**
 * Oracle text split into its ability-line tokens. Keyword abilities sit on
 * their own line or in a comma list, so a token match never mistakes
 * "target creature gains flying" for flying, and a split card's own
 * "Deathtouch // ..." line still reads as deathtouch.
 */
export const abilityTokens = (oracleText: string) =>
  oracleText
    .split(/\n|\/\//)
    .flatMap((line) => line.split(','))
    .map((token) =>
      token
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\.$/, ''))

export const hasKeyword = (object: GameObject, keyword: string, state?: {
  rules: Array<{ pluginId: string }>
}) => {
  if (abilityTokens(object.oracleText).includes(keyword)) return true
  return keyword === 'haste'
    && Boolean(state?.rules.some((rule) => rule.pluginId === 'sharedHaste'))
}

export const strikesFirst = (object: GameObject) =>
  hasKeyword(object, 'first strike') || hasKeyword(object, 'double strike')

/**
 * Damage that counts as lethal when a trampling attacker divides its damage
 * (CR 510.1a). Deathtouch makes any nonzero amount lethal (CR 702.2c), so one
 * point satisfies each blocker and everything else can trample through.
 */
export const lethalDamage = (blocker: GameObject, source?: GameObject) => {
  const remaining = Math.max(0, (blocker.toughness ?? 0) - blocker.damageMarked)
  if (!source || !hasKeyword(source, 'deathtouch')) return remaining
  return Math.min(1, remaining)
}
