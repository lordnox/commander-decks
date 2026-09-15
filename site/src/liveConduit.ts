export const DEFAULT_CONDUIT_ORIGIN = 'https://conduit.app.kopelke.online'

export type ConduitKind = 'snapshot' | 'delta'

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

export const decodePrefix = (bytes: Uint8Array) => {
  if (bytes.byteLength < 13) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bodyLength = view.getUint32(0)
  const kindByte = bytes[4]
  const kind: ConduitKind | null =
    kindByte === 0 ? 'snapshot' : kindByte === 1 ? 'delta' : null
  const generation = Number(view.getBigUint64(5))
  if (!kind || bytes.byteLength !== 13 + bodyLength) return null
  return { kind, generation, body: bytes.subarray(13) }
}

const asBytes = async (data: unknown) => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return null
}

export const watchSnapshots = (
  origin: string,
  readKey: string,
  onBody: (bytes: Uint8Array) => void,
  onStatus?: (connected: boolean) => void,
) => {
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let backoff = 500

  const connect = () => {
    if (closed) return
    const watchUrl = new URL('v1/watch', `${origin.replace(/\/+$/, '')}/`)
    watchUrl.protocol = watchUrl.protocol === 'http:' ? 'ws:' : 'wss:'
    socket = new WebSocket(watchUrl)
    socket.binaryType = 'arraybuffer'

    socket.addEventListener('open', () => {
      backoff = 500
      onStatus?.(true)
      socket?.send(JSON.stringify({ read: readKey, snapshotsOnly: true }))
    })
    socket.addEventListener('message', (event) => {
      void asBytes(event.data).then((bytes) => {
        if (!bytes || closed) return
        const frame = decodePrefix(bytes)
        if (frame?.kind === 'snapshot') onBody(frame.body)
      })
    })
    socket.addEventListener('error', () => socket?.close())
    socket.addEventListener('close', () => {
      onStatus?.(false)
      if (closed || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, backoff)
      backoff = Math.min(backoff * 2, 5000)
    })
  }

  connect()
  return {
    close: () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      socket?.close()
    },
  }
}
