import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenSource } from '../backend/idm-token.mjs';
test('machine token: minimal scope, shared renewal, expiry, no stale fallback', async () => {
  let time = 0,
    calls = 0,
    fail = false;
  const get = tokenSource(
    { clientId: 'test', clientSecret: 'synthetic' },
    async (url, o) => {
      calls++;
      assert.equal(url, 'https://school.example/iserv/auth/public/token');
      assert.equal(o.redirect, 'error');
      assert.equal(o.body.get('scope'), 'iserv:idm:api-read');
      assert.equal(o.body.get('grant_type'), 'client_credentials');
      return fail
        ? new Response('', { status: 401 })
        : Response.json({
            access_token: 'synthetic-' + calls,
            expires_in: 3600,
            scope: 'iserv:idm:api-read',
          });
    },
    () => time,
  );
  assert.deepEqual(await Promise.all([get(), get()]), ['synthetic-1', 'synthetic-1']);
  assert.equal(calls, 1);
  time = 3540000;
  assert.equal(await get(), 'synthetic-2');
  time = 7080000;
  fail = true;
  await assert.rejects(get);
  fail = false;
  assert.equal(await get(), 'synthetic-4');
});
test('reject invalid credentials and malformed or overprivileged token responses', async () => {
  assert.throws(() => tokenSource({}));
  for (const data of [
    { access_token: 'x', expires_in: 3600, scope: 'iserv:idm:api-write' },
    { access_token: 'x', expires_in: 0 },
    {},
  ]) {
    await assert.rejects(
      tokenSource({ clientId: 'test', clientSecret: 'synthetic' }, async () => Response.json(data)),
    );
  }
});
