import { describe, expect, test } from 'bun:test'
import {
  formatInvite,
  parseInbox,
  parseInvite,
  pagesLiveUrl,
  seatInviteLacksHostWrite,
} from './protocol'

const read = 'a'.repeat(43)
const mailbox = 'b'.repeat(43)
const hostWrite = 'c'.repeat(43)

describe('invite', () => {
  test('round-trips a seat pipe and a spectator token', () => {
    expect(parseInvite(formatInvite(read, mailbox))).toEqual({
      read,
      mailbox,
    })
    expect(parseInvite(read)).toEqual({ read })
    expect(seatInviteLacksHostWrite(parseInvite(`${read}|${mailbox}`), hostWrite)).toBe(true)
    expect(seatInviteLacksHostWrite({ read: hostWrite }, hostWrite)).toBe(false)
  })

  test('pages URL uses k= and omits default origin', () => {
    const url = new URL(
      pagesLiveUrl(
        'https://lordnox.github.io/commander-decks/live/',
        { read, mailbox },
      ),
    )
    expect(url.searchParams.get('k')).toBe(`${read}|${mailbox}`)
    expect(url.searchParams.has('c')).toBe(false)
    expect(url.searchParams.has('you')).toBe(false)
  })
})

describe('inbox', () => {
  test('parses lobby and play types', () => {
    expect(parseInbox('{"type":"join","name":"Fog","deck":"decks/x"}')).toEqual({
      type: 'join',
      name: 'Fog',
      deck: 'decks/x',
    })
    expect(parseInbox('{"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parseInbox('{"type":"swap","with":"p3"}')).toEqual({
      type: 'swap',
      with: 'p3',
    })
    expect(parseInbox('{"type":"pregame","cards":["Leyline of Sanctity"]')).toBeNull()
    expect(parseInbox('{"type":"pregame","cards":["Leyline of Sanctity"]}')).toEqual({
      type: 'pregame',
      cards: ['Leyline of Sanctity'],
    })
  })
})
