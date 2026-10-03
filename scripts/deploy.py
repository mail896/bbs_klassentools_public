#!/usr/bin/env python3
"""Administrative activation of reviewed, root-owned static KlassenTools releases."""
import os, sys, re, json, hashlib, stat, shutil, subprocess, tempfile, datetime, ctypes, fcntl
from pathlib import Path
STAGE = Path('/var/lib/klassentools-staging')
RELEASES = Path('/var/www/klassentools/releases')
LIVE = Path('/var/www/html/klassentools')
STATE = Path('/var/lib/klassentools-deploy')
FILES = ('index.html', 'style.css', 'app.js', 'logic.mjs', 'demo.mjs', 'photo-matching.mjs', 'seating-ui.mjs', 'seating-layout.mjs', 'seating-export.mjs', 'learning-core.mjs', 'learning-ui.mjs', 'admin-ui.mjs', 'administration-ui.mjs', 'dice-bbs.png', 'demo-portraits.webp', 'avatar-placeholder.webp', 'landing-school.webp')

def protected(p, directory=False):
    s = p.lstat()
    assert s.st_uid == 0 and (not s.st_mode & 0o022) and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)), f'Unsafe ownership/type/mode: {p}'

def exchange(a, b):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(a), -100, os.fsencode(b), 2) != 0:
        raise OSError(ctypes.get_errno(), 'atomic exchange failed')

def setlink(target):
    temp = LIVE.parent / ('.klassentools-next-' + str(os.getpid()))
    assert not temp.exists() and (not temp.is_symlink())
    temp.symlink_to(target)
    os.replace(temp, LIVE)

def smoke(manifest):
    for name in manifest['files']:
        data = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--max-time', '10', '--resolve', 'apps.school.example:443:127.0.0.1', 'https://apps.school.example/klassentools/' + name])
        assert hashlib.sha256(data).hexdigest() == manifest['files'][name], f'HTTP mismatch: {name}'

def activate(identifier):
    assert os.geteuid() == 0, 'Run as administrator'
    assert re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', identifier) and '..' not in identifier, 'Invalid release ID'
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    protected(STATE, True)
    with (STATE / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        protected(STAGE, True)
        stage = STAGE / identifier
        protected(stage, True)
        protected(stage / 'manifest.json')
        manifest = json.loads((stage / 'manifest.json').read_text())
        files = tuple(manifest['files'])
        assert set(files) == set(FILES), 'Unexpected public release files'
        assert set((p.name for p in stage.iterdir())) == set(files) | {'manifest.json'}
        for name in (*files, 'manifest.json'):
            protected(stage / name)
        manifest = json.loads((stage / 'manifest.json').read_text())
        assert re.fullmatch('[0-9a-f]{40}', manifest['commit']) and set(manifest['files']) == set(files)
        for name in files:
            assert hashlib.sha256((stage / name).read_bytes()).hexdigest() == manifest['files'][name], name
        RELEASES.mkdir(mode=0o755, parents=True, exist_ok=True)
        protected(RELEASES, True)
        protected(RELEASES.parent, True)
        release = RELEASES / identifier
        if release.exists():
            protected(release, True)
            assert set((p.name for p in release.iterdir())) == set(files)
            for name in files:
                protected(release / name)
                assert hashlib.sha256((release / name).read_bytes()).hexdigest() == manifest['files'][name]
        else:
            temp = Path(tempfile.mkdtemp(prefix='.prepared-', dir=RELEASES))
            try:
                for name in files:
                    shutil.copyfile(stage / name, temp / name)
                    (temp / name).chmod(0o644)
                temp.chmod(0o755)
                os.replace(temp, release)
            except Exception:
                shutil.rmtree(temp)
                raise
        previous = os.readlink(LIVE) if LIVE.is_symlink() else None
        old_directory = None
        if previous:
            assert Path(previous).parent == RELEASES, 'Unexpected current symlink'
        else:
            protected(LIVE, True)
            backup = Path('/var/backups') / ('klassentools-bootstrap-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
            backup.mkdir(mode=0o700)
            old_directory = backup / 'public'
        record = {'time': datetime.datetime.now().astimezone().isoformat(), 'release': identifier, 'commit': manifest['commit'], 'previous': previous, 'initial_directory_backup': str(old_directory) if old_directory else None}
        activated = False
        try:
            if previous:
                setlink(release)
            else:
                temp = LIVE.parent / ('.klassentools-next-' + str(os.getpid()))
                temp.symlink_to(release)
                exchange(temp, LIVE)
                activated = True
                os.rename(temp, old_directory)
            activated = True
            smoke(manifest)
            record['status'] = 'active'
            tmp = STATE / 'current.tmp'
            tmp.write_text(json.dumps(record, indent=2) + '\n')
            os.replace(tmp, STATE / 'current.json')
        except Exception:
            if activated:
                if previous:
                    setlink(previous)
                else:
                    original = old_directory if old_directory.exists() else temp
                    exchange(original, LIVE)
                    original.unlink()
            record['status'] = 'failed_rolled_back'
            with (STATE / 'history.jsonl').open('a') as f:
                f.write(json.dumps(record) + '\n')
            raise
        with (STATE / 'history.jsonl').open('a') as f:
            f.write(json.dumps(record) + '\n')
        (STATE / (identifier + '.json')).write_text(json.dumps(manifest, indent=2) + '\n')
        print(json.dumps(record))
if __name__ == '__main__':
    activate(sys.argv[1])
