---
name: scryfall-lookup
description: "Look up Magic: The Gathering cards and search for cards using the Scryfall API and Scryfall search syntax. Use when the user asks what a card does, requests card details or rulings-relevant Oracle text, or wants cards matching colors, color identity, mechanics, Oracle tags, types, formats, prices, or other Scryfall criteria. Do not use for evaluating a deck unless card data or candidate cards must first be retrieved."
---

# Scryfall Lookup

Use Scryfall as the source of truth for current Magic card data. Read the search syntax reference when translating unfamiliar criteria:

- https://scryfall.com/docs/syntax

Query the API rather than scraping Scryfall HTML.

For a known card name, check `cards/index.json` and `cards/<oracle-id>.json` first. Hit the API only on a miss or when the user asked for current or live data.

Every API request must send `User-Agent: commander-decks/1.0` and `Accept: application/json`. Wait about 100ms between requests. On HTTP 429, wait and retry once; do not tight-loop.

## Exact or approximate card lookup

For a known card name, call:

```text
https://api.scryfall.com/cards/named?exact=<URL-encoded card name>
```

If the user may have misspelled or abbreviated the name, retry with:

```text
https://api.scryfall.com/cards/named?fuzzy=<URL-encoded name>
```

Example:

```text
https://api.scryfall.com/cards/named?exact=Abyssal%20Persecutor
```

Report the card's:

- name
- mana cost
- type line
- Oracle text
- power/toughness, loyalty, defense, or other relevant stats
- current legality or price only when requested
- `scryfall_uri` as the card link

For double-faced cards, read the `card_faces` array and report both relevant faces.

For multiple known card names, send exact identifiers to:

```text
POST https://api.scryfall.com/cards/collection
```

Use a JSON body shaped as `{"identifiers": [{"name": "Card A"}, {"name": "Card B"}]}`, with at most 75 identifiers per request. Retry only entries returned in `not_found` through the fuzzy named endpoint. Do not turn a list of exact names into one request per card.

## Card searches

Translate the request into Scryfall syntax and call:

```text
https://api.scryfall.com/cards/search?q=<URL-encoded query>&unique=cards&order=name
```

Example: “Find red cards that blink things.”

```text
otag:blink id:r color:r
```

API request:

```text
https://api.scryfall.com/cards/search?q=otag%3Ablink%20id%3Ar%20color%3Ar&unique=cards&order=name
```

Use the narrowest accurate filters. Common operators include:

- `color:` or `c:` for card color
- `identity:` or `id:` for Commander color identity
- `oracle:` or `o:` for Oracle text
- `type:` or `t:` for card type
- `otag:` for Scryfall Oracle tags
- `commander:` for cards legal in a commander's color identity
- `format:` or `f:` for format legality
- `is:commander` for cards usable as commanders
- `is:gamechanger` for the current Commander Game Changers list (used by `assess-deck`)

Do not silently broaden a restrictive request. If zero results are returned, explain the query and then try one clearly identified broader query when useful.

## Result handling

- Parse JSON and check the API error object before answering.
- Use `data` for results.
- Follow `next_page` while `has_more` is true when the user asks for all results.
- For an open-ended request, return a concise selection of the strongest matches and state the search query used.
- Prefer `oracle_text`; do not infer current rules text from memory.
- Link each recommended card using its `scryfall_uri`.
- Distinguish card color (`color:`) from Commander color identity (`id:`).
- Preserve the user's requested format, budget, color identity, and exclusions.
- Avoid excessive requests; batch exact names, perform remaining searches sequentially, and respect Scryfall's API guidance.

## Answer style

For one card, answer directly with its rules-relevant text and a short plain-language summary when useful.

For multiple cards, use a compact list or table with card name, mana value, why it matches, and Scryfall link. Include the exact Scryfall query at the end.
