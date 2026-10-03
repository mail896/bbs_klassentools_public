const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const loaded = [],
      errors = [];
    let releaseModule, moduleRequested, moduleUrl;
    const requested = new Promise((resolve) => {
      moduleRequested = resolve;
    });
    const held = new Promise((resolve) => {
      releaseModule = resolve;
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://apps.school.example/klassentools/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/api/')) return route.fulfill({ json: { authenticated: false } });
      const file = url.pathname.endsWith('/') ? 'index.html' : path.basename(url.pathname);
      loaded.push(file);
      if (file === 'seating-ui.mjs') {
        moduleUrl = url.href;
        moduleRequested();
        await held;
      }
      return route.fulfill({ path: path.join(__dirname, '../public', file) });
    });
    await page.goto('https://apps.school.example/klassentools/');
    await page.locator('#landing').waitFor({ state: 'visible' });
    assert.equal(loaded.includes('seating-ui.mjs'), false);
    assert.equal(loaded.includes('seating-export.mjs'), false);
    assert.equal(loaded.includes('administration-ui.mjs'), false);
    await page.goto('https://apps.school.example/klassentools/?app=1');
    await page.locator('#grid .person').first().waitFor();
    await page.click('#seat-tab');
    await requested;
    await page.click('#team-tab');
    releaseModule();
    await page.evaluate((url) => import(url), moduleUrl);
    assert.equal(await page.locator('#team-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#seating-panel').isVisible(), false);
    // A new request waits for the same module, then opens the current class.
    await page.click('#seat-tab');
    await page.locator('#seating-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.seat-table').count(), 12);
    assert.equal(loaded.filter((name) => name === 'seating-ui.mjs').length, 1);
    await page.click('#team-tab');
    assert.equal(await page.locator('#seating-panel').isVisible(), false);
    assert.equal(loaded.includes('administration-ui.mjs'), false);
    assert.deepEqual(errors, []);
    console.log('PASS lazy modules: initial requests, pending navigation, reuse and tab switching');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
