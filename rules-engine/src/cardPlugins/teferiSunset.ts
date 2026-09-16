import type { PlayerId, Plugin } from '../types'

const EMBLEMS = 'teferiSunset.emblems'

const emblemCount = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0

export const teferiSunset: Plugin = {
  id: 'teferiSunset',
  apply: ({ event, draft }) => {
    if (event.type === 'custom' && event.name === 'teferiSunset.emblem' && event.seat) {
      const player = draft.players[event.seat]
      player.data[EMBLEMS] = emblemCount(player.data[EMBLEMS]) + 1
      draft.note(`${event.seat} gets a Teferi emblem`)
      return
    }
    if (event.type !== 'custom' || event.name !== 'advanceStep') return
    for (const player of Object.values(draft.players)) {
      const count = emblemCount(player.data[EMBLEMS])
      if (count === 0 || player.id === draft.active) continue
      if (draft.step === 'untap') {
        for (const object of draft.zoneOf('battlefield', player.id)) object.tapped = false
        draft.note(`${player.id} untaps from a Teferi emblem`)
      }
      if (draft.step === 'draw') {
        draft.enqueue({ type: 'draw', seat: player.id as PlayerId, count })
        draft.note(`${player.id} draws from a Teferi emblem`)
      }
    }
  },
}
