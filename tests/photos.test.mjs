import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');
import { photoStore, preparePhoto } from '../backend/photos.mjs';
import { createApp } from '../backend/server.mjs';
const actor = { id: '11111111-1111-4111-8111-111111111111', name: 'Test Lehrkraft' };
const image = async () =>
  'data:image/png;base64,' +
  (
    await sharp({ create: { width: 64, height: 96, channels: 3, background: '#345678' } })
      .png()
      .toBuffer()
  ).toString('base64');
test('decoder bounds format, strips metadata and emits 640-square JPEG', async () => {
  const output = await preparePhoto(await image()),
    meta = await sharp(output).metadata();
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 640);
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined);
  await assert.rejects(() =>
    preparePhoto('data:image/png;base64,' + Buffer.from('<svg/>').toString('base64')),
  );
  await assert.rejects(() => preparePhoto('data:image/svg+xml;base64,PHN2Zy8+'));
  const huge = await sharp({
    create: { width: 2100, height: 2100, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  await assert.rejects(() => preparePhoto('data:image/png;base64,' + huge.toString('base64')));
});
test('photos and audit persist atomically; conflicts and audit failure roll back', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'klassentools-photos-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'photos.sqlite');
  let fail = false;
  let store = photoStore(file, {
    beforeAudit: () => {
      if (fail) throw new Error('audit unavailable');
    },
  });
  const img = await preparePhoto(await image());
  const members = new Map([['s', 'Test Student']]);
  const save = (revision, group = 'g') =>
    store.mutate({ group, expected: revision, actor, upserts: [{ id: 's', image: img }], members });
  assert.equal(save(0).revision, 1);
  assert.equal(save(0, 'other').revision, 1);
  assert.equal(store.audit('g').entries[0].action, 'upload');
  assert.throws(
    () => save(0),
    (e) => e.status === 409,
  );
  fail = true;
  assert.throws(() => save(1));
  assert.equal(store.snapshot('g', new Set(['s'])).revision, 1);
  assert.equal(store.audit('g').entries.length, 1);
  fail = false;
  assert.equal(save(1).revision, 2);
  assert.equal(store.audit('g').entries[0].action, 'replace');
  store.close();
  store = photoStore(file);
  assert.equal(store.snapshot('g', new Set(['s'])).photos.length, 1);
  assert.equal(store.snapshot('g', new Set()).photos.length, 0);
  const deleted = store.mutate({ group: 'g', expected: 2, actor, all: true, members });
  assert.equal(deleted.changed, 1);
  assert.equal(store.snapshot('g', new Set(['s'])).total, 0);
  assert.equal(store.snapshot('other', new Set(['s'])).total, 1);
  assert.equal(store.audit('g').entries[0].action, 'delete_all');
  store.close();
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('SELECT count(*) AS n FROM photo_audit WHERE class_id=?').get('g').n, 3);
  db.close();
});
test('photo API enforces Teacher, class, Student, CSRF, revisions, auditing and shared persistence', async (t) => {
  const store = photoStore(':memory:');
  t.after(() => store.close());
  let member = true,
    student = true;
  let info = {
    uuid: actor.id,
    name: actor.name,
    'iserv:roles': [{ uuid: 'teacher', displayName: 'Teacher' }],
  };
  const provider = {
    begin: async () => ({ state: 'ok', url: 'https://example.invalid' }),
    complete: async () => ({ info, expires: Date.now() + 3600000 }),
    refresh: async () => info,
  };
  const app = createApp({
    getProvider: async () => provider,
    teacherUuid: 'teacher',
    studentUuid: 'student',
    getIdmToken: async () => 'fake',
    catalog: ['Test'],
    photos: store,
    adminUsers: [actor.id],
    idm: {
      groups: async () => (member ? [{ hexUuid: 'g', group: 'test', name: 'Test' }] : []),
      members: async () =>
        student
          ? [
              {
                hexUuid: 's',
                user: 'test.student',
                firstname: 'Test',
                lastname: 'Student',
                roles: [{ hexUuid: 'student' }],
              },
            ]
          : [],
    },
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}/klassentools/`;
  const call = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options });
  async function login() {
    let r = await call('oidc/login');
    const tx = r.headers.getSetCookie()[0].split(';')[0];
    r = await call('oidc/callback?state=ok&code=x', { headers: { cookie: tx } });
    const cookie = r.headers
      .getSetCookie()
      .find((v) => v.startsWith('__Secure-klassentools-session='))
      .split(';')[0];
    const session = await (await call('api/session', { headers: { cookie } })).json();
    return {
      cookie,
      origin: 'https://apps.school.example',
      'content-type': 'application/json',
      'x-csrf-token': session.csrf,
    };
  }
  const endpoint = 'api/classes/g/photos';
  assert.equal((await call(endpoint)).status, 401);
  let headers = await login();
  const data = await image();
  const save = (revision = 0, id = 's', extra = {}) =>
    call(endpoint, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify({ revision, photos: [{ memberId: id, data }] }),
    });
  assert.equal((await save(0, 's', { 'x-csrf-token': 'bad' })).status, 403);
  assert.equal((await save(0, 's', { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await save(0, 'foreign')).status, 403);
  assert.equal((await save()).status, 200);
  assert.equal((await save()).status, 409);
  let snapshot = await (await call(endpoint, { headers })).json();
  assert.equal(snapshot.photos.length, 1);
  assert.equal(snapshot.revision, 1);
  info = { ...info, uuid: '22222222-2222-4222-8222-222222222222', name: 'Zweite Lehrkraft' };
  headers = await login();
  assert.equal((await (await call(endpoint, { headers })).json()).photos.length, 1);
  assert.equal((await save(1)).status, 200);
  assert.equal((await call('api/classes/g/photo-audit', { headers })).status, 403);
  assert.equal((await call('api/admin/audit')).status, 401);
  assert.equal((await call('api/admin/audit', { headers })).status, 403);
  const second = info;
  info = { ...info, uuid: actor.id };
  headers = await login();
  member = false;
  const audit = await (await call('api/admin/audit', { headers })).json();
  assert.equal(audit.entries[0].actor_name, 'Zweite Lehrkraft');
  assert.equal(audit.entries.length, 2);
  assert.equal((await call('api/admin/audit', { method: 'DELETE', headers })).status, 405);
  assert.equal((await call('api/admin/audit?before=0', { headers })).status, 400);
  assert.equal(
    (await (await call('api/admin/audit?group=other', { headers })).json()).entries.length,
    0,
  );
  info = { ...info, 'iserv:roles': [] };
  assert.equal((await call('api/admin/audit', { headers })).status, 403);
  info = second;
  headers = await login();
  member = true;

  member = false;
  assert.equal((await call(endpoint, { headers })).status, 403);
  assert.equal((await call('api/classes/g/photo-audit', { headers })).status, 403);
  member = true;
  student = false;
  assert.equal((await save(2)).status, 403);
  assert.equal((await (await call(endpoint, { headers })).json()).photos.length, 0);
  student = true;
  const deletion = await call(endpoint, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ revision: 2, all: true, confirmClass: 'g' }),
  });
  assert.equal(deletion.status, 200);
  assert.equal((await (await call(endpoint, { headers })).json()).total, 0);
  info = { ...info, 'iserv:roles': [] };
  assert.equal((await call(endpoint, { headers })).status, 403);
});

test('audit search filters before pagination and retains inactive history', () => {
  const store = photoStore(':memory:');
  const upserts = Array.from({ length: 55 }, (_, i) => ({
    id: 's' + i,
    image: Buffer.from('synthetic'),
  }));
  store.mutate({
    group: 'active',
    expected: 0,
    actor: { id: 't', name: 'Müller' },
    upserts,
    members: new Map(upserts.map((p, i) => [p.id, i === 0 ? 'Besonderer Name' : 'Test ' + i])),
  });
  store.mutate({
    group: 'inactive',
    expected: 0,
    actor,
    upserts: [{ id: 's', image: Buffer.from('synthetic') }],
    members: new Map([['s', 'Archivname']]),
  });
  assert.equal(
    store.audit(null, undefined, { groups: ['active'], query: 'besonderer' }).entries.length,
    1,
  );
  const first = store.audit(null, undefined, { groups: ['active'], query: 'MÜLLER' });
  assert.equal(first.entries.length, 50);
  assert.ok(first.next);
  assert.equal(
    store.audit(null, first.next, { groups: ['active'], query: 'MÜLLER' }).entries.length,
    5,
  );
  assert.equal(store.audit(null, undefined, { groups: [] }).entries.length, 0);
  assert.equal(
    store.audit(null, undefined, { groups: ['active'], query: 'Archivname' }).entries.length,
    0,
  );
  assert.equal(store.audit(null, undefined, { query: 'Archivname' }).entries.length, 1);
  assert.equal(store.audit(null, undefined, { query: "' OR 1=1 --" }).entries.length, 0);
  store.close();
});
