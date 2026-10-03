import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/server.mjs';
import { photoStore } from '../backend/photos.mjs';
const require = createRequire(import.meta.url),
  { chromium } = require('playwright');
const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');
const root = fileURLToPath(new URL('../public/', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'klassentools-photo-flow-')),
  store = photoStore(join(dir, 'photos.sqlite'));
const info = {
  uuid: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetische Lehrkraft',
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
  let failPhotos = false,
    failPhotoWrite = false,
    delayedPhoto = null;
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
      if (delayedPhoto && url.pathname.endsWith('/photos') && route.request().method() === 'GET') {
        const pending = delayedPhoto;
        delayedPhoto = null;
        pending.started.resolve();
        await pending.release.promise;
        await route.fulfill({ status: 403, json: { error: 'Old class request denied' } });
        pending.finished.resolve();
        return;
      }

      if (
        failPhotoWrite &&
        url.pathname.endsWith('/photos') &&
        route.request().method() === 'POST'
      ) {
        failPhotoWrite = false;
        return route.fulfill({
          status: 503,
          json: { error: 'Speichern vorübergehend nicht möglich' },
        });
      }
      if (failPhotos && url.pathname.endsWith('/photos'))
        return route.fulfill({ status: 503, json: { error: 'Fotodienst nicht erreichbar' } });
      if (url.pathname.endsWith('/photos') && route.request().method() === 'GET')
        await new Promise((r) => setTimeout(r, 400));
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
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator('#grid .portrait').count(),
      0,
      'No placeholder roster before photos arrive',
    );
    await page.waitForFunction(() =>
      document.querySelector('.local-note').textContent.includes('gemeinsam gespeichert'),
    );
  };
  await open();
  await page.locator('#manage').click();
  await page.waitForFunction(() =>
    document.querySelector('#stored-photo-count').textContent.includes('0 Fotos'),
  );
  const buffer = await sharp({
    create: { width: 400, height: 700, channels: 3, background: '#4585a0' },
  })
    .png()
    .toBuffer();
  const folder = join(dir, 'folder-import');
  mkdirSync(folder);
  writeFileSync(join(folder, 'Person, Test0.png'), buffer);
  writeFileSync(join(folder, 'Test1 - Person.png'), buffer);
  await page.waitForFunction(() => !document.querySelector('#local-photos').disabled);
  await page.locator('#local-photos').setInputFiles(folder);
  await page.locator('#apply-photos').waitFor();
  assert.equal(await page.locator('#photo-review-count').textContent(), '2 zugeordnet · 0 offen');
  assert.equal(await page.locator('#apply-photos').isEnabled(), true);
  assert.equal(await page.locator('.photo-review-row:visible').count(), 2);
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector('#apply-photos').getBoundingClientRect().top <
        document.querySelector('#photo-review').getBoundingClientRect().top,
    ),
  );
  await page.waitForFunction(() => !document.querySelector('#local-files').disabled);
  await page.locator('#local-files').setInputFiles([
    { name: 'test.person0.png', mimeType: 'image/png', buffer },
    { name: 'unknown.png', mimeType: 'image/png', buffer },
  ]);
  await page.locator('#apply-photos').waitFor();
  assert.equal(await page.locator('.photo-review-row:visible').count(), 1);
  await page.selectOption('[data-photo-index="1"]', '1');
  await page.uncheck('#photo-review-open-only');
  await page.locator('[data-crop-index="0"]').click();
  await page.locator('#crop-dialog').waitFor();
  await page.locator('#crop-zoom').fill('1.5');
  await page.locator('#crop-y').fill('0.2');
  await page.locator('#crop-apply').click();
  await page.locator('#apply-photos').click();
  await page.waitForFunction(() => !document.querySelector('#management').open);
  assert.equal(store.snapshot('g', new Set(['s0', 's1'])).total, 2);
  assert.equal(store.audit('g').entries.length, 2);
  await open();
  assert.equal(await page.locator('#grid .portrait img:not(.avatar-placeholder)').count(), 2);
  await page.locator('#manage').click();
  assert.equal(await page.locator('#management #show-photo-audit').count(), 0);
  await page.locator('[data-edit-photo="0"]').click();
  await page.locator('#crop-dialog').waitFor();
  await page.locator('#crop-settings summary').click();
  await page.check('#crop-fit');
  await page.locator('#crop-apply').click();
  await page.waitForFunction(() => !document.querySelector('#management').open);
  assert.equal(store.audit('g').entries[0].action, 'replace');
  // Company-only edits preserve the exact stored photo and produce no photo audit.
  const company = store.saveCompany(
    { name: 'Testbetrieb', city: 'Testort', short: 'Test', active: true, revision: 0 },
    info.name,
  )[0].id;
  const beforePhoto = store.snapshot('g', new Set(['s0'])).photos[0];
  const beforeAudit = store.audit('g').entries.length;
  await page.locator('#manage').click();
  await page.locator('[data-edit-photo="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#crop-apply').disabled);
  assert.match(await page.locator('#crop-title').textContent(), /Foto & Betrieb/);
  await page.fill('#crop-company-search', 'testort');
  await page.press('#crop-company-search', 'Enter');
  assert.equal(await page.locator('#crop-dialog').evaluate((e) => e.open), true);
  await page.selectOption('#crop-company-select', company);
  await page.screenshot({ path: '/tmp/v1114-person-editor.png' });
  await page.locator('#crop-apply').click();
  await page.waitForFunction(() => !document.querySelector('#management').open);
  assert.equal(store.assignments('g').assignments.s0, company);
  assert.deepEqual(store.snapshot('g', new Set(['s0'])).photos[0], beforePhoto);
  assert.equal(store.audit('g').entries.length, beforeAudit);
  assert.equal(await page.locator('#company-toast').isVisible(), true);
  // A canceled removal never changes the saved assignment.
  await page.locator('#manage').click();
  await page.locator('[data-edit-photo="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#crop-apply').disabled);
  assert.equal(await page.locator('#crop-company-select').inputValue(), company);
  await page.selectOption('#crop-company-select', '');
  await page.locator('#crop-cancel').click();
  assert.equal(store.assignments('g').assignments.s0, company);
  await page.locator('#cancel-photos').click();
  // Removing a company is also possible without modifying the photo.
  await page.locator('#manage').click();
  await page.locator('[data-edit-photo="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#crop-apply').disabled);
  await page.selectOption('#crop-company-select', '');
  await page.locator('#crop-apply').click();
  await page.waitForFunction(() => !document.querySelector('#management').open);
  assert.equal(store.assignments('g').assignments.s0, undefined);
  assert.deepEqual(store.snapshot('g', new Set(['s0'])).photos[0], beforePhoto);

  await page.locator('#manage').click();
  // A partially successful combined save stays open and can retry without repeating the company write.
  await page.locator('[data-edit-photo="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#crop-apply').disabled);
  await page.selectOption('#crop-company-select', company);
  await page.locator('#crop-settings summary').click();
  await page.fill('#crop-zoom', '1.2');
  failPhotoWrite = true;
  await page.locator('#crop-apply').click();
  await page.waitForFunction(() =>
    document
      .querySelector('#crop-status')
      .textContent.includes('Betriebszuordnung bereits gespeichert'),
  );
  assert.equal(await page.locator('#crop-dialog').evaluate((e) => e.open), true);
  assert.deepEqual(store.snapshot('g', new Set(['s0'])).photos[0], beforePhoto);
  const assignmentRevision = store.assignments('g').revision;
  await page.locator('#crop-apply').click();
  await page.waitForFunction(() => !document.querySelector('#management').open);
  assert.equal(store.assignments('g').revision, assignmentRevision);
  assert.equal(store.audit('g').entries.length, beforeAudit + 1);
  assert.equal(store.audit('g').entries[0].action, 'replace');
  await page.locator('#manage').click();
  await page.locator('[data-delete-member="s0"]').waitFor();
  await page.check('[data-delete-member="s0"]');
  await page.locator('#delete-selected-photos').click();
  await page.waitForFunction(() =>
    document.querySelector('#import-status').textContent.includes('1 Fotos gelöscht'),
  );
  assert.equal(store.snapshot('g', new Set(['s0', 's1'])).total, 1);
  // A second writer changes revision after this dialog loaded: deletion must conflict.
  const state = store.snapshot('g', new Set(['s1']));
  store.mutate({
    group: 'g',
    expected: state.revision,
    actor: { id: info.uuid, name: 'Zweite Lehrkraft' },
    upserts: [{ id: 's1', image: Buffer.from(state.photos[0].data.split(',')[1], 'base64') }],
    members: new Map([['s1', 'Test1 Person']]),
  });
  await page.locator('#delete-all-photos').click();
  await page.waitForFunction(() =>
    document.querySelector('#import-status').textContent.includes('zwischenzeitlich'),
  );
  assert.equal(store.snapshot('g', new Set(['s1'])).total, 1);
  await page.locator('#cancel-photos').click();
  await page.locator('#manage').click();
  await page.waitForFunction(() =>
    document.querySelector('#stored-photo-count').textContent.includes('1 Fotos'),
  );
  await page.locator('#delete-all-photos').click();
  await page.waitForFunction(() =>
    document.querySelector('#import-status').textContent.includes('1 Fotos gelöscht'),
  );
  assert.equal(store.snapshot('g', new Set()).total, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/klassentools-photos-mobile.png' });
  await page.locator('#cancel-photos').click();
  await page.selectOption('#class-select', '');
  await page.selectOption('#class-select', 'g');
  await page.selectOption('#class-select', '');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.person').count(), 24);
  // A late access error from a previous class request must not reset the new class.
  const delayed = {
    started: Promise.withResolvers(),
    release: Promise.withResolvers(),
    finished: Promise.withResolvers(),
  };
  delayedPhoto = delayed;
  await page.selectOption('#class-select', 'g');
  await delayed.started.promise;
  await page.selectOption('#class-select', '');
  await page.selectOption('#class-select', 'g');
  await page.waitForFunction(
    () =>
      document.querySelector('#grid .portrait') &&
      document.querySelector('#class-select').value === 'g',
  );
  delayed.release.resolve();
  await delayed.finished.promise;
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#class-select').inputValue(), 'g');
  assert.equal(await page.locator('#grid .portrait').count(), 6);
  await page.selectOption('#class-select', '');
  failPhotos = true;
  await page.selectOption('#class-select', 'g');
  await page.waitForFunction(() =>
    document.querySelector('#class-status').textContent.includes('Fotodienst nicht erreichbar'),
  );
  assert.equal(await page.locator('#class-select').inputValue(), '');
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(() => JSON.stringify(localStorage).includes('data:image')),
    false,
  );
  console.log(
    'PASS: real API browser import/crop/save/reload/replace/delete/audit/conflict/mobile with synthetic photos',
  );
} finally {
  await browser.close();
  app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
