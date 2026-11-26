"""Install the original TV exports from a local checkout of ab19902020/South-park-."""
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[2]
target = root / 'www/assets/home/episodes'
target.mkdir(parents=True, exist_ok=True)
for revision, sha, path in json.loads((root / 'tools/home/episodes.json').read_text()):
    dest = target / pathlib.Path(path).name
    data = subprocess.check_output(['git', '-C', sys.argv[1], 'show', f'{revision}:{path}'])
    if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != sha:
        raise ValueError(path)
    dest.write_bytes(data)
