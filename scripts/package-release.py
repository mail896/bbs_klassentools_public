#!/usr/bin/env python3
"""Package only public files from a named, clean Git commit."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def main(ref, target):
    repo = Path(__file__).resolve().parents[1]

    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args])

    if git('status', '--porcelain').strip():
        raise RuntimeError('Commit changes before packaging')
    commit = git('rev-parse', ref + '^{commit}').decode().strip()
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Invalid commit')
    # The tagged helper owns the allowlist; no second list can drift out of sync.
    source = git('show', commit + ':scripts/deploy.py').decode()
    files_node = next(node for node in ast.parse(source).body
                      if isinstance(node, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == 'FILES' for t in node.targets))
    allowed = ast.literal_eval(files_node.value)
    if len(set(allowed)) != len(allowed) or not all(re.fullmatch(r'[a-z][a-z0-9.-]+', name) for name in allowed):
        raise ValueError('Invalid public allowlist')
    out = Path(target)
    out.mkdir(parents=True, exist_ok=False)
    files = {}
    for name in allowed:
        data = git('show', commit + ':public/' + name)
        (out / name).write_bytes(data)
        files[name] = hashlib.sha256(data).hexdigest()
    (out / 'manifest.json').write_text(json.dumps({'commit': commit, 'files': files}, indent=2) + '\n')
    print(commit)


if __name__ == '__main__':
    main(*sys.argv[1:])
