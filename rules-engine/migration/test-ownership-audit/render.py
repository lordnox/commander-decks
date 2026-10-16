#!/usr/bin/env python3
"""Render ownership markdown from inventory.json so section tables cannot drift."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

AUDIT = Path(__file__).resolve().parent
SRC_PREFIX = 'rules-engine/src/'
REPO = 'https://github.com/lordnox/commander-decks/blob'
PROPOSED = {
    'rules-engine/src/plugins/enchantmentAnimation.test.ts',
    'rules-engine/src/cardPlugins/libraryTop.test.ts',
}
RETAIN_DECISION = 'Retain existing engine/mechanic/compiler owner; no coverage deletion authorized'
SECTION_ORDER = (
    'cirdan',
    'dack',
    'sin',
    'homer-eva-kambal',
    'single-card',
    'mixed-card',
    'canonical-card',
    'mixed-catalog',
    'existing-owner',
)


def load_inventory():
    return json.loads((AUDIT / 'inventory.json').read_text())


def rel(path):
    return path[len(SRC_PREFIX):] if path.startswith(SRC_PREFIX) else path


def blob(revision, path, line=None):
    url = f'{REPO}/{revision}/{path}'
    return f'{url}#L{line}' if line else url


def expect_subject(text, limit=80):
    collapsed = re.sub(r'\s+', ' ', text).strip()
    match = re.match(r'expect\((.*)\)\.', collapsed)
    subject = match.group(1) if match else collapsed
    return subject[:limit].rstrip(' ,;')


def dest_note(group):
    if not group['ownerExists'] or group['owner'] in PROPOSED:
        return '**proposed mechanic suite**'
    if ':helper:' in group['id'] and group['owner'] == group['source']:
        return '(existing owner; retain until consumers move)'
    if group['disposition'] == 'keep-owned':
        return '(existing owner; retain current coverage)'
    return '(existing owner; add missing assertions)'


def behavior(group):
    title = group['test']
    return ' / '.join([*group['groups'], title]) if group['groups'] else title


def preserve(group, revision):
    if group['disposition'] == 'duplicate':
        evidence = group['duplicateEvidence']
        link = f"[{rel(evidence['file'])}:{evidence['line']}]({blob(revision, evidence['file'], evidence['line'])})"
        return f"{evidence['reason']} Evidence: {link}"
    assertions = group['assertions']
    parts = [f'{len(assertions)} direct/inherited checks']
    shown = assertions[:3]
    parts.extend(expect_subject(item['text']) for item in shown)
    if len(assertions) > 3:
        parts.append('remaining checks in JSON')
    parts.extend(group['flags'])
    return '; '.join(parts)


def group_row(group, revision):
    source_link = f"[{rel(group['source'])}:{group['line']}]({blob(revision, group['source'], group['line'])})"
    dest_link = f"[{rel(group['owner'])}]({blob(revision, group['owner'])})"
    runtime = '; '.join(group['runtime'])
    return (
        f"| `{group['id']}`<br>{source_link} | {behavior(group)} | {runtime} | "
        f"{group['disposition']} / #{group['issue']} | {dest_link} {dest_note(group)} | "
        f"{preserve(group, revision)} |"
    )


def section_markdown(revision, category, groups):
    rows = '\n'.join(group_row(group, revision) for group in groups)
    return (
        f'# {category}: assertion ownership\n\n'
        f'Pinned source: `{revision}`. See [audit conventions](README.md). '
        'Exact assertions, inherited helper checks, fixtures, and event evidence are in '
        '[inventory.json](inventory.json).\n\n'
        '| Group / source | Behavior and edge cases (source test title) | Runtime evidence | '
        'Disposition / slice | Mechanic destination | Preserve before removing source |\n'
        '| --- | --- | --- | --- | --- | --- |\n'
        f'{rows}\n'
    )


def scope_markdown(data):
    revision = data['auditedRevision']
    lines = [
        '# Complete suite triage',
        '',
        'Every rules-engine test file at the audited revision is listed here. Detailed coverage '
        'is the deck/card-grouped dumps plus mixed mechanic suites that also carry structural #401 '
        'rows. Pure existing mechanic owners are retained without a per-assertion inventory; a card '
        'used as an exchangeable fixture alone does not make a mechanic suite deck-owned.',
        '',
        '| Suite | Test declarations | Literal assertion sites | Decision |',
        '| --- | ---: | ---: | --- |',
    ]
    for suite in data['suiteTriage']:
        link = f"[{rel(suite['file'])}]({blob(revision, suite['file'])})"
        if suite['detailed']:
            decision = f"Detailed: [{suite['category']}]({suite['category']}.md)"
        else:
            decision = RETAIN_DECISION
        lines.append(f"| {link} | {suite['tests']} | {suite['assertions']} | {decision} |")
    lines.append('')
    return '\n'.join(lines)


def update_readme(data):
    revision = data['auditedRevision']
    counts = data['counts']
    dispositions = Counter(group['disposition'] for group in data['groups'])
    sections = Counter()
    section_groups = Counter()
    for suite in data['suiteTriage']:
        if suite['detailed']:
            sections[suite['category']] += 1
    for group in data['groups']:
        section_groups[group['category']] += 1
    retained = counts['rulesSuites'] - counts['detailedSuites']
    section_rows = '\n'.join(
        f'| [{category}]({category}.md) | {sections[category]} | {section_groups[category]} |'
        for category in SECTION_ORDER
    )
    readme = (AUDIT / 'README.md').read_text()
    readme = re.sub(
        r'\[scope\.md\]\(scope\.md\) lists \*\*\d+ rules-engine suites / \d+ test callback declarations\*\*. '
        r'The detailed inventory covers \*\*\d+ suites\*\*.*?with \*\*\d+ distinct literal assertion sites\*\*. '
        r'The other \d+ suites already have kernel, mechanic, compiler, or protocol ownership and are retained\.',
        (
            f"[scope.md](scope.md) lists **{counts['rulesSuites']} rules-engine suites / "
            f"{counts['rulesTestDeclarations']} test callback declarations**. The detailed inventory covers "
            f"**{counts['detailedSuites']} suites**, every deck/card-grouped dump plus mixed mechanic suites "
            f"that also have structural #401 rows, with **{counts['literalAssertionsInDetailedSuites']} distinct "
            f'literal assertion sites**. The other {retained} suites already have kernel, mechanic, compiler, '
            'or protocol ownership and are retained without a per-assertion inventory.'
        ),
        readme,
        count=1,
        flags=re.S,
    )
    readme = re.sub(
        r'There are \*\*\d+ ownership groups\*\*',
        f"There are **{counts['assertionGroups']} ownership groups**",
        readme,
        count=1,
    )
    readme = re.sub(
        r'\| `keep-owned` \| \d+ \|',
        f"| `keep-owned` | {dispositions['keep-owned']} |",
        readme,
        count=1,
    )
    readme = re.sub(
        r'\| `structural` \| \d+ \|',
        f"| `structural` | {dispositions['structural']} |",
        readme,
        count=1,
    )
    readme = re.sub(
        r'\| `move-preserve` \| \d+ \|',
        f"| `move-preserve` | {dispositions['move-preserve']} |",
        readme,
        count=1,
    )
    readme = re.sub(
        r'\| `duplicate` \| \d+ \|',
        f"| `duplicate` | {dispositions['duplicate']} |",
        readme,
        count=1,
    )
    readme = re.sub(
        r'\| \[cirdan\].*?\| \[existing-owner\].*?\| \d+ \| \d+ \|',
        section_rows,
        readme,
        count=1,
        flags=re.S,
    )
    readme = re.sub(
        r'The validator checks.*It does not decide behavioral equivalence or replace the audit\.',
        (
            'The validator checks the complete suite census, pinned hashes, declaration accounting, '
            'distinct assertion-site accounting, exact matcher text, destination existence, issue assignments, '
            'duplicate references, circular destinations into dump suites, restart titles assigned to #403, '
            'and that every remaining group id appears in its section markdown. It does not decide behavioral '
            'equivalence or replace the audit.'
        ),
        readme,
        count=1,
        flags=re.S,
    )
    readme = re.sub(
        r'The inventory validator passes: 271 suites, [\d,]+ groups, and [\d,]+ distinct assertion sites\.',
        (
            f"The inventory validator passes: {counts['rulesSuites']} suites, "
            f"{counts['assertionGroups']:,} groups, and "
            f"{counts['literalAssertionsInDetailedSuites']:,} distinct assertion sites."
        ),
        readme,
        count=1,
    )
    note = (
        'Mixed dump suites are owned by mechanic, not by source filename. Do not destine gameplay into another '
        'suite this audit empties. Restart/reconnect titles belong to #403. Pure existing mechanic owners stay '
        f'in [scope.md](scope.md) as retained files; only mixed existing-owner suites remain in '
        f'[existing-owner.md](existing-owner.md). Pinned source remains `{revision}`.'
    )
    if 'Mixed dump suites are owned by mechanic' not in readme:
        needle = (
            'A mixed source test can have a separate `:composition` row for #401 and a behavior row for #402/#403. '
            'Shared helpers have their own rows and consumer lists; helper assertions can also appear with their callers, '
            'so group assertion counts are intentionally not additive.'
        )
        readme = readme.replace(
            needle,
            needle + '\n\n' + note,
            1,
        )
    (AUDIT / 'README.md').write_text(readme)


def render(data=None):
    data = data or load_inventory()
    revision = data['auditedRevision']
    by_category = {category: [] for category in SECTION_ORDER}
    for group in data['groups']:
        by_category[group['category']].append(group)
    for category, groups in by_category.items():
        (AUDIT / f'{category}.md').write_text(section_markdown(revision, category, groups))
    (AUDIT / 'scope.md').write_text(scope_markdown(data))
    update_readme(data)


if __name__ == '__main__':
    render()
    print('Rendered ownership markdown from inventory.json.')
