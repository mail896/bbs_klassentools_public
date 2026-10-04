const { chromium } = require('playwright');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://klassentools.test') return route.abort();
      if (url.pathname.includes('/api/'))
        return route.fulfill({
          json: url.pathname.endsWith('/session') ? { authenticated: false } : { ok: true },
        });
      const file = path.join(
        path.join(__dirname, '../public'),
        url.pathname.endsWith('/') ? 'index.html' : path.basename(url.pathname),
      );
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: file });
    });
    await page.goto('https://klassentools.test/?demo=1');
    await page.click('#learn-tab');

    await page.click('#learn-purpose-quiz');
    await page.selectOption('#learn-limit', 'time');
    await page.click('#learn-start');
    await page.locator('#learn-timer').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#learn-time-track').getAttribute('aria-valuemax'), '5');
    await page.waitForTimeout(3200);
    assert.equal(await page.locator('#learn-timer.is-ending').isVisible(), true);
    await page.screenshot({ path: '/tmp/quiz-countdown.png', fullPage: true });
    await page.locator('.learn-wrong').waitFor();
    assert.match(await page.locator('#learn-status').textContent(), /Zeit abgelaufen/);
    assert.match(await page.locator('#learn-count').textContent(), /1 beantwortet · 0 richtig/);
    assert.equal(await page.locator('#learn-timer').isVisible(), false);
    assert.match(await page.locator('#learn-clock').textContent(), /Pause/);
    await page.locator('#learn-timer').waitFor({ state: 'visible' });
    await page.click('#learn-finish');
    await page.locator('.learn-summary').waitFor();
    assert.equal(await page.locator('.learn-review-people > div').count(), 1);
    await page.selectOption('#learn-mode', 'typing');
    await page.selectOption('#learn-limit', '10');
    await page.click('#learn-start');
    await page.locator('#learn-timer').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#learn-time-track').getAttribute('aria-valuemax'), '20');
    await page.fill('#learn-input', 'Noch nicht gesendet');
    await page.waitForTimeout(5500);
    assert.equal(await page.locator('.learn-reveal').count(), 0);
    assert.equal(await page.locator('#learn-input').inputValue(), 'Noch nicht gesendet');
    await page.locator('.learn-wrong').waitFor();
    assert.match(await page.locator('#learn-status').textContent(), /Zeit abgelaufen/);
    await page.click('#learn-finish');
    await page.click('#learn-purpose-learn');
    await page.click('#learn-start');
    await page.waitForTimeout(5500);
    assert.equal(await page.locator('#learn-timer').isVisible(), false);
    assert.equal(await page.locator('.learn-reveal').count(), 0);
    await page.locator('[data-answer]').first().click();
    await page.locator('.learn-reveal').waitFor();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#learn-next').isVisible(), true);
    await page.click('#pick-tab');
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#learning-panel').isVisible(), false);
    console.log(
      'PASS quiz 5/10/20-second countdown, timeouts, feedback pause, review and untimed learning',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
