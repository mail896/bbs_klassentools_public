import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRound,
  nextQuestion,
  answerQuestion,
  matchesName,
  label,
} from '../public/learning-core.mjs';
import { photoStore } from '../backend/photos.mjs';
import { createApp } from '../backend/server.mjs';
const people = [
  { id: 'a', first: 'Anna', last: 'Müller', hasPhoto: true, company: 'Werk' },
  { id: 'b', first: 'Anna', last: 'Meier', hasPhoto: true, company: 'Handel' },
  { id: 'c', first: 'Tim', last: 'Test', hasPhoto: false, company: '' },
];
const settings = { mode: 'photo-name', names: 'full', limit: 'class' };
test('learning excludes missing photos, disambiguates names and accepts only unambiguous small typos', () => {
  assert.equal(label(people[0], 'first', people), 'Anna Müller');
  assert.equal(label(people[2], 'first', people), 'Tim');
  assert.ok(matchesName(' Anna-Muller ', 'Anna Müller', ['Anna Müller', 'Anna Meier']));
  assert.ok(matchesName('Anna Müler', 'Anna Müller', ['Anna Müller']));
  assert.equal(matchesName('Anna Meier', 'Anna Müller', ['Anna Müller', 'Anna Meier']), false);
  assert.equal(matchesName('Maira', 'Maria', ['Maria', 'Maira']), false);
  assert.equal(matchesName('Ti', 'Tim', ['Tim']), false);
  assert.throws(() => createRound([], settings));
  const r = createRound(people, settings, 0),
    p = {};
  nextQuestion(r, p, 0, () => 0);
  assert.equal(r.goal, 2);
  assert.equal(r.current.id, 'a');
  answerQuestion(r, p, 'wrong', 1);
  answerQuestion(r, p, 'a', 2);
  assert.equal(r.answered, 1);
  assert.equal(p['a|photo-name|full'].wrong, 1);
  assert.equal(p['a|photo-name|full'].due, 120001);
  nextQuestion(r, p, 3, () => 0);
  assert.equal(r.current.id, 'b');
  answerQuestion(r, p, 'b', 4);
  nextQuestion(r, p, 5);
  assert.equal(r.done, true);
  assert.equal(r.correct, 1);
  assert.equal(p['b|photo-name|full'].due, 86400004);
});
test('timer closes without late answer credit; repeated errors increase selection likelihood', () => {
  const r = createRound(people, { ...settings, limit: 'time' }, 0),
    p = {};
  nextQuestion(r, p, 0);
  answerQuestion(r, p, r.current.id, 60000);
  assert.equal(r.done, true);
  assert.equal(r.correct, 0);
  const trained = { 'a|photo-name|full': { wrong: 10, due: 1000000 } };
  const weighted = createRound(people, { ...settings, limit: '10' }, 0);
  nextQuestion(weighted, trained, 0, () => 0.7);
  assert.equal(weighted.current.id, 'a');
});
test('learning storage persists privately, retries are idempotent and only completed scored rounds rank', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'learning-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.sqlite');
  let db = photoStore(file);
  const now = Date.now();
  let r = db.startLearning('g', 'teacherA', 'Teacher', people, settings, now);
  const answer = { id: r.id, index: 0, action: 'answer', answer: r.question.id };
  r = db.learningAction('g', 'teacherA', answer, now + 1000);
  db.learningAction('g', 'teacherA', answer, now + 1001);
  assert.equal(Object.values(db.learningProgress('g', 'teacherA'))[0].right, 1);
  assert.deepEqual(db.learningProgress('g', 'teacherB'), {});
  assert.throws(
    () => db.learningAction('g', 'teacherB', { ...answer, index: 1 }),
    (e) => e.status === 404,
  );
  r = db.learningAction('g', 'teacherA', { id: r.id, index: 1, action: 'next' }, now + 2000);
  r = db.learningAction(
    'g',
    'teacherA',
    { id: r.id, index: 1, action: 'answer', answer: r.question.id },
    now + 3000,
  );
  r = db.learningAction('g', 'teacherA', { id: r.id, index: 2, action: 'next' }, now + 4000);
  assert.equal(r.done, true);
  assert.equal(db.learningAudit('g').highscores.length, 1);
  db.learningAction('g', 'teacherA', { id: r.id, index: 2, action: 'finish' }, now + 4001);
  assert.equal(db.learningAudit('g').entries.length, 1);
  let cards = db.startLearning(
    'g',
    'teacherB',
    'Teacher',
    people,
    { ...settings, mode: 'cards' },
    now,
  );
  for (let i = 0; i < 2; i++) {
    cards = db.learningAction(
      'g',
      'teacherB',
      { id: cards.id, index: i, action: 'answer', answer: true },
      now + 10,
    );
    cards = db.learningAction(
      'g',
      'teacherB',
      { id: cards.id, index: i + 1, action: 'next' },
      now + 20,
    );
  }
  assert.equal(db.learningAudit('g').highscores.length, 1);
  const b = db.startLearning('g', 'teacherB', 'Teacher', people, settings, now);
  db.learningAction('g', 'teacherB', { id: b.id, index: 0, action: 'finish' }, now + 100);
  assert.equal(db.learningAudit('g').highscores.length, 1);
  db.close();
  db = photoStore(file);
  assert.equal(Object.keys(db.learningProgress('g', 'teacherA')).length, 2);
  db.resetLearning('g', 'teacherB', 'Teacher');
  assert.equal(Object.keys(db.learningProgress('g', 'teacherA')).length, 2);
  db.close();
});
test('company catalog and assignments validate revisions, active state, membership and atomic audit', () => {
  const db = photoStore(':memory:');
  const [c] = db.saveCompany(
    { revision: 0, name: 'Beispielwerk', city: 'Einbeck', short: 'Werk', active: true },
    'Admin',
  );
  const assigned = db.saveAssignments(
    'g',
    { revision: 0, assignments: { a: c.id } },
    [{ id: 'a', name: 'Anna' }],
    'Teacher',
  );
  assert.equal(assigned.assignments.a, c.id);
  assert.throws(
    () =>
      db.saveAssignments('g', { revision: 0, assignments: { a: '' } }, [{ id: 'a' }], 'Teacher'),
    (e) => e.status === 409,
  );
  const count = db.learningAudit().entries.length;
  assert.throws(() =>
    db.saveAssignments(
      'g',
      { revision: 1, assignments: { a: '', foreign: c.id } },
      [{ id: 'a' }],
      'Teacher',
    ),
  );
  assert.equal(db.learningAudit().entries.length, count);
  assert.equal(db.assignments('g').assignments.a, c.id);
  db.saveCompany({ ...c, revision: 1, active: false }, 'Admin');
  assert.throws(() =>
    db.saveAssignments('g', { revision: 1, assignments: { b: c.id } }, [{ id: 'b' }], 'Teacher'),
  );
  db.saveAssignments('g', { revision: 1, assignments: { a: c.id } }, [{ id: 'a' }], 'Teacher');
  assert.equal(db.assignments('g').revision, 2);
  assert.throws(
    () => db.saveCompany({ id: {}, revision: 0, name: 'x', active: true }, 'Admin'),
    (e) => e.status === 400,
  );
  db.close();
});
test('learning API protects admin ranking, CSRF, class membership and personal round ownership', async (t) => {
  const db = photoStore(':memory:');
  t.after(() => db.close());
  const admin = '11111111-1111-4111-8111-111111111111';
  let info = {
      uuid: admin,
      name: 'Admin',
      'iserv:roles': [{ uuid: 'teacher', displayName: 'Teacher' }],
    },
    member = true;
  const provider = {
    begin: async () => ({ state: 'ok', url: 'https://example.invalid' }),
    complete: async () => ({ info, expires: Date.now() + 3600000 }),
    refresh: async () => info,
  };
  const app = createApp({
    getProvider: async () => provider,
    teacherUuid: 'teacher',
    studentUuid: 'student',
    catalog: ['Test'],
    adminUsers: [admin],
    photos: db,
    getIdmToken: async () => 'test',
    idm: {
      groups: async () => (member ? [{ hexUuid: 'g', group: 'test', name: 'Test' }] : []),
      members: async () => [
        {
          hexUuid: 'a',
          user: 'anna',
          firstname: 'Anna',
          lastname: 'Müller',
          roles: [{ hexUuid: 'student' }],
        },
      ],
    },
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}/klassentools/`;
  const call = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options });
  const login = async () => {
    let r = await call('oidc/login');
    const tx = r.headers.getSetCookie()[0].split(';')[0];
    r = await call('oidc/callback?state=ok&code=x', { headers: { cookie: tx } });
    const cookie = r.headers
      .getSetCookie()
      .find((x) => x.startsWith('__Secure-klassentools-session='))
      .split(';')[0];
    const session = await (await call('api/session', { headers: { cookie } })).json();
    return {
      cookie,
      origin: 'https://apps.school.example',
      'content-type': 'application/json',
      'x-csrf-token': session.csrf,
    };
  };
  const path = 'api/classes/g/learning';
  assert.equal((await call(path)).status, 401);
  let headers = await login();
  const post = (body, extra = {}) =>
    call(path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  assert.equal(
    (await post({ action: 'start', settings }, { 'x-csrf-token': 'wrong' })).status,
    403,
  );
  assert.equal((await post({ action: 'start', settings })).status, 400);
  db.mutate({
    group: 'g',
    expected: 0,
    actor: { id: admin, name: 'Admin' },
    upserts: [{ id: 'a', image: Buffer.from('test') }],
    members: new Map([['a', 'Anna Müller']]),
  });
  let r = await post({ action: 'start', settings });
  assert.equal(r.status, 200);
  const round = await r.json();
  r = await post({ id: round.id, index: 0, action: 'answer', answer: 'a' });
  assert.equal(r.status, 200);
  await post({ id: round.id, index: 1, action: 'next' });
  assert.equal((await call('api/admin/learning-audit', { headers })).status, 200);
  info = { ...info, uuid: '22222222-2222-4222-8222-222222222222', name: 'Teacher' };
  headers = await login();
  assert.equal((await call('api/admin/learning-audit', { headers })).status, 403);
  assert.equal((await call('api/admin/companies', { headers })).status, 403);
  assert.equal(
    (
      await call('api/admin/companies', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'delete', id: 'fake', revision: 1 }),
      })
    ).status,
    403,
  );
  assert.deepEqual((await (await call(path, { headers })).json()).progress, {});
  assert.equal((await post({ id: round.id, index: 1, action: 'finish' })).status, 404);
  assert.equal((await post({ id: {}, index: 0, action: 'answer', answer: 'a' })).status, 400);
  member = false;
  assert.equal((await call(path, { headers })).status, 403);
  assert.equal((await call('api/classes/g/companies', { headers })).status, 403);
  member = true;
  info = { ...info, 'iserv:roles': [] };
  assert.equal((await call(path, { headers })).status, 403);
});

test('learning retention removes expired rounds and results but preserves progress and company audit', () => {
  const db = photoStore(':memory:');
  const now = Date.now();
  const round = db.startLearning('g', 'owner', 'Teacher', people, settings, now);
  db.learningAction(
    'g',
    'owner',
    { id: round.id, index: 0, action: 'answer', answer: round.question.id },
    now + 1,
  );
  db.learningAction('g', 'owner', { id: round.id, index: 1, action: 'finish' }, now + 2);
  db.saveCompany({ revision: 0, name: 'Keep', active: true }, 'Admin');
  db.pruneLearning(now + 91 * 86400000);
  assert.equal(db.learningAudit().entries.length, 1);
  assert.equal(Object.keys(db.learningProgress('g', 'owner')).length, 1);
  assert.throws(
    () => db.learningAction('g', 'owner', { id: round.id, index: 1, action: 'finish' }),
    (e) => e.status === 404,
  );
  db.close();
});

test('fictional answer groups stay consistent in both photo quizzes; unknown groups still work', () => {
  const roster = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    first: 'Test' + i,
    last: 'Demo',
    hasPhoto: true,
    learningGroup: i % 2 ? 'a' : 'b',
  }));
  for (const mode of ['photo-name', 'name-photo']) {
    const r = createRound(roster, { ...settings, mode });
    nextQuestion(r, {});
    const group = roster.find((p) => p.id === r.current.id).learningGroup;
    assert.equal(r.current.choices.length, 4);
    assert.ok(
      r.current.choices.every((c) => roster.find((p) => p.id === c.id).learningGroup === group),
    );
  }
  const r = createRound(people, settings);
  nextQuestion(r, {});
  assert.equal(r.current.choices.length, 2);
});
test('flipping cards records one view without wrong answers, mastery or score', () => {
  const r = createRound(people, { ...settings, mode: 'cards' }),
    progress = {};
  nextQuestion(r, progress);
  answerQuestion(r, progress, 'reveal');
  answerQuestion(r, progress, 'reveal');
  assert.equal(r.answered, 1);
  assert.equal(r.correct, 0);
  assert.equal(r.feedback.revealed, true);
  assert.deepEqual(Object.values(progress), [{ views: 1 }]);
});

test('all eligible people appear before repeats even with strongly weighted errors', () => {
  const roster = Array.from({ length: 15 }, (_, i) => ({
    id: String(i),
    first: 'Name' + i,
    last: 'Test',
    hasPhoto: true,
  }));
  const round = createRound(roster, { ...settings, limit: 'free' }),
    progress = { '0|photo-name|full': { right: 0, wrong: 100, streak: 0, due: 0 } };
  const seen = [];
  for (let i = 0; i < 15; i++) {
    nextQuestion(round, progress, Date.now(), () => 0);
    seen.push(round.current.id);
    answerQuestion(round, progress, 'wrong');
  }
  assert.equal(new Set(seen).size, 15);
  nextQuestion(round, progress, Date.now(), () => 0);
  assert.equal(round.current.id, '0');
});
test('company questions offer four distinct businesses, even when classmates share one', () => {
  const roster = Array.from({ length: 8 }, (_, i) => ({
    ...people[0],
    id: String(i),
    company: i < 5 ? 'Werk' : 'Firma' + i,
  }));
  const round = createRound(roster, { ...settings, mode: 'company' });
  nextQuestion(round, {}, 0, () => 0);
  assert.equal(round.current.companyChoices.length, 4);
  assert.equal(new Set(round.current.companyChoices).size, 4);
  assert.ok(round.current.companyChoices.includes(round.current.company));
  const small = createRound(people, { ...settings, mode: 'company' });
  nextQuestion(small, {});
  assert.equal(small.current.companyChoices.length, 2);
});
test('company deletion clears assignments atomically, audits and invalidates stale revisions', () => {
  const db = photoStore(':memory:');
  const [c] = db.saveCompany({ name: 'Firma', revision: 0, active: true }, 'Admin');
  db.saveAssignments('a', { revision: 0, assignments: { p: c.id } }, [{ id: 'p' }], 'Teacher');
  db.saveAssignments('b', { revision: 0, assignments: { q: c.id } }, [{ id: 'q' }], 'Teacher');
  assert.throws(
    () => db.deleteCompany({ id: c.id, revision: 0 }, 'Admin'),
    (e) => e.status === 409,
  );
  assert.equal(db.assignments('a').assignments.p, c.id);
  db.deleteCompany({ id: c.id, revision: c.revision }, 'Admin');
  assert.equal(db.companies().length, 0);
  for (const group of ['a', 'b']) {
    assert.deepEqual(db.assignments(group).assignments, {});
    assert.equal(db.assignments(group).revision, 2);
  }
  assert.ok(db.learningAudit().entries.some((e) => e.action === 'Betrieb gelöscht'));
  assert.throws(
    () =>
      db.saveAssignments('a', { revision: 1, assignments: { p: c.id } }, [{ id: 'p' }], 'Teacher'),
    (e) => e.status === 409,
  );
  assert.throws(
    () => db.deleteCompany({ id: c.id, revision: c.revision }, 'Admin'),
    (e) => e.status === 409,
  );
  db.close();
});

test('timed quiz pauses exactly two seconds per answer; retries and early next cannot add time', () => {
  const r = createRound(people, { ...settings, limit: 'time' }, 0),
    p = {};
  nextQuestion(r, p, 0, () => 0);
  answerQuestion(r, p, r.current.id, 10000);
  assert.equal(r.deadline, 62000);
  assert.equal(r.feedbackUntil, 12000);
  assert.equal(r.pausedMs, 2000);
  answerQuestion(r, p, r.current.id, 11000);
  assert.equal(r.deadline, 62000);
  const id = r.current.id;
  nextQuestion(r, p, 11999, () => 0);
  assert.equal(r.current.id, id);
  nextQuestion(r, p, 12000, () => 0);
  assert.notEqual(r.current.id, id);
  assert.equal(r.feedbackUntil, null);
  answerQuestion(r, p, r.current.id, 62000);
  assert.equal(r.done, true);
  assert.equal(r.answered, 1);
});
test('timed audit reports active seconds and identifies the timing rule', () => {
  const db = photoStore(':memory:'),
    now = Date.now();
  let r = db.startLearning('g', 'owner', 'Teacher', people, { ...settings, limit: 'time' }, now);
  r = db.learningAction(
    'g',
    'owner',
    { id: r.id, index: 0, action: 'answer', answer: r.question.id },
    now + 10000,
  );
  db.learningAction('g', 'owner', { id: r.id, index: 1, action: 'finish' }, now + 62000);
  const score = db.learningAudit('g').highscores[0].detail;
  assert.equal(score.seconds, 60);
  assert.equal(score.timing, 'active-v1');
  db.close();
});

test('one eligible portrait can repeat in practice, but whole-class rounds finish once', () => {
  for (const limit of ['10', 'free', 'class']) {
    const r = createRound([people[0]], { ...settings, limit }, 0),
      progress = {};
    nextQuestion(r, progress, 1);
    answerQuestion(r, progress, 'a', 2);
    nextQuestion(r, progress, 3);
    assert.equal(r.done, limit === 'class');
    if (!r.done) assert.equal(r.current.index, 1);
  }
});
