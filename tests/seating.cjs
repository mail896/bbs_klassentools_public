const { chromium } = require('playwright');
const assert = require('node:assert/strict'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } }),
    errors = [];
  let signedIn = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('https://apps.school.example/klassentools/**', (r) => {
    const u = new URL(r.request().url());
    if (signedIn && u.pathname.endsWith('/session'))
      return r.fulfill({
        json: { authenticated: true, teacher: true, name: 'Test Lehrkraft', csrf: 'test' },
      });
    if (signedIn && u.pathname.endsWith('/classes'))
      return r.fulfill({
        json: { classes: [{ id: 'test-room', name: 'Testklasse' }], rosterReady: true },
      });
    if (signedIn && u.pathname.endsWith('/members'))
      return r.fulfill({
        json: {
          group: { name: 'Testklasse' },
          members: Array.from({ length: 31 }, (_, i) => ({
            id: 'member-' + i,
            first: 'Test' + i,
            last: 'Beispiel',
            account: 'test.' + i,
          })),
        },
      });
    if (u.pathname.includes('/api/')) return r.fulfill({ json: { authenticated: false } });
    return r.fulfill({
      path: path.join(
        __dirname,
        '../public',
        u.pathname.endsWith('/') ? 'index.html' : path.basename(u.pathname),
      ),
    });
  });
  await page.goto('https://apps.school.example/klassentools/?demo=1');
  await page.locator('.person').first().waitFor();
  await page.click('#seat-tab');
  await page.locator('#seat-plan-tools > summary').click();
  await page.locator('#seat-table-tools > summary').click();
  await page.click('#seat-fit');
  assert.equal(await page.locator('.seat-table').count(), 12);
  assert.equal(await page.locator('.seat-person[draggable=true]').count(), 24);
  const positions = () =>
    page
      .locator('#seat-tables .seat-person')
      .evaluateAll((es) => es.map((e) => e.dataset.seatPerson));
  const initial = await positions();
  assert.equal(await page.locator('.seat-vertical').count(), 8);
  await page.locator('[data-seat-rotate="0"]').click();
  assert.equal(await page.locator('.seat-vertical').count(), 7);
  assert.deepEqual(await positions(), initial);
  await page.locator('[data-seat-rotate="0"]').click();
  assert.equal(await page.locator('.seat-vertical').count(), 8);
  await page.selectOption('#seat-orientation', 'vertical');
  await page.click('#seat-add');
  assert.ok(
    await page
      .locator('.seat-table')
      .last()
      .evaluate((e) => e.classList.contains('seat-vertical')),
  );
  await page.click('#seat-remove');
  await page.selectOption('#seat-orientation', 'horizontal');
  // Read both positions in one browser frame: overview fitting may move the room.
  const orientation = await page.evaluate(() => ({
    boardY: document.querySelector('.seat-front').getBoundingClientRect().y,
    tableY: document.querySelector('.seat-table').getBoundingClientRect().y,
  }));
  assert.ok(orientation.boardY > orientation.tableY);
  const sides = await page
    .locator('.seat-table')
    .evaluateAll((es) =>
      es.map((e) => ({ x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight })),
    );
  assert.ok(
    sides.every((a, i) =>
      sides.every(
        (b, j) =>
          i === j || a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
      ),
    ),
  );
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1200 });
    const seatX = (await page.locator('.seat-canvas').boundingBox()).x;
    assert.equal(
      await page.locator('.seat-canvas').evaluate((e) => getComputedStyle(e).borderLeftWidth),
      '0px',
    );
    await page.click('#pick-tab');
    assert.equal((await page.locator('.stage').boundingBox()).x, seatX);
    await page.click('#seat-tab');
  }
  await page.setViewportSize({ width: 1600, height: 1200 });
  assert.equal(
    await page
      .locator('.seat-face')
      .first()
      .evaluate((e) => e.offsetWidth),
    76,
  );
  assert.equal(
    await page
      .locator('.seat-table')
      .first()
      .evaluate((e) => e.offsetWidth),
    186,
  );

  const teacher = page.locator('#seat-teacher');
  const teacherInitial = await teacher.evaluate((e) => parseFloat(e.style.left));
  await teacher.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await teacher.evaluate((e) => parseFloat(e.style.left)), teacherInitial + 20);
  const teacherBox = await teacher.boundingBox();
  await page.mouse.move(teacherBox.x + 40, teacherBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(teacherBox.x + 90, teacherBox.y + 40, { steps: 5 });
  await page.mouse.up();
  const teacherX = await teacher.evaluate((e) => parseFloat(e.style.left));
  assert.ok(teacherX > teacherInitial + 20);
  await page.click('#seat-save');
  await teacher.focus();
  await page.keyboard.press('ArrowRight');
  await page.click('#seat-restore');
  assert.equal(await teacher.evaluate((e) => parseFloat(e.style.left)), teacherX);
  for (let i = 0; i < 4; i++) await page.click('#seat-add');
  assert.equal(await page.locator('.seat-table').count(), 16);
  assert.equal(await page.locator('#seat-add').isDisabled(), true);
  await page.click('#seat-remove');
  assert.equal(await page.locator('#seat-add').isDisabled(), false);

  await page.locator('#seat-tables .seat-person').nth(0).click();
  await page.locator('#seat-tables .seat-person').nth(1).click();
  let changed = await positions();
  assert.equal(changed[0], initial[1]);
  assert.equal(changed[1], initial[0]);
  await page
    .locator('#seat-tables .seat-person')
    .nth(0)
    .dragTo(page.locator('#seat-tables .seat-person').nth(1));
  assert.deepEqual(await positions(), initial);
  await page.locator('.seat-pin').first().click();
  await page.click('#seat-random');
  assert.equal((await positions())[0], initial[0]);
  assert.equal(new Set(await positions()).size, 24);
  const shared = await positions();
  await page.click('#seat-copy');
  await page.click('#seat-random');
  assert.equal(await page.locator('#seat-plan').inputValue(), 'private');
  await page.selectOption('#seat-plan', 'shared');
  assert.deepEqual(await positions(), shared);
  await page.click('#seat-save');
  await page.click('#seat-random');
  await page.click('#seat-restore');
  assert.deepEqual(await positions(), shared);
  await page.click('#seat-add');
  assert.equal(await page.locator('.seat-table').count(), 13);
  await page.click('#seat-remove');
  assert.equal(await page.locator('.seat-table').count(), 12);
  await page.click('#seat-rows');
  const coords = () =>
    page
      .locator('.seat-table')
      .evaluateAll((es) =>
        es.map((e) => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) })),
      );
  for (const rows of [2, 4, 6, 3]) {
    await page.selectOption('#seat-row-count', String(rows));
    assert.equal(new Set((await coords()).map((t) => t.y)).size, rows);
  }
  await page.click('#seat-add');
  await page.click('#seat-add');
  const desks = await coords();
  assert.ok(
    desks.every((a, i) =>
      desks.every(
        (b, j) =>
          i === j || a.x + 260 <= b.x || b.x + 260 <= a.x || a.y + 185 <= b.y || b.y + 185 <= a.y,
      ),
    ),
  );
  assert.ok(
    await page
      .locator('#seat-room')
      .evaluate(
        (e) =>
          e.offsetHeight >
          Math.max(
            ...[...e.querySelectorAll('.seat-table')].map((t) => t.offsetTop + t.offsetHeight),
          ),
      ),
  );
  await page.click('#seat-remove');
  const controls = await page.locator('.seat-controls').boundingBox(),
    canvas = await page.locator('.seat-canvas').boundingBox(),
    nav = await page.locator('.main-tabs').boundingBox();
  assert.ok(controls.x < canvas.x);
  assert.ok(nav.y < canvas.y);
  assert.equal(await page.locator('.seat-front').textContent(), 'Tafel / Projektionsfläche');
  const handle = page.locator('.seat-handle').first();
  const x = await handle.evaluate((e) => parseFloat(e.closest('.seat-table').style.left));
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await handle.evaluate((e) => parseFloat(e.closest('.seat-table').style.left)),
    x + 20,
  );
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 85, box.y + 42, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(
    await handle.evaluate((e) => parseFloat(e.closest('.seat-table').style.left)),
    x + 20,
  );
  await page.selectOption('#seat-size', '1');
  assert.equal(await page.locator('.seat-table').count(), 24);
  assert.equal(await page.locator('#seat-tables .seat-person').count(), 24);
  await page.selectOption('#seat-size', '2');
  await page.click('#seat-u');
  await page.screenshot({ path: '/tmp/klassentools-seating-desktop.png', fullPage: true });
  await page.locator('#seat-tables .seat-person').first().click();
  await page.click('#seat-unseat');
  assert.equal(await page.locator('#seat-unplaced .seat-person').count(), 1);
  await page.locator('#seat-unplaced .seat-person').click();
  await page.locator('#seat-tables .seat-person[data-seat-person=""]').click();
  assert.equal(await page.locator('#seat-unplaced .seat-person').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.selectOption('#theme', 'dark');
  await page.screenshot({ path: '/tmp/klassentools-seating-mobile.png', fullPage: true });
  await page.click('#pick-tab');
  assert.equal(await page.locator('#seating-panel').isVisible(), false);
  assert.equal(await page.locator('.stage').isVisible(), true);
  await page.click('#seat-tab');
  assert.equal(await page.locator('.seat-table').count(), 12);
  await page.reload();
  await page.click('#seat-tab');
  assert.equal(
    await page.locator('#seat-plan option[value=private]').evaluate((e) => e.disabled),
    true,
  );
  assert.deepEqual(errors, []);
  signedIn = true;
  await page.goto('https://apps.school.example/klassentools/?app=1');
  await page.locator('#class-select option[value="test-room"]').waitFor({ state: 'attached' });
  await page.selectOption('#class-select', 'test-room');
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 31);
  await page.click('#seat-tab');
  assert.equal(await page.locator('.seat-table').count(), 16);
  assert.equal(await page.locator('#seat-tables .seat-person[draggable=true]').count(), 31);
  await page.selectOption('#class-select', '');
  assert.equal(await page.locator('.seat-table').count(), 12);
  assert.equal(
    (await page.locator('.seat-name > small').allTextContents()).includes('Beispiel'),
    false,
  );
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.click('#seat-tab');
  await page.waitForTimeout(50);
  await page.locator('#seat-plan-tools').evaluate((e) => {
    e.open = true;
  });
  await page.locator('#seat-table-tools').evaluate((e) => {
    e.open = true;
  });
  await page.click('#seat-fit');
  const occupantsBeforeGrowth = await positions();
  const roomSize = () =>
    page.locator('#seat-room').evaluate((e) => ({ w: e.offsetWidth, h: e.offsetHeight }));
  for (const [dx, dy] of [
    [-900, 0],
    [900, 0],
    [0, -1000],
    [0, 1000],
  ]) {
    await page.click('#seat-u');
    await page.waitForTimeout(50);
    const beforeSize = await roomSize();
    const grip = page.locator('[data-seat-desk="0"]');
    const rect = await grip.boundingBox();
    const other = await page.locator('.seat-table').nth(1).boundingBox();
    await page.mouse.move(rect.x + 15, rect.y + 10);
    await page.mouse.down();
    await page.mouse.move(rect.x + 15 + dx, rect.y + 10 + dy, { steps: 10 });
    const during = await page.locator('.seat-table').nth(1).boundingBox();
    assert.ok(
      Math.abs(during.x - other.x) < 2 && Math.abs(during.y - other.y) < 2,
      'stationary desks must not jump during drag',
    );
    await page.mouse.up();
    await page.waitForTimeout(50);
    const afterSize = await roomSize();
    assert.ok(
      dx ? afterSize.w > beforeSize.w : afterSize.h > beforeSize.h,
      `room expands past the old edge ${dx},${dy}: ${JSON.stringify(beforeSize)} -> ${JSON.stringify(afterSize)}`,
    );
    assert.deepEqual(await positions(), occupantsBeforeGrowth);
  }
  const grown = await roomSize();
  await page.click('#seat-save');
  await page.click('#seat-rows');
  await page.click('#seat-restore');
  assert.deepEqual(await roomSize(), grown);
  console.log(
    'PASS seating U, swaps, drag, fixed seats, copy, restore, table layouts, unplaced, mobile, reload',
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
