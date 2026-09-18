export {
  decodePrefix,
  type ConduitKind,
  type ConduitFrame,
} from '../../shared/liveConduit'
import {
  watchSnapshots as watchSnapshotsCore,
  type ConduitKind,
} from '../../shared/liveConduit'

export const DEFAULT_CONDUIT_ORIGIN = 'https://conduit.app.kopelke.online'

export const conduitOrigin = (
  location: Pick<Location, 'search'> = window.location,
) => {
  const queryOrigin = new URLSearchParams(location.search).get('c')
  return (
    queryOrigin ||
    import.meta.env.VITE_LIVE_CONDUIT_URL ||
    DEFAULT_CONDUIT_ORIGIN
  ).replace(/\/+$/, '')
}

const binUrl = (origin: string, key: string) =>
  `${origin.replace(/\/+$/, '')}/v1/bins/${encodeURIComponent(key)}`

export const getLatestSnapshot = async (origin: string, readKey: string) => {
  const response = await fetch(binUrl(origin, readKey))
  if (response.status === 204) return null
  if (!response.ok) {
    throw new Error(`Could not load the live snapshot (${response.status})`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export const appendSnapshot = async (
  origin: string,
  writeKey: string,
  body: Uint8Array | string,
  kind: ConduitKind = 'snapshot',
) => {
  const requestBody = typeof body === 'string'
    ? body
    : body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer
  const response = await fetch(binUrl(origin, writeKey), {
    method: 'POST',
    headers: { 'X-Live-Conduit-Kind': kind },
    body: requestBody,
  })
  if (!response.ok) {
    throw new Error(`Could not send the live plan (${response.status})`)
  }
}

export const watchSnapshots = (
  origin: string,
  readKey: string,
  onBody: (bytes: Uint8Array) => void,
  onStatus?: (connected: boolean) => void,
) =>
  watchSnapshotsCore(origin, readKey, (frame) => onBody(frame.body), {
    onStatus,
  })
