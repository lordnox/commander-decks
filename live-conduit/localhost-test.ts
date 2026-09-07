#!/usr/bin/env bun
/**
 * Smoke live-conduit on localhost against IMPLEMENTATION.md.
 *
 *   bun live-conduit/localhost-test.ts
 *   LIVE_CONDUIT_URL=http://127.0.0.1:8787 bun live-conduit/localhost-test.ts
 */

const base = (process.env.LIVE_CONDUIT_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
)

const wsBase = base.replace(/^http/, "ws")

type Kind = "snapshot" | "delta"
type KeyPair = { read: string; write: string }

const fail = (message: string): never => {
  console.error(`FAIL  ${message}`)
  process.exit(1)
}

const pass = (name: string) => {
  console.log(`ok    ${name}`)
}

const header = (res: Response, name: string) => {
  const direct = res.headers.get(name)
  if (direct != null) return direct
  const lower = name.toLowerCase()
  for (const [key, value] of res.headers.entries()) {
    if (key.toLowerCase() === lower) return value
  }
  return null
}

const generation = (res: Response) =>
  Number(header(res, "X-Live-Conduit-Generation") ?? "NaN")

const headGeneration = (res: Response) =>
  Number(header(res, "X-Live-Conduit-Head-Generation") ?? "NaN")

