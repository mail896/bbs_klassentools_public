import {
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validSelection(ids) {
  return (
    Array.isArray(ids) &&
    ids.length <= 2000 &&
    ids.every((id) => typeof id === 'string' && uuid.test(id)) &&
    new Set(ids).size === ids.length
  );
}
// A missing catalog is only allowed on first installation; malformed files fail closed.
export function catalogStore(path, { required = false } = {}) {
  const read = () => {
    let raw;
    try {
      raw = readFileSync(path);
    } catch (e) {
      if (e.code === 'ENOENT' && !required) return { revision: 'initial', selected: null };
      throw e;
    }
    if (raw.length > 100000) throw new Error('Invalid catalog');
    const data = JSON.parse(raw);
    if (data.version !== 1 || !validSelection(data.selected)) throw new Error('Invalid catalog');
    return { revision: createHash('sha256').update(raw).digest('hex'), selected: data.selected };
  };
  return {
    read,
    save(selected, revision) {
      if (!validSelection(selected)) throw new Error('Invalid selection');
      if (read().revision !== revision) return null;
      const temp = path + '.' + randomUUID() + '.tmp';
      let fd;
      try {
        fd = openSync(temp, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify({ version: 1, selected: [...selected].sort() }) + '\n');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temp, path);
        const dir = openSync(dirname(path), 'r');
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      } finally {
        if (fd !== undefined) closeSync(fd);
        rmSync(temp, { force: true });
      }
      return read();
    },
  };
}
