import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManaPoolBadge } from './TableBoard'

test('an empty pool draws nothing', () => {
  expect(renderToStaticMarkup(<ManaPoolBadge />)).toBe('')
  expect(renderToStaticMarkup(
    <ManaPoolBadge pool={{ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }} />,
  )).toBe('')
})

test('held mana is labelled by symbol and amount', () => {
  const html = renderToStaticMarkup(
    <ManaPoolBadge pool={{ W: 1, U: 1, B: 2, G: 0 }} />,
  )

  expect(html).toContain('aria-label="Mana pool: 1 W, 1 U, 2 B"')
  expect(html).toContain('>W<')
  expect(html).toContain('>2B<')
  // A zero entry is not a floating mana.
  expect(html).not.toContain('>G<')
})
