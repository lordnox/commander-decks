import { SEAT_IDS, type SeatId } from './protocol'
import { keysPath, replayPath } from './session'

const ENCODER = '.agents/skills/live-table/scripts/encode_live.py'

/** Publish one dealt-game frame per bin through the live-table encoder. */
export const publishReplay = async (options: {
  slug: string
  root: string
  talk: string
  judge: string
  waiting: string
  event?: number
}) => {
  const { slug, root, talk, judge, waiting } = options
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
      '--waiting',
      waiting,
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
