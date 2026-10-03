import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedClasses,
  studentsOnly,
  idmClient,
  userUuid,
  directoryGroups,
} from '../backend/classes.mjs';
import { groupsOf } from '../backend/auth.mjs';
test('class catalog intersects actual teacher groups only', () => {
  const info = {
    'iserv:groups': [
      { id: 'a', act: 'ito.a', name: 'ITO.a' },
      { id: 'b', act: 'staff', name: 'Lehrer' },
    ],
  };
  assert.deepEqual(
    allowedClasses(info, ['ITO.a', 'ITO.b'], groupsOf).map((g) => g.id),
    ['a'],
  );
  assert.deepEqual(allowedClasses({}, ['ITO.a'], groupsOf), []);
});
test('Student required, Teacher excluded even with both roles; no implicit student fallback', () => {
  const student = {
    hexUuid: 'u1',
    user: 'test.person',
    firstname: 'Test',
    lastname: 'Person',
    roles: [{ hexUuid: 's' }],
  };
  assert.equal(studentsOnly([student], 's', 't').length, 1);
  for (const roles of [[], [{ hexUuid: 't' }], [{ hexUuid: 's' }, { hexUuid: 't' }]])
    assert.deepEqual(studentsOnly([{ ...student, roles }], 's', 't'), []);
  assert.throws(() => studentsOnly([{ ...student, roles: undefined }], 's', 't'));
  assert.throws(() => studentsOnly([student], '', 't'));
  assert.deepEqual(studentsOnly([{ ...student, locked: true }], 's', 't'), []);
});
test('IDM uses only fixed same-origin GET and fails closed on errors/schema changes', async () => {
  let seen;
  const c = idmClient(async (url, options) => {
    seen = { url, options };
    return new Response('[]');
  });
  assert.deepEqual(await c.members('test-token', 'group-id'), []);
  assert.equal(seen.url.origin, 'https://idm.school.example');
  assert.equal(seen.options.method, 'GET');
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.url.pathname, '/iserv/idm/api/v1/groups/group-id/members');
  assert.throws(() => c.members('test-token', '../../users'));
  await assert.rejects(() => idmClient(async () => new Response('{}')).roles('token'));
  await assert.rejects(() =>
    idmClient(async () => new Response('', { status: 403 })).roles('token'),
  );
});

test('REST identity comes only from verified UUID, conflicting claims fail closed', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  assert.equal(userUuid({ uuid }), uuid);
  assert.equal(userUuid({ 'iserv:uuid': uuid }), uuid);
  assert.throws(() => userUuid({ preferred_username: 'test.teacher' }));
  assert.throws(() => userUuid({ uuid, 'iserv:uuid': '22222222-2222-4222-8222-222222222222' }));
  assert.deepEqual(
    directoryGroups([{ hexUuid: uuid, group: 'ito.a', name: 'ITO.a', deleted: null }]),
    [{ id: uuid, account: 'ito.a', name: 'ITO.a' }],
  );
  assert.deepEqual(directoryGroups([{ deleted: '2026-01-01' }]), []);
  assert.throws(() => directoryGroups([{ name: 'Incomplete' }]));
});
