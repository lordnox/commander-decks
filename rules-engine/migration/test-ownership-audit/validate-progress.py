#!/usr/bin/env python3
"""Check implementation-ledger JSON and its accounting against the pinned inventory."""
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDIT = Path(__file__).resolve().parent
inventory_path = AUDIT / 'inventory.json'
inventory_bytes = inventory_path.read_bytes()
inventory = json.loads(inventory_bytes)
revision = inventory['auditedRevision']
PINNED_INVENTORY_SHA256 = 'ad711a27331c1af08f62f22b3a7dda9bfa040600641890c5ff40880b028107f5'


def require(condition, message):
    if not condition:
        raise SystemExit(message)


require(hashlib.sha256(inventory_bytes).hexdigest() == PINNED_INVENTORY_SHA256,
        f'inventory.json changed from its pinned SHA-256 {PINNED_INVENTORY_SHA256}')

groups = {group['id']: group for group in inventory['groups']}
require(len(groups) == len(inventory['groups']), 'inventory contains duplicate IDs')
expected_by_issue = {
    issue: {identifier for identifier, group in groups.items() if group['issue'] == issue}
    for issue in (401, 402, 403)
}
seen_all = set()
counts = {}
for issue in (401, 402, 403):
    path = AUDIT / f'{issue}-progress.json'
    try:
        ledger = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f'Invalid progress ledger {path.name}: {error}') from error
    require(ledger.get('issue') == issue, f'{path.name} has the wrong issue number')
    implemented = ledger.get('implemented')
    require(isinstance(implemented, list), f'{path.name} must contain an implemented list')
    duplicates = [identifier for identifier, count in Counter(implemented).items() if count > 1]
    require(not duplicates, f'{path.name} has duplicate implemented IDs: {duplicates}')
    implemented_set = set(implemented)
    unknown = implemented_set - set(groups)
    require(not unknown, f'{path.name} contains unknown IDs: {sorted(unknown)}')
    wrong_issue = {identifier for identifier in implemented_set if groups[identifier]['issue'] != issue}
    require(not wrong_issue, f'{path.name} contains IDs from another issue: {sorted(wrong_issue)}')

    if issue == 403:
        manual_audit = ledger.get('manualAudit')
        require(isinstance(manual_audit, dict), '403-progress.json needs a manualAudit record')
        verified = manual_audit.get('verifiedGroups')
        require(isinstance(verified, list), '403 manualAudit must list verifiedGroups')
        duplicates = [identifier for identifier, count in Counter(verified).items() if count > 1]
        require(not duplicates, f'403 manual audit has duplicate IDs: {duplicates}')
        expected_manual = expected_by_issue[403] - {
            identifier for identifier in expected_by_issue[403]
            if identifier.startswith('courserOfKruphix:')
        }
        require(len(expected_manual) == 73, f'expected 73 non-Courser #403 groups, found {len(expected_manual)}')
        require(set(verified) == expected_manual,
                f'403 manual audit coverage differs (missing={len(expected_manual - set(verified))}, extra={len(set(verified) - expected_manual)})')
        exceptions = manual_audit.get('exceptions')
        require(isinstance(exceptions, list), '403 manualAudit must list exceptions')
        exception_groups = [entry.get('group') for entry in exceptions]
        require(all(identifier in verified for identifier in exception_groups),
                '403 manualAudit exception references an unverified group')
        require(all(isinstance(entry.get('issue'), int) and entry.get('detail') for entry in exceptions),
                '403 manualAudit exceptions need an issue number and detail')

    retained_rows = ledger.get('retainedOwnerEvidence', [])
    require(isinstance(retained_rows, list), f'{path.name} retainedOwnerEvidence must be a list')
    retained_ids = []
    for row in retained_rows:
        identifier = row.get('group')
        require(isinstance(identifier, str) and identifier,
                f'{path.name} retained evidence needs an exact group ID')
        for field in ('owner', 'evidence', 'runtimeEvidence'):
            require(isinstance(row.get(field), str) and row[field].strip(),
                    f'{path.name} retained evidence {identifier} lacks {field}')
        require(bool(row.get('currentTitle') or row.get('sourceTitle') or row.get('owner')),
                f'{path.name} retained evidence {identifier} lacks a current/source owner title')
        retained_ids.append(identifier)
    duplicate_retained = [identifier for identifier, count in Counter(retained_ids).items() if count > 1]
    require(not duplicate_retained, f'{path.name} repeats retained evidence IDs: {duplicate_retained}')
    retained_set = set(retained_ids)
    require(not (retained_set & implemented_set),
            f'{path.name} lists IDs as both implemented and retained: {sorted(retained_set & implemented_set)}')
    unknown_retained = retained_set - set(groups)
    require(not unknown_retained, f'{path.name} has unknown retained IDs: {sorted(unknown_retained)}')
    wrong_retained = {identifier for identifier in retained_set if groups[identifier]['issue'] != issue}
    require(not wrong_retained, f'{path.name} retained IDs belong to another issue: {sorted(wrong_retained)}')
    accounted_set = implemented_set | retained_set

    relocation_ids = []
    for row in ledger.get('relocations', []):
        require(bool(row.get('destination', '').strip()), f'{path.name} has a relocation without destination')
        require(bool(row.get('suite', '').strip()), f'{path.name} has a relocation without suite')
        require(bool(row.get('evidence', '').strip()), f'{path.name} has a relocation without evidence')
        row_ids = row.get('groups')
        require(isinstance(row_ids, list) and row_ids, f'{path.name} has an empty relocation group')
        relocation_ids.extend(row_ids)
    duplicate_relocations = [identifier for identifier, count in Counter(relocation_ids).items() if count > 1]
    if issue == 401:
        require(set(relocation_ids) == implemented_set,
                f'401 per-group owner evidence must cover every implemented ID (missing={len(implemented_set - set(relocation_ids))}, extra={len(set(relocation_ids) - implemented_set)})')
    if issue == 402:
        require(set(relocation_ids) == implemented_set,
                f'402 per-group relocation evidence must cover every implemented ID (missing={len(implemented_set - set(relocation_ids))}, extra={len(set(relocation_ids) - implemented_set)})')
        require(len(retained_set) == 29,
                f'402 retainedOwnerEvidence must cover 29 keep-owned IDs, found {len(retained_set)}')
    require(not duplicate_relocations, f'{path.name} relocates IDs more than once: {duplicate_relocations}')
    unknown_relocations = set(relocation_ids) - set(groups)
    require(not unknown_relocations, f'{path.name} relocates unknown IDs: {sorted(unknown_relocations)}')
    require(set(relocation_ids) <= accounted_set,
            f'{path.name} has relocation rows absent from evidence accounting: {sorted(set(relocation_ids) - accounted_set)}')
    missing = expected_by_issue[issue] - accounted_set
    extra = accounted_set - expected_by_issue[issue]
    require(not missing and not extra,
            f'{path.name} accounting differs (missing={len(missing)}, extra={len(extra)})')
    overlap = seen_all & accounted_set
    require(not overlap, f'IDs appear in more than one ledger: {sorted(overlap)}')
    seen_all.update(accounted_set)
    counts[issue] = (len(accounted_set), len(relocation_ids))

require(seen_all == set(groups), 'progress ledgers do not cover every inventory group exactly once')
print('Progress JSON and pinned inventory accounting passed: ' + ', '.join(
    f'#{issue} {implemented} IDs ({relocated} relocated)'
    for issue, (implemented, relocated) in counts.items()
))
