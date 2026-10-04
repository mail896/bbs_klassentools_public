/* global document, innerWidth */
import { chromium } from 'playwright';
import { demoPeople } from '../public/demo.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('dist/pages');
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(
    /^\/bbs_klassentools_public\//,
    '/',
  );
  const file = resolve(root, '.' + name + (name.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + '/')) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.webp': 'image/webp',
      }[extname(file)] || 'application/octet-stream',
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  const base = `http://127.0.0.1:${server.address().port}/bbs_klassentools_public/`;
  await page.goto(base + 'demo/?demo=1');
  await page.locator('.person').first().waitFor();
  await page.selectOption('#theme', 'light');
  await page.screenshot({ animations: 'disabled', path: 'images/auswahl.png', fullPage: true });
  await page.uncheck('#animation');
  await page.click('#team-tab');
  await page.click('#start');
  await page.waitForTimeout(150);
  await page.screenshot({ animations: 'disabled', path: 'images/teams.png', fullPage: true });
  await page.click('#seat-tab');
  await page.click('#seat-fit');
  await page.waitForTimeout(100);
  await page.screenshot({ animations: 'disabled', path: 'images/sitzplan.png', fullPage: true });
  await page.click('#learn-tab');
  await page.screenshot({
    animations: 'disabled',
    path: 'images/lernen-start.png',
    fullPage: true,
  });
  await page.click('#learn-start');
  await page.locator('[data-answer]').first().waitFor();
  await page.screenshot({ animations: 'disabled', path: 'images/lernen.png', fullPage: true });
  await page.click('#learn-finish');
  await page.selectOption('#learn-mode', 'name-photo');
  await page.click('#learn-start');
  await page.locator('[data-answer]').first().waitFor();
  await page.screenshot({
    animations: 'disabled',
    path: 'images/lernen-name-foto.png',
    fullPage: true,
  });
  for (let index = 0; index < 10; index++) {
    await page.locator('[data-answer]').first().waitFor();
    const question = await page.locator('#learn-question h2').textContent();
    const target = demoPeople().find((p) => question === `Wer ist ${p.first} ${p.last}?`);
    assert.ok(target, 'Only authored DEMO names appear in screenshots');
    const answer =
      index === 9
        ? page.locator(`[data-answer]:not([data-answer="${target.id}"])`).first()
        : page.locator(`[data-answer="${target.id}"]`);
    await answer.click();
    if (index === 0)
      await page.screenshot({
        animations: 'disabled',
        path: 'images/lernen-rueckmeldung.png',
        fullPage: true,
      });
    await page.locator('#learn-next').click();
  }
  await page.locator('.learn-summary').waitFor();
  await page.screenshot({
    animations: 'disabled',
    path: 'images/lernen-ergebnis.png',
    fullPage: true,
  });
  await page.selectOption('#learn-mode', 'cards');
  await page.click('#learn-start');
  await page.click('#learn-flip');
  await page.waitForTimeout(600);
  await page.screenshot({
    animations: 'disabled',
    path: 'images/lernen-karte.png',
    fullPage: true,
  });
  await page.click('#learn-finish');
  await page.click('#learn-purpose-quiz');
  await page.selectOption('#learn-mode', 'photo-name');
  await page.click('#learn-start');
  await page.locator('#learn-timer:not([hidden])').waitFor();
  await page.screenshot({ animations: 'disabled', path: 'images/lernen-quiz.png', fullPage: true });
  await page.click('#learn-finish');
  await page.click('#pick-tab');
  await page.selectOption('#theme', 'dark');
  await page.screenshot({ animations: 'disabled', path: 'images/dunkel.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: 'images/mobil.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(base + 'demo/');
  await page.click('#landing-demo');
  await page.locator('.person').first().waitFor();
  assert.equal(
    requests.some((url) => /\/api\/|\/oidc\//.test(url)),
    false,
    'static demo must not contact API/login',
  );
  assert.equal(
    requests.some(
      (url) =>
        !url.startsWith('http://127.0.0.1:') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:'),
    ),
    false,
    'no external requests',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS Pages demo under repository subpath, mobile, teams, seating, no API or external requests. Synthetic screenshots generated.',
  );
} finally {
  await browser.close();
  server.close();
}
