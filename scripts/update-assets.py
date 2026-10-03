#!/usr/bin/env python3
"""Update/check content-addressed local module imports and HTML entry points."""
import hashlib
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1] / 'public'
check = '--check' in sys.argv
changed = []
visited = set()

def digest(name):
    return hashlib.sha256((root / name).read_bytes()).hexdigest()[:12]

def save(path, text):
    if path.read_text() != text:
        changed.append(path.name)
        if not check:
            path.write_text(text)

def module(name, chain=()):
    if name in chain:
        raise ValueError('Circular module imports: ' + ' -> '.join((*chain, name)))
    if name in visited:
        return
    path = root / name
    def replace(match):
        dependency = match[1]
        module(dependency, (*chain, name))
        return "from './" + dependency + '?v=' + digest(dependency) + "'"
    text = re.sub(r"from '\./([a-z0-9-]+\.mjs)(?:\?v=[a-f0-9]+)?'", replace, path.read_text())
    def dynamic(match):
        dependency = match[1]
        module(dependency, (*chain, name))
        return "import('./" + dependency + '?v=' + digest(dependency) + "')"
    text = re.sub(r"import\('\./([a-z0-9-]+\.mjs)(?:\?v=[a-f0-9]+)?'\)", dynamic, text)
    save(path, text)
    visited.add(name)

module('app.js')
index = root / 'index.html'
text = index.read_text()
for asset in ['app.js', 'style.css']:
    text = re.sub(re.escape(asset) + r'\?v=[a-f0-9]+', asset + '?v=' + digest(asset), text)
save(index, text)
print(('Stale' if check else 'Updated') + ' asset references: ' + (', '.join(changed) or 'none'))
if check and changed:
    sys.exit(1)
