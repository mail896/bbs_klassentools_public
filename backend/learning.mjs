import { randomUUID, randomInt } from 'node:crypto';
import { HttpError } from './errors.mjs';
import { createRound, nextQuestion, answerQuestion, roundView } from '../public/learning-core.mjs';
const random = () => randomInt(0, 0x100000000) / 0x100000000;
export function learningStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL,short TEXT NOT NULL,active INTEGER NOT NULL,revision INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS company_assignments(class_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS learning_progress(class_id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(class_id,owner)) STRICT;
  CREATE TABLE IF NOT EXISTS learning_rounds(id TEXT PRIMARY KEY,class_id TEXT NOT NULL,owner TEXT NOT NULL,actor TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS learning_audit(id TEXT PRIMARY KEY,time INTEGER NOT NULL,class_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL) STRICT;
  CREATE INDEX IF NOT EXISTS learning_round_owner ON learning_rounds(class_id,owner);
  CREATE INDEX IF NOT EXISTS learning_audit_time ON learning_audit(time);`);
  const audit = (group, actor, action, detail) =>
    db
      .prepare('INSERT INTO learning_audit VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), Date.now(), group, actor, action, JSON.stringify(detail));
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const x = fn();
      db.exec('COMMIT');
      return x;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  const progress = (g, o) =>
    JSON.parse(
      db.prepare('SELECT data FROM learning_progress WHERE class_id=? AND owner=?').get(g, o)
        ?.data || '{}',
    );
  const companies = () => db.prepare('SELECT * FROM companies ORDER BY name COLLATE NOCASE').all();
  const assignments = (g) => {
    const row = db.prepare('SELECT revision,data FROM company_assignments WHERE class_id=?').get(g);
    return {
      revision: row?.revision || 0,
      assignments: JSON.parse(row?.data || '{}'),
      companies: companies(),
    };
  };
  const clean = (v, max) => {
    if (typeof v !== 'string' || v.trim().length > max)
      throw new HttpError(400, 'Ungültiger Text.');
    return v.trim();
  };
  const pruneLearning = (now = Date.now()) => {
    db.prepare('DELETE FROM learning_rounds WHERE updated<?').run(now - 86400000);
    db.prepare(
      "DELETE FROM learning_audit WHERE time<? AND action IN ('Lernrunde beendet','Eigener Lernfortschritt zurückgesetzt')",
    ).run(now - 90 * 86400000);
  };
  pruneLearning();
  const compare = (a, b) =>
    (a.limit === 'time'
      ? b.right - a.right || b.accuracy - a.accuracy
      : b.accuracy - a.accuracy || b.right - a.right) || a.seconds - b.seconds;
  return {
    pruneLearning,
    companies,
    saveCompany(body, actor) {
      return transaction(() => {
        if (
          (body.id !== undefined &&
            (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.id))) ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0
        )
          throw new HttpError(400, 'Ungültige Betriebskennung oder Version.');
        const name = clean(body.name, 120),
          city = clean(body.city || '', 80),
          short = clean(body.short || '', 50);
        if (!name || typeof body.active !== 'boolean')
          throw new HttpError(400, 'Name und Status erforderlich.');
        const id = body.id || randomUUID(),
          old = db.prepare('SELECT * FROM companies WHERE id=?').get(id);
        if ((old?.revision || 0) !== body.revision)
          throw new HttpError(409, 'Betrieb wurde geändert. Bitte neu laden.');
        if (!old && db.prepare('SELECT count(*) AS n FROM companies').get().n >= 2000)
          throw new HttpError(400, 'Maximal 2000 Betriebe.');
        if (
          companies().some(
            (c) =>
              c.id !== id &&
              c.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de') &&
              c.city.toLocaleLowerCase('de') === city.toLocaleLowerCase('de'),
          )
        )
          throw new HttpError(409, 'Dieser Betrieb ist bereits vorhanden.');
        db.prepare('INSERT OR REPLACE INTO companies VALUES(?,?,?,?,?,?)').run(
          id,
          name,
          city,
          short,
          body.active ? 1 : 0,
          (old?.revision || 0) + 1,
        );
        audit('', actor, 'Betrieb geändert', {
          id,
          name,
          city,
          short,
          active: body.active,
          before: old || null,
        });
        return companies();
      });
    },
    deleteCompany(body, actor) {
      return transaction(() => {
        if (
          typeof body.id !== 'string' ||
          !/^[a-zA-Z0-9-]{1,64}$/.test(body.id) ||
          !Number.isSafeInteger(body.revision)
        )
          throw new HttpError(400, 'Ungültiger Betrieb.');
        const old = db.prepare('SELECT * FROM companies WHERE id=?').get(body.id);
        if (!old || old.revision !== body.revision)
          throw new HttpError(409, 'Betrieb wurde geändert oder gelöscht. Bitte neu laden.');
        let removed = 0;
        for (const row of db.prepare('SELECT * FROM company_assignments').all()) {
          const data = JSON.parse(row.data);
          const members = Object.keys(data).filter((id) => data[id] === body.id);
          if (!members.length) continue;
          for (const id of members) delete data[id];
          db.prepare(
            'UPDATE company_assignments SET data=?,revision=revision+1 WHERE class_id=?',
          ).run(JSON.stringify(data), row.class_id);
          audit(row.class_id, actor, 'Betriebszuordnungen entfernt', {
            name: old.name,
            members,
            count: members.length,
          });
          removed += members.length;
        }
        db.prepare('DELETE FROM companies WHERE id=?').run(body.id);
        audit('', actor, 'Betrieb gelöscht', { name: old.name, before: old, removed });
        return companies();
      });
    },
    assignments,
    saveAssignments(g, body, members, actor) {
      return transaction(() => {
        const old = assignments(g);
        if (body.revision !== old.revision)
          throw new HttpError(409, 'Zuordnungen wurden geändert. Bitte neu laden.');
        if (
          !body.assignments ||
          typeof body.assignments !== 'object' ||
          Array.isArray(body.assignments) ||
          Object.keys(body.assignments).length > 200
        )
          throw new HttpError(400, 'Ungültige Zuordnung.');
        const data = { ...old.assignments },
          known = new Set(members.map((m) => m.id));
        for (const [id, company] of Object.entries(body.assignments)) {
          if (
            !known.has(id) ||
            typeof company !== 'string' ||
            (company &&
              !old.companies.some(
                (c) => c.id === company && (c.active || old.assignments[id] === company),
              ))
          )
            throw new HttpError(400, 'Unbekannte Person oder inaktiver Betrieb.');
          const before = data[id] || '';
          if (company) data[id] = company;
          else delete data[id];
          if (before !== company)
            audit(g, actor, 'Betrieb zugeordnet', {
              memberId: id,
              beforeId: before,
              afterId: company,
              member: members.find((m) => m.id === id)?.name || id,
              before: old.companies.find((c) => c.id === before)?.name || '',
              after: old.companies.find((c) => c.id === company)?.name || '',
            });
        }
        db.prepare('INSERT OR REPLACE INTO company_assignments VALUES(?,?,?)').run(
          g,
          old.revision + 1,
          JSON.stringify(data),
        );
        return assignments(g);
      });
    },
    learningProgress: progress,
    startLearning(g, owner, actor, people, settings, now = Date.now()) {
      const r = createRound(people, settings, now),
        id = randomUUID();
      r.companies = [
        ...new Set([
          ...r.companies,
          ...companies()
            .filter((c) => c.active)
            .map((c) => c.name),
        ]),
      ];
      nextQuestion(r, progress(g, owner), now, random);
      // Only one active round per teacher and class; stale rounds are not highscores.
      db.prepare('DELETE FROM learning_rounds WHERE (class_id=? AND owner=?) OR updated<?').run(
        g,
        owner,
        now - 86400000,
      );
      db.prepare('INSERT INTO learning_rounds VALUES(?,?,?,?,?,?)').run(
        id,
        g,
        owner,
        actor,
        JSON.stringify(r),
        now,
      );
      return { id, ...roundView(r) };
    },
    learningAction(g, owner, body, now = Date.now()) {
      return transaction(() => {
        if (
          typeof body.id !== 'string' ||
          body.id.length > 64 ||
          !Number.isSafeInteger(body.index) ||
          body.index < 0
        )
          throw new HttpError(400, 'Ungültige Lernrunde.');
        const row = db
          .prepare('SELECT * FROM learning_rounds WHERE id=? AND class_id=? AND owner=?')
          .get(body.id, g, owner);
        if (!row || row.updated < now - 86400000)
          throw new HttpError(404, 'Lernrunde abgelaufen. Bitte neu starten.');
        const r = JSON.parse(row.data),
          p = progress(g, owner),
          wasDone = r.done;
        if (
          body.index !== r.answered &&
          !(body.action === 'answer' && r.feedback && body.index === r.answered - 1)
        )
          throw new HttpError(409, 'Die Lernrunde ist bereits weiter. Bitte neu starten.');
        if (body.action === 'answer') {
          if (
            typeof body.answer !== 'boolean' &&
            (typeof body.answer !== 'string' || body.answer.length > 160)
          )
            throw new HttpError(400, 'Ungültige Antwort.');
          answerQuestion(r, p, body.answer, now);
        } else if (body.action === 'next') nextQuestion(r, p, now, random);
        else if (body.action === 'finish') r.done = true;
        else throw new HttpError(400, 'Unbekannte Aktion.');
        if (r.deadline && now >= r.deadline) r.done = true;
        if (r.done && !wasDone) {
          const complete =
            r.settings.limit === 'time'
              ? now >= r.deadline
              : r.settings.limit !== 'free' && r.answered >= r.goal;
          audit(g, row.actor, 'Lernrunde beendet', {
            owner,
            pool: r.people.length,
            mode: r.settings.mode,
            limit: r.settings.limit,
            names: r.settings.names,
            right: r.correct,
            total: r.answered,
            goal: r.goal,
            complete,
            ranked: complete && r.settings.mode !== 'cards',
            timing: r.timing || 'elapsed',
            seconds: Math.round(
              (now - r.started - (r.pausedMs || 0) + Math.max(0, (r.feedbackUntil || 0) - now)) /
                1000,
            ),
            accuracy: r.answered ? Math.round((100 * r.correct) / r.answered) : 0,
          });
        }
        db.prepare('INSERT OR REPLACE INTO learning_progress VALUES(?,?,?)').run(
          g,
          owner,
          JSON.stringify(p),
        );
        db.prepare('UPDATE learning_rounds SET data=?,updated=? WHERE id=?').run(
          JSON.stringify(r),
          now,
          body.id,
        );
        return { id: body.id, ...roundView(r), progress: p };
      });
    },
    resetLearning(g, owner, actor) {
      transaction(() => {
        db.prepare('DELETE FROM learning_progress WHERE class_id=? AND owner=?').run(g, owner);
        db.prepare('DELETE FROM learning_rounds WHERE class_id=? AND owner=?').run(g, owner);
        audit(g, actor, 'Eigener Lernfortschritt zurückgesetzt', {});
      });
    },
    learningAudit(group = '', query = '') {
      pruneLearning();
      const rows = db
        .prepare(
          "SELECT * FROM learning_audit WHERE (?='' OR class_id=?) AND (?='' OR instr(lower(actor||' '||action||' '||detail),lower(?))>0) ORDER BY time DESC LIMIT 500",
        )
        .all(group, group, query, query)
        .map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
      const scores = new Map();
      for (const r of rows) {
        if (!r.detail.ranked) continue;
        const d = r.detail,
          k = JSON.stringify([
            r.class_id,
            d.owner,
            d.mode,
            d.limit,
            d.names,
            d.goal,
            d.pool,
            d.timing || 'elapsed',
          ]);
        const old = scores.get(k);
        if (!old || compare(d, old.detail) < 0) scores.set(k, r);
      }
      return {
        entries: rows,
        highscores: [...scores.values()].sort(
          (a, b) =>
            a.detail.mode.localeCompare(b.detail.mode) ||
            a.detail.limit.localeCompare(b.detail.limit) ||
            compare(a.detail, b.detail),
        ),
      };
    },
  };
}
