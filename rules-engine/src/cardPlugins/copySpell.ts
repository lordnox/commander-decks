import type { Plugin } from '../types'

/** Twincast and other copy effects enqueue the copied spell in targetedResolve. */
export const copySpell: Plugin = {
  id: 'copySpell',
}
