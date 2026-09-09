import { spawn } from 'node:child_process'
import { appendFileSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runHost } from './host'
import {
  loadSession,
  logPath,
  pidAlive,
  pidPath,
  readPid,
  repoRoot,
  writePid,
} from './session'
import { runSeat } from './seat'

const usage = () => {
  console.log(`Usage:
  bun live-runner/src/cli.ts host --slug <slug> [--agent] [--fg]
  bun live-runner/src/cli.ts seat --slug <slug> --invite <token-or-file> --name <name> --deck <deck> [--fg]
  bun live-runner/src/cli.ts resume --slug <slug> [--agent] [--fg]
  bun live-runner/src/cli.ts stop --slug <slug>`)
}

const arg = (argv: string[], name: string) => {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  return argv[index + 1]
}

const flag = (argv: string[], name: string) => argv.includes(name)

const inviteText = async (value: string) => {
  if (value.includes('|') || value.length >= 40) return value.trim()
  return (await Bun.file(value).text()).trim()
}

const daemonize = (argv: string[], slug: string, root: string) => {
  const childArgv = [...argv.filter((item) => item !== '--fg'), '--fg']
  const log = logPath(slug, root)
  appendFileSync(log, '')
  const fd = openSync(log, 'a')
  const child = spawn(process.execPath, childArgv, {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, LIVE_RUNNER_CHILD: '1' },
    cwd: root,
  })
  child.unref()
  if (child.pid) writePid(slug, child.pid, root)
  console.log(`started pid ${child.pid}`)
  console.log(`log ${log}`)
  console.log(`pid ${pidPath(slug, root)}`)
  process.exit(0)
}

const stopSlug = (slug: string, root: string) => {
  const pid = readPid(slug, root)
  if (pid && pidAlive(pid)) {
    process.kill(pid, 'SIGTERM')
    console.log(`stopped ${pid}`)
    return
  }
  console.log('not running')
}

export const otherRunnerPid = (
  slug: string,
  root: string,
  currentPid = process.pid,
) => {
  const pid = readPid(slug, root)
  return pid && pid !== currentPid && pidAlive(pid) ? pid : null
}

export const main = async (argv = process.argv.slice(2)) => {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    usage()
    return 0
  }
  const root = repoRoot()
  const slug = arg(argv, '--slug')
  const fg = flag(argv, '--fg') || process.env.LIVE_RUNNER_CHILD === '1'
  const agent = flag(argv, '--agent')

  if (command === 'stop') {
    if (!slug) {
      usage()
      return 1
    }
    stopSlug(slug, root)
    return 0
  }

  if (!slug) {
    usage()
    return 1
  }

  if (command === 'resume') {
    const session = loadSession(slug, root)
    if (!session) {
      console.error('no session')
      return 1
    }
    const pid = readPid(slug, root)
    if (pid && pidAlive(pid)) {
      console.log(`already running ${pid}`)
      return 0
    }
    if (session.role === 'host') {
      const hostArgv = [
        fileURLToPath(import.meta.url),
        'host',
        '--slug',
        slug,
        ...(agent ? ['--agent'] : []),
      ]
      if (!fg) daemonize(hostArgv, slug, root)
      writePid(slug, process.pid, root)
      await runHost({
        slug,
        root,
        logFile: logPath(slug, root),
        agent: agent || session.agent,
      })
      await new Promise(() => {})
      return 0
    }
    if (!session.mailbox) {
      console.error('seat session missing mailbox')
      return 1
    }
    if (!fg) {
      daemonize(
        [
          fileURLToPath(import.meta.url),
          'seat',
          '--slug',
          slug,
          '--invite',
          `${session.read}|${session.mailbox}`,
          '--name',
          'resume',
          '--deck',
          'resume',
        ],
        slug,
        root,
      )
    }
    writePid(slug, process.pid, root)
    await runSeat({
      slug,
      invite: `${session.read}|${session.mailbox}`,
      name: 'resume',
      deck: 'resume',
      root,
      logFile: logPath(slug, root),
      skipJoin: true,
    })
    await new Promise(() => {})
    return 0
  }

  if (command === 'host') {
    const running = otherRunnerPid(slug, root)
    if (running) {
      console.error(`host already running ${running}`)
      return 1
    }
    const hostArgv = [
      fileURLToPath(import.meta.url),
      'host',
      '--slug',
      slug,
      ...(agent ? ['--agent'] : []),
    ]
    if (!fg) daemonize(hostArgv, slug, root)
    writePid(slug, process.pid, root)
    await runHost({
      slug,
      root,
      logFile: logPath(slug, root),
      agent,
    })
    await new Promise(() => {})
    return 0
  }

  if (command === 'seat') {
    const inviteArg = arg(argv, '--invite')
    const name = arg(argv, '--name')
    const deck = arg(argv, '--deck')
    if (!inviteArg || !name || !deck) {
      usage()
      return 1
    }
    if (!fg) {
      daemonize(
        [
          fileURLToPath(import.meta.url),
          'seat',
          '--slug',
          slug,
          '--invite',
          inviteArg,
          '--name',
          name,
          '--deck',
          deck,
        ],
        slug,
        root,
      )
    }
    writePid(slug, process.pid, root)
    await runSeat({
      slug,
      invite: await inviteText(inviteArg),
      name,
      deck,
      root,
      logFile: logPath(slug, root),
    })
    await new Promise(() => {})
    return 0
  }

  usage()
  return 1
}

if (import.meta.main) {
  void main().then((code) => {
    if (code) process.exit(code)
  })
}
