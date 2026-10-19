import { keywordAbility } from '../builders'
import { KEYWORDS } from '../schema/v1'

export const keyword = Object.freeze({
  get flash() { return keywordAbility(KEYWORDS.flash) },
  get flying() { return keywordAbility(KEYWORDS.flying) },
  get defender() { return keywordAbility(KEYWORDS.defender) },
  get trample() { return keywordAbility(KEYWORDS.trample) },
})
