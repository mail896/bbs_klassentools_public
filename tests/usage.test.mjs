import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usageStore, networkClassifier } from '../backend/usage.mjs';
test('statistics deduplicate events, separate anonymous use, aggregate and expire after 90 days', () => {
  let time = Date.now();
  const store = usageStore(':memory:', { now: () => time });
  const e = { id: '1', session: 'session1', action: 'view', context: 'demo' };
  store.record(e);
  store.record(e);
  store.record({ ...e, id: '2', action: 'local_import', context: 'local', amount: 26 });
  store.record({
    ...e,
    id: '3',
    session: 'session2',
    actorId: 'teacher',
    actorName: 'Test Teacher',
    action: 'pick',
    context: 'iserv',
    classId: 'class1',
    className: 'Demo Class',
    network: 'school',
  });
  const r = store.report(30);
  assert.equal(r.totals.views, 1);
  assert.equal(r.totals.sessions, 2);
  assert.equal(r.totals.teachers, 1);
  assert.equal(r.totals.photos, 26);
  assert.equal(r.teachers[0].name, 'Test Teacher');
  assert.equal(r.classes.find((c) => c.class_id === 'class1').picks, 1);
  time += 91 * 86400000;
  assert.equal(store.report(90).totals.events, 0);
  store.close();
});
test('network classification fails closed without trusted header and configured ranges', () => {
  const req = (ip) => ({ headers: { 'x-klassentools-client-ip': ip } });
  assert.equal(networkClassifier(['192.0.2.0/24'])(req('192.0.2.5')), 'unknown');
  assert.equal(networkClassifier([], true)(req('192.0.2.5')), 'unknown');
  const classify = networkClassifier(['192.0.2.0/24', '2001:db8::/32'], true);
  assert.equal(classify(req('192.0.2.7')), 'school');
  assert.equal(classify(req('198.51.100.5')), 'external');
  assert.equal(classify(req('2001:db8::1')), 'school');
  assert.equal(classify(req('192.0.2.1, 198.51.100.1')), 'unknown');
});

test('confirmed school ranges include public exits and VLAN boundaries', async () => {
  const { readFileSync } = await import('node:fs');
  const ranges = JSON.parse(
    readFileSync(new URL('../deployment/school-networks.json', import.meta.url)),
  );
  const classify = networkClassifier(ranges, true);
  const check = (ip) => classify({ headers: { 'x-klassentools-client-ip': ip } });
  for (const ip of ['192.0.2.84', '198.51.100.210', '10.20.0.0', '10.20.255.255'])
    assert.equal(check(ip), 'school', ip);
  for (const ip of ['192.0.2.85', '10.19.255.255', '10.21.0.0'])
    assert.equal(check(ip), 'external', ip);
});

test('student denials keep latest verified names, count by identity and expire independently of usage', (t) => {
  let time = Date.now();
  const store = usageStore(':memory:', { now: () => time });
  t.after(() => store.close());
  const event = { id: 'one', actorId: 'student1', actorName: 'Old Name', account: 'old.name' };
  store.recordDeniedStudent(event);
  store.recordDeniedStudent(event);
  time += 8 * 86400000;
  store.recordDeniedStudent({
    ...event,
    id: 'two',
    actorName: '<Alex & Example>',
    account: 'alex.example',
  });
  store.recordDeniedStudent({
    ...event,
    id: 'three',
    actorId: 'student2',
    actorName: 'Another Example',
    account: '',
  });
  const before = store.report(30);
  assert.equal(before.deniedStudents.length, 2);
  const alex = before.deniedStudents.find((r) => r.account === 'alex.example');
  assert.equal(alex.name, '<Alex & Example>');
  assert.equal(alex.attempts, 2);
  assert.equal(alex.last, time);
  assert.equal(
    store.report(7).deniedStudents.find((r) => r.account === 'alex.example').attempts,
    1,
  );
  assert.equal(before.totals.events, 0);
  assert.equal(before.totals.teachers, 0);
  assert.equal(before.totals.sessions, 0);
  for (const field of ['teachers', 'access', 'networks', 'classes', 'teacherClasses', 'recent'])
    assert.deepEqual(before[field], []);
  time += 91 * 86400000;
  assert.deepEqual(store.report(90).deniedStudents, []);
});

test('existing usage database gains student denials without changing previous statistics and survives reopening', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'klassentools-denial-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'usage.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE usage_events (
    id TEXT PRIMARY KEY,time INTEGER NOT NULL,session TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,
    action TEXT NOT NULL,context TEXT NOT NULL,class_id TEXT NOT NULL,class_name TEXT NOT NULL,amount INTEGER NOT NULL,network TEXT NOT NULL)`);
  old
    .prepare('INSERT INTO usage_events VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'old',
      Date.now(),
      'visit',
      'teacher',
      'Demo Teacher',
      'view',
      'demo',
      '',
      '',
      0,
      'unknown',
    );
  old.close();
  const store = usageStore(file);
  const previous = store.report(30);
  assert.equal(previous.totals.teachers, 1);
  assert.equal(previous.totals.views, 1);
  store.recordDeniedStudent({
    id: 'denied',
    actorId: 'student',
    actorName: 'Demo Student',
    account: 'demo.student',
  });
  assert.deepEqual(store.report(30).totals, previous.totals);
  store.close();
  const reopened = usageStore(file);
  t.after(() => reopened.close());
  assert.equal(reopened.report(30).deniedStudents[0].name, 'Demo Student');
  assert.deepEqual(reopened.report(30).totals, previous.totals);
});
