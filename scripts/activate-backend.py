#!/usr/bin/env python3
"""Admin-only activation of an already reviewed root-owned backend artifact."""
from pathlib import Path
import os, sys, json, hashlib, stat, re, subprocess, fcntl
release = sys.argv[1]
assert os.geteuid() == 0 and re.fullmatch('[a-z0-9][a-z0-9.-]{0,60}', release) and ('..' not in release)
base = Path('/opt/klassentools/backend')
dest = base / 'releases' / release
current = base / 'current'

def protected(p):
    s = p.lstat()
    assert s.st_uid == 0 and (not s.st_mode & 0o022) and (not stat.S_ISLNK(s.st_mode))
for p in [base, base / 'releases', dest]:
    protected(p)
with (base / 'deploy.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    for p in dest.rglob('*'):
        protected(p)
    manifest = json.loads((dest / 'release-manifest.json').read_text())
    assert re.fullmatch('[a-f0-9]{40}', manifest['commit'])
    actual = {str(p.relative_to(dest)) for p in dest.rglob('*') if p.is_file() and p.name != 'release-manifest.json'}
    assert actual == set(manifest['files'])
    for name, digest in manifest['files'].items():
        assert hashlib.sha256((dest / name).read_bytes()).hexdigest() == digest
    previous = os.readlink(current) if current.is_symlink() else None

    def switch(target):
        temp = base / 'next'
        temp.unlink(missing_ok=True)
        temp.symlink_to(target)
        os.replace(temp, current)
    switch(dest)
    try:
        subprocess.run(['systemctl', 'restart', 'klassentools'], check=True)
        import time
        for n in range(20):
            p = subprocess.run(['curl', '-fsS', '--unix-socket', '/run/klassentools/backend.sock', 'http://localhost/klassentools/api/health'], capture_output=True)
            if p.returncode == 0 and json.loads(p.stdout).get('status') == 'ok':
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('Health check failed')
    except Exception:
        if previous:
            switch(previous)
            subprocess.run(['systemctl', 'restart', 'klassentools'], check=True)
        else:
            subprocess.run(['systemctl', 'stop', 'klassentools'])
            current.unlink(missing_ok=True)
        raise
    (base / 'active.json').write_text(json.dumps({'release': release, 'commit': manifest['commit'], 'previous': previous}) + '\n')
    print('Backend activated:', release, manifest['commit'])
