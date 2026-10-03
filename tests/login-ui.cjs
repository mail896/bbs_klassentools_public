const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let authenticated = true;
  await page.route('https://apps.school.example/klassentools/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/usage')) return route.fulfill({ json: { ok: true } });
    if (url.pathname.endsWith('/api/session'))
      return route.fulfill({
        json: authenticated
          ? { authenticated: true, name: 'Test Lehrkraft', teacher: true, csrf: 'test' }
          : { authenticated: false },
      });
    if (url.pathname.endsWith('/api/classes'))
      return route.fulfill({ json: { classes: [], rosterReady: true } });
    if (url.pathname.endsWith('/api/logout')) {
      assert.equal(route.request().headers()['x-csrf-token'], 'test');
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (process.env.KLASSENTOOLS_STAGED_DIR) {
      const name = path.basename(url.pathname) || 'index.html';
      const file = path.join(
        process.env.KLASSENTOOLS_STAGED_DIR,
        name === 'klassentools' ? 'index.html' : name,
      );
      if (fs.existsSync(file)) return route.fulfill({ path: file });
    }
    return route.continue();
  });
  await page.goto('https://apps.school.example/klassentools/?login=ok');
  await page.waitForFunction(() =>
    document.querySelector('#auth-status').textContent.includes('Test Lehrkraft'),
  );
  assert.equal(await page.locator('#management').evaluate((e) => e.open), false);
  assert.equal(await page.locator('#auth-status').isVisible(), true);
  assert.equal(new URL(page.url()).search, '?app=1');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#manage').click();
  assert.equal(await page.locator('#management #logout').count(), 0);
  await page.locator('#management .close').click();
  await page.locator('#logout').click();
  await page.waitForFunction(() =>
    document.querySelector('#auth-status').textContent.includes('Nicht angemeldet'),
  );
  assert.equal(await page.locator('#login-link').isVisible(), true);
  assert.equal(new URL(page.url()).hostname, 'apps.school.example');
  console.log(
    'PASS: visible account, no login modal, mobile layout, separate photo dialog, logout without redirect',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
