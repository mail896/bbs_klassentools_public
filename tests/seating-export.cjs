const { chromium } = require('playwright');
const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs');
const sharp = require('../backend/node_modules/sharp');
(async () => {
  const photo =
    'data:image/jpeg;base64,' +
    (
      await sharp({ create: { width: 100, height: 100, channels: 3, background: '#2288dd' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
  const browser = await chromium.launch({ headless: true }),
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('https://apps.school.example/klassentools/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.endsWith('/session'))
      return r.fulfill({
        json: { authenticated: true, teacher: true, name: 'Test Lehrkraft', csrf: 'test' },
      });
    if (p.endsWith('/classes'))
      return r.fulfill({ json: { classes: [{ id: 'test', name: 'TEST.a' }], rosterReady: true } });
    if (p.endsWith('/members'))
      return r.fulfill({
        json: {
          group: { name: 'TEST.a' },
          photosEnabled: true,
          updatedAt: Date.now(),
          members: Array.from({ length: 31 }, (_, i) => ({
            id: 's' + i,
            first: 'Test' + i,
            last: 'Beispiel',
            account: 'test.' + i,
          })),
        },
      });
    if (p.endsWith('/photos'))
      return r.fulfill({
        json: { revision: 1, total: 1, photos: [{ memberId: 's0', version: '1', data: photo }] },
      });
    if (p.endsWith('/seating'))
      return r.fulfill({
        json: {
          shared: { version: 1, revision: 0, plan: null },
          private: { version: 1, revision: 0, plan: null, name: 'test.lehrkraft.test.a.v1' },
          privateVersions: [],
        },
      });
    if (p.includes('/api/')) return r.fulfill({ json: { ok: true } });
    return r.fulfill({
      path: path.join(__dirname, '../public', p.endsWith('/') ? 'index.html' : path.basename(p)),
    });
  });
  await page.goto('https://apps.school.example/klassentools/?app=1');
  await page.locator('#class-select option[value=test]').waitFor({ state: 'attached' });
  await page.selectOption('#class-select', 'test');
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 31);
  await page.click('#seat-tab');
  await page.locator('#seat-plan-tools > summary').click();
  await page.locator('#seat-table-tools > summary').click();
  await page.click('#seat-fit');
  await page.waitForFunction(() => !document.querySelector('#seat-save').disabled);
  for (const [width, height] of [
    [1600, 1000],
    [2560, 1440],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(() => {
        const v = document.querySelector('#seat-viewport').getBoundingClientRect();
        return (
          v.bottom <= innerHeight &&
          [...document.querySelectorAll('.seat-table,.seat-front,#seat-teacher')].every((e) => {
            const b = e.getBoundingClientRect();
            return (
              b.top >= v.top - 1 &&
              b.left >= v.left - 1 &&
              b.right <= v.right + 1 &&
              b.bottom <= v.bottom + 1
            );
          })
        );
      }),
    );
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.click('#seat-detail');
  assert.equal(await page.locator('#seat-detail').getAttribute('aria-pressed'), 'true');
  await page.click('#seat-fit');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/klassentools-overview.png' });
  const downloadPromise = page.waitForEvent('download');
  await page.click('#seat-image');
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^Sitzplan-TEST.a-/);
  await download.saveAs('/tmp/klassentools-seat-export.png');
  const metadata = await sharp('/tmp/klassentools-seat-export.png').metadata();
  assert.ok(metadata.height > 2000 && metadata.height <= 4096);
  assert.ok(metadata.width >= 1200);
  const pixels = await sharp('/tmp/klassentools-seat-export.png').removeAlpha().raw().toBuffer();
  let blues = 0;
  for (let i = 0; i < pixels.length; i += 3)
    if (pixels[i] < 60 && pixels[i + 1] > 100 && pixels[i + 1] < 160 && pixels[i + 2] > 180)
      blues++;
  assert.ok(blues > 100, 'saved photo included in PNG');
  await page.evaluate(() => {
    window.print = () => {
      window.printCalls = (window.printCalls || 0) + 1;
    };
  });
  await page.click('#seat-print-button');
  await page.waitForFunction(() => window.printCalls === 1);
  assert.ok(await page.locator('#seat-print-image').getAttribute('src'));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#seating-panel').isVisible(), false);
  assert.equal(await page.locator('#seat-print').isVisible(), true);
  const pdf = await page.pdf({
    path: '/tmp/klassentools-seat-print.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
  await page.emulateMedia({ media: 'screen' });
  // Current edits must invalidate the prepared export, and unplaced students must remain represented.
  await page.locator('#seat-tables .seat-person').first().click();
  await page.click('#seat-unseat');
  assert.equal(await page.locator('#seat-unplaced-count').textContent(), '1');
  await page.click('#seat-print-button');
  await page.waitForFunction(() => window.printCalls === 2);
  assert.notEqual(
    await page.locator('#seat-print-image').getAttribute('src'),
    'data:image/jpeg;base64,' +
      fs.readFileSync('/tmp/klassentools-seat-export.png').toString('base64'),
  );
  await page.click('#seat-rows');
  await page.selectOption('#seat-row-count', '2');
  await page.click('#seat-print-button');
  await page.waitForFunction(() => window.printCalls === 3);
  assert.equal(
    await page.locator('#seat-print').evaluate((e) => e.classList.contains('seat-landscape')),
    true,
  );
  await page.emulateMedia({ media: 'print' });
  const landscape = await page.pdf({
    path: '/tmp/klassentools-seat-landscape.pdf',
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal((landscape.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    'PASS 31-seat overview at 3 screen sizes, detail toggle, PNG with photo, one-page portrait/landscape PDF, edits and mobile',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
