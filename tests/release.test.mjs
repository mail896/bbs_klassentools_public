import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
test('release allowlist covers every public file and versioned module dependency', () => {
  const allowed = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        "import ast,json; t=ast.parse(open('scripts/deploy.py').read()); print(json.dumps(ast.literal_eval(next(n.value for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='FILES' for x in n.targets)))))",
      ],
      { cwd: root },
    ),
  );
  assert.deepEqual([...allowed].sort(), readdirSync(new URL('public/', root)).sort());
  for (const name of allowed.filter((n) => /\.(js|mjs|html)$/.test(n))) {
    for (const match of read('public/' + name).matchAll(
      /(?:from ['"]\.\/|(?:src|href)=["'](?:\.\/)?)((?:[a-z0-9-]+)\.(?:mjs|js|css))\?v=([a-f0-9]+)["']/g,
    )) {
      assert.ok(allowed.includes(match[1]), `${name} references unpackaged ${match[1]}`);
      const hash = createHash('sha256')
        .update(read('public/' + match[1]))
        .digest('hex')
        .slice(0, 12);
      assert.equal(match[2], hash, `Stale ${name} reference: ${match[1]}`);
    }
  }
  const version = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('backend/package.json')).version, version);
  assert.equal(JSON.parse(read('backend/package-lock.json')).packages[''].version, version);
  assert.ok(read('public/index.html').includes('Version ' + version));
});
