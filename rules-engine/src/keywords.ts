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

export const hasKeyword = (object: GameObject, keyword: string) =>
  abilityTokens(object.oracleText).includes(keyword)

export const strikesFirst = (object: GameObject) =>
  hasKeyword(object, 'first strike') || hasKeyword(object, 'double strike')
