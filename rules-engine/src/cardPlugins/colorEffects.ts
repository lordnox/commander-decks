import type { GameObject } from '../types'

/** CR 707.2: layer-5 color changes are not copiable values. */
export const copiableColors = (object: GameObject) => {
  const first = object.continuousEffects?.find(({ effect }) => effect.kind === 'colorChange')
  return [...(first?.effect.kind === 'colorChange' ? first.effect.before : object.colors)]
}

/** CR 613.1a/e: copy effects apply before color changes, regardless of timestamp. */
export const reapplyColorChanges = (object: GameObject) => {
  for (const { effect } of object.continuousEffects ?? []) {
    if (effect.kind !== 'colorChange') continue
    effect.before = [...object.colors]
    object.colors = [...effect.after]
  }
}
