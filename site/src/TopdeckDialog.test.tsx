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
