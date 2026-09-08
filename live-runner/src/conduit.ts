import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BIN_LABELS } from './protocol'

export const DEFAULT_ORIGIN = 'https://conduit.app.kopelke.online'
const ENV_PATH = join(homedir(), '.config/commander-decks/live-conduit.env')

export type MintedBins = Record<string, { read: string; write: string }>

export const loadEnvFile = (path = ENV_PATH) => {
  const loaded: Record<string, string> = {}
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return loaded
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const eq = line.indexOf('=')
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) loaded[key] = value
  }
  return loaded
}

export const envValue = (name: string) =>
  process.env[name] || loadEnvFile()[name]

export const originFromEnv = () =>
  (envValue('LIVE_CONDUIT_URL') || DEFAULT_ORIGIN).replace(/\/+$/, '')

export const apiKeyFromEnv = () => envValue('LIVE_CONDUIT_API_KEY')

const binUrl = (origin: string, key: string) =>
  `${origin.replace(/\/+$/, '')}/v1/bins/${encodeURIComponent(key)}`

export const mint = async (
  origin: string,
  apiKey: string | undefined,
  labels: readonly string[] = BIN_LABELS,
) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    headers['X-API-Key'] = apiKey
  }
  const response = await fetch(`${origin.replace(/\/+$/, '')}/v1/mint`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ bins: [...labels] }),
  })
  if (!response.ok) {
    throw new Error(`mint failed (${response.status})`)
  }
  return (await response.json()) as { ttlSeconds?: number; bins: MintedBins }
}

export const appendSnapshot = async (
  origin: string,
  writeKey: string,
  body: string | Uint8Array,
  kind: 'snapshot' | 'delta' = 'snapshot',
) => {
  const payload = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const response = await fetch(binUrl(origin, writeKey), {
    method: 'POST',
    headers: { 'X-Live-Conduit-Kind': kind },
    body: payload,
  })
  if (!response.ok) {
    throw new Error(`append failed (${response.status})`)
  }
  return {
    generation: Number(response.headers.get('X-Live-Conduit-Generation') || '0'),
  }
}

export const getLatest = async (origin: string, readKey: string) => {
  const response = await fetch(binUrl(origin, readKey))
  if (response.status === 204 || response.status === 404) {
    return { status: response.status, body: null, generation: 0 }
  }
  if (!response.ok) {
    throw new Error(`get failed (${response.status})`)
  }
  return {
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
    generation: Number(response.headers.get('X-Live-Conduit-Generation') || '0'),
  }
}

export const destroyBin = async (origin: string, writeKey: string) => {
  const response = await fetch(binUrl(origin, writeKey), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    throw new Error(`destroy failed (${response.status})`)
  }
}
