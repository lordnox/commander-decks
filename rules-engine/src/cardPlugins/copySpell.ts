import type { Plugin } from '../types'

export { copyStackSpell } from './effects'

/** Twincast and other copy effects enqueue the copied spell in targetedResolve. */
export const copySpell: Plugin = {
  id: 'copySpell',
}
