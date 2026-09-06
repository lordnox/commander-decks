const base = import.meta.env.BASE_URL

// GitHub Pages serves index.html and the data files with max-age=600 and no
// fingerprint in their names, so a browser can hold a deploy-old archive for
// ten minutes. A `t` stamp on the page URL is a different cache key, and
// carrying it into every link and data fetch keeps one reload consistent.
const stampOf = (search: string) => new URLSearchParams(search).get('t')

export const withRefresh = (path: string, search = window.location.search) => {
  const stamp = stampOf(search)
  if (!stamp) return `${base}${path}`
  const separator = path.includes('?') ? '&' : '?'
  return `${base}${path}${separator}t=${encodeURIComponent(stamp)}`
}

export const archiveHref = (search = window.location.search) =>
  withRefresh('', search)

export const gameHref = (slug: string, search = window.location.search) =>
  withRefresh(`?game=${encodeURIComponent(slug)}`, search)

export const reloadFresh = () => {
  const url = new URL(window.location.href)
  url.searchParams.set('t', String(Date.now()))
  window.location.assign(url.toString())
}
