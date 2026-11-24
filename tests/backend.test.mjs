import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/server.mjs';
import { usageStore } from '../backend/usage.mjs';
import { teacherAllowed } from '../backend/auth.mjs';
const origin = 'https://apps.school.example';
const info = {
  uuid: '11111111-1111-4111-8111-111111111111',
  sub: 'test-sub',
  name: 'Demo Teacher',
  'iserv:roles': [{ uuid: 'teacher-uuid', displayName: 'Teacher' }],
  'iserv:groups': [{ id: 'demo-group', act: 'klasse.demo', name: 'Demo' }],
};
async function harness(t, role = 'teacher-uuid', extra = {}) {
  let clock = Date.now(),
    current = structuredClone(info),
    unavailable = false,
    onRefresh = async () => {};
  const provider = {
    begin: async () => ({
      state: 'expected-state',
      nonce: 'nonce',
      verifier: 'verifier',
      url: 'https://school.example/authorize',
    }),
    complete: async () => ({
      subject: 'test-sub',
      info: current,
      accessToken: 'synthetic-token',
      expires: clock + 3600000,
    }),
    refresh: async () => {
      if (unavailable) throw new Error('offline');
      await onRefresh();
      return current;
    },
  };
  const app = createApp({
    getProvider: async () => provider,
    teacherUuid: role,
    now: () => clock,
    ...extra,
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, options = {}) =>
    fetch(base + '/klassentools/' + path, { redirect: 'manual', ...options });
  async function login() {
    const start = await call('oidc/login');
    assert.equal(start.status, 303);
    const tx = start.headers.getSetCookie()[0].split(';')[0];
    const end = await call('oidc/callback?code=fake&state=expected-state', {
      headers: { cookie: tx },
    });
    return {
      end,
      tx,
      cookie: end.headers
        .getSetCookie()
        .find((s) => s.startsWith('__Secure-klassentools-session='))
        ?.split(';')[0],
    };
  }
  return {
    call,
    login,
    advance: (n) => (clock += n),
    setInfo: (v) => (current = v),
    offline: () => (unavailable = true),
    holdRefresh: (handler) => (onRefresh = handler),
  };
}
test('Teacher, session cookies, CSRF and logout', async (t) => {
  const h = await harness(t);
  assert.equal((await (await h.call('api/session')).json()).authenticated, false);
  const { end, cookie } = await h.login();
  assert.match(end.headers.getSetCookie().join(';'), /HttpOnly/);
  assert.match(end.headers.getSetCookie().join(';'), /Secure/);
  const session = await (await h.call('api/session', { headers: { cookie } })).json();
  assert.equal(session.teacher, true);
  assert.equal(session.groups[0].account, 'klasse.demo');
  assert.ok(!JSON.stringify(session).includes('synthetic-token'));
  assert.equal(
    (await h.call('api/logout', { method: 'POST', headers: { cookie, origin } })).status,
    403,
  );
  assert.equal(
    (
      await h.call('api/logout', {
        method: 'POST',
        headers: { cookie, origin, 'x-csrf-token': session.csrf },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await h.call('api/session', { headers: { cookie } })).json()).authenticated,
    false,
  );
});
test('State mismatch, replay, missing cookie and non-Teacher are rejected', async (t) => {
  const h = await harness(t);
  assert.match(
    (await h.call('oidc/callback?code=fake&state=expected-state')).headers.get('location'),
    /failed/,
  );
  const { tx } = await h.login();
  assert.match(
    (
      await h.call('oidc/callback?code=fake&state=expected-state', { headers: { cookie: tx } })
    ).headers.get('location'),
    /failed/,
  );
  h.setInfo({ ...info, 'iserv:roles': [{ uuid: 'student-uuid', displayName: 'Teacher' }] });
  const denied = await h.login();
  assert.match(denied.end.headers.get('location'), /denied/);
  assert.equal(denied.cookie, undefined);
});
test('Role removal, outage and session expiry fail closed', async (t) => {
  const h = await harness(t);
  let { cookie } = await h.login();
  h.setInfo({ ...info, 'iserv:roles': [] });
  h.advance(61000);
  assert.equal((await h.call('api/session', { headers: { cookie } })).status, 403);
  h.setInfo(info);
  ({ cookie } = await h.login());
  h.offline();
  h.advance(61000);
  assert.equal((await h.call('api/session', { headers: { cookie } })).status, 401);
  ({ cookie } = await h.login());
  h.advance(3600001);
  assert.equal(
    (await (await h.call('api/session', { headers: { cookie } })).json()).authenticated,
    false,
  );
});
test('Unconfigured role never grants Teacher access; names are not role IDs', async (t) => {
  assert.equal(teacherAllowed(info, ''), false);
  assert.equal(teacherAllowed(info, 'Teacher'), false);
  const h = await harness(t, '');
  const { cookie } = await h.login();
  const session = await (await h.call('api/session', { headers: { cookie } })).json();
  assert.equal(session.teacher, false);
  assert.equal(session.setupRequired, true);
  assert.deepEqual(session.groups, []);
  assert.equal(session.roles[0].uuid, 'teacher-uuid');
});

test('Class access revalidates membership and rejects foreign and unknown classes before IDM', async (t) => {
  let calls = 0,
    member = true;
  const h = await harness(t, 'teacher-uuid', {
    getIdmToken: async () => 'machine-test-token',
    catalog: ['Demo'],
    studentUuid: 'student-uuid',
    idm: {
      groups: async (token, user) => {
        assert.equal(token, 'machine-test-token');
        assert.equal(user, info.uuid);
        return member
          ? [{ hexUuid: 'demo-group', group: 'klasse.demo', name: 'Demo', deleted: null }]
          : [];
      },
      members: async () => {
        calls++;
        return [];
      },
    },
  });
  assert.equal((await h.call('api/classes')).status, 401);
  const { cookie } = await h.login();
  const headers = { cookie };
  const list = await (await h.call('api/classes', { headers })).json();
  assert.equal(list.classes[0].id, 'demo-group');
  assert.equal((await h.call('api/classes/foreign/members', { headers })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await h.call('api/classes/demo-group/members', { headers })).status, 200);
  assert.equal(calls, 1);
  member = false;
  assert.equal((await h.call('api/classes/demo-group/members', { headers })).status, 403);
  assert.equal(calls, 1);
  h.setInfo({ ...info, 'iserv:roles': [] });
  assert.equal((await h.call('api/classes', { headers })).status, 403);
});

test('admin catalog requires fresh Teacher and configured UUID, CSRF, known IDs and revision; grants remain membership-bound', async (t) => {
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let state = { revision: 'initial', selected: null },
    allCalls = 0,
    memberCalls = 0;
  const classCatalog = {
    read: () => state,
    save: (selected, revision) => {
      if (revision !== state.revision) return null;
      return (state = {
        selected,
        revision: String(Number(state.revision) || 0) + selected.join(''),
      });
    },
  };
  const ga = { hexUuid: a, group: 'demo', name: 'Demo' },
    gb = { hexUuid: b, group: 'other', name: 'Other' };
  const h = await harness(t, 'teacher-uuid', {
    adminUsers: [info.uuid],
    classCatalog,
    catalog: ['Demo'],
    getIdmToken: async () => 'token',
    studentUuid: 's',
    idm: {
      allGroups: async () => {
        allCalls++;
        return [ga, gb];
      },
      groups: async () => [ga],
      members: async () => {
        memberCalls++;
        return [];
      },
    },
  });
  assert.equal((await h.call('api/admin/classes')).status, 401);
  const { cookie } = await h.login(),
    session = await (await h.call('api/session', { headers: { cookie } })).json();
  assert.equal(session.admin, true);
  const headers = {
    cookie,
    origin,
    'content-type': 'application/json',
    'x-csrf-token': session.csrf,
  };
  const request = (selected, revision = 'initial', extra = {}) =>
    h.call('api/admin/classes', {
      method: 'PUT',
      headers: { ...headers, ...extra },
      body: JSON.stringify({ selected, revision }),
    });
  assert.equal((await request([a], 'initial', { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal(
    (await request([a], 'initial', { 'x-csrf-token': 'é'.repeat(session.csrf.length) })).status,
    403,
  );
  assert.equal(allCalls, 0);
  assert.equal((await request([a], 'initial', { origin: 'https://foreign.invalid' })).status, 403);
  const catalog = await (await h.call('api/admin/classes', { headers })).json();
  assert.deepEqual(catalog.selected, [a]);
  assert.equal((await request(['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])).status, 400);
  const saved = await (await request([b])).json();
  assert.deepEqual(saved.selected, [b]);
  assert.equal((await request([a])).status, 409);
  assert.deepEqual((await (await h.call('api/classes', { headers })).json()).classes, []);
  assert.equal((await h.call('api/classes/' + b + '/members', { headers })).status, 403);
  assert.equal(memberCalls, 0);
  assert.equal((await h.call('api/classes/' + a + '/members', { headers })).status, 403);
  h.setInfo({ ...info, uuid: '22222222-2222-4222-8222-222222222222' });
  assert.equal((await h.call('api/admin/classes', { headers })).status, 403);
  assert.equal((await request([a], saved.revision)).status, 403);
  h.setInfo({ ...info, 'iserv:roles': [] });
  assert.equal((await h.call('api/admin/classes', { headers })).status, 403);
  assert.deepEqual(state.selected, [b]);
});

test('usage accepts minimal anonymous events, verifies identity and restricts admin report', async (t) => {
  const events = [];
  const h = await harness(t, 'teacher-uuid', {
    adminUsers: [info.uuid],
    usage: { record: (e) => events.push(e), report: (days) => ({ days }) },
  });
  const event = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    action: 'local_import',
    context: 'local',
    classId: '',
    amount: 3,
  };
  const post = (body, headers = {}) =>
    h.call('api/usage', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await post(event, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ ...event, filename: 'private.jpg' })).status, 400);
  const response = await post(event);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure/);
  assert.equal(events[0].actorId, '');
  assert.equal(events[0].amount, 3);
  assert.equal((await post({ ...event, context: 'iserv', classId: 'foreign' })).status, 403);
  assert.equal((await h.call('api/admin/usage')).status, 401);
  const { cookie } = await h.login();
  await post({ ...event, action: 'view', context: 'demo', amount: 0 }, { cookie });
  assert.equal(events[1].actorId, info.uuid);
  assert.equal((await h.call('api/admin/usage', { headers: { cookie } })).status, 200);
  assert.equal((await h.call('api/admin/usage?days=900', { headers: { cookie } })).status, 400);
  h.setInfo({ ...info, uuid: '22222222-2222-4222-8222-222222222222' });
  assert.equal((await h.call('api/admin/usage', { headers: { cookie } })).status, 403);
  h.setInfo({ ...info, 'iserv:roles': [] });
  assert.equal((await h.call('api/admin/usage', { headers: { cookie } })).status, 403);
});

test('IServ access denial requires a valid login transaction and never creates a session', async (t) => {
  const h = await harness(t);
  assert.match(
    (await h.call('oidc/callback?error=access_denied&state=expected-state')).headers.get(
      'location',
    ),
    /failed/,
  );
  for (const error of ['access_denied', 'server_error']) {
    const start = await h.call('oidc/login'),
      cookie = start.headers.getSetCookie()[0].split(';')[0];
    const response = await h.call('oidc/callback?state=expected-state&error=' + error, {
      headers: { cookie },
    });
    assert.equal(
      response.headers.get('location'),
      '/klassentools/?login=' + (error === 'access_denied' ? 'denied' : 'failed'),
    );
    assert.ok(
      !response.headers.getSetCookie().some((v) => v.startsWith('__Secure-klassentools-session=')),
    );
    assert.match(
      (
        await h.call('oidc/callback?state=expected-state&error=' + error, { headers: { cookie } })
      ).headers.get('location'),
      /failed/,
    );
  }
});

test('Usage of an already authorized class does not query IServ again', async (t) => {
  let calls = 0;
  const events = [];
  const h = await harness(t, 'teacher-uuid', {
    usage: { record: (e) => events.push(e) },
    getIdmToken: async () => 'token',
    catalog: ['Demo'],
    idm: {
      groups: async () => {
        calls++;
        return [{ hexUuid: 'g', group: 'demo', name: 'Demo' }];
      },
    },
  });
  const { cookie } = await h.login();
  await h.call('api/classes', { headers: { cookie } });
  assert.equal(calls, 1);
  h.advance(61000);
  h.offline();
  const post = (classId) =>
    h.call('api/usage', {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        action: 'pick',
        context: 'iserv',
        classId,
        amount: 1,
      }),
    });
  assert.equal((await post('g')).status, 200);
  assert.equal(events[0].className, 'Demo');
  assert.equal(calls, 1);
  assert.equal((await post('foreign')).status, 403);
  assert.equal(calls, 1);
});

for (const action of ['logout', 'expiry'])
  test(
    `In-flight IServ refresh cannot restore access after ${action}`,
    { timeout: 5000 },
    async (t) => {
      const h = await harness(t);
      const { cookie } = await h.login();
      const session = await (await h.call('api/session', { headers: { cookie } })).json();
      const started = Promise.withResolvers(),
        release = Promise.withResolvers();
      t.after(() => release.resolve());
      h.holdRefresh(async () => {
        started.resolve();
        await release.promise;
      });
      const pending = h.call('api/classes', { headers: { cookie } });
      await started.promise;
      if (action === 'logout')
        assert.equal(
          (
            await h.call('api/logout', {
              method: 'POST',
              headers: { cookie, origin, 'x-csrf-token': session.csrf },
            })
          ).status,
          200,
        );
      else h.advance(3600001);
      release.resolve();
      assert.equal((await pending).status, 401);
      assert.equal(
        (await (await h.call('api/session', { headers: { cookie } })).json()).authenticated,
        false,
      );
    },
  );

for (const action of ['logout', 'expiry']) {
  for (const operation of ['classes', 'photos', 'delete-photos']) {
    test(
      `Delayed directory lookup cannot ${operation} after ${action}`,
      { timeout: 5000 },
      async (t) => {
        const started = Promise.withResolvers(),
          release = Promise.withResolvers();
        t.after(() => release.resolve());
        let memberCalls = 0,
          storeCalls = 0;
        const hold = async () => {
          started.resolve();
          await release.promise;
        };
        const h = await harness(t, 'teacher-uuid', {
          catalog: ['Demo'],
          studentUuid: 'student',
          getIdmToken: async () => 'token',
          idm: {
            groups: async () => {
              if (operation === 'classes') await hold();
              return [{ hexUuid: 'g', group: 'demo', name: 'Demo' }];
            },
            members: async () => {
              if (++memberCalls === (operation === 'delete-photos' ? 2 : 1)) await hold();
              return [
                {
                  hexUuid: 's1',
                  user: 'student',
                  firstname: 'Demo',
                  lastname: 'Person',
                  roles: [{ hexUuid: 'student' }],
                },
              ];
            },
          },
          photos: {
            snapshot: () => {
              storeCalls++;
              return {};
            },
            mutate: () => {
              storeCalls++;
              return {};
            },
          },
        });
        const { cookie } = await h.login();
        const session = await (await h.call('api/session', { headers: { cookie } })).json();
        const pending = h.call(operation === 'classes' ? 'api/classes' : 'api/classes/g/photos', {
          method: operation === 'delete-photos' ? 'DELETE' : 'GET',
          headers: {
            cookie,
            origin,
            'x-csrf-token': session.csrf,
            'content-type': 'application/json',
          },
          ...(operation === 'delete-photos'
            ? { body: JSON.stringify({ revision: 0, memberIds: ['s1'] }) }
            : {}),
        });
        await started.promise;
        if (action === 'logout') {
          assert.equal(
            (
              await h.call('api/logout', {
                method: 'POST',
                headers: { cookie, origin, 'x-csrf-token': session.csrf },
              })
            ).status,
            200,
          );
        } else h.advance(3600001);
        release.resolve();
        assert.equal((await pending).status, 401);
        assert.equal(storeCalls, 0, 'No protected data read or mutation after session ended');
      },
    );
  }
}

test('JSON requests reject malformed and oversized bodies without recording changes', async (t) => {
  const events = [];
  const h = await harness(t, 'teacher-uuid', { usage: { record: (event) => events.push(event) } });
  for (const [body, expected] of [
    ['{', 400],
    ['null', 400],
    ['"' + 'x'.repeat(1024) + '"', 413],
  ]) {
    const response = await h.call('api/usage', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(events, []);
});

test('only verified student denials are recorded, stay admin-only and never create a session', async (t) => {
  const usage = usageStore(':memory:');
  t.after(() => usage.close());
  const h = await harness(t, 'teacher-uuid', {
    studentUuid: 'student-uuid',
    adminUsers: [info.uuid],
    usage,
  });
  const student = {
    uuid: '22222222-2222-4222-8222-222222222222',
    name: 'Alex Beispiel',
    preferred_username: 'alex.beispiel',
    'iserv:roles': [{ uuid: 'student-uuid', displayName: 'Student' }],
  };
  h.setInfo(student);
  const { end, cookie, tx } = await h.login();
  assert.equal(end.headers.get('location'), '/klassentools/?login=denied');
  assert.equal(cookie, undefined);
  assert.deepEqual(await (await h.call('api/session', { headers: { cookie: tx } })).json(), {
    authenticated: false,
  });
  assert.equal((await h.call('api/admin/usage', { headers: { cookie: tx } })).status, 401);
  assert.equal((await h.call('api/classes', { headers: { cookie: tx } })).status, 401);
  const rows = usage.report(30).deniedStudents;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, student.name);
  assert.equal(rows[0].account, student.preferred_username);
  assert.equal(rows[0].attempts, 1);
  // A consumed callback, missing transaction, spoofed query and IdP denial have no verified identity.
  await h.call('oidc/callback?code=fake&state=expected-state', { headers: { cookie: tx } });
  await h.call('oidc/callback?code=fake&state=expected-state&name=Fake&preferred_username=fake');
  const start = await h.call('oidc/login');
  const fresh = start.headers.getSetCookie()[0].split(';')[0];
  await h.call('oidc/callback?state=expected-state&error=access_denied&name=Fake', {
    headers: { cookie: fresh },
  });
  const mismatch = await h.call('oidc/login');
  await h.call('oidc/callback?state=wrong&code=fake', {
    headers: { cookie: mismatch.headers.getSetCookie()[0].split(';')[0] },
  });
  assert.deepEqual(usage.report(30).deniedStudents, rows);
  const forged = await h.call('api/usage', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      action: 'denied_student',
      context: 'demo',
      classId: '',
      amount: 1,
    }),
  });
  assert.equal(forged.status, 400);
  await h.login();
  assert.equal(usage.report(30).deniedStudents[0].attempts, 2);
  assert.equal(usage.report(30).totals.teachers, 0);
  assert.equal(usage.report(30).totals.sessions, 0);
  h.setInfo({ ...student, 'iserv:roles': [] });
  await h.login();
  assert.equal(usage.report(30).deniedStudents[0].attempts, 2);
  h.setInfo({ ...info, 'iserv:roles': [...info['iserv:roles'], ...student['iserv:roles']] });
  const admin = await h.login();
  const response = await h.call('api/admin/usage', { headers: { cookie: admin.cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const report = await response.json();
  assert.equal(report.deniedStudents[0].attempts, 2);
  assert.ok(!JSON.stringify(report).includes('synthetic-token'));
  h.setInfo({ ...info, uuid: student.uuid });
  assert.equal(
    (await h.call('api/admin/usage', { headers: { cookie: admin.cookie } })).status,
    403,
  );
  h.setInfo(student);
  assert.equal(
    (await h.call('api/admin/usage', { headers: { cookie: admin.cookie } })).status,
    403,
  );
});

test('invalid student UUIDs and unavailable denial logging never grant access or expose claims', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  let writes = 0;
  const h = await harness(t, 'teacher-uuid', {
    studentUuid: 'student-uuid',
    usage: {
      recordDeniedStudent() {
        writes++;
        throw new Error('private database detail');
      },
    },
  });
  const student = {
    ...info,
    name: 'Private Example',
    'iserv:roles': [{ uuid: 'student-uuid', displayName: 'Student' }],
  };
  h.setInfo({ ...student, uuid: 'invalid' });
  const invalid = await h.login();
  assert.equal(invalid.cookie, undefined);
  assert.equal(invalid.end.headers.get('location'), '/klassentools/?login=denied');
  assert.equal(writes, 0);
  h.setInfo(student);
  const failed = await h.login();
  assert.equal(failed.cookie, undefined);
  assert.equal(failed.end.headers.get('location'), '/klassentools/?login=denied');
  assert.equal(writes, 1);
  assert.deepEqual(
    errors.mock.calls.map((c) => c.arguments),
    Array(2).fill(['Abgewiesene Schüleranmeldung konnte nicht protokolliert werden.']),
  );
});

test('denial diagnostics distinguish provider rejection and missing student role without personal data', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const usage = usageStore(':memory:');
  t.after(() => usage.close());
  const h = await harness(t, 'teacher-uuid', { studentUuid: 'student-uuid', usage });
  // Untrusted callbacks are distinguished without copying their input.
  await h.call('oidc/callback?state=wrong&error=access_denied&name=Private');
  assert.deepEqual(
    warnings.mock.calls.map((call) => call.arguments),
    [['KlassenTools login diagnostic:', 'transaction_missing']],
  );
  const start = await h.call('oidc/login');
  const tx = start.headers.getSetCookie()[0].split(';')[0];
  const rejected = await h.call(
    'oidc/callback?state=expected-state&error=access_denied&error_description=Private',
    {
      headers: { cookie: tx },
    },
  );
  assert.equal(rejected.headers.get('location'), '/klassentools/?login=denied');
  h.setInfo({ ...info, name: 'Private', 'iserv:roles': [] });
  assert.equal((await h.login()).cookie, undefined);
  assert.deepEqual(
    warnings.mock.calls.map((call) => call.arguments),
    [
      ['KlassenTools login diagnostic:', 'transaction_missing'],
      ['KlassenTools login diagnostic:', 'provider_access_denied'],
      ['KlassenTools login diagnostic:', 'configured_student_role_missing'],
    ],
  );
  assert.deepEqual(usage.report(30).deniedStudents, []);
});

test('callback diagnostics classify early failures, discard untrusted text and bound logging', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const h = await harness(t);
  for (const [error, reason] of [
    ['invalid_scope', 'provider_invalid_scope'],
    ['private text', 'provider_unclassified'],
  ]) {
    const start = await h.call('oidc/login');
    const tx = start.headers.getSetCookie()[0].split(';')[0];
    await h.call('oidc/callback?state=expected-state&error=' + encodeURIComponent(error), {
      headers: { cookie: tx },
    });
    assert.deepEqual(warnings.mock.calls.at(-1).arguments, [
      'KlassenTools login diagnostic:',
      reason,
    ]);
  }
  const start = await h.call('oidc/login');
  const tx = start.headers.getSetCookie()[0].split(';')[0];
  await h.call('oidc/callback?state=wrong', { headers: { cookie: tx } });
  assert.deepEqual(warnings.mock.calls.at(-1).arguments, [
    'KlassenTools login diagnostic:',
    'state_mismatch',
  ]);
  for (let i = 0; i < 25; i++) await h.call('oidc/callback?state=wrong');
  assert.equal(warnings.mock.callCount(), 20);
  h.advance(60000);
  await h.call('oidc/callback?state=wrong');
  assert.equal(warnings.mock.callCount(), 21);
});

test('OIDC verification diagnostics never log exception text, claims or causes', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {});
  let failure;
  const h = await harness(t, 'teacher-uuid', {
    getProvider: async () => ({
      begin: async () => ({ state: 'expected-state', url: 'https://school.example/authorize' }),
      complete: async () => {
        if (failure) throw failure;
        return { expires: 0 };
      },
    }),
  });
  for (const [properties, reason] of [
    [{ error: 'invalid_scope' }, 'verification_invalid_scope'],
    [
      { code: 'OAUTH_JWT_CLAIM_COMPARISON_FAILED' },
      'verification_OAUTH_JWT_CLAIM_COMPARISON_FAILED',
    ],
    [{ error: 'private-claim', code: 'private-code' }, 'verification_unclassified'],
    [null, 'identity_expired'],
  ]) {
    failure =
      properties &&
      Object.assign(new Error('private-token', { cause: 'private-cause' }), properties);
    const result = await h.login();
    assert.equal(result.cookie, undefined);
    assert.equal(result.end.headers.get('location'), '/klassentools/?login=failed');
    assert.deepEqual(warnings.mock.calls.at(-1).arguments, [
      'KlassenTools login diagnostic:',
      reason,
    ]);
  }
});