const json = async (res: Response) => {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    fail(`expected JSON, got HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
}

const bytesOf = (value: string | Uint8Array) =>
  typeof value === "string" ? new TextEncoder().encode(value) : value

const equalBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) return false
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

const decodePrefix = (bytes: Uint8Array) => {
  if (bytes.byteLength < 13) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bodyLength = view.getUint32(0)
  const kindByte = bytes[4]
  const kind: Kind | null =
    kindByte === 0 ? "snapshot" : kindByte === 1 ? "delta" : null
  const gen = Number(view.getBigUint64(5))
  if (kind == null || bytes.byteLength !== 13 + bodyLength) return null
  return { kind, generation: gen, body: bytes.subarray(13) }
}

const splitPrefixed = (bytes: Uint8Array) => {
  const frames: NonNullable<ReturnType<typeof decodePrefix>>[] = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (offset + 13 > bytes.byteLength) fail("truncated range prefix")
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 13)
    const bodyLength = view.getUint32(0)
    const end = offset + 13 + bodyLength
    if (end > bytes.byteLength) fail("truncated range body")
    const frame = decodePrefix(bytes.subarray(offset, end))
    if (!frame) fail("invalid prefixed frame in range")
    frames.push(frame)
    offset = end
  }
  return frames
}

const request = (
  path: string,
  init: RequestInit & { key?: string } = {},
) => {
  const headers = new Headers(init.headers)
  if (init.key) headers.set("Authorization", `Bearer ${init.key}`)
  return fetch(`${base}${path}`, { ...init, headers })
}

const append = async (
  write: string,
  body: string | Uint8Array,
  kind: Kind = "snapshot",
) => {
  const res = await request(`/v1/bins/${write}`, {
    method: "POST",
    headers: { "X-Live-Conduit-Kind": kind },
    body: bytesOf(body),
  })
  if (res.status !== 201) {
    fail(`append ${kind} → HTTP ${res.status} ${await res.text()}`)
  }
  return res
}

const getBin = (read: string, query = "") =>
  request(`/v1/bins/${read}${query}`)

const expectStatus = async (
  name: string,
  res: Response,
  status: number,
) => {
  if (res.status !== status) {
    fail(`${name}: expected HTTP ${status}, got ${res.status} ${await res.text()}`)
  }
  pass(name)
  return res
}

const mintNine = async () => {
  const res = await request("/v1/mint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bins: [
        "host",
        "p1",
        "p1-inbox",
        "p2",
        "p2-inbox",
        "p3",
        "p3-inbox",
        "p4",
        "p4-inbox",
      ],
    }),
  })
  if (res.status !== 201) {
    fail(`mint → HTTP ${res.status} ${await res.text()}`)
  }
  const body = await json(res)
  const bins = body.bins as Record<string, KeyPair> | undefined
  if (!bins?.host?.read || !bins.host.write || !bins.p2?.read) {
    fail("mint JSON missing host/p2 keys")
  }
  const keys = Object.values(bins).flatMap((pair) => [pair.read, pair.write])
  if (new Set(keys).size !== 18) fail("mint did not return 18 unique keys")
  pass("POST /v1/mint (9 bins, 18 keys)")
  return bins
}

const waitWs = (url: string, read: string, snapshotsOnly: boolean) =>
  new Promise<{ messages: Uint8Array[]; close: () => void }>((resolve, reject) => {
    const messages: Uint8Array[] = []
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("watch connect timeout"))
    }, 4000)
    ws.binaryType = "arraybuffer"
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ read, snapshotsOnly }))
      clearTimeout(timer)
      resolve({
        messages,
        close: () => ws.close(),
      })
    })
    ws.addEventListener("message", (event) => {
      const data = event.data
      if (typeof data === "string") return
      if (data instanceof ArrayBuffer) {
        messages.push(new Uint8Array(data))
        return
      }
      if (data instanceof Blob) {
        void data.arrayBuffer().then((buf) => messages.push(new Uint8Array(buf)))
      }
    })
    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("watch socket error"))
    })
  })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let health: Response
try {
  health = await request("/health")
} catch (reason) {
  fail(
    `nothing at ${base} — start live-conduit, then rerun from that machine (${reason instanceof Error ? reason.message : reason})`,
  )
}
if (health.status === 0 || health.type === "error") {
  fail(`nothing at ${base} — start live-conduit first`)
}
if (health.status !== 200) {
  fail(`GET /health → HTTP ${health.status}`)
}
const healthBody = await json(health)
if (healthBody.ok !== true) fail("GET /health body is not { ok: true }")
pass("GET /health")

const bins = await mintNine()
const host = bins.host
const p2 = bins.p2
const p1 = bins.p1

const empty = await getBin(host.read)
await expectStatus("GET empty bin → 204", empty, 204)

const snap1 = bytesOf("NOW-1\0nul")
await append(host.write, snap1, "snapshot")
const got1 = await getBin(host.read)
await expectStatus("GET latest snapshot", got1, 200)
const got1Bytes = new Uint8Array(await got1.arrayBuffer())
if (!equalBytes(got1Bytes, snap1)) fail("latest snapshot bytes mismatch (NUL?)")
if (generation(got1) !== 1) fail(`expected generation 1, got ${generation(got1)}`)

await append(host.write, "NOW-2", "snapshot")
await append(host.write, "event-3", "delta")

const latest = await getBin(host.read)
await expectStatus("GET skips trailing delta", latest, 200)
if (new TextDecoder().decode(await latest.clone().arrayBuffer()) !== "NOW-2") {
  fail("default GET should be snapshot 2, not the delta")
}
if (generation(latest) !== 2) fail(`snapshot generation should be 2, got ${generation(latest)}`)
if (headGeneration(latest) !== 3) {
  fail(`head generation should be 3, got ${headGeneration(latest)}`)
}

const exactDelta = await getBin(host.read, "?gen=3")
await expectStatus("GET ?gen=3 delta", exactDelta, 200)
if (new TextDecoder().decode(await exactDelta.arrayBuffer()) !== "event-3") {
  fail("?gen=3 body should be the delta")
}

const at3 = await getBin(host.read, "?snapshot=3")
await expectStatus("GET ?snapshot=3 → snapshot 2", at3, 200)
if (new TextDecoder().decode(await at3.arrayBuffer()) !== "NOW-2") {
  fail("?snapshot=3 should return snapshot gen 2")
}

const range = await getBin(host.read, "?from=1&to=3")
await expectStatus("GET ?from=1&to=3", range, 200)
const rangeBytes = new Uint8Array(await range.arrayBuffer())
const frames = splitPrefixed(rangeBytes)
if (frames.length !== 3) fail(`range expected 3 frames, got ${frames.length}`)
if (frames[0]?.kind !== "snapshot" || frames[2]?.kind !== "delta") {
  fail("range kinds should be snapshot, snapshot, delta")
}
pass("range frames decode")

const indexRes = await request(`/v1/bins/${host.read}/index`)
await expectStatus("GET /index", indexRes, 200)
const index = await json(indexRes)
if (index.head !== 3) fail(`index.head should be 3, got ${index.head}`)
if (index.latestSnapshot !== 2) fail(`index.latestSnapshot should be 2`)
const used = index.usedBytes as number
if (!(used > 0) || used !== snap1.byteLength + bytesOf("NOW-2").byteLength + bytesOf("event-3").byteLength) {
  fail(`index.usedBytes ${used} != sum of frame lengths`)
}

const writeAsRead = await getBin(host.write)
if (writeAsRead.status !== 404) {
  fail(`GET with write key should be 404, got ${writeAsRead.status}`)
}
pass("write key cannot GET")

const readAsWrite = await request(`/v1/bins/${host.read}`, {
  method: "POST",
  body: "nope",
})
if (readAsWrite.status !== 404) {
  fail(`POST with read key should be 404, got ${readAsWrite.status}`)
}
pass("read key cannot append")

await append(p2.write, "p2-secret", "snapshot")
await append(p1.write, "p1-secret", "snapshot")
const p2got = await getBin(p2.read)
if (new TextDecoder().decode(await p2got.arrayBuffer()) !== "p2-secret") {
  fail("p2 read should only see p2 snapshot")
}
const hostLeak = await getBin(host.read)
if (new TextDecoder().decode(await hostLeak.arrayBuffer()) === "p2-secret") {
  fail("host bin leaked p2 bytes")
}
pass("bins are isolated")

const tooBig = await request(`/v1/bins/${host.write}`, {
  method: "POST",
  headers: { "X-Live-Conduit-Kind": "snapshot" },
  body: new Uint8Array(1048576 + 1),
})
if (tooBig.status !== 413) fail(`oversize frame should be 413, got ${tooBig.status}`)
pass("oversize frame → 413")

try {
  const watch = await waitWs(`${wsBase}/v1/watch`, p2.read, true)
  await sleep(200)
  await append(p2.write, "p2-live", "snapshot")
  await append(p2.write, "p2-delta", "delta")
  await sleep(400)
  watch.close()
  const kinds = watch.messages
    .map(decodePrefix)
    .filter(Boolean)
    .map((frame) => frame?.kind)
  if (!kinds.includes("snapshot")) fail("watch did not push a snapshot")
  if (kinds.includes("delta")) fail("snapshotsOnly watch emitted a delta")
  pass("WS /v1/watch snapshotsOnly")
} catch (reason) {
  fail(`watch: ${reason instanceof Error ? reason.message : reason}`)
}

console.log(`\nall checks passed against ${base}`)
