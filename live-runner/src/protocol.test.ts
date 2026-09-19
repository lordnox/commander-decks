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
    expect(parseInbox('{"type":"pass"}')).toEqual({ type: 'pass' })
    expect(parseInbox('{"type":"pass","actionId":7}')).toEqual({
      type: 'pass',
      actionId: 7,
    })
    expect(parseInbox('{"type":"swap","with":"p3"}')).toEqual({
      type: 'swap',
      with: 'p3',
    })
    expect(parseInbox('{"type":"pregame","cards":["Leyline of Sanctity"]')).toBeNull()
    expect(parseInbox('{"type":"pregame","cards":["Leyline of Sanctity"]}')).toEqual({
      type: 'pregame',
      cards: ['Leyline of Sanctity'],
    })
    expect(parseInbox('{"type":"mulligan","actionId":2}')).toEqual({
      type: 'mulligan',
      actionId: 2,
    })
    expect(parseInbox('{"type":"keep","cards":["Swamp"],"cheat":true,"actionId":3}')).toEqual({
      type: 'keep',
      cards: ['Swamp'],
      cheat: true,
      actionId: 3,
    })
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Teferi","destination":"graveyard"}],"actionId":4}')).toEqual({
      type: 'topdeck',
      choices: [{ card: 'Teferi', destination: 'graveyard' }],
      actionId: 4,
    })
    expect(parseInbox('{"type":"advance","actionId":5}')).toEqual({
      type: 'advance',
      actionId: 5,
    })
    expect(parseInbox('{"type":"act","kind":"playLand","objectId":"o3","actionId":6}')).toEqual({
      type: 'act',
      kind: 'playLand',
      objectId: 'o3',
      actionId: 6,
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"spell","targetObjectId":"target"}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'spell',
      targetObjectId: 'target',
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"flicker","targetObjectIds":["rock","land"]}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'flicker',
      targetObjectIds: ['rock', 'land'],
    })
    expect(parseInbox('{"type":"act","kind":"activateAbility","objectId":"teferi","abilityId":"teferi.plus-one","targetObjectIds":["rock","bear","land"]}')).toEqual({
      type: 'act',
      kind: 'activateAbility',
      objectId: 'teferi',
      abilityId: 'teferi.plus-one',
      targetObjectIds: ['rock', 'bear', 'land'],
    })
    expect(parseInbox('{"type":"act","kind":"declareAttackers","attackers":[{"objectId":"bear","defenderId":"p2"},{"objectId":"dragon","defenderId":"walker"}]}')).toEqual({
      type: 'act',
      kind: 'declareAttackers',
      attackers: [
        { objectId: 'bear', defenderId: 'p2' },
        { objectId: 'dragon', defenderId: 'walker' },
      ],
    })
    expect(parseInbox('{"type":"act","kind":"declareAttackers","attackers":[{"objectId":"bear"}]}')).toBeNull()
    expect(parseInbox('{"type":"priority-mode","always":true}')).toEqual({
      type: 'priority-mode',
      always: true,
    })
    expect(parseInbox('{"type":"priority-mode","always":"yes"}')).toBeNull()
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Forest","destination":"battlefield"}]}')).toEqual({
      type: 'topdeck',
      choices: [{ card: 'Forest', destination: 'battlefield' }],
    })
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"p2","destination":"target"},{"card":"p3","destination":"skip"}]}')).toEqual({
      type: 'topdeck',
      choices: [
        { card: 'p2', destination: 'target' },
        { card: 'p3', destination: 'skip' },
      ],
    })
    // A resolving Scapeshift sends its lands here, so dropping them would
    // silently strand the dialog.
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Forest","destination":"sacrifice"}]}')).toEqual({
      type: 'topdeck',
      choices: [{ card: 'Forest', destination: 'sacrifice' }],
    })
  })
})

test('a hold message carries only a known target', () => {
  expect(parseInbox('{"type":"hold","until":"my-turn"}')).toEqual({
    type: 'hold',
    until: 'my-turn',
  })
  expect(parseInbox('{"type":"hold","until":"off"}')).toEqual({
    type: 'hold',
    until: 'off',
  })
  expect(parseInbox('{"type":"hold","until":"forever"}')).toBeNull()
})
