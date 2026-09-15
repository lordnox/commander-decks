import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Switch } from './Switch'

test('switch exposes its checked state to assistive technology', () => {
  const checked = renderToStaticMarkup(
    <Switch checked aria-label="Show plan" onCheckedChange={() => {}} />,
  )
  expect(checked).toContain('role="switch"')
  expect(checked).toContain('aria-checked="true"')
  expect(checked).toContain('aria-label="Show plan"')
})
