import { keywordAbility } from '../builders'
import { KEYWORDS } from '../schema/v1'

export const keyword = Object.freeze({
  get deathtouch() { return keywordAbility(KEYWORDS.deathtouch) },
  get hexproof() { return keywordAbility(KEYWORDS.hexproof) },
  get indestructible() { return keywordAbility(KEYWORDS.indestructible) },
  get haste() { return keywordAbility(KEYWORDS.haste) },
  get vigilance() { return keywordAbility(KEYWORDS.vigilance) },
  get flash() { return keywordAbility(KEYWORDS.flash) },
  get reach() { return keywordAbility(KEYWORDS.reach) },
  get flying() { return keywordAbility(KEYWORDS.flying) },
  get defender() { return keywordAbility(KEYWORDS.defender) },
  get trample() { return keywordAbility(KEYWORDS.trample) },
})
