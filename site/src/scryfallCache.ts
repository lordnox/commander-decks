import type { LiveSnapshot } from './liveCodec'
import type { CardDetails, CardFace } from './replayTypes'

const collectionUrl = 'https://api.scryfall.com/cards/collection'
const databaseName = 'commander-cards'
const storeName = 'cards'
const cacheTtl = 7 * 24 * 60 * 60 * 1000
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ScryfallImages = {
  small?: string
  normal?: string
}

export type ScryfallCard = {
  id: string
  name: string
  scryfall_uri?: string
  image_uris?: ScryfallImages
  type_line?: string
  mana_cost?: string
  oracle_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  card_faces?: Array<{
    name: string
    image_uris?: ScryfallImages
    type_line?: string
    mana_cost?: string
    oracle_text?: string
    power?: string
    toughness?: string
    loyalty?: string
    defense?: string
  }>
}

type CachedCard = {
  id: string
  fetchedAt: number
  details: CardDetails
}

export const isScryfallId = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value)

const cardStats = ({
  power,
  toughness,
  loyalty,
  defense,
}: Pick<ScryfallCard, 'power' | 'toughness' | 'loyalty' | 'defense'>) => {
  if (power !== undefined && toughness !== undefined) return `${power}/${toughness}`
  return loyalty ?? defense ?? ''
}

const convertFace = (face: NonNullable<ScryfallCard['card_faces']>[number]): CardFace => ({
  name: face.name,
  image_small: face.image_uris?.small ?? '',
  image_normal: face.image_uris?.normal ?? '',
  type_line: face.type_line ?? '',
  mana_cost: face.mana_cost ?? '',
  oracle_text: face.oracle_text ?? '',
  stats: cardStats(face),
})

export const scryfallCardToDetails = (card: ScryfallCard): CardDetails => {
  const details: CardDetails = {
    id: card.id.toLowerCase(),
    scryfall_uri: card.scryfall_uri,
    image_small: card.image_uris?.small,
    image_normal: card.image_uris?.normal,
    type_line: card.type_line ?? '',
    mana_cost: card.mana_cost ?? '',
    oracle_text: card.oracle_text ?? '',
    stats: cardStats(card),
  }
  if (card.card_faces?.length) {
    details.faces = card.card_faces.map(convertFace)
  }
  return details
}

export const needsCardHydration = (details: CardDetails) => {
  if (!isScryfallId(details.id)) return false
  if (details.oracle_text || details.image_small || details.image_normal) return false
  return !details.faces?.some(
    (face) => face.oracle_text || face.image_small || face.image_normal || face.type_line,
  )
}

export const mergeCardDetails = (
  hydrated: CardDetails,
  explicit: CardDetails,
): CardDetails => ({
  ...hydrated,
  ...explicit,
  id: explicit.id?.toLowerCase() ?? hydrated.id,
})

export const compactCardDetails = (details: CardDetails): CardDetails =>
  isScryfallId(details.id) ? { id: details.id.toLowerCase() } : { ...details }

export const compactLiveSnapshot = (snapshot: LiveSnapshot): LiveSnapshot => ({
  ...snapshot,
  catalog: Object.fromEntries(
    Object.entries(snapshot.catalog).map(([name, details]) => [
      name,
      compactCardDetails(details),
    ]),
  ),
  tokens: snapshot.tokens
    ? Object.fromEntries(
        Object.entries(snapshot.tokens).map(([key, details]) => [
          key,
          compactCardDetails(details),
        ]),
      )
    : undefined,
})

export const batchScryfallIds = (ids: string[], size = 75) => {
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size))
  }
  return batches
}

const openCardDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open card cache'))
  })

const readCachedCards = async (ids: string[], now: number) => {
  const found = new Map<string, CardDetails>()
  if (ids.length === 0) return found

  const database = await openCardDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      for (const id of ids) {
        const request = store.get(id)
        request.onsuccess = () => {
          const cached = request.result as CachedCard | undefined
          if (cached && now - cached.fetchedAt < cacheTtl) {
            found.set(id, cached.details)
          }
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not read card cache'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Card cache read aborted'))
    })
  } finally {
    database.close()
  }
  return found
}

const writeCachedCards = async (cards: Map<string, CardDetails>, fetchedAt: number) => {
  if (cards.size === 0) return
  const database = await openCardDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      for (const [id, details] of cards) {
        store.put({ id, fetchedAt, details } satisfies CachedCard)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not update card cache'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Card cache update aborted'))
    })
  } finally {
    database.close()
  }
}

const fetchCardBatch = async (ids: string[]) => {
  const response = await fetch(collectionUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifiers: ids.map((id) => ({ id })),
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Could not load card details from Scryfall (${response.status} ${response.statusText})`,
    )
  }
  const collection = await response.json() as {
    data?: ScryfallCard[]
    not_found?: Array<{ id?: string }>
  }
  return new Map(
    (collection.data ?? []).map((card) => [
      card.id.toLowerCase(),
      scryfallCardToDetails(card),
    ]),
  )
}

const mergeCatalog = (
  catalog: Record<string, CardDetails>,
  hydrated: Map<string, CardDetails>,
) =>
  Object.fromEntries(
    Object.entries(catalog).map(([key, details]) => {
      const id = details.id?.toLowerCase()
      const fetched = id ? hydrated.get(id) : undefined
      return [key, fetched ? mergeCardDetails(fetched, details) : details]
    }),
  )

export const hydrateLiveSnapshot = async (snapshot: LiveSnapshot) => {
  const allDetails = [
    ...Object.values(snapshot.catalog),
    ...Object.values(snapshot.tokens ?? {}),
  ]
  const ids = [
    ...new Set(
      allDetails
        .filter(needsCardHydration)
        .map(({ id }) => id?.toLowerCase())
        .filter(isScryfallId),
    ),
  ]
  if (ids.length === 0) return snapshot

  const now = Date.now()
  const cached = await readCachedCards(ids, now).catch(() => new Map<string, CardDetails>())
  const missing = ids.filter((id) => !cached.has(id))
  const fetched = new Map<string, CardDetails>()
  for (const batch of batchScryfallIds(missing)) {
    const cards = await fetchCardBatch(batch)
    for (const [id, details] of cards) fetched.set(id, details)
  }
  void writeCachedCards(fetched, now).catch(() => undefined)

  const hydrated = new Map([...cached, ...fetched])
  return {
    ...snapshot,
    catalog: mergeCatalog(snapshot.catalog, hydrated),
    tokens: snapshot.tokens ? mergeCatalog(snapshot.tokens, hydrated) : undefined,
  }
}
