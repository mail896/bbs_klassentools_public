const { chromium } = require('playwright');
const path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [width, height, count] of [
    [1920, 1080, 31],
    [2560, 1440, 31],
    [6016, 3384, 31],
    [1366, 768, 31],
    [1920, 1080, 40],
    [1920, 1080, 60],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://apps.school.example/klassentools/**', (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith('/api/usage')) return route.fulfill({ json: { ok: true } });
      if (p.endsWith('/api/session'))
        return route.fulfill({
          json: { authenticated: true, teacher: true, name: 'Test Lehrkraft', csrf: 'fake' },
        });
      if (p.endsWith('/api/classes'))
        return route.fulfill({ json: { classes: [{ id: 'g', name: 'Testklasse' }] } });
      if (p.endsWith('/members'))
        return route.fulfill({
          json: {
            group: { name: 'Testklasse' },
            updatedAt: Date.now(),
            members: Array.from({ length: count }, (_, i) => ({
              id: 's' + i,
              account: 'test.' + i,
              first: 'Testname',
              last: 'Nachname' + i,
            })),
          },
        });
      if (p.endsWith('/companies'))
        return route.fulfill({ json: { companies: [], assignments: {}, revision: 0 } });
      return route.fulfill({
        path: path.join(
          process.env.KLASSENTOOLS_STAGED_DIR || path.join(__dirname, '../public'),
          p.endsWith('/') ? 'index.html' : path.basename(p),
        ),
      });
    });
    await page.goto('https://apps.school.example/klassentools/?app=1');
    await page.selectOption('#class-select', 'g');
    await page.waitForFunction((n) => document.querySelectorAll('.person').length === n, count);
    await page.click('#fullscreen');
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => ({
      height: innerHeight,
      width: innerWidth,
      bottom: Math.max(
        ...[...document.querySelectorAll('.person')].map((e) => e.getBoundingClientRect().bottom),
      ),
      square: [...document.querySelectorAll('.portrait')].every(
        (e) => Math.abs(e.getBoundingClientRect().width - e.getBoundingClientRect().height) < 2,
      ),
      overflow: document.documentElement.scrollWidth > innerWidth,
      bodyHeight: document.body.getBoundingClientRect().height,
    }));
    console.log(width, height, count, metrics);
    assert.ok(metrics.bottom < metrics.height - 20);
    assert.ok(metrics.square);
    assert.ok(metrics.bodyHeight <= height + 2, 'controls and footer fit');
    assert.ok(!metrics.overflow);
    assert.deepEqual(errors, []);
    await page.click('#fullscreen');
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#grid').evaluate((e) => e.style.gridTemplateColumns), '');
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
