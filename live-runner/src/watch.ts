export {
  decodePrefix,
  type ConduitKind,
  type ConduitFrame,
} from '../../shared/liveConduit'
import { watchSnapshots as watchSnapshotsCore } from '../../shared/liveConduit'

export const watchSnapshots = (
  origin: string,
  readKey: string,
  onFrame: (generation: number, body: Uint8Array) => void,
  options: { from?: number; onStatus?: (connected: boolean) => void } = {},
) =>
  watchSnapshotsCore(
    origin,
    readKey,
    (frame) => onFrame(frame.generation, frame.body),
    { ...options, acceptStringMessages: true },
  )
