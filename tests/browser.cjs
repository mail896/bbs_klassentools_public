const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.KLASSENTOOLS_STAGED_DIR)
    await page.route('https://apps.school.example/klassentools/**', async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/api/usage'))
        return route.fulfill({ json: { ok: true } });
      const name = path.basename(new URL(route.request().url()).pathname) || 'index.html';
      const file = path.join(
        process.env.KLASSENTOOLS_STAGED_DIR,
        name === 'klassentools' ? 'index.html' : name,
      );
      if (!fs.existsSync(file)) return route.fulfill({ json: { authenticated: false } });
      const policies = {
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'",
      };
      const type = file.endsWith('.webp')
        ? 'image/webp'
        : file.endsWith('.png')
          ? 'image/png'
          : file.endsWith('.css')
            ? 'text/css'
            : file.endsWith('.html')
              ? 'text/html'
              : 'text/javascript';
      await route.fulfill({
        body: fs.readFileSync(file),
        headers: { 'content-type': type, ...policies },
      });
    });
  await page.addInitScript(() => {
    window.cspErrors = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspErrors.push(e.effectiveDirective),
    );
  });
  await page.goto('https://apps.school.example/klassentools/?app=1');
  assert.equal(await page.locator('.person').count(), 24);
  assert.equal(await page.locator('.demo-portrait').count(), 24);
  assert.equal(
    await page
      .locator('.demo-portrait')
      .evaluateAll((es) => new Set(es.map((e) => e.style.backgroundPosition)).size),
    24,
  );
  assert.equal(
    await page.evaluate(async () => {
      const img = new Image();
      img.src = './demo-portraits.webp';
      await img.decode();
      return img.naturalWidth === 1536 && img.naturalHeight === 1024;
    }),
    true,
  );
  assert.equal(await page.locator('#refresh-class').count(), 0);
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.selectOption('#theme', 'dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.reload();
  assert.equal(await page.locator('#theme').inputValue(), 'dark');
  await page.selectOption('#theme', 'auto');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(
    await page.locator('#plus').evaluate((e) => getComputedStyle(e).touchAction),
    'manipulation',
  );
  assert.equal(
    await page
      .locator('footer')
      .getByRole('link', { name: 'Marc Schulz', exact: true })
      .getAttribute('href'),
    'mailto:marc.schulz@bbs-einbeck.de',
  );
  for (const [name, href] of [
    ['Quelltext/Dokumentation', 'https://github.com/mail896/bbs_klassentools_public'],
    ['GitHub Pages', 'https://mail896.github.io/bbs_klassentools_public/'],
  ]) {
    const link = page.locator('.footer-project').getByRole('link', { name, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
  }
  assert.equal(
    await page.locator('.footer-project').evaluate((e) => getComputedStyle(e).textAlign),
    'right',
  );
  assert.ok((await page.locator('.dice-logo').boundingBox()).width <= 44);
  assert.match(await page.locator('link[rel="stylesheet"]').getAttribute('href'), /style.css\?v=/);
  assert.match(await page.locator('link[rel="icon"]').getAttribute('href'), /dice-bbs.png\?v=/);
  await page.screenshot({ path: '/tmp/klassentools-desktop.png', fullPage: true });
  // Even without the new stylesheet, intrinsic HTML dimensions prevent the giant logo.
  await page.locator('link[rel="stylesheet"]').evaluate((e) => (e.disabled = true));
  assert.equal((await page.locator('.dice-logo').boundingBox()).width, 44);
  await page.locator('link[rel="stylesheet"]').evaluate((e) => (e.disabled = false));
  // Reducing attendance clamps the draw; fewer than two cannot start.
  await page.locator('#pick-count').fill('10');
  for (let id = 2; id < 24; id++) await page.locator(`[data-id="${id}"]`).click();
  assert.equal(await page.locator('#pick-count').inputValue(), '1');
  assert.equal(await page.locator('#plus').isDisabled(), true);
  assert.equal(await page.locator('#start').isEnabled(), true);
  await page.locator('[data-id="1"]').click();
  assert.equal(await page.locator('#start').isDisabled(), true);
  assert.equal(await page.locator('#pick-count').inputValue(), '0');
  assert.equal(await page.locator('#pick-hint').isVisible(), true);
  await page.locator('[data-id="0"]').click();
  assert.equal(await page.locator('#start').isDisabled(), true);
  await page.locator('#all-present').click();
  assert.equal(await page.locator('#pick-count').inputValue(), '1');
  assert.equal(await page.locator('#start').isEnabled(), true);
  await page.locator('[data-id="0"]').click();
  assert.equal(await page.locator('#present-count').innerText(), '23');
  await page.locator('#pick-count').fill('3');
  await page.locator('#start').click();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.eliminated').count(), 0);
  assert.equal(
    await page
      .locator('.person:not(.absent)')
      .first()
      .evaluate((e) => getComputedStyle(e).opacity),
    '1',
  );
  await page.locator('#skip').click();
  assert.equal(await page.locator('.chosen').count(), 3);
  assert.equal(await page.locator('.chosen[data-id="0"]').count(), 0);
  const first = await page.locator('.chosen').evaluateAll((els) => els.map((e) => e.dataset.id));
  await page.locator('#animation').uncheck();
  await page.locator('#start').click();
  const second = await page.locator('.chosen').evaluateAll((els) => els.map((e) => e.dataset.id));
  assert.equal(first.filter((id) => second.includes(id)).length, 0);
  await page.reload();
  assert.match(await page.locator('#pool').innerText(), /18/);
  await page.locator('#team-tab').click();
  await page.locator('#team-count').fill('4');
  await page.locator('#start').click();
  assert.equal(await page.locator('.team').count(), 6);
  assert.equal(await page.locator('.team-person').count(), 24);
  await page.screenshot({ path: '/tmp/klassentools-teams.png', fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  await download.saveAs('/tmp/klassentools-test.csv');
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: '/tmp/klassentools-test.pdf', format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#back').click();
  await page.locator('#animation').check();
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelectorAll('.team').length === 6);
  assert.equal(await page.locator('#skip').isVisible(), false);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      'overflow ' + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#back').click();
  await page.screenshot({ path: '/tmp/klassentools-mobile.png', fullPage: true });
  await page.locator('#manage').click();
  assert.equal(await page.locator('#management').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#management').isVisible(), false);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator('#pick-tab').click();
  await page.locator('#pick-count').fill('1');
  await page.locator('#start').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.person:not(.absent):not(.eliminated)').length === 1,
  );
  assert.equal(
    await page.locator('#skip').isVisible(),
    true,
    'final survivor is held before reveal',
  );
  await page.waitForFunction(() => document.querySelector('.grid.result'));
  assert.equal(await page.locator('.chosen').count(), 1);
  assert.ok(
    await page
      .locator('.chosen')
      .evaluate((e) => e.getAnimations().some((a) => a.effect.getTiming().duration === 850)),
    'selected tile zooms from original position',
  );
  await page.waitForFunction(() => !document.querySelector('#start').disabled);
  assert.equal(await page.locator('.chosen').isDisabled(), true);
  assert.equal(
    await page.locator('.dice-logo').evaluate((e) => e.complete && e.naturalWidth > 0),
    true,
  );
  const fixture = fs.mkdtempSync('/tmp/klassentools-synthetic-');
  for (const name of ['Winter_Emma', 'Noah.Berger', 'Mia.Hoffmann', 'Fischer_Leon'])
    fs.copyFileSync(
      path.join(__dirname, '../public/dice-bbs.png'),
      path.join(fixture, name + '.png'),
    );
  await page.locator('#manage').click();
  const requests = [];
  page.on('request', (r) => {
    if (r.url().startsWith('http')) requests.push({ url: r.url(), body: r.postDataJSON() });
  });
  await page
    .locator('#local-files')
    .setInputFiles(fs.readdirSync(fixture).map((name) => path.join(fixture, name)));
  await page.waitForFunction(() => document.querySelectorAll('.portrait img').length === 4);
  assert.equal(await page.locator('#class-name').innerText(), 'Lokale Testklasse');
  assert.equal(
    await page
      .locator('.portrait img')
      .evaluateAll((es) => es.every((e) => e.complete && e.naturalWidth > 0)),
    true,
  );
  assert.ok((await page.locator('#grid').innerText()).includes('Emma'));
  await page.locator('#animation').uncheck();
  await page.locator('#start').click();
  assert.equal(await page.locator('.chosen img').count(), 1);
  await page.locator('#team-tab').click();
  await page.locator('#start').click();
  assert.equal(await page.locator('.team-person img').count(), 4);
  assert.ok(
    requests.every((r) => r.url.endsWith('/api/usage')),
    'local photo test only sends usage counters',
  );
  for (const r of requests) {
    assert.deepEqual(Object.keys(r.body).sort(), ['action', 'amount', 'classId', 'context', 'id']);
    assert.equal(r.body.classId, '');
    assert.equal(r.body.context, 'local');
  }
  assert.ok(requests.some((r) => r.body.action === 'local_import' && r.body.amount === 4));
  assert.equal(
    await page.evaluate(() => JSON.stringify(localStorage).includes('data:image')),
    false,
  );
  await page.reload();
  assert.equal(await page.locator('.person').count(), 24);
  assert.equal(await page.locator('.portrait img').count(), 0);
  for (let i = 4; i < 30; i++)
    fs.copyFileSync(
      path.join(__dirname, '../public/dice-bbs.png'),
      path.join(fixture, `Test${i}.Person.png`),
    );
  await page.locator('#manage').click();
  await page
    .locator('#local-files')
    .setInputFiles(fs.readdirSync(fixture).map((name) => path.join(fixture, name)));
  await page.waitForFunction(() => document.querySelectorAll('.portrait img').length === 30);
  assert.equal(
    await page
      .locator('#grid')
      .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length),
    8,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok(
    await page
      .locator('.person')
      .last()
      .evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight),
    '30 tiles fit in desktop viewport',
  );
  await page.screenshot({ path: '/tmp/klassentools-30-synthetic.png', fullPage: true });
  fs.rmSync(fixture, { recursive: true });
  assert.deepEqual(await page.evaluate(() => window.cspErrors), []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: attendance, draw, persistence, teams, animation, CSV, print, responsive, dialog; no browser errors',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
