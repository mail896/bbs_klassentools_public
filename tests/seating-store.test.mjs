import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { photoStore } from '../backend/photos.mjs';
import { validateSeating } from '../backend/seating-validation.mjs';
import { createApp } from '../backend/server.mjs';
const plan = () => ({
  size: 2,
  layout: 'rows',
  rows: 2,
  teacher: { x: 500, y: 80 },
  tables: [{ x: 40, y: 180, slots: ['s', null] }],
  pinned: ['s'],
});
const actor = { id: '11111111-1111-4111-8111-111111111111', name: 'Test Lehrkraft' };
test('seating persists with revisions, private isolation and transactional audit', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'seating-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.sqlite');
  let fail = false;
  let db = photoStore(file, {
    beforeAudit: () => {
      if (fail) throw Error('audit');
    },
  });
  const save = (owner, expected, p = plan()) =>
    db.saveSeating({ group: 'g', owner, expected, plan: p, actor });
  save('', 0);
  save(actor.id, 0);
  assert.equal(db.seating('g', 'other').plan, null);
  assert.throws(
    () => save('', 0),
    (e) => e.status === 409,
  );
  fail = true;
  assert.throws(() => save('', 1));
  assert.equal(db.seating('g', '').revision, 1);
  assert.equal(db.audit('g').entries.length, 2);
  fail = false;
  save('', 1, null);
  assert.equal(db.seating('g', '').plan, null);
  assert.equal(db.seating('g', actor.id).revision, 1);
  assert.throws(
    () => save('', 0),
    (e) => e.status === 409,
  );
  assert.equal(db.audit('g', undefined, { query: 'Sitzplan' }).entries.length, 3);
  db.close();
  db = photoStore(file);
  assert.deepEqual(db.seating('g', actor.id).plan, plan());
  db.close();
});
test('seating validation rejects duplicates, external members, malformed coordinates and excess tables', () => {
  const members = new Set(['s']);
  assert.deepEqual(validateSeating(plan(), members), plan());
  const dup = plan();
  dup.tables[0].slots = ['s', 's'];
  assert.throws(() => validateSeating(dup, members));
  const foreign = plan();
  foreign.tables[0].slots = ['other', null];
  assert.throws(
    () => validateSeating(foreign, members),
    (e) => e.status === 409,
  );
  for (const x of [-1, Infinity, 1.5, 30001]) {
    const p = plan();
    p.teacher.x = x;
    assert.throws(() => validateSeating(p, members));
  }
  const excess = plan();
  excess.tables = Array.from({ length: 6 }, () => ({ x: 40, y: 180, slots: [null, null] }));
  assert.throws(() => validateSeating(excess, members));
});
test('seating API checks authentication, Teacher, membership, CSRF, ownership and conflict', async (t) => {
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
    catalog: ['Test'],
    photos: store,
    getIdmToken: async () => 'fake',
    idm: {
      groups: async () => (member ? [{ hexUuid: 'g', group: 'test', name: 'Test' }] : []),
      members: async () =>
        student
          ? [
              {
                hexUuid: 's',
                user: 'test',
                firstname: 'Test',
                lastname: 'Person',
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
    const sess = await (await call('api/session', { headers: { cookie } })).json();
    return {
      cookie,
      origin: 'https://apps.school.example',
      'content-type': 'application/json',
      'x-csrf-token': sess.csrf,
    };
  }
  const path = 'api/classes/g/seating';
  assert.equal((await call(path)).status, 401);
  let headers = await login();
  const save = (scope = 'shared', revision = 0, extra = {}) =>
    call(path, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify({ scope, revision, plan: plan(), owner: actor.id }),
    });
  assert.equal((await save('shared', 0, { 'x-csrf-token': 'bad' })).status, 403);
  assert.equal((await save('shared', 0, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await save()).status, 200);
  assert.equal((await save()).status, 409);
  assert.equal((await save('private')).status, 200);
  info = { ...info, uuid: '22222222-2222-4222-8222-222222222222' };
  headers = await login();
  let data = await (await call(path, { headers })).json();
  assert.deepEqual(data.shared.plan, plan());
  assert.equal(data.private.plan, null);
  assert.equal((await save('private')).status, 200);
  assert.equal(store.seating('g', actor.id).revision, 1);
  assert.equal(
    (
      await call(path, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ scope: 'private', revision: 1 }),
      })
    ).status,
    200,
  );
  assert.ok(store.seating('g', actor.id).plan);
  student = false;
  assert.equal((await save('shared', 1)).status, 409);
  student = true;
  member = false;
  assert.equal((await call(path, { headers })).status, 403);
  assert.equal((await save('shared', 1)).status, 403);
  member = true;
  info = { ...info, 'iserv:roles': [] };
  assert.equal((await call(path, { headers })).status, 403);
});

test('private variants preserve earlier plans, ownership, version sequence and atomic audit', () => {
  const db = photoStore(':memory:');
  const one = db.saveSeating({ group: 'g', owner: actor.id, expected: 0, plan: plan(), actor });
  const changed = plan();
  changed.teacher.x = 700;
  changed.tables[0].vertical = true;
  const two = db.saveSeating({
    group: 'g',
    owner: actor.id,
    expected: one.revision,
    plan: changed,
    actor,
    newVersion: true,
  });
  assert.equal(two.version, 2);
  assert.equal(two.revision, 1);
  assert.equal(db.seating('g', actor.id, 1).plan.teacher.x, 500);
  assert.equal(db.seating('g', actor.id, 2).plan.teacher.x, 700);
  assert.equal(db.seatingVersions('g', 'other').length, 0);
  assert.throws(
    () =>
      db.saveSeating({ group: 'g', owner: 'other', version: 2, expected: 0, plan: changed, actor }),
    (e) => e.status === 404,
  );
  assert.throws(
    () =>
      db.saveSeating({
        group: 'g',
        owner: actor.id,
        version: 2,
        expected: 0,
        plan: changed,
        actor,
      }),
    (e) => e.status === 409,
  );
  db.saveSeating({ group: 'g', owner: actor.id, version: 2, expected: 1, plan: null, actor });
  assert.equal(
    db.saveSeating({
      group: 'g',
      owner: actor.id,
      newVersion: true,
      expected: 1,
      plan: changed,
      actor,
    }).version,
    3,
  );
  assert.equal(db.seatingVersions('g', actor.id).length, 2);
  assert.equal(db.audit('g').entries[0].member_name, 'Privater Sitzplan · v3');
  db.close();
});
