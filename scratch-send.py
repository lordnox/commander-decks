"""Send one inbox message as a seat, for agent-piloted seats."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path('.agents/skills/live-table/scripts').resolve()))
import conduit_client as cc

session = json.loads(
    Path('table-games/seed1729-eva-homer-sygg-sin.runner.json').read_text()
)
seat = sys.argv[1]
message = json.loads(sys.argv[2])
write_key = session['bins'][f'{seat}-inbox']['write']
origin = session['origin']

cc.append(origin, write_key, json.dumps(message).encode('utf-8'), kind='snapshot')
print('sent', seat, json.dumps(message))
