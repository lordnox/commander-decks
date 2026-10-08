import { keywordAbility } from '../builders'

export const keyword = Object.freeze({
  get defender() { return keywordAbility('defender') },
  get trample() { return keywordAbility('trample') },
})
