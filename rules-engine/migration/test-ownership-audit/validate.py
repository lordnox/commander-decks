#!/usr/bin/env python3
"""Validate pinned audit evidence without changing any test or coverage ledger."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDIT = Path(__file__).resolve().parent
DATA = json.loads((AUDIT / 'inventory.json').read_text())
REVISION = DATA['auditedRevision']


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def require(condition, message):
    if not condition:
        raise SystemExit(message)


tracked = set(git('ls-tree', '-r', '--name-only', REVISION).decode().splitlines())
suites = {path for path in tracked if path.startswith('rules-engine/') and re.search(r'\.test\.tsx?$', path)}
triage = {suite['file']: suite for suite in DATA['suiteTriage']}
require(suites == set(triage), 'Suite census differs from the pinned source tree')
require(len(suites) == DATA['counts']['rulesSuites'], 'Suite count differs')
require(sum(suite['tests'] for suite in triage.values()) == DATA['counts']['rulesTestDeclarations'], 'Declaration count differs')
require(sum(suite['detailed'] for suite in triage.values()) == DATA['counts']['detailedSuites'], 'Detailed-suite count differs')
require(len(DATA['groups']) == DATA['counts']['assertionGroups'], 'Group count differs')

sources = {}
for path, suite in triage.items():
    source = git('show', f'{REVISION}:{path}')
    require(hashlib.sha256(source).hexdigest() == suite['sha256'], f'Source hash differs: {path}')
    sources[path] = source.decode().splitlines()
    require(len(suite['declarations']) == suite['tests'], f'Declaration census differs: {path}')

ids = set()
observed_assertions = set()
observed_declarations = set()
for group in DATA['groups']:
    identifier = group['id']
    require(identifier not in ids, f'Duplicate group ID: {identifier}')
    ids.add(identifier)
    path = group['source']
    require(path in triage and triage[path]['detailed'], f'Unknown detailed suite: {path}')
    source = sources[path]
    require(1 <= group['line'] <= group['endLine'] <= len(source), f'Invalid source span: {identifier}')
    require(group['issue'] in [401, 402, 403], f'Missing implementation slice: {identifier}')
    require(group['disposition'] in ['keep-owned', 'structural', 'move-preserve', 'duplicate'], f'Invalid disposition: {identifier}')
    require(group['ownerExists'] == (group['owner'] in tracked), f'Incorrect owner-existence claim: {identifier}')
    if not group['ownerExists']:
        require(group['owner'] in {'rules-engine/src/plugins/enchantmentAnimation.test.ts', 'rules-engine/src/cardPlugins/libraryTop.test.ts'}, f'Undocumented proposed owner: {identifier}')
    if ':helper:' not in identifier:
        span = (group['line'], group['endLine'])
        require(span in {(test['line'], test['endLine']) for test in triage[path]['declarations']}, f'Unmatched test declaration: {identifier}')
        observed_declarations.add((path, *span))
    for assertion in group['assertions']:
        start, end = assertion['line'], assertion['endLine']
        require(1 <= start <= end <= len(source), f'Invalid assertion span: {identifier}:{start}')
        snippet = re.sub(r'\s+', ' ', '\n'.join(source[start - 1:end]))
        require(assertion['text'] in snippet, f'Assertion text differs: {identifier}:{start}')
        observed_assertions.add((path, start, end, assertion['text']))
    evidence = group['duplicateEvidence']
    require(bool(evidence) == (group['disposition'] == 'duplicate'), f'Duplicate evidence mismatch: {identifier}')
    if evidence:
        require(evidence['file'] in tracked, f'Missing duplicate destination: {identifier}')
        require(1 <= evidence['line'] <= len(sources[evidence['file']]), f'Invalid duplicate citation: {identifier}')
        require(bool(evidence['reason'].strip()), f'Missing equivalence reasoning: {identifier}')

expected_declarations = {
    (path, test['line'], test['endLine'])
    for path, suite in triage.items() if suite['detailed']
    for test in suite['declarations']
}
expected_assertions = {
    (path, assertion['line'], assertion['endLine'], assertion['text'])
    for path, suite in triage.items() if suite['detailed']
    for assertion in suite['assertionSites']
}
require(observed_declarations == expected_declarations, 'Detailed declaration accounting is incomplete')
require(observed_assertions == expected_assertions, 'Detailed assertion-site accounting is incomplete')
require(len(expected_assertions) == DATA['counts']['literalAssertionsInDetailedSuites'], 'Distinct assertion count differs')
print(f'Validated {len(suites)} suites, {len(ids)} ownership groups, and {len(expected_assertions)} distinct assertion sites at {REVISION}.')
