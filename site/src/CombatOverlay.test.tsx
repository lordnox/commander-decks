import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CombatOverlay } from './CombatOverlay'
import type { LiveSeat } from './liveCodec'
import type { ReplayCombat, ReplayGame } from './replayTypes'

const seat = (id: string, name: string, life: number): LiveSeat => ({
  id,
  name,
  deck: `decks/${id}`,
  commanders: [],
  color: '#c45c26',
  life,
  poison: 0,
  commander_tax: 0,
  library_count: 89,
  hand_count: 5,
  commander_damage: {},
  battlefield: [],
  graveyard: [],
  exile: [],
  command: [],
})

const seats = [
  seat('p1', 'Foggy Blood Transfusion', 40),
  seat('p3', 'Thousand Cuts', 40),
  seat('p4', 'Sin-fall', 39),
]

const game = {
  schema: 1,
  seed: 0,
  starting_life: 40,
  headline: 'live',
  result: { winner: null, ended: 'truncated', turn: 3, summary: '' },
  seats: seats.map((entry) => ({
    id: entry.id,
    name: entry.name,
    deck: entry.deck,
    commanders: [],
    plan: '',
    mulligans: 0,
    color: entry.color,
  })),
  catalog: {},
  events: [],
} as unknown as ReplayGame

const render = (combat: ReplayCombat, you = 'p1') =>
  renderToStaticMarkup(
    <CombatOverlay game={game} combat={combat} seats={seats} you={you} />,
  ).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('combat overlay', () => {
  test('names the attacker, the defender and the empty block', () => {
    const text = render({
      step: 'attackers',
      attackers: [{
        card: 'Foulmire Knight // Profane Insight',
        defender: 'p4',
        pt: '1/1',
        tapped: true,
        keywords: ['deathtouch'],
      }],
      possible_blockers: { p4: [] },
    })

    expect(text).toContain('Declare attackers')
    expect(text).toContain('Foulmire Knight // Profane Insight')
    expect(text).toContain('Sin-fall')
    expect(text).toContain('39 life')
    expect(text).toContain('1/1 · deathtouch')
    expect(text).toContain('Can block with: nothing')
    expect(text).toContain('Hide')
    expect(text).not.toContain('headed at you')
  })

  test('calls out damage aimed at the viewer', () => {
    const text = render({
      step: 'blockers',
      attackers: [
        { card: 'Rankle, Master of Pranks', defender: 'p1', pt: '3/3' },
        { card: 'Satyr Wayfinder', defender: 'p1', pt: '1/1' },
      ],
      possible_blockers: { p1: ['Kami of False Hope'] },
    })

    expect(text).toContain('4 damage headed at you from 2 attackers')
    expect(text).toContain('Can block with: Kami of False Hope')
  })

  test('shows who blocked and who got through', () => {
    const text = render({
      step: 'combat_damage',
      attackers: [
        { card: 'Rankle, Master of Pranks', defender: 'p1', pt: '3/3' },
        { card: 'Satyr Wayfinder', defender: 'p1', pt: '1/1' },
      ],
      blocks: [{ attacker: 'Rankle, Master of Pranks', blockers: ['Kami of False Hope'] }],
      unblocked: ['Satyr Wayfinder'],
    })

    expect(text).toContain('blocked by Kami of False Hope')
    expect(text).toContain('unblocked')
  })

  test('an empty combat renders nothing', () => {
    expect(render({ step: 'attackers', attackers: [] }).trim()).toBe('')
  })
})
