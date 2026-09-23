import type { FaceCharacteristics, GameObject, Plugin } from '../types'

const printedFaces = (object: GameObject) =>
  [object.frontFace, object.backFace].filter(
    (face): face is FaceCharacteristics => Boolean(face),
  )

const isAdventureSpellFace = (face: FaceCharacteristics) =>
  face.subtypes.includes('Adventure')

const nonlandFace = (object: GameObject) => {
  const faces = printedFaces(object)
  return faces.find((face) =>
    !face.types.includes('Land') && !isAdventureSpellFace(face))
}

export const adventureFaceOf = (object: GameObject) =>
  printedFaces(object).find(isAdventureSpellFace)

export const permanentFaceOf = (object: GameObject) =>
  printedFaces(object).find((face) => !isAdventureSpellFace(face))

export const isAdventureCard = (object: GameObject) =>
  Boolean(adventureFaceOf(object) && permanentFaceOf(object))

const landFace = (object: GameObject) =>
  printedFaces(object).find((face) => face.types.includes('Land'))

export const castFaceOf = (object: GameObject) => nonlandFace(object)

export const landFaceOf = (object: GameObject) => landFace(object)

export const applyFace = (object: GameObject, face: FaceCharacteristics) => {
  object.types = [...face.types]
  object.subtypes = [...face.subtypes]
  object.supertypes = [...face.supertypes]
  object.manaCost = face.manaCost
  object.manaValue = face.manaValue
  object.colors = [...face.colors]
  if (face.power !== undefined) object.power = face.power
  if (face.toughness !== undefined) object.toughness = face.toughness
  if (face.printedDefense !== undefined) object.printedDefense = face.printedDefense
  if (face.oracleText !== undefined) object.oracleText = face.oracleText
}

/**
 * A modal double-faced card has only its front-face characteristics outside
 * the stack and battlefield. Casting or playing it applies the chosen face.
 */
export const doubleFaced: Plugin = {
  id: 'doubleFaced',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'move') return
    const before = state.objects[event.objectId]
    const object = draft.object(event.objectId)
    if (
      !before
      || !object
      || event.to === 'battlefield'
      || event.to === 'stack'
      || object.token
      || !object.frontFace
    ) {
      return
    }
    applyFace(object, object.frontFace)
  },
}
