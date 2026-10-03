import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/server.mjs';
import { photoStore } from '../backend/photos.mjs';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright');
const root = fileURLToPath(new URL('../public/', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'klassentools-seat-flow-')),
  store = photoStore(join(dir, 'photos.sqlite'));
const info = {
  uuid: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetische Lehrkraft',
  preferred_username: 'test.lehrkraft',
  'iserv:roles': [{ uuid: 'teacher', displayName: 'Teacher' }],
};
const members = Array.from({ length: 6 }, (_, i) => ({
  hexUuid: 's' + i,
  user: 'test.person' + i,
  firstname: 'Test' + i,
  lastname: 'Person',
  roles: [{ hexUuid: 'student' }],
}));
const provider = {
  begin: async () => ({ state: 'ok', url: 'https://example.invalid' }),
  complete: async () => ({ info, expires: Date.now() + 3600000 }),
  refresh: async () => info,
};
const app = createApp({
  getProvider: async () => provider,
  teacherUuid: 'teacher',
  studentUuid: 'student',
  catalog: ['Testklasse'],
  photos: store,
  getIdmToken: async () => 'test',
  idm: {
    groups: async () => [{ hexUuid: 'g', group: 'test', name: 'Testklasse' }],
    members: async () => members,
  },
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${app.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  let r = await fetch(local + '/klassentools/oidc/login', { redirect: 'manual' }),
    tx = r.headers.getSetCookie()[0].split(';')[0];
  r = await fetch(local + '/klassentools/oidc/callback?state=ok&code=fake', {
    redirect: 'manual',
    headers: { cookie: tx },
  });
  const cookie = r.headers
    .getSetCookie()
    .find((s) => s.startsWith('__Secure-klassentools-session='))
    .split(';')[0]
    .split('=');
  let failPhotos = false;
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([
    {
      name: cookie[0],
      value: cookie[1],
      domain: 'apps.school.example',
      path: '/klassentools/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route('https://apps.school.example/klassentools/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/')) {
      if (failPhotos && url.pathname.endsWith('/photos'))
        return route.fulfill({ status: 503, json: { error: 'Fotodienst nicht erreichbar' } });
      const response = await route.fetch({
        url: local + url.pathname + url.search,
        headers: {
          ...route.request().headers(),
          cookie: cookie.join('='),
          origin: 'https://apps.school.example',
        },
      });
      return route.fulfill({ response });
    }
    const file = join(root, url.pathname.endsWith('/') ? 'index.html' : basename(url.pathname));
    if (existsSync(file)) return route.fulfill({ path: file });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const open = async () => {
    await page.goto('https://apps.school.example/klassentools/?app=1');
    await page.locator('#class-select option[value=g]').waitFor({ state: 'attached' });
    await page.selectOption('#class-select', 'g');
    await page.waitForFunction(() => document.querySelectorAll('.person').length === 6);
    await page.click('#seat-tab');
    await page.locator('#seat-plan-tools > summary').click();
    await page.locator('#seat-table-tools > summary').click();
    await page.click('#seat-fit');
    await page.waitForFunction(() => !document.querySelector('#seat-save').disabled);
  };
  await open();
  assert.equal(await page.locator('.seat-table').count(), 3);
  await page.click('#seat-save');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('dauerhaft gespeichert'),
  );
  assert.equal(store.seating('g', '').revision, 1);
  await open();
  assert.equal(await page.locator('.seat-table').count(), 3);
  assert.ok((await page.locator('#seat-save-state').textContent()).includes('Gespeichert'));
  await page.click('#seat-copy');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('dauerhaft gespeichert'),
  );
  assert.ok(store.seating('g', info.uuid).plan);
  await open();
  await page.selectOption('#seat-plan', 'private');
  assert.equal(await page.locator('.seat-table').count(), 3);
  await page.click('#seat-add');
  await page.click('#seat-save');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('dauerhaft gespeichert'),
  );
  assert.equal(store.seating('g', info.uuid).plan.tables.length, 4);
  assert.equal(store.seating('g', '').plan.tables.length, 3);
  await open();
  await page.selectOption('#seat-plan', 'private');
  assert.equal(await page.locator('.seat-table').count(), 4);
  await page.selectOption('#seat-plan', 'shared');
  assert.equal(await page.locator('.seat-table').count(), 3);
  const remote = store.seating('g', '');
  store.saveSeating({
    group: 'g',
    owner: '',
    expected: remote.revision,
    plan: remote.plan,
    actor: { id: info.uuid, name: 'Andere Lehrkraft' },
  });
  await page.click('#seat-add');
  await page.click('#seat-save');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('inzwischen geändert'),
  );
  assert.equal(await page.locator('.seat-table').count(), 4);
  assert.equal(store.seating('g', '').plan.tables.length, 3);
  await page.click('#seat-reload');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('Sitzpläne geladen'),
  );
  assert.equal(await page.locator('.seat-table').count(), 3);
  await page.selectOption('#seat-plan', 'private');
  await page.click('#seat-delete');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('Sitzplan gelöscht'),
  );
  assert.equal(store.seating('g', info.uuid).plan, null);
  assert.equal(await page.locator('#seat-plan').inputValue(), 'shared');
  assert.equal(store.audit('g', undefined, { query: 'Sitzplan' }).entries.length, 5);
  await page.click('#seat-copy');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('dauerhaft gespeichert'),
  );
  assert.equal(
    await page.locator('#seat-plan option:checked').textContent(),
    'test.lehrkraft.test.v1',
  );
  await page.click('#seat-add');
  await page.click('#seat-new-version');
  await page.waitForFunction(() => document.querySelector('#seat-plan').value === 'private:2');
  assert.equal(
    await page.locator('#seat-plan option:checked').textContent(),
    'test.lehrkraft.test.v2',
  );
  assert.equal(store.seating('g', info.uuid, 1).plan.tables.length, 3);
  assert.equal(store.seating('g', info.uuid, 2).plan.tables.length, 4);
  await open();
  await page.selectOption('#seat-plan', 'private:2');
  assert.equal(await page.locator('.seat-table').count(), 4);
  await page.selectOption('#seat-plan', 'private');
  assert.equal(await page.locator('.seat-table').count(), 3);
  await page.selectOption('#seat-plan', 'shared');
  await page.click('#seat-copy');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('dauerhaft gespeichert'),
  );
  assert.equal(store.seating('g', info.uuid, 2).plan.tables.length, 4);
  assert.equal(store.seating('g', info.uuid, 3).plan.tables.length, 3);
  await open();
  await page.selectOption('#seat-plan', 'private:3');
  assert.equal(await page.locator('.seat-table').count(), 3);
  await page.selectOption('#seat-plan', 'private:2');
  await page.click('#seat-delete');
  await page.waitForFunction(() =>
    document.querySelector('#seat-status').textContent.includes('Sitzplan gelöscht'),
  );
  assert.ok(store.seating('g', info.uuid, 1).plan);
  assert.equal(store.seating('g', info.uuid, 2).plan, null);

  await page.selectOption('#class-select', '');
  await page.click('#seat-save');
  assert.ok((await page.locator('#seat-status').textContent()).includes('Browserfenster'));
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(() => JSON.stringify(localStorage).includes('Synthetische')),
    false,
  );
  console.log('PASS seating real API save/reload/private-copy/conflict/reload/delete/audit/demo');
} finally {
  await browser.close();
  app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
