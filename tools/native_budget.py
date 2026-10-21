import json
from pathlib import Path

def check_rss(measured, key, budget):
    data=json.loads(Path(budget).read_text())
    entry=data['measurements'].get(key)
    if not entry:
        raise LookupError('no recorded RSS baseline for '+key)
    limit=entry['limitBytes']
    if not isinstance(measured,int) or measured<=0:
        raise AssertionError('RSS unavailable')
    if measured>limit:
        raise AssertionError(f'RSS {measured} bytes exceeds {limit} byte budget')
    return limit
