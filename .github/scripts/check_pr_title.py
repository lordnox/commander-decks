#!/usr/bin/env python3
"""Validate a GitHub pull request title against the repository prefix rule."""

from __future__ import annotations

import re
import sys

from area_labels import AREAS
AREA_PATTERN = '|'.join(AREAS)

# dsl: Part 11 resumable replacement processing
# decks: add Bad Dürrenberg shaman decks
TITLE_PATTERN = re.compile(rf'^(?:{AREA_PATTERN}): (?:Part [0-9]+ )?.{{8,}}$')

EXAMPLES = (
    'dsl: Part 11 resumable replacement processing',
    'dsl: Part 13 static modifiers and activation restrictions',
    'dsl: Part 15 partial conformance tests',
    'decks: add Bad Dürrenberg shaman decks',
    'ci: require area-prefixed pull request titles',
)


def check_pr_title(title: str) -> str | None:
    if '\n' in title:
        return 'use a single-line title'
    stripped = title.strip()
    if stripped != title:
        return 'do not pad the title with leading or trailing spaces'
    if stripped.endswith('.'):
        return 'do not end the title with a period'
    if not TITLE_PATTERN.match(stripped):
        return (
            'use "<area>: <imperative summary>"'
            f' with area one of {", ".join(AREAS)}'
            ' (numbered Rule DSL work uses "dsl: Part N …")'
        )
    return None


def self_test() -> None:
    valid = (
        *EXAMPLES,
        'rules: preserve optional payment timing',
        'server: persist accepted game events',
        'docs: record Rule DSL parts 00-10 as merged',
        'live: redact private replacement frames',
        'site: show waiting seat on live table',
        'chore: drop unused oxlint exception',
    )
    invalid = (
        'Rule DSL Part 11: resumable replacement processing and lineage',
        'Add partial Rule DSL Part 15 conformance tests',
        'dsl: Part 11 resumable replacement processing.',
        'feat: add replacements',
        'dsl:',
        'dsl: short',
        ' dsl: Part 11 replacements',
    )
    for title in valid:
        error = check_pr_title(title)
        if error:
            raise SystemExit(f'expected valid title {title!r}, got {error}')
    for title in invalid:
        if check_pr_title(title) is None:
            raise SystemExit(f'expected invalid title {title!r}')


def main(argv: list[str]) -> int:
    if argv[1:] == ['--self-test']:
        self_test()
        print('pr title self-test passed')
        return 0
    if len(argv) != 2:
        print('usage: check_pr_title.py "<title>" | --self-test', file=sys.stderr)
        return 2
    error = check_pr_title(argv[1])
    if error is None:
        return 0
    print(f'invalid pull request title: {argv[1]!r}')
    print(error)
    print('examples:')
    for example in EXAMPLES:
        print(f'  {example}')
    return 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
