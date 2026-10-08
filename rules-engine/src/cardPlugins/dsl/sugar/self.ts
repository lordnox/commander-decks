import { enters, dies, ref } from '../builders'

export const self = Object.freeze({
  get enters() { return enters({ filter: ref('self') }) },
  get dies() { return dies({ filter: ref('self') }) },
})
