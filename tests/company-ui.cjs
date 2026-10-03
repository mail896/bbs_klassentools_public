const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://apps.school.example/klassentools/**', (r) => {
      const p = new URL(r.request().url()).pathname;
      if (p.includes('/api/')) return r.fulfill({ json: { authenticated: false } });
      return r.fulfill({
        path: path.join(__dirname, '../public', p.endsWith('/') ? 'index.html' : path.basename(p)),
      });
    });
    await page.goto('https://apps.school.example/klassentools/?app=1');
    await page.locator('#grid .person').first().waitFor();
    assert.equal(await page.locator('#grid .company-info').count(), 24);
    assert.equal(await page.locator('#grid .company-caption').first().isVisible(), false);
    await page.locator('#grid .company-info').first().click();
    assert.equal(await page.locator('#present-count').textContent(), '24');
    assert.equal(await page.locator('#company-tooltip').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#company-tooltip').isVisible(), false);
    await page.locator('#manage').focus();
    await page.locator('#grid .company-info').first().focus();
    assert.equal(await page.locator('#company-tooltip').isVisible(), true);
    await page.locator('.exports [data-show-companies]').check();
    assert.equal(await page.locator('#grid .company-caption').first().isVisible(), true);
    await page.screenshot({ path: '/tmp/v1113-companies.png', fullPage: true });
    await page.uncheck('#animation');
    await page.click('#start');
    await page.locator('#grid .chosen').waitFor();
    assert.equal(await page.locator('#grid .company-info').isEnabled(), true);
    await page.locator('#grid .company-info').click();
    assert.equal(await page.locator('#company-tooltip').isVisible(), true);
    await page.click('#team-tab');
    await page.click('#start');
    assert.equal(await page.locator('.team-person .company-info').count(), 24);
    await page.locator('.team-person .company-info').first().click();
    assert.equal(await page.locator('#company-tooltip').isVisible(), true);
    await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.fillText;
      window.drawn = [];
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        window.drawn.push(text);
        return original.call(this, text, ...args);
      };
    });
    await page.click('#seat-tab');
    await page.locator('.seat-table .company-info').first().click();
    assert.equal(await page.locator('.seat-selected').count(), 0);
    assert.equal(await page.locator('#company-tooltip').isVisible(), true);
    assert.equal(await page.locator('.seat-view-tools [data-show-companies]').isChecked(), true);
    assert.equal(await page.locator('.seat-name .company-caption').first().isVisible(), true);
    await page.click('#seat-fit');
    await page.screenshot({ path: '/tmp/v1113-company-seats.png', fullPage: true });
    // The locally rendered PNG contains labels only when enabled.
    const download = page.waitForEvent('download');
    await page.click('#seat-image');
    await download;
    assert.ok(
      await page.evaluate(() => window.drawn.some((s) => /Musterwerk|Beispieltechnik/.test(s))),
    );
    await page.locator('.seat-view-tools [data-show-companies]').uncheck();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.drawn = [];
    });
    const download2 = page.waitForEvent('download');
    await page.click('#seat-image');
    await download2;
    assert.equal(
      await page.evaluate(() => window.drawn.some((s) => /Musterwerk|Beispieltechnik/.test(s))),
      false,
    );
    await page.click('#learn-tab');
    await page.click('#learn-start');
    assert.equal(await page.locator('#learn-question .company-info').count(), 0);
    assert.ok(
      !/Musterwerk|Beispieltechnik|Demo-Handel|Lernwerkstatt/.test(
        await page.locator('#learn-question').innerText(),
      ),
    );
    await page.locator('[data-answer]').first().click();
    await page.locator('.learn-reveal').waitFor();
    assert.match(
      await page.locator('.learn-reveal').innerText(),
      /Musterwerk|Beispieltechnik|Demo-Handel|Lernwerkstatt/,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: company tooltip, independent attendance/seat controls, optional captions, team results, PNG opt-in, quiz concealment',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
