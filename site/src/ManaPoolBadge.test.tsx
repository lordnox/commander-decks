import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManaPoolBadge } from './TableBoard'

test('an empty pool draws nothing', () => {
  expect(renderToStaticMarkup(<ManaPoolBadge />)).toBe('')
  expect(renderToStaticMarkup(
    <ManaPoolBadge pool={{ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }} />,
  )).toBe('')
})

test('each held color is a counted chip carrying its own color', () => {
  const html = renderToStaticMarkup(
    <ManaPoolBadge pool={{ W: 1, U: 1, B: 2, G: 0 }} />,
  )

  expect(html).toContain('aria-label="1 white mana"')
  expect(html).toContain('aria-label="2 black mana"')
  expect(html).toContain('bg-amber-50')
  expect(html).toContain('bg-sky-300')
  // The pool sits at the far edge of the badge row, away from the zone counts.
  expect(html).toContain('ml-auto')
  // A zero entry is not a floating mana.
  expect(html).not.toContain('green mana')
})

test('chips read in WUBRG order regardless of pool key order', () => {
  const html = renderToStaticMarkup(
    <ManaPoolBadge pool={{ G: 1, B: 1, W: 1, R: 1, U: 1 }} />,
  )

  const order = ['white', 'blue', 'black', 'red', 'green']
    .map((color) => html.indexOf(`${color} mana`))
  expect(order).toEqual([...order].sort((left, right) => left - right))
})
