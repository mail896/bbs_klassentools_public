const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('../backend/node_modules/sharp');
const root = path.resolve(__dirname, '../dist/pages');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'klassentools-pages-local-'));
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname.replace(
    /^\/bbs_klassentools_public\//,
    '/',
  );
  const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.png': 'image/png',
        '.webp': 'image/webp',
      }[path.extname(file)] || 'application/octet-stream',
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [],
      requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    const base = `http://127.0.0.1:${server.address().port}/bbs_klassentools_public/`;
    await page.goto(base + 'demo/?demo=1');
    assert.equal(await page.locator('.person').count(), 24);
    await page.click('#manage');
    assert.equal(await page.locator('#photo-title').textContent(), 'DEMO-Klasse');
    assert.equal(await page.locator('#local-files').isVisible(), false);
    assert.equal(await page.locator('#company-assignment').isVisible(), false);
    await page.click('#local-class-new');
    assert.equal(
      await page.locator('label[for="local-files"]').textContent(),
      'Einzelne Fotos auswählen',
    );
    for (const word of ['Fotos', 'Ordner'])
      assert.ok(
        await page
          .getByText(word, { exact: true })
          .evaluate((el) => Number(getComputedStyle(el).fontWeight) >= 600),
      );
    const jpg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#719bba' },
    })
      .jpeg()
      .toBuffer();
    await page.setInputFiles('#local-files', {
      name: 'Jana.Beispiel.JPG',
      mimeType: 'image/jpeg',
      buffer: jpg,
    });
    await page.locator('[data-local-first="0"]').waitFor();
    assert.equal(await page.locator('[data-local-first="0"]').inputValue(), 'Jana');
    await page.fill('#local-class-names', 'Alex Muster');
    await page.click('#local-class-apply');
    assert.equal(await page.locator('#grid .person').count(), 2);
    assert.equal(await page.locator('#grid .avatar-placeholder').count(), 1);
    await page.click('#manage');
    const choosing = page.waitForEvent('filechooser');
    await page.click('[data-local-photo="1"]');
    await (await choosing).setFiles({ name: 'IMG_1234.JPG', mimeType: 'image/jpeg', buffer: jpg });
    await page.waitForFunction(() =>
      document.querySelector('#local-class-status').textContent.includes('vorbereitet. Bitte'),
    );
    assert.equal(await page.locator('[data-local-first="1"]').inputValue(), 'Alex');
    await page.click('#local-class-apply');
    assert.equal(await page.locator('#grid .person').count(), 2);
    assert.equal(await page.locator('#grid .avatar-placeholder').count(), 0);
    await page.click('#learn-tab');
    await page.selectOption('#learn-mode', 'cards');
    await page.click('#learn-start');
    await page.click('#learn-flip');
    await page.waitForFunction(
      () => document.querySelector('#learn-flip').getAttribute('aria-pressed') === 'true',
    );
    await page.click('#learn-finish');
    await page.click('#pick-tab');
    await page.click('#learn-tab');
    assert.match(await page.locator('#learn-progress').textContent(), /^1 Namen angesehen/);
    await page.click('#pick-tab');
    await page.click('#manage');
    await page.click('[data-local-photo-remove="1"]');
    assert.equal(await page.locator('.local-roster-row').count(), 2);
    await page.click('#local-class-apply');
    assert.equal(await page.locator('#grid .avatar-placeholder').count(), 1);
    await page.click('#manage');
    const folder = path.join(fixture, 'synthetic-photos');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'Winter, Emma.JPG'), jpg);
    fs.writeFileSync(path.join(folder, 'Noah.Berger.jpg'), jpg);
    await page.setInputFiles('#local-photos', folder);
    await page.locator('[data-local-first="3"]').waitFor();
    await page.click('#local-class-apply');
    assert.equal(await page.locator('#grid .person').count(), 4);
    assert.match(await page.locator('#grid').textContent(), /Emma/);
    assert.equal(
      await page.evaluate(() => /Jana|Alex|Emma|data:image/.test(JSON.stringify(localStorage))),
      false,
    );
    await page.click('#manage');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const remove = page.locator('[data-local-remove="3"]');
    assert.equal(await remove.getAttribute('title'), 'Person entfernen');
    await remove.click();
    assert.equal(await page.locator('.local-roster-row').count(), 3);
    page.once('dialog', (d) => d.accept());
    await page.click('#local-class-back');
    assert.equal(await page.locator('#grid .person').count(), 24);
    await page.goto(base + 'demo/?demo=1&local=1');
    await page.locator('#local-class-editor').waitFor();
    await page.fill('#local-class-names', 'Robin Testname');
    await page.click('#local-class-apply');
    await page.reload();
    assert.equal(await page.locator('#grid .person').count(), 24);
    assert.equal(
      requests.some((url) => /\/api\/|\/oidc\//.test(url)),
      false,
    );
    assert.equal(
      requests.some(
        (url) => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:'),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS Pages: separate local class, JPG/folder import, later photo assignment/removal, session progress, mobile, reload, no API/upload/external requests',
    );
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  });
