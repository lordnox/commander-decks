import type { CatalogEntry } from './types'
import { snapshotFor } from './snapshot'
import { keyword } from '../v1'

export default {
ruleDefinition: snapshotFor([keyword.trample]),
} satisfies CatalogEntry
