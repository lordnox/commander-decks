export type ConduitKind = 'snapshot' | 'delta'

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
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return null
}

export const watchSnapshots = (
  origin: string,
  readKey: string,
  onFrame: (generation: number, body: Uint8Array) => void,
  options: { from?: number; onStatus?: (connected: boolean) => void } = {},
) => {
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let backoff = 500
  let lastGen = options.from ?? 0

  const connect = () => {
    if (closed) return
    const watchUrl = new URL('/v1/watch', origin)
    watchUrl.protocol = watchUrl.protocol === 'http:' ? 'ws:' : 'wss:'
    socket = new WebSocket(watchUrl)
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', () => {
      backoff = 500
      options.onStatus?.(true)
      const hello: { read: string; snapshotsOnly: true; from?: number } = {
        read: readKey,
        snapshotsOnly: true,
      }
      if (lastGen > 0) hello.from = lastGen
      socket?.send(JSON.stringify(hello))
    })
    socket.addEventListener('message', (event) => {
      void asBytes(event.data).then((bytes) => {
        if (!bytes || closed) return
        const frame = decodePrefix(bytes)
        if (frame?.kind !== 'snapshot') return
        lastGen = frame.generation
        onFrame(frame.generation, frame.body)
      })
    })
    socket.addEventListener('error', () => socket?.close())
    socket.addEventListener('close', () => {
      options.onStatus?.(false)
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
