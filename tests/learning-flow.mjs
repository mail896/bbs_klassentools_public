import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/server.mjs';
import { photoStore, preparePhoto } from '../backend/photos.mjs';
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
  adminUsers: [info.uuid],
  getIdmToken: async () => 'test',
  idm: {
    allGroups: async () => [{ hexUuid: 'g', group: 'test', name: 'Testklasse' }],
    groups: async () => [{ hexUuid: 'g', group: 'test', name: 'Testklasse' }],
    members: async () => members,
  },
});
const image = await preparePhoto(
  'data:image/webp;base64,' +
    readFileSync(join(root, 'avatar-placeholder.webp')).toString('base64'),
);
store.mutate({
  group: 'g',
  expected: 0,
  actor: { id: info.uuid, name: info.name },
  upserts: members.map((m) => ({ id: m.hexUuid, image })),
  members: new Map(members.map((m) => [m.hexUuid, m.firstname + ' ' + m.lastname])),
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

  let delayedCompanies = null,
    savingCompanies = null;
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([
    {
      name: cookie[0],
      value: cookie[1],
      domain: 'klassentools.test',
      path: '/klassentools/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  // All browser traffic is intercepted; only the in-process loopback backend is contacted.
  await context.route('**/*', (route) => route.abort());
  await context.route('https://klassentools.test/klassentools/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/')) {
      const response = await route.fetch({
        url: local + url.pathname + url.search,
        headers: {
          ...route.request().headers(),
          cookie: cookie.join('='),
          origin: 'https://apps.school.example',
        },
      });
      if (
        savingCompanies &&
        url.pathname.endsWith('/companies') &&
        route.request().method() === 'POST'
      ) {
        const pending = savingCompanies;
        savingCompanies = null;
        pending.started.resolve();
        await pending.release.promise;
      }
      if (
        delayedCompanies &&
        url.pathname.endsWith('/companies') &&
        route.request().method() === 'GET'
      ) {
        const pending = delayedCompanies;
        delayedCompanies = null;
        pending.started.resolve();
        await pending.release.promise;
        await route.fulfill({ response });
        pending.finished.resolve();
        return;
      }
      return route.fulfill({ response });
    }
    const file = join(root, url.pathname.endsWith('/') ? 'index.html' : basename(url.pathname));
    if (existsSync(file)) return route.fulfill({ path: file });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let discard = true,
    prompts = 0;
  page.on('dialog', (d) => {
    prompts++;
    return discard ? d.accept() : d.dismiss();
  });
  const open = async () => {
    await page.goto('https://klassentools.test/klassentools/?app=1');
    await page.locator('#class-select option[value=g]').waitFor({ state: 'attached' });
    await page.selectOption('#class-select', 'g');
    await page.waitForFunction(() => document.querySelectorAll('.person').length === 6);
    await page.click('#learn-tab');
    await page.waitForFunction(() => !document.querySelector('#learn-start').disabled);
  };

  await open();
  assert.equal(await page.locator('#learn-purpose-learn').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#learn-limit option[value=time]').isEnabled(), false);
  const startResponse = page.waitForResponse(
    (r) => r.url().endsWith('/learning') && r.request().method() === 'POST',
  );
  await page.click('#learn-start');
  const initial = await (await startResponse).json();
  const wrong = initial.question.choices.find((p) => p.id !== initial.question.id).id;
  await page.locator(`[data-answer="${wrong}"]`).click();
  await page.locator('.learn-wrong').waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('.learn-reveal').isVisible(), true);
  assert.equal(await page.locator('#learn-next').isVisible(), true);
  await page.click('#learn-next');
  await page.locator('[data-answer]').first().waitFor();
  await page.click('#learn-finish');
  await page.locator('.learn-summary').waitFor();
  assert.equal(store.learningAudit('g').entries.length, 0);
  assert.equal(Object.keys(store.learningProgress('g', info.uuid)).length, 1);
  await page.click('#learn-purpose-quiz');
  await page.selectOption('#learn-limit', 'class');
  await page.click('#learn-start');
  for (let i = 0; i < 6; i++) {
    if (i === 0) {
      await page.locator('#learn-timer').waitFor({ state: 'visible' });
      await page.locator('.learn-wrong').waitFor();
      assert.match(await page.locator('#learn-status').textContent(), /Zeit abgelaufen/);
    } else await page.locator('[data-answer]').first().click();
    await page.locator('.learn-reveal').waitFor();
    assert.equal(await page.locator('#learn-start').isDisabled(), true);
    assert.equal(await page.locator('#learn-next').isVisible(), false);
    await page.locator('.learn-reveal').waitFor({ state: 'hidden' });
  }
  await page.locator('.learn-result').waitFor();
  assert.equal(store.learningAudit('g').highscores.length, 1);
  assert.equal(Object.keys(store.learningProgress('g', info.uuid)).length, 6);
  await open();
  assert.ok((await page.locator('#learn-progress').textContent()).includes('6 Namen geübt'));
  // Catalogue + assignment go through their real authenticated endpoints.
  await page.goto('https://klassentools.test/klassentools/?admin=classes');
  await page.locator('#admin-companies-tab').waitFor({ state: 'visible' });
  await page.click('#admin-companies-tab');
  await page.fill('#company-name', 'Beispielwerk');
  await page.fill('#company-city', 'Beispielstadt');
  await page.click('#company-admin-save');
  await page.waitForFunction(() =>
    document.querySelector('#company-admin-status')?.textContent.includes('gespeichert'),
  );
  await page.click('#admin-learning-tab');
  await page.waitForFunction(() =>
    document.querySelector('#learn-audit-results')?.textContent.includes('Synthetische Lehrkraft'),
  );
  assert.ok(
    (await page.locator('#learn-audit-results').textContent()).includes(
      'Beste abgeschlossene Runden',
    ),
  );
  await open();
  await page.click('#manage');
  await page.locator('[data-company-member]').first().waitFor();
  const company = store.companies()[0].id;
  // A response for a closed dialog must not replace edits in the reopened dialog.
  await page.click('#cancel-photos');
  const delayed = {
    started: Promise.withResolvers(),
    release: Promise.withResolvers(),
    finished: Promise.withResolvers(),
  };
  delayedCompanies = delayed;
  await page.click('#manage');
  await delayed.started.promise;
  await page.click('#cancel-photos');
  await page.click('#manage');
  await page.locator('[data-company-member]').first().waitFor();
  await page.selectOption('[data-company-member="s1"]', company);
  delayed.release.resolve();
  await delayed.finished.promise;
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-company-member="s1"]').inputValue(), company);
  await page.selectOption('[data-company-member="s1"]', '');
  await page.locator('[data-company-check]').first().check();
  await page.fill('#company-filter', 'beispielstadt');
  assert.equal(await page.locator('[data-company-match]').count(), 1);
  await page.press('#company-filter', 'Enter');
  assert.equal(await page.locator('#management').evaluate((e) => e.open), true);
  await page.locator('[data-company-match]').click();
  assert.equal(await page.locator('#company-bulk').inputValue(), company);
  await page.click('#company-bulk-apply');
  discard = false;
  const beforeDiscard = prompts;
  await page.keyboard.press('Escape');
  assert.equal(prompts, beforeDiscard + 1);
  assert.equal(await page.locator('#management').evaluate((e) => e.open), true);
  const pendingSave = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  savingCompanies = pendingSave;
  await page.click('#company-save');
  await pendingSave.started.promise;
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2);
  await page.click('#management .close');
  assert.equal(prompts, beforeDiscard + 1);
  assert.equal(await page.locator('#management').evaluate((e) => e.open), true);
  pendingSave.release.resolve();
  discard = true;

  await page.waitForFunction(() =>
    document.querySelector('#company-status').textContent.includes('gespeichert'),
  );
  assert.equal(store.assignments('g').assignments.s0, company);
  await page.waitForFunction(() => !document.querySelector('#management').open);
  assert.equal(await page.locator('#company-toast').isVisible(), true);
  await page.click('#pick-tab');
  assert.equal(await page.locator('#grid [data-company-info]').count(), 1);
  await page.locator('#grid [data-company-info]').click();
  assert.ok((await page.locator('#company-tooltip').textContent()).includes('Beispielstadt'));
  assert.equal(await page.locator('#present-count').textContent(), '6');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('#class-select option[value=g]').waitFor({ state: 'attached' });
  await page.selectOption('#class-select', 'g');
  await page.locator('#grid [data-company-info]').waitFor();
  assert.equal(await page.locator('#grid [data-company-info]').count(), 1);
  await page.keyboard.press('Escape');
  // Every demo mode works independently of the authenticated data.
  await page.selectOption('#class-select', '');
  for (const mode of ['photo-name', 'name-photo', 'typing', 'cards', 'company']) {
    await page.click('#learn-tab');
    await page.click(mode === 'cards' ? '#learn-purpose-learn' : '#learn-purpose-quiz');
    await page.selectOption('#learn-mode', mode);
    assert.equal(await page.locator('.learn-symbol').count(), 1);
    await page.click('#learn-start');
    if (mode === 'company') assert.equal(await page.locator('[data-answer]').count(), 4);
    if (mode === 'name-photo') {
      assert.match(await page.locator('#learn-question h2').textContent(), /^Wer ist .+\?$/);
      assert.equal(
        await page
          .locator('.learn-photo-choices button')
          .first()
          .evaluate((el) => getComputedStyle(el).borderTopWidth),
        '0px',
      );
    }
    if (mode === 'typing') {
      await page.fill('#learn-input', 'Test');
      await page.locator('#learn-input-form button').click();
    } else if (mode === 'cards') {
      await page.click('#learn-flip');
    } else await page.locator('[data-answer]').first().click();
    await page.locator(mode === 'cards' ? '#learn-flip.is-flipped' : '.learn-reveal').waitFor();
    if (mode === 'cards') {
      assert.equal(await page.locator('#learn-yes, #learn-no').count(), 0);
      const before = await page.locator('#learn-flip').getAttribute('data-question');
      await page.click('#learn-flip');
      await page.waitForFunction(
        (key) => document.querySelector('#learn-flip')?.dataset.question !== key,
        before,
      );
      assert.equal(await page.locator('#learn-next').isVisible(), false);
      assert.equal(await page.locator('#learn-flip').getAttribute('aria-pressed'), 'false');
    } else
      assert.ok(
        await page.locator('#learn-status.learn-correct, #learn-status.learn-wrong').count(),
      );
    await page.click('#learn-finish');
    await page.locator('.learn-result').waitFor();
    if (mode === 'typing') {
      assert.equal(await page.locator('.learn-review-people > div').count(), 1);
      await page.click('#learn-practice');
      await page.locator('#learn-flip').waitFor();
      assert.equal(await page.locator('#learn-purpose-learn').getAttribute('aria-pressed'), 'true');
      await page.click('#learn-flip');
      await page.locator('#learn-flip.is-flipped').waitFor();
      await page.click('#learn-flip');
      await page.locator('.learn-result').waitFor();
      assert.equal(await page.locator('.learn-summary-stats').count(), 0);
    }
  }
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('Test0')), false);
  await page.click('#learn-tab');
  await page.selectOption('#learn-mode', 'photo-name');
  await page.click('#learn-start');
  await page.screenshot({ path: '/tmp/klassentools-learning-light.png', fullPage: true });
  await page.selectOption('#theme', 'dark');
  await page.screenshot({ path: '/tmp/klassentools-learning-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/klassentools-learning-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.click('#pick-tab');
  assert.equal(await page.locator('#learning-panel').isVisible(), false);
  await page.waitForTimeout(2700);
  assert.equal(await page.locator('#learning-panel').isVisible(), false);
  await page.goto('https://klassentools.test/klassentools/?admin=classes');
  await page.click('#admin-companies-tab');
  await page.locator('.admin-company-row .company-delete').first().click();
  await page.waitForFunction(
    () => document.querySelector('#company-admin-status')?.textContent === 'Betrieb gelöscht.',
  );
  assert.equal(store.companies().length, 0);
  assert.deepEqual(store.assignments('g').assignments, {});
  assert.deepEqual(errors, []);
  console.log(
    'PASS learning modes, persistent progress, admin catalogue/audit, batch assignment, mobile and private isolation',
  );
} finally {
  await browser.close();
  app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
