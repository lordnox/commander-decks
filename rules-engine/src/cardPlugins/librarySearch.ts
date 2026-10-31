import type { Plugin } from '../types'

export const RETIRED_SEARCH_FETCH = 'librarySearch.fetch'

/** Reject stale requests for the retired synthetic search action during migration. */
export const librarySearch: Plugin = {
  id: 'librarySearch',
  legal: ({ event }) => {
    if (event.type === 'activateAbility' && event.abilityId === RETIRED_SEARCH_FETCH) {
      return 'that card has no library-search ability'
    }
  },
}
