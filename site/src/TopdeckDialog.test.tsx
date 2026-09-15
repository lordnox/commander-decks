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
