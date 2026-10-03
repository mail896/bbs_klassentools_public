import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPhoto, matchPhotos } from '../public/photo-matching.mjs';
const roster = [
  { id: 'a', account: 'anna.mueller', first: 'Anna', last: 'Müller' },
  { id: 'b', account: 'kai.serschnitt', first: 'Kai', last: 'Serschnitt' },
];
test('Known account, reversed names and case are exact', () => {
  for (const name of ['anna.mueller.jpg', 'MÜLLER_Anna.PNG', 'Anna Müller.webp'])
    assert.equal(matchPhoto(name, roster).status, 'exact');
});
test('Typo and transliteration require confirmation; unrelated names stay unmatched', () => {
  assert.equal(matchPhoto('Kai.Serschnit.jpg', roster).status, 'suggestion');
  assert.equal(matchPhoto('Mueller_Anna.jpg', roster).status, 'suggestion');
  assert.equal(matchPhoto('Unbekannte Person.jpg', roster).status, 'unmatched');
});
test('Ambiguous people and duplicate files never auto assign', () => {
  assert.equal(
    matchPhoto('Anna Müller.jpg', [...roster, { ...roster[0], id: 'c', account: 'anna.mueller2' }])
      .status,
    'ambiguous',
  );
  assert.deepEqual(
    matchPhotos(['anna.mueller.jpg', 'Müller_Anna.png'], roster).map((r) => r.status),
    ['duplicate', 'duplicate'],
  );
});
test('Reject paths, invalid rosters and unsupported extensions', () => {
  assert.throws(() => matchPhoto('../Anna.jpg', roster));
  assert.throws(() => matchPhoto('Anna.jpg', [roster[0], roster[0]]));
  assert.equal(matchPhoto('Anna.svg', roster).status, 'unsupported');
});

test('Comma-separated names are exact but collisions remain open', () => {
  for (const name of [
    'Müller, Anna.jpg',
    'Müller,Anna.PNG',
    '  Müller,  Anna .webp',
    'Serschnitt, Kai.jpg',
  ])
    assert.equal(matchPhoto(name, roster).status, 'exact');
  assert.deepEqual(
    matchPhotos(['Müller, Anna.jpg', 'anna.mueller.jpg'], roster).map((r) => r.status),
    ['duplicate', 'duplicate'],
  );
  assert.equal(
    matchPhoto('Müller, Anna.jpg', [...roster, { ...roster[0], id: 'c', account: 'anna2' }]).status,
    'ambiguous',
  );
  assert.equal(matchPhoto('Müller, Anja.jpg', roster).status, 'suggestion');
});

test('Both name orders accept mixed separators without resolving ambiguities', () => {
  for (const name of [
    'Anna Müller',
    'Anna, Müller',
    'Anna_Müller',
    'Anna - Müller',
    'Anna–Müller',
    'Müller — Anna',
    'Müller._ Anna',
    '  Anna ,_ Müller  ',
  ])
    assert.equal(matchPhoto(name + '.jpg', roster).status, 'exact', name);
  const compound = [{ id: 'x', account: 'anna.maria', first: 'Anna-Maria', last: 'von Beispiel' }];
  assert.equal(matchPhoto('von_Beispiel, Anna Maria.jpg', compound).status, 'exact');
  assert.equal(
    matchPhoto('Anna Müller.jpg', [
      ...roster,
      { id: 'z', account: 'reverse', first: 'Müller', last: 'Anna' },
    ]).status,
    'ambiguous',
  );
});
