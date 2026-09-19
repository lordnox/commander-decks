import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LiveTopdeck } from './liveCodec'
import type { ReplayGame } from './replayTypes'
import { TopdeckDialog } from './TopdeckDialog'

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
