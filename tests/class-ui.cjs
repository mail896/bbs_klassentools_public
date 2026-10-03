const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let authenticated = true,
    failed = false,
    loads = 0;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://apps.school.example/klassentools/**', async (route) => {
    const u = new URL(route.request().url()),
      p = u.pathname;
    if (p.endsWith('/companies'))
      return route.fulfill({ json: { companies: [], assignments: {}, revision: 0 } });
    if (p.endsWith('/api/usage')) return route.fulfill({ json: { ok: true } });
    if (p.endsWith('/api/session'))
      return route.fulfill({
        json: authenticated
          ? { authenticated: true, teacher: true, name: 'Test Lehrkraft', csrf: 'test' }
          : { authenticated: false },
      });
    if (p.endsWith('/api/logout')) {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (p.endsWith('/api/classes'))
      return route.fulfill({
        json: { classes: [{ id: 'demo-group', name: 'Testklasse' }], rosterReady: true },
      });
    if (p.endsWith('/members')) {
      loads++;
      return route.fulfill(
        failed
          ? { status: 403, json: { error: 'Kein Zugriff auf diese Klasse.' } }
          : {
              json: {
                group: { name: 'Testklasse' },
                updatedAt: Date.now(),
                members: Array.from({ length: 6 }, (_, i) => ({
                  id: 'uuid-' + i,
                  account: 'demo.' + i,
                  first: 'Synthetisch' + i,
                  last: 'Testperson',
                })),
              },
            },
      );
    }
    if (process.env.KLASSENTOOLS_STAGED_DIR) {
      const name = path.basename(p) || 'index.html';
      const f = path.join(
        process.env.KLASSENTOOLS_STAGED_DIR,
        name === 'klassentools' ? 'index.html' : name,
      );
      if (fs.existsSync(f)) return route.fulfill({ path: f });
    }
    return route.continue();
  });
  await page.goto('https://apps.school.example/klassentools/?app=1');
  await page.locator('#class-select option[value="demo-group"]').waitFor({ state: 'attached' });
  await page.selectOption('#class-select', 'demo-group');
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 6);
  assert.equal(await page.locator('#class-name').textContent(), 'Testklasse');
  assert.equal(await page.locator('.avatar-placeholder').count(), 6);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.avatar-placeholder')].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.equal(
    await page
      .locator('.avatar-placeholder')
      .evaluateAll((es) => es.every((e) => e.complete && e.naturalWidth > 0)),
    true,
  );
  await page.locator('#manage').click();
  const photo = fs.readFileSync(path.join(__dirname, '../public/dice-bbs.png'));
  await page.locator('#local-files').setInputFiles([
    { name: 'demo.0.png', mimeType: 'image/png', buffer: photo },
    { name: 'unbekannt.png', mimeType: 'image/png', buffer: photo },
  ]);
  await page.locator('#apply-photos').waitFor();
  assert.equal(await page.locator('[data-photo-index="0"]').inputValue(), '0');
  assert.equal(await page.locator('[data-photo-index="1"]').inputValue(), '');
  assert.equal(await page.locator('.photo-review-row:visible').count(), 1);
  await page.uncheck('#photo-review-open-only');
  assert.equal(await page.locator('.photo-review-row[data-state=ready]').count(), 1);
  assert.equal(await page.locator('.photo-review-row[data-state=open]').count(), 1);
  await page.selectOption('[data-photo-index="1"]', '0');
  await page.locator('#apply-photos').click();
  assert.ok((await page.locator('#import-status').textContent()).includes('nur ein Foto'));
  await page.selectOption('[data-photo-index="1"]', '1');
  await page.locator('#apply-photos').click();
  assert.equal(await page.locator('#management').evaluate((e) => e.open), false);
  assert.equal(await page.locator('#class-select').inputValue(), 'demo-group');
  assert.equal(await page.locator('#class-name').textContent(), 'Testklasse');
  assert.equal(await page.locator('.person').count(), 6);
  assert.equal(await page.locator('.portrait img:not(.avatar-placeholder)').count(), 2);
  await page.uncheck('#animation');
  await page.locator('#start').click();
  assert.equal(await page.locator('.chosen').count(), 1);
  assert.equal(
    await page.evaluate(() => JSON.stringify(localStorage).includes('Synthetisch')),
    false,
  );
  await page.selectOption('#class-select', '');
  await page.selectOption('#class-select', 'demo-group');
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 6);
  assert.equal(loads, 1);
  failed = true;
  await page.reload();
  await page.locator('#class-select option[value="demo-group"]').waitFor({ state: 'attached' });
  await page.selectOption('#class-select', '');
  await page.selectOption('#class-select', 'demo-group');
  await page.waitForFunction(() =>
    document.querySelector('#class-status').textContent.includes('Kein Zugriff'),
  );
  assert.equal(await page.locator('.person').count(), 24);
  assert.equal(
    await page
      .locator('body')
      .textContent()
      .then((s) => s.includes('Synthetisch')),
    false,
  );
  failed = false;
  await page.selectOption('#class-select', 'demo-group');
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 6);
  await page.locator('#logout').click();
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 24);
  assert.equal(await page.locator('#iserv-classes').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS class load, draw, roster reuse until reload, no persistent names, denied access clears roster, logout clears roster',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
