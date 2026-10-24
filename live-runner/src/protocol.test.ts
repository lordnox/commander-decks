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
    expect(parseInbox('{"type":"act","kind":"playLand","objectId":"o3","face":"back"}')).toEqual({
      type: 'act',
      kind: 'playLand',
      objectId: 'o3',
      face: 'back',
    })
    expect(parseInbox('{"type":"act","kind":"playLand","objectId":"o3","face":"left"}')).toEqual({
      type: 'act',
      kind: 'playLand',
      objectId: 'o3',
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"spell","targetObjectId":"target","castOption":"evoke","phyrexianLife":[0,1]}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'spell',
      targetObjectId: 'target',
      castOption: 'evoke',
      phyrexianLife: [0, 1],
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"flicker","targetObjectIds":["rock","land"]}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'flicker',
      targetObjectIds: ['rock', 'land'],
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"arc","targetClauses":[["guard"],["raider"]]}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'arc',
      targetClauses: [['guard'], ['raider']],
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"rebound","alternativeCost":"withoutPayingMana"}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'rebound',
      alternativeCost: 'withoutPayingMana',
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"planned","manaActivations":[{"objectId":"source","abilityId":"$.abilities[0]","choices":["c"],"x":0}]}')).toEqual({
      type: 'act', kind: 'castSpell', objectId: 'planned',
      manaActivations: [{ objectId: 'source', abilityId: '$.abilities[0]', choices: ['c'], x: 0 }],
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"planned","manaActivations":[{"objectId":"source","abilityId":"$.abilities[0]","x":-1}]}')).toBeNull()
    expect(parseInbox('{"type":"act","kind":"cancelAnnouncement","transactionId":"announcement-1"}')).toEqual({
      type: 'act', kind: 'cancelAnnouncement', announcementId: 'announcement-1', transactionId: 'announcement-1',
    })
    expect(parseInbox('{"type":"act","kind":"declineFreeCast","objectId":"rebound"}')).toEqual({
      type: 'act',
      kind: 'declineFreeCast',
      objectId: 'rebound',
    })
    expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"room","door":"left"}')).toEqual({
      type: 'act',
      kind: 'castSpell',
      objectId: 'room',
      door: 'left',
    })
    expect(parseInbox('{"type":"act","kind":"unlockDoor","objectId":"room","door":"right"}')).toEqual({
      type: 'act',
      kind: 'unlockDoor',
      objectId: 'room',
      door: 'right',
    })
    expect(parseInbox('{"type":"act","kind":"unlockDoor","objectId":"room","door":"middle"}')).toEqual({
      type: 'act',
      kind: 'unlockDoor',
      objectId: 'room',
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
    expect(parseInbox('{"type":"act","kind":"declareBlockers","blockers":[{"blockerId":"soldier","attackerId":"dragon"}]}')).toEqual({
      type: 'act',
      kind: 'declareBlockers',
      blockers: [{ blockerId: 'soldier', attackerId: 'dragon' }],
    })
    expect(parseInbox('{"type":"act","kind":"declareBlockers","blockers":[{"blockerId":"soldier"}]}')).toBeNull()
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
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Forest","slot":1,"destination":"target"}]}')).toEqual({
      type: 'topdeck',
      choices: [{ card: 'Forest', slot: 1, destination: 'target' }],
    })
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Forest","slot":-1,"destination":"target"}]}')).toBeNull()
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Forest","slot":"0","destination":"target"}]}')).toBeNull()
    // A resolving Scapeshift sends its lands here, so dropping them would
    // silently strand the dialog.
    expect(parseInbox('{"type":"topdeck","choices":[{"card":"Forest","destination":"sacrifice"}]}')).toEqual({
      type: 'topdeck',
      choices: [{ card: 'Forest', destination: 'sacrifice' }],
    })
    expect(parseInbox('{"type":"topdeck","requestId":"req-7","revision":3,"choices":[{"card":"Forest","slot":0,"destination":"target"}]}')).toEqual({
      type: 'topdeck',
      requestId: 'req-7',
      revision: 3,
      choices: [{ card: 'Forest', slot: 0, destination: 'target' }],
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

test('parseInbox carries typed modal occurrences and allocations', () => {
  expect(parseInbox(JSON.stringify({
    type: 'act', kind: 'castSpell', objectId: 'spell', modeIndices: [1, 0],
    distributionBindings: [{ scopeId: '$.abilities[0].modes[1]#0', clauseIndex: 0, amounts: [2, 1] }],
  }))).toMatchObject({ type: 'act', modeIndices: [1, 0], distributionBindings: [{ clauseIndex: 0, amounts: [2, 1] }] })
  expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"spell","modeIndices":[-1]}')).toBeNull()
  expect(parseInbox('{"type":"act","kind":"castSpell","objectId":"spell","distributionBindings":[{"scopeId":"x","clauseIndex":0,"amounts":[-1]}]}')).toBeNull()
})


test('live action decoding preserves independent evidence payments and their optional-cost selection', () => {
  const message = { type: 'act' as const, kind: 'castSpell' as const, objectId: 'spell', selectedOptionalCosts: [0, 0], evidence: [['a', 'b'], ['c']] }
  expect(parseInbox(JSON.stringify(message))).toEqual(message)
  expect(parseInbox(JSON.stringify({ ...message, evidence: [['a', 3]] }))).toBeNull()
  expect(parseInbox(JSON.stringify({ ...message, selectedOptionalCosts: [-1] }))).toBeNull()
})
