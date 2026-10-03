import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draw, drawChances, groupSizes, shuffle } from '../public/logic.mjs';
test('Gruppen sind vollständig, ausgeglichen und mindestens zwei Personen groß', () => {
  for (let n = 4; n <= 60; n++)
    for (let value = 2; value <= Math.floor(n / 2); value++)
      for (const method of ['size', 'count']) {
        const sizes = groupSizes(n, value, method);
        assert.equal(
          sizes.reduce((a, b) => a + b, 0),
          n,
        );
        assert.ok(Math.min(...sizes) >= 2);
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
        assert.ok(sizes.length >= 2);
        if (method === 'count') assert.equal(sizes.length, value);
      }
});
test('Ziehung ohne Wiederholung sowie Übergang in die nächste Runde', () => {
  let seen = [];
  let picks = [];
  for (let i = 0; i < 8; i++) {
    const r = draw(
      Array.from({ length: 24 }, (_, j) => j),
      seen,
      3,
      true,
    );
    seen = r.seen;
    picks.push(...r.selected);
  }
  assert.equal(new Set(picks).size, 24);
  const r = draw([0, 1, 2, 3, 4], [0, 1, 2, 3], 3, true);
  assert.equal(r.selected[0], 4);
  assert.equal(new Set(r.selected).size, 3);
  assert.equal(r.seen.length, 2);
  assert.equal(r.crossed, true);
});
test('Abwesende werden nie gezogen; fehlerhafte Eingaben werden abgewiesen', () => {
  for (let i = 0; i < 100; i++) {
    const chosen = draw([2, 4, 6], [], 2, true).selected;
    assert.equal(chosen.length, 2);
    assert.ok(chosen.every((id) => [2, 4, 6].includes(id)));
  }
  for (const value of [0, -1, 1.5, NaN, 3, 4])
    assert.throws(() => draw([1, 2, 3], [], value, true));
  assert.throws(() => groupSizes(3, 2, 'size'));
  assert.throws(() => groupSizes(24, 13, 'count'));
});
test('Mischen verändert die Quelle nicht und erhält alle Personen', () => {
  const ids = [1, 2, 3, 4];
  assert.deepEqual([...shuffle(ids)].sort(), ids);
  assert.deepEqual(ids, [1, 2, 3, 4]);
});

test('Mindestens eine anwesende Person bleibt übrig, auch mit Rundenwechsel', () => {
  for (const fair of [true, false]) {
    assert.equal(draw([1, 2], [1], 1, fair).selected.length, 1);
    for (const ids of [[], [1], [1, 2]]) assert.throws(() => draw(ids, [], ids.length, fair));
    assert.throws(() => draw([1], [], 1, fair));
    assert.equal(draw([1, 2, 3], [1, 2], 2, fair).selected.length, 2);
  }
});

test('Chancen berücksichtigen Lostopf, Abwesenheit und Rundenübergang', () => {
  const ids = Array.from({ length: 24 }, (_, i) => i);
  assert.equal(drawChances(ids, [], 3, false).chance, 0.125);
  assert.deepEqual(drawChances(ids, ids.slice(0, 12), 3, true), {
    available: 12,
    fresh: false,
    chance: 0.25,
    previous: 0,
  });
  assert.deepEqual(drawChances([0, 1, 2, 3, 4], [0, 1, 2, 3], 3, true), {
    available: 1,
    fresh: false,
    chance: 1,
    previous: 0.5,
  });
  assert.deepEqual(drawChances([0, 1, 2], [0, 1, 2, 99], 1, true), {
    available: 3,
    fresh: true,
    chance: 1 / 3,
    previous: null,
  });
  assert.equal(drawChances([2, 4], [], 1, true).chance, 0.5);
  assert.equal(drawChances([0, 1, 2], [0], 2, true).previous, 0);
  assert.throws(() => drawChances([0], [], 1, true));
});
