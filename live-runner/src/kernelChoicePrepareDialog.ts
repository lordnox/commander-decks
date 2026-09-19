import {
  dialogCandidates,
  pendingDialog,
} from '../../rules-engine/src/pendingDialog'
import type { LobbyState } from './lobby'
import { isSeatId } from './protocol'
import type { KernelHandle } from './kernelHandle'
import { OPTIONAL_DIALOGS, openTopdeck } from './kernelChoice'

/** The generic card dialog every plugin reaches for when no family fits. */
export const preparePendingDialog = (kernel: KernelHandle, lobby: LobbyState) => {
  const state = kernel.history.current()
  const dialog = pendingDialog(state)
  if (!dialog || !isSeatId(dialog.seat)) return false
  const cards = dialog.options
    ?? (OPTIONAL_DIALOGS.has(dialog.kind)
      ? ['Yes']
      : dialogCandidates(state, dialog).map((object) => object.name))
  if (dialog.optional && cards.length === 0) {
    const result = kernel.dispatch({ type: 'custom', name: dialog.chosenEvent, seat: dialog.seat })
    if (!result.ok) throw new Error(result.error)
    return false
  }
  return openTopdeck(
    lobby,
    {
      seat: dialog.seat,
      kind: dialog.kind,
      cards,
      destinations: dialog.destinations,
      ...(dialog.requirements ? { requirements: dialog.requirements } : {}),
      kernel: {
        sourceId: dialog.sourceId,
        stage: dialog.kind,
        chosenEvent: dialog.chosenEvent,
        after: dialog.after,
      },
    },
    {
      waiting: `${lobby.occupants[dialog.seat]?.name ?? dialog.seat} ${dialog.waiting}`,
      prompt: dialog.prompt,
      judge: dialog.judge,
    },
  )
}
