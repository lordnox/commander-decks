import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LiveTopdeck } from './liveCodec'
import type { ReplayGame } from './replayTypes'
import { TopdeckDialog, allocationAnswerFor, answerFor, validAllocation } from './TopdeckDialog'

const allocationOffer = {
  entries: [
    { id: 'target:0', label: 'Target 1', max: 700 },
    { id: 'target:1', label: 'Target 2', max: 700 },
  ],
  total: 1000,
  minEach: 1,
}

test('topdeck dialog offers card previews and a board-view escape', () => {
  const game = {
    catalog: {
      Island: {
        image_small: 'island-small.jpg',
        image_normal: 'island-normal.jpg',
      },
    },
  } as unknown as ReplayGame
  const decision = {
    seat: 'p4',
    kind: 'scry',
    cards: ['Island'],
    destinations: ['top', 'bottom'],
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('aria-label="Preview Island"')
  expect(html).toContain('Hover over or tap card art')
  expect(html).toContain('>Hide</button>')
})

test('a reveal-land choice says reveal instead of target', () => {
  const game = {
    catalog: { Island: {} },
  } as unknown as ReplayGame
  const decision = {
    seat: 'p1',
    kind: 'reveal',
    cards: ['Island'],
    destinations: ['hand', 'reveal'],
    requirements: { reveal: { min: 0, max: 1 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Reveal 1')
  expect(html).toContain('>Reveal</button>')
})

test('cumulative upkeep renders one opponent choice per age counter and sacrifice', () => {
  const game = {
    catalog: {},
    seats: [
      { id: 'p2', name: 'Second player' },
      { id: 'p3', name: 'Third player' },
    ],
  } as unknown as ReplayGame
  const decision = {
    kind: 'cumulative-upkeep',
    cards: ['p2', 'p3'],
    count: 2,
    destinations: ['target', 'sacrifice'],
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Pay cumulative upkeep')
  expect(html).toContain('Age counter 1')
  expect(html).toContain('Age counter 2')
  expect(html).toContain('Second player')
  expect(html).toContain('Sacrifice permanent')
})

test('library searches offer filtering and one explicit selection', () => {
  const game = {
    catalog: {
      Forest: {},
      'Oracle of Mul Daya': {},
    },
  } as unknown as ReplayGame
  const decision = {
    seat: 'p4',
    kind: 'search',
    cards: ['Forest', 'Oracle of Mul Daya'],
    destinations: ['library', 'hand'],
    requirements: { hand: { min: 1, max: 1 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Search your library')
  expect(html).toContain('placeholder="Filter matching cards"')
  expect(html).toContain('Choose this card')
  expect(html).toContain('disabled=""')
})

test('a bounded library search shows its live selection count', () => {
  const game = {
    catalog: { Forest: {}, Island: {} },
  } as unknown as ReplayGame
  const decision = {
    seat: 'p4',
    kind: 'search',
    cards: ['Forest', 'Island'],
    destinations: ['library', 'battlefield'],
    requirements: { battlefield: { min: 0, max: 4 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Selected 0 of 4')
  expect(html).toContain('aria-live="polite"')
})

test('a fetch search names the battlefield as the destination', () => {
  const game = { catalog: { Taiga: {}, Forest: {} } } as unknown as ReplayGame
  const decision = {
    seat: 'p1',
    kind: 'search',
    cards: ['Taiga', 'Forest'],
    destinations: ['library', 'battlefield'],
    requirements: { battlefield: { min: 1, max: 1 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Search your library')
  expect(html).toContain('battlefield')
  expect(html).toContain('Taiga')
})

test('Homer offers every player as an optional target', () => {
  const game = { catalog: {} } as unknown as ReplayGame
  const decision = {
    kind: 'target-players',
    cards: ['p1', 'p2', 'p3', 'p4'],
    destinations: ['skip', 'target'],
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Choose target players')
  expect(html).toContain('Target this player')
  expect(html).toContain('Do not target')
  expect(html).toContain('Confirm targets')
})

test('typed player targeting uses a generic prompt and exact requirement', () => {
  const game = {
    catalog: {},
    seats: [
      { id: 'p2', name: 'Opponent Two' },
      { id: 'p3', name: 'Opponent Three' },
    ],
  } as unknown as ReplayGame
  const decision = {
    seat: 'p1',
    kind: 'target-players',
    cards: ['p2', 'p3'],
    destinations: ['skip', 'target'],
    requirements: { target: { min: 1, max: 1 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Choose the required player targets')
  expect(html).toContain('Required: 1 in target')
  expect(html).toContain('Opponent Two')
  expect(html).not.toContain('Homer')
})

test('a vote offers named options, permanents, and players by their seat names', () => {
  const game = {
    catalog: { 'Grizzly Bears': { image_small: 'bears.jpg' } },
    seats: [{ id: 'p2', name: 'Opponent Two' }],
  } as unknown as ReplayGame
  const decision = {
    seat: 'p1',
    kind: 'vote',
    cards: ['carnage', 'Grizzly Bears', 'p2'],
    destinations: ['skip', 'target'],
    requirements: { target: { min: 1, max: 1 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Cast your vote')
  expect(html).toContain('carnage')
  expect(html).toContain('aria-label="Preview Grizzly Bears"')
  expect(html).toContain('Opponent Two')
})

test('a resolving Scapeshift asks for land sacrifices before opening a search', () => {
  const game = { catalog: { Forest: {}, Island: {} } } as unknown as ReplayGame
  const decision = {
    seat: 'p4',
    kind: 'sacrifice-lands',
    cards: ['Forest', 'Island'],
    destinations: ['battlefield', 'sacrifice'],
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Resolving spell')
  expect(html).toContain('Choose lands to sacrifice')
  expect(html).toContain('Sacrifice this land')
  expect(html).toContain('Keep this land')
  expect(html).toContain('Sacrifice and search')
  expect(html).not.toContain('Search your library')
})

test('an opponent-forced sacrifice offers every eligible permanent, not only creatures', () => {
  const game = { catalog: { Rock: {}, Swamp: {} } } as unknown as ReplayGame
  const decision = {
    seat: 'p2',
    kind: 'sacrifice',
    cards: ['Rock', 'Swamp'],
    destinations: ['battlefield', 'sacrifice'],
    requirements: { sacrifice: { min: 2, max: 2 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Required sacrifice')
  expect(html).toContain('Choose what to sacrifice')
  expect(html).not.toContain('creature to sacrifice')
  expect(html).toContain('Required: 2 in sacrifice')
  expect(html).toContain('>Rock</p>')
  expect(html).toContain('>Swamp</p>')
  expect(html).toContain('Sacrifice this permanent')
  expect(html).toContain('Keep this permanent')
})

test('only the card list scrolls, so hide and resolve stay reachable', () => {
  const game = { catalog: {} } as unknown as ReplayGame
  const decision = {
    seat: 'p4',
    kind: 'search',
    cards: Array.from({ length: 40 }, (_, index) => `Card ${index}`),
    destinations: ['library', 'hand'],
    requirements: { hand: { min: 1, max: 1 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  const dialog = html.slice(html.indexOf('role="dialog"'))
  expect(dialog.slice(0, dialog.indexOf('>'))).toContain('overflow-hidden')
  expect(html).toContain('<ol class="-mx-1 mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">')
  expect(html).toContain('shrink-0 self-start rounded-xl bg-purple-200')
})

test('a pile partition offers face-up and face-down destinations', () => {
  const game = {
    catalog: { Island: {}, Forest: {} },
  } as unknown as ReplayGame
  const decision = {
    seat: 'p2',
    kind: 'partition',
    cards: ['Island', 'Forest'],
    destinations: ['face-up', 'face-down'],
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Separate into piles')
  expect(html).toContain('Put in face-up')
  expect(html).toContain('Put in face-down')
  expect(html).toContain('Resolve partition')
})

test('same-named cards are numbered so each can be picked on its own', () => {
  const game = {
    catalog: { Forest: {}, Treasure: {} },
  } as unknown as ReplayGame
  const decision = {
    seat: 'p1',
    kind: 'choose',
    cards: ['Forest', 'Treasure', 'Forest'],
    destinations: ['skip', 'target'],
    requirements: { target: { min: 0, max: 3 } },
  } as LiveTopdeck
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={game}
      decision={decision}
      pending={false}
      onResolve={() => {}}
    />,
  )

  expect(html).toContain('Forest #1')
  expect(html).toContain('Forest #2')
  expect(html).not.toContain('Treasure #')
  expect(html).not.toContain('>Forest<')
})

test('each answer names the offered position of its card, not just its name', () => {
  // The second Forest is the one targeted, so the host must not read it as the first.
  expect(answerFor([
    { id: 0, card: 'Forest', destination: 'skip' },
    { id: 1, card: 'Treasure', destination: 'skip' },
    { id: 2, card: 'Forest', destination: 'target' },
  ])).toEqual([
    { card: 'Forest', slot: 0, destination: 'skip' },
    { card: 'Treasure', slot: 1, destination: 'skip' },
    { card: 'Forest', slot: 2, destination: 'target' },
  ])
  // A reordered scry keeps each card's original position.
  expect(answerFor([
    { id: 1, card: 'Island', destination: 'top' },
    { id: 0, card: 'Island', destination: 'bottom' },
  ]).map(({ slot }) => slot)).toEqual([1, 0])
})

test('allocation input enables the answer at the exact total and preserves entry ids', () => {
  const values = { 'target:0': '400', 'target:1': '600' }
  expect(validAllocation(allocationOffer, values)).toBe(true)
  expect(allocationAnswerFor(allocationOffer, values)).toEqual([
    { id: 'target:0', amount: 400 },
    { id: 'target:1', amount: 600 },
  ])
  expect(validAllocation(allocationOffer, { 'target:0': '-1', 'target:1': '1001' })).toBe(false)
  expect(validAllocation(allocationOffer, { 'target:0': '0', 'target:1': '1000' })).toBe(false)
  expect(validAllocation(allocationOffer, { 'target:0': '701', 'target:1': '299' })).toBe(false)
  expect(validAllocation(allocationOffer, { 'target:0': '', 'target:1': '1000' })).toBe(false)
})

test('an empty zero-total allocation still renders its submit button', () => {
  const html = renderToStaticMarkup(
    <TopdeckDialog
      game={{ catalog: {} } as unknown as ReplayGame}
      decision={{
        seat: 'p1',
        kind: 'allocate',
        cards: [],
        destinations: ['target'],
        interaction: {
          requestId: 'allocation-request',
          revision: 1,
          chooser: 'p1',
          source: { name: 'Trigger', objectId: 'trigger' },
          phase: 'resolution',
          purpose: 'choice',
          cancellation: 'mustAnswer',
          selection: { kind: 'allocate', entries: [], total: 0, minEach: 0 },
        },
      } as LiveTopdeck}
      pending={false}
      onResolve={() => {}}
    />,
  )
  expect(html).toContain('>Resolve allocate</button>')
})


test('a pile choice for a later instruction does not offer to move cards into hand', () => {
  const game = { catalog: {} } as ReplayGame
  const decision = { seat: 'p1', kind: 'choosePile', cards: ['Pile 1', 'Pile 2'], destinations: ['skip', 'target'] } as LiveTopdeck
  const html = renderToStaticMarkup(<TopdeckDialog game={game} decision={decision} pending={false} onResolve={() => {}} />)
  expect(html).toContain('Choose this pile')
  expect(html).toContain('Leave this pile')
  expect(html).not.toContain('Put one pile into your hand')
})
