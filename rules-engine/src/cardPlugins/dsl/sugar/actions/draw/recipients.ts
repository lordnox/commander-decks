import { ref, target } from '../../../builders'
import { drawCounts } from './counts'

export const drawRecipients = Object.freeze({
  get self() { return drawCounts(ref('controller')) },
  get target() { return drawCounts(target(0)) },
  targetAt(index: number) { return drawCounts(target(index)) },
})
