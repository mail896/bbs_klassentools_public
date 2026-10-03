const { chromium } = require('playwright');
const assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let authenticated = false;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://apps.school.example/klassentools/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/api/session'))
      return route.fulfill({
        json: authenticated
          ? { authenticated: true, teacher: true, name: 'Test Teacher', csrf: 'test' }
          : { authenticated: false },
      });
    if (p.endsWith('/api/logout')) {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (p.endsWith('/api/classes')) return route.fulfill({ json: { classes: [] } });
    if (p.includes('/api/')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({
      path: path.join(
        process.env.KLASSENTOOLS_STAGED_DIR || path.join(__dirname, '../public'),
        p.endsWith('/') ? 'index.html' : path.basename(p),
      ),
    });
  });
  await page.goto('https://apps.school.example/klassentools/');
  await page.locator('#landing-demo').waitFor();
  assert.equal(await page.locator('#app-main').isVisible(), false);
  assert.equal(await page.locator('#landing-login').getAttribute('href'), './oidc/login');
  await page.screenshot({ path: '/tmp/klassentools-landing-light.png', fullPage: true });
  await page.selectOption('#theme', 'dark');
  await page.screenshot({ path: '/tmp/klassentools-landing-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/klassentools-landing-mobile.png', fullPage: true });
  for (const outcome of ['denied', 'failed']) {
    await page.goto('https://apps.school.example/klassentools/?login=' + outcome);
    await page.waitForFunction(
      () => document.querySelector('#landing-status').textContent.length > 0,
    );
    assert.equal(await page.locator('#landing-status').isVisible(), true);
    assert.match(
      await page.locator('#landing-status').textContent(),
      outcome === 'denied' ? /Lehrkräfte.*Mitglied/ : /Anmeldung konnte nicht bestätigt/,
    );
    assert.equal(await page.locator('#landing-status').getAttribute('role'), 'alert');
    assert.equal(await page.locator('#landing-status h2').isVisible(), true);
    assert.match(await page.locator('#landing-status').textContent(), /Mit einem Schülerkonto/);
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector('#landing-status').getBoundingClientRect().bottom <=
          document.querySelector('.landing-choices').getBoundingClientRect().top,
      ),
    );
    assert.equal(await page.locator('#app-main').isVisible(), false);
    assert.equal(new URL(page.url()).search, '');
  }
  await page.locator('#landing-demo').click();
  await page.waitForURL('**/?demo=1');
  assert.equal(await page.locator('#landing').isVisible(), false);
  assert.equal(await page.locator('#app-main').isVisible(), true);
  assert.equal(await page.locator('.person').count(), 24);
  await page.reload();
  assert.equal(await page.locator('#app-main').isVisible(), true);
  authenticated = true;
  await page.goto('https://apps.school.example/klassentools/');
  await page.waitForFunction(
    () => document.querySelector('#landing-login').getAttribute('href') === './?app=1',
  );
  await page.locator('#landing-demo').click();
  await page.waitForURL('**/?demo=1');
  assert.equal(authenticated, false);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS landing light/dark/mobile, anonymous demo entry and reload');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
