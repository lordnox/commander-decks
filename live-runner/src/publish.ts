import {
  SEAT_IDS,
  type SeatActionIds,
  type SeatActions,
  type SeatId,
} from './protocol'
import type { JudgeHistoryEntry } from './lobby'
import { keysPath, replayPath } from './session'

const ENCODER = '.agents/skills/live-table/scripts/encode_live.py'

/** Publish one dealt-game frame per bin through the live-table encoder. */
export const publishReplay = async (options: {
  slug: string
  root: string
  talk: string
  judge: string
  privateJudge: Partial<Record<SeatId, string>>
  waiting: string
  privateWaiting: Partial<Record<SeatId, string>>
  judgeHistory: Partial<Record<SeatId, JudgeHistoryEntry[]>>
  actions: SeatActions
  actionIds: SeatActionIds
  event?: number
}) => {
  const {
    slug,
    root,
    talk,
    judge,
    privateJudge,
    waiting,
    privateWaiting,
    judgeHistory,
    actions,
    actionIds,
  } = options
  for (const seat of SEAT_IDS satisfies readonly SeatId[]) {
    const args = [
      ENCODER,
      replayPath(slug, root),
      '--you',
      seat,
      '--talk',
      talk,
      '--judge',
      judge,
      '--seat-judges-json',
      JSON.stringify(privateJudge),
      '--waiting',
      waiting,
      '--seat-waiting-json',
      JSON.stringify(privateWaiting),
      '--judge-history-json',
      JSON.stringify(judgeHistory),
      '--actions-json',
      JSON.stringify(actions),
      '--action-ids-json',
      JSON.stringify(actionIds),
      '--conduit',
      '--conduit-keys',
      keysPath(slug, root),
    ]
    if (options.event !== undefined) args.push('--event', String(options.event))
    const child = Bun.spawn(['python3', ...args], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await child.exited
    if (code !== 0) {
      throw new Error(
        `encode_live failed for ${seat}: ${await new Response(child.stderr).text()}`,
      )
    }
  }
}
