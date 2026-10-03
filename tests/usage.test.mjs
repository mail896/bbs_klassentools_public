import { test } from 'node:test';
import assert from 'node:assert/strict';
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
