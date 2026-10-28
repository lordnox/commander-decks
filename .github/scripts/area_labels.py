"""Shared area vocabulary and GitHub issue/PR label validation."""

import json
import os
import re
import sys
from urllib.request import Request, urlopen

AREAS = ('chore', 'ci', 'decks', 'docs', 'dsl', 'live', 'rules', 'server', 'site')
COMMENT_MARKER = '<!-- area-label-check -->'


def selected_areas(body):
    """Read only the required area field emitted by the issue form."""
    match = re.search(r'^### Area\s*\n(.*?)(?=^### |\Z)', body or '', re.M | re.S)
    if not match:
        return []
    return [area for area in match[1].strip().split(', ') if area in AREAS]


def label_error(item, *, pull_request=False):
    labels = {label['name'] for label in item['labels']}
    if not labels.intersection(AREAS):
        return f'Add at least one area label: {", ".join(AREAS)}.'
    if pull_request:
        area = item['title'].split(':', 1)[0]
        if area in AREAS and area not in labels:
            return f'Add the `{area}` label to match the PR title area.'
    return None


def api(path, method='GET', data=None):
    request = Request(
        f'{os.environ.get("GITHUB_API_URL", "https://api.github.com")}/repos/{os.environ["GITHUB_REPOSITORY"]}/{path}',
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={
            'Authorization': f'Bearer {os.environ["GH_TOKEN"]}',
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    )
    with urlopen(request) as response:
        return json.load(response)


def check_pull_request(number):
    # Query current metadata: queued label/title events may contain stale snapshots.
    error = label_error(api(f'issues/{number}'), pull_request=True)
    if error:
        print(f'::error::{error}')
        return 1
    print('PR area labels match the current title.')
    return 0


def check_issue(number, action):
    issue = api(f'issues/{number}')
    if 'pull_request' in issue or issue['state'] != 'open':
        return
    if action == 'opened':
        areas = selected_areas(issue.get('body'))
        if areas:
            api(f'issues/{number}/labels', 'POST', {'labels': areas})
            issue = api(f'issues/{number}')
    error = label_error(issue)
    comments = []
    page = 1
    while True:
        batch = api(f'issues/{number}/comments?per_page=100&page={page}')
        comments.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    previous = next((comment for comment in comments
                     if comment['user']['login'] == 'github-actions[bot]'
                     and comment['body'].startswith(COMMENT_MARKER)), None)
    if not error and previous is None:
        return
    message = error or 'Area label check passed. This issue has a relevant area label.'
    body = f'{COMMENT_MARKER}\n{message}\n\nSee [the area labeling rule](https://github.com/{os.environ["GITHUB_REPOSITORY"]}/blob/main/.github/PULL_REQUESTS.md#area-labels). Milestones are separate.'
    if previous:
        if previous['body'] != body:
            api(f'issues/comments/{previous["id"]}', 'PATCH', {'body': body})
    else:
        api(f'issues/{number}/comments', 'POST', {'body': body})
    print(message)


if __name__ == '__main__':
    with open(os.environ['GITHUB_EVENT_PATH']) as source:
        event = json.load(source)
    if 'pull_request' in event:
        sys.exit(check_pull_request(event['number']))
    check_issue(event['issue']['number'], event['action'])
