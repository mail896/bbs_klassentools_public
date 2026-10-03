const { chromium } = require('playwright');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true }),
    page = await browser.newPage();
  const auditQueries = [];
  let manyGroups = false,
    releaseCompanySave;
  let authenticated = true,
    selected = ['g1'],
    revision = 'r1',
    saved = 0,
    conflict = false;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://apps.school.example/klassentools/**', async (route) => {
    const u = new URL(route.request().url()),
      p = u.pathname;
    if (p.endsWith('/api/usage')) return route.fulfill({ json: { ok: true } });
    if (p.endsWith('/api/admin/usage'))
      return route.fulfill({
        json: {
          totals: { views: 4, sessions: 2, teachers: 1, picks: 3, teams: 1 },
          access: [{ access: 'anonymous', sessions: 1, views: 2, imports: 1, photos: 26 }],
          networks: [{ network: 'school', sessions: 1, views: 2 }],
          teachers: [],
          teacherClasses: [],
          classes: [],
          recent: Array.from({ length: 45 }, (_, i) => ({
            time: Date.now(),
            actor_name: 'Nutzung ' + i,
            action: 'view',
            context: 'demo',
            amount: 1,
          })),
        },
      });
    if (p.endsWith('/api/session'))
      return route.fulfill({
        json: authenticated
          ? { authenticated: true, teacher: true, admin: true, name: 'Test Admin', csrf: 'csrf' }
          : { authenticated: false },
      });
    if (p.endsWith('/api/logout')) {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (p.endsWith('/api/admin/audit')) {
      auditQueries.push(u.searchParams.get('q'));
      return route.fulfill({
        json: {
          entries:
            u.searchParams.get('q') === 'niemand'
              ? []
              : [
                  {
                    class_id: 'g1',
                    time: '2026-09-25T08:00:00Z',
                    actor_name: 'Test Admin',
                    member_name: u.searchParams.has('before') ? 'Älteres Kind' : 'Test Kind',
                    action: 'upload',
                    revision: 1,
                  },
                ],
          next: u.searchParams.has('before') ? null : 123,
        },
      });
    }
    if (p.endsWith('/api/admin/companies')) {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => {
          releaseCompanySave = resolve;
        });
        return route.fulfill({ status: 500, json: { error: 'Alte Anfrage' } });
      }
      return route.fulfill({ json: { companies: [] } });
    }
    if (p.endsWith('/api/admin/learning-audit')) {
      const entries = Array.from({ length: u.searchParams.get('q') ? 1 : 45 }, (_, i) => ({
        time: Date.now() - i * 1000,
        actor: 'Lehrkraft ' + i,
        class_id: 'g1',
        action: 'Lernrunde beendet',
        detail: {
          mode: 'photo-name',
          limit: '10',
          names: 'full',
          right: 8,
          total: 10,
          accuracy: 80,
          complete: true,
        },
      }));
      return route.fulfill({ json: { entries, highscores: [] } });
    }
    if (p.endsWith('/api/admin/classes')) {
      if (route.request().method() === 'PUT') {
        assert.equal(route.request().headers()['x-csrf-token'], 'csrf');
        const body = route.request().postDataJSON();
        assert.equal(body.revision, revision);
        if (conflict)
          return route.fulfill({
            status: 409,
            json: { error: 'Zwischenzeitlich geändert. Bitte neu laden.' },
          });
        selected = body.selected;
        revision = 'r2';
        saved++;
        return route.fulfill({ json: { selected, revision } });
      }
      return route.fulfill({
        json: {
          groups: [
            { id: 'g1', name: 'DEMO A', account: 'demo.a' },
            { id: 'g2', name: 'DEMO B', account: 'demo.b' },
            { id: 'g3', name: '<img src=x onerror=alert(1)>', account: 'sicher' },
            ...(manyGroups
              ? Array.from({ length: 40 }, (_, i) => ({
                  id: 'extra' + i,
                  name: 'Weitere Gruppe ' + i,
                  account: 'weitere.' + i,
                }))
              : []),
          ],
          selected,
          revision,
        },
      });
    }
    if (p.endsWith('/api/classes'))
      return route.fulfill({
        json: { classes: selected.map((id) => ({ id, name: id === 'g1' ? 'DEMO A' : 'DEMO B' })) },
      });
    if (process.env.KLASSENTOOLS_STAGED_DIR) {
      const n = path.basename(p) || 'index.html',
        f = path.join(process.env.KLASSENTOOLS_STAGED_DIR, n === 'klassentools' ? 'index.html' : n);
      if (fs.existsSync(f)) return route.fulfill({ path: f });
    }
    return route.continue();
  });
  await page.goto('https://apps.school.example/klassentools/?app=1');
  await page.locator('#admin-open').click();
  await page.locator('[data-group-id="g1"]').waitFor();
  await page.locator('#admin-audit-tab').click();
  assert.equal(await page.locator('#audit-active').isChecked(), true);
  assert.equal(await page.locator('#audit-class option').count(), 2);
  await page.locator('#audit-active').uncheck();
  assert.equal(await page.locator('#audit-class option').count(), 4);
  await page.locator('#audit-class-search').fill('DEMO B');
  assert.equal(await page.locator('#audit-class option').count(), 2);
  await page.locator('#audit-class-search').fill('');
  await page.locator('#audit-active').check();
  await page.waitForFunction(() =>
    document.querySelector('#photo-audit').textContent.includes('Test Kind'),
  );
  assert.match(await page.locator('#photo-audit').textContent(), /DEMO A/);
  await page.selectOption('#audit-class', 'g1');
  await page.waitForFunction(() =>
    document.querySelector('#audit-status').textContent.includes('Einträge'),
  );
  await page.click('#more-photo-audit');
  await page.waitForFunction(
    () => document.querySelector('#photo-audit-page').textContent === 'Seite 2',
  );
  assert.equal(await page.locator('#photo-audit p').count(), 1);
  assert.match(await page.locator('#photo-audit').textContent(), /Älteres Kind/);
  assert.equal(await page.locator('#more-photo-audit').isDisabled(), true);
  await page.click('#previous-photo-audit');
  await page.waitForFunction(
    () => document.querySelector('#photo-audit-page').textContent === 'Seite 1',
  );
  assert.match(await page.locator('#photo-audit').textContent(), /Test Kind/);
  const adminUrl = page.url();
  await page.fill('#audit-query', 'niemand');
  await page.waitForFunction(() =>
    document
      .querySelector('#audit-status')
      .textContent.includes('Keine Änderungen für diese Filter'),
  );
  assert.equal(auditQueries.at(-1), 'niemand');
  const immediateSearch = page.waitForRequest(
    (r) =>
      r.url().includes('/api/admin/audit?') && new URL(r.url()).searchParams.get('q') === 'Test',
  );
  await page.fill('#audit-query', 'Test');
  await page.press('#audit-query', 'Enter');
  await immediateSearch;
  assert.equal(page.url(), adminUrl);
  await page.waitForFunction(() =>
    document.querySelector('#photo-audit').textContent.includes('Test Kind'),
  );
  await page.press('#audit-class-search', 'Enter');
  assert.equal(page.url(), adminUrl);
  await page.click('#audit-search-button');
  await page.click('#admin-companies-tab');
  await page.locator('#company-name').waitFor();
  const pendingSave = page.waitForRequest(
    (r) => r.url().includes('/api/admin/companies') && r.method() === 'POST',
  );
  await page.fill('#company-name', 'Testbetrieb');
  await page.click('#company-admin-save');
  await pendingSave;
  await page.click('#admin-classes-tab');
  releaseCompanySave();
  await page.click('#admin-companies-tab');
  await page.locator('#company-name').waitFor();
  assert.equal(await page.locator('#company-admin-status').textContent(), '');
  await page.click('#admin-learning-tab');
  const learnUrl = page.url();
  await page.locator('#learn-events-pages tbody tr').first().waitFor();
  assert.equal(await page.locator('#learn-events-pages tbody tr').count(), 20);
  await page.click('#learn-events-pages [data-page="next"]');
  assert.match(
    await page.locator('#learn-events-pages [role="status"]').textContent(),
    /Seite 2 von 3/,
  );
  assert.match(
    await page.locator('#learn-events-pages tbody tr').first().textContent(),
    /Lehrkraft 20/,
  );
  await page.click('#learn-events-pages [data-page="next"]');
  assert.equal(await page.locator('#learn-events-pages tbody tr').count(), 5);
  assert.equal(await page.locator('#learn-events-pages [data-page="next"]').isDisabled(), true);
  await page.click('#learn-events-pages [data-page="previous"]');
  assert.equal(await page.locator('#learn-events-pages tbody tr').count(), 20);
  await page.fill('#learn-audit-search', 'gezielt');
  await page.waitForFunction(
    () => document.querySelector('#learn-events-pages tbody')?.children.length === 1,
  );
  await page.press('#learn-audit-search', 'Enter');
  assert.equal(page.url(), learnUrl);
  await page.waitForFunction(() =>
    document
      .querySelector('#learn-events-pages [role="status"]')
      ?.textContent.includes('Seite 1 von 1'),
  );
  assert.equal(await page.locator('#learn-events-pages tbody tr').count(), 1);
  await page.locator('#admin-classes-tab').click();
  await page.locator('#admin-usage-tab').click();
  const activity = page
    .locator('#usage-content section')
    .filter({ has: page.getByRole('heading', { name: 'Letzte 100 Aktivitäten' }) });
  await activity.locator('tbody tr').first().waitFor();
  assert.equal(await activity.locator('tbody tr').count(), 20);
  await activity.locator('[data-page="next"]').click();
  assert.match(await activity.locator('tbody tr').first().textContent(), /Nutzung 20/);
  await activity.locator('[data-page="next"]').click();
  assert.equal(await activity.locator('tbody tr').count(), 5);
  await page.selectOption('#usage-days', '7');
  await page.waitForFunction(() =>
    document.querySelector('#usage-content [role="status"]')?.textContent.includes('Seite 1'),
  );

  assert.match(page.url(), /admin=usage/);
  await page.waitForFunction(() =>
    document.querySelector('#usage-status').textContent.includes('4 Aufrufe'),
  );
  assert.match(await page.locator('#usage-content').textContent(), /26/);
  assert.equal(await page.locator('#admin-dialog').evaluate((e) => e.tagName), 'SECTION');
  assert.ok(
    (await page.locator('footer').boundingBox()).y >
      (await page.locator('#admin-dialog').boundingBox()).y,
  );
  await page.screenshot({ path: '/tmp/klassentools-admin-page.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#admin-classes-tab').click();
  assert.equal(await page.locator('#admin-save').isDisabled(), true);
  assert.equal(await page.locator('#admin-groups img').count(), 0);
  await page.locator('#admin-search').fill('DEMO B');
  assert.equal(await page.locator('.admin-group').count(), 1);
  await page.locator('[data-group-id="g2"]').check();
  await page.locator('#admin-save').click();
  await page.waitForFunction(() =>
    document.querySelector('#admin-status').textContent.includes('gespeichert'),
  );
  assert.equal(await page.locator('#admin-dialog').isVisible(), true);
  assert.equal(saved, 1);
  assert.deepEqual(selected, ['g1', 'g2']);
  await page.reload();
  await page.locator('[data-group-id="g2"]').waitFor();
  await page.locator('#admin-search').fill('');
  await page.locator('#admin-only-selected').check();
  assert.equal(await page.locator('.admin-group').count(), 2);
  manyGroups = true;
  await page.locator('#admin-only-selected').uncheck();
  await page.click('#admin-reload');
  await page.waitForFunction(() =>
    document.querySelector('#admin-count').textContent.includes('43 passende'),
  );
  assert.equal(await page.locator('.admin-group').count(), 20);
  await page.click('#admin-groups [data-page="next"]');
  await page.click('#admin-groups [data-page="next"]');
  assert.equal(await page.locator('.admin-group').count(), 3);
  await page.locator('[data-group-id="extra39"]').check();
  assert.match(await page.locator('#admin-groups [role="status"]').textContent(), /Seite 3/);
  await page.fill('#admin-search', 'DEMO');
  assert.match(await page.locator('#admin-groups [role="status"]').textContent(), /Seite 1/);
  assert.match(await page.locator('#admin-count').textContent(), /3 als Klasse/);
  await page.fill('#admin-search', 'Weitere Gruppe 39');
  assert.equal(await page.locator('[data-group-id="extra39"]').isChecked(), true);
  await page.locator('[data-group-id="extra39"]').uncheck();
  await page.fill('#admin-search', 'DEMO');
  conflict = true;
  await page.locator('[data-group-id="g2"]').click();
  await page.locator('#admin-save').click();
  await page.waitForFunction(() =>
    document.querySelector('#admin-status').textContent.includes('Zwischenzeitlich'),
  );
  assert.equal(saved, 1);
  assert.equal(await page.locator('#admin-dialog').isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  page.on('dialog', (d) => d.accept());
  await page.locator('#admin-classes-panel [data-admin-back]').click();
  await page.waitForURL('https://apps.school.example/klassentools/?app=1');
  await page.locator('#logout').click();
  await page.waitForFunction(() => document.querySelector('#admin-open').hidden);
  assert.equal(await page.locator('#admin-groups').textContent(), '');
  await page.goto('https://apps.school.example/klassentools/?admin=usage');
  await page.locator('#admin-access').waitFor();
  assert.equal(await page.locator('#admin-dialog').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS admin selection, search retains hidden choices, save, conflict, escaped names, mobile, logout',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
