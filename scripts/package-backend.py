#!/usr/bin/env python3
"""Package reviewed backend source and locked production dependencies."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def main(ref, target):
    repo = Path(__file__).resolve().parents[1]

    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args])

    if git('status', '--porcelain').strip():
        raise RuntimeError('Commit changes before packaging')
    commit = git('rev-parse', ref + '^{commit}').decode().strip()
    out = Path(target).resolve()
    out.mkdir(parents=True, exist_ok=False)
    for name in ['package.json', 'package-lock.json', 'auth.mjs', 'server.mjs', 'classes.mjs',
                 'idm-token.mjs', 'catalog.mjs', 'photos.mjs', 'usage.mjs', 'errors.mjs',
                 'seating-validation.mjs', 'learning.mjs']:
        (out / name).write_bytes(git('show', commit + ':backend/' + name))
    (out / 'public').mkdir()
    (out / 'public/learning-core.mjs').write_bytes(git('show', commit + ':public/learning-core.mjs'))
    source = out / 'learning.mjs'
    source.write_text(source.read_text().replace('../public/learning-core.mjs', './public/learning-core.mjs'))
    subprocess.run(['npm', 'ci', '--prefix', str(out), '--ignore-scripts', '--omit=dev',
                    '--no-fund', '--no-audit'], check=True)
    # CLI links are unnecessary for the service; artifacts allow regular files only.
    shutil.rmtree(out / 'node_modules/.bin', ignore_errors=True)
    if any(path.is_symlink() for path in out.rglob('*')):
        raise RuntimeError('Unexpected dependency symlink')
    files = {str(path.relative_to(out)): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in out.rglob('*') if path.is_file()}
    (out / 'release-manifest.json').write_text(json.dumps({'commit': commit, 'files': files}, indent=2) + '\n')
    print(commit)


if __name__ == '__main__':
    main(*sys.argv[1:])
