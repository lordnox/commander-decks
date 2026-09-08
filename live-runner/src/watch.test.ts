import { describe, expect, test } from 'bun:test'
import { decodePrefix } from './watch'

const encodePrefix = (
  kind: 'snapshot' | 'delta',
  generation: bigint,
  body: Uint8Array,
) => {
  const bytes = new Uint8Array(13 + body.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, body.byteLength)
  bytes[4] = kind === 'snapshot' ? 0 : 1
  view.setBigUint64(5, generation)
  bytes.set(body, 13)
  return bytes
}

describe('watch prefix', () => {
  test('matches the Pages 13-byte layout', () => {
    const body = new TextEncoder().encode('v2.example')
    const decoded = decodePrefix(encodePrefix('snapshot', 42n, body))
    expect(decoded?.kind).toBe('snapshot')
    expect(decoded?.generation).toBe(42)
    expect(new TextDecoder().decode(decoded?.body)).toBe('v2.example')
  })
})
