import { describe, expect, test } from 'bun:test'
import { battlefieldRow, cardInfo } from './cards'
import type { ReplayGame } from './replayTypes'

const gunshipText = [
  'When this Spacecraft enters, it deals damage equal to the number of artifacts you control to target creature an opponent controls.',
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 6+.)",
  '6+ | Flying',
].join('\n')

const game = (): ReplayGame =>
  ({
    catalog: {
      'Mind Stone': {
        type_line: 'Artifact',
        oracle_text: '{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.',
      },
      'Warmaker Gunship': {
        type_line: 'Artifact — Spacecraft',
        oracle_text: gunshipText,
      },
      'Knight Paladin': {
        type_line: 'Artifact — Vehicle',
        oracle_text: 'Trample\nCrew 1',
      },
    },
    tokens: {
      'Mind Stone': { name: 'Mind Stone' },
      'Warmaker Gunship': { name: 'Warmaker Gunship' },
    },
  }) as unknown as ReplayGame

describe('token details', () => {
  test('a name-only token stub inherits the printed card it copies', () => {
    const { details } = cardInfo(game(), 'Mind Stone', {
      name: 'Mind Stone',
      token: true,
      token_id: 'Mind Stone',
    })
    expect(details.type_line).toBe('Artifact')
    expect(details.oracle_text).toContain('Add {C}')
  })
})

describe('battlefield rows', () => {
  test('a mana rock token sits with the lands', () => {
    const entry = { name: 'Mind Stone', token: true, token_id: 'Mind Stone' }
    const { details } = cardInfo(game(), 'Mind Stone', entry)
    expect(battlefieldRow(details, entry)).toBe('mana')
  })

  test('a Spacecraft below its station threshold stays an artifact', () => {
    const entry = {
      name: 'Warmaker Gunship',
      token: true,
      token_id: 'Warmaker Gunship',
      counters: { charge: 4 },
    }
    const { details } = cardInfo(game(), 'Warmaker Gunship', entry)
    expect(battlefieldRow(details, entry)).toBe('permanents')
  })

  test('a stationed Spacecraft joins the creatures', () => {
    const entry = {
      name: 'Warmaker Gunship',
      token: true,
      token_id: 'Warmaker Gunship',
      counters: { charge: 6 },
    }
    const { details } = cardInfo(game(), 'Warmaker Gunship', entry)
    expect(battlefieldRow(details, entry)).toBe('creatures')
  })

  test('an uncrewed Vehicle stays an artifact but a crewed one does not', () => {
    const { details } = cardInfo(game(), 'Knight Paladin')
    expect(battlefieldRow(details, { name: 'Knight Paladin' })).toBe('permanents')
    expect(
      battlefieldRow(details, { name: 'Knight Paladin', note: 'crewed; trample' }),
    ).toBe('creatures')
  })
})
