import { learningStore } from './learning.mjs';
import { HttpError } from './errors.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
sharp.cache(false);
sharp.concurrency(1);
export async function preparePhoto(data) {
  if (
    typeof data !== 'string' ||
    data.length > 1400000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new HttpError(400, 'Ungültiges Bild. Bitte JPEG, PNG oder WebP verwenden.');
  const buffer = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!jpeg && !png && !webp)
    throw new HttpError(400, 'Der Dateiinhalt ist kein unterstütztes Bild.');
  try {
    const input = sharp(buffer, { limitInputPixels: 4000000, failOn: 'warning', animated: false });
    const meta = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1)
      throw new Error('format');
    const result = await input
      .rotate()
      .resize(640, 640, { fit: 'contain', background: '#e5e9ed' })
      .flatten({ background: '#e5e9ed' })
      .jpeg({ quality: 85 })
      .timeout({ seconds: 3 })
      .toBuffer();
    if (result.length > 300000) throw new Error('size');
    return result;
  } catch {
    throw new HttpError(
      400,
      'Ein Bild ist beschädigt, animiert oder zu groß. Bitte neu auswählen.',
    );
  }
}
export function photoStore(file, { beforeAudit = () => {} } = {}) {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(file, { timeout: 3000 });
  if (file !== ':memory:') chmodSync(file, 0o600);
  const schema = db.prepare('PRAGMA user_version').get().user_version;
  if (schema > 1) {
    db.close();
    throw new Error('Unsupported photo schema');
  }
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS seating_plans(class_id TEXT NOT NULL,owner_id TEXT NOT NULL,revision INTEGER NOT NULL,plan TEXT,updated_at TEXT NOT NULL,actor_name TEXT NOT NULL,PRIMARY KEY(class_id,owner_id)) STRICT;
 CREATE TABLE IF NOT EXISTS seating_versions(class_id TEXT NOT NULL,owner_id TEXT NOT NULL,version INTEGER NOT NULL,revision INTEGER NOT NULL,plan TEXT,updated_at TEXT NOT NULL,actor_name TEXT NOT NULL,PRIMARY KEY(class_id,owner_id,version)) STRICT;
 CREATE TABLE IF NOT EXISTS photo_classes(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0) STRICT;
 CREATE TABLE IF NOT EXISTS photos(class_id TEXT NOT NULL,member_id TEXT NOT NULL,version TEXT NOT NULL,image BLOB NOT NULL,PRIMARY KEY(class_id,member_id)) STRICT;
 CREATE TABLE IF NOT EXISTS photo_audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,batch_id TEXT NOT NULL,time TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,class_id TEXT NOT NULL,member_id TEXT NOT NULL,member_name TEXT NOT NULL,action TEXT NOT NULL,before_version TEXT,after_version TEXT,revision INTEGER NOT NULL) STRICT;
 CREATE INDEX IF NOT EXISTS photo_audit_class ON photo_audit(class_id,seq);
 PRAGMA user_version=1;`);
  db.function('audit_fold', { deterministic: true }, (value) =>
    String(value || '')
      .normalize('NFC')
      .toLocaleLowerCase('de'),
  );
  const revision = (id) =>
    db.prepare('SELECT revision FROM photo_classes WHERE id=?').get(id)?.revision || 0;
  const learning = learningStore(db);
  return {
    ...learning,
    close: () => db.close(),
    seating(group, owner, version = 1) {
      const row =
        version === 1
          ? db
              .prepare(
                'SELECT revision,plan,updated_at,actor_name FROM seating_plans WHERE class_id=? AND owner_id=?',
              )
              .get(group, owner)
          : db
              .prepare(
                'SELECT revision,plan,updated_at,actor_name FROM seating_versions WHERE class_id=? AND owner_id=? AND version=?',
              )
              .get(group, owner, version);
      return row
        ? {
            version,
            revision: row.revision,
            plan: row.plan ? JSON.parse(row.plan) : null,
            updatedAt: row.updated_at,
            updatedBy: row.actor_name,
          }
        : { version, revision: 0, plan: null };
    },
    seatingVersions(group, owner) {
      const versions = [
        1,
        ...db
          .prepare(
            'SELECT version FROM seating_versions WHERE class_id=? AND owner_id=? ORDER BY version',
          )
          .all(group, owner)
          .map((r) => r.version),
      ];
      return versions.map((v) => this.seating(group, owner, v)).filter((v) => v.plan);
    },
    saveSeating({ group, owner, expected, plan, actor, version = 1, newVersion = false }) {
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        !Number.isSafeInteger(version) ||
        version < 1 ||
        version > 10000 ||
        (!owner && (version !== 1 || newVersion)) ||
        (newVersion && !plan)
      )
        throw new HttpError(400, 'Ungültiger Bearbeitungsstand.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (newVersion) {
          const count = db
            .prepare(
              'SELECT count(*) AS n FROM seating_versions WHERE class_id=? AND owner_id=? AND plan IS NOT NULL',
            )
            .get(group, owner).n;
          if (count >= 49)
            throw new HttpError(
              400,
              'Maximal 50 private Planversionen je Klasse. Bitte löschen Sie nicht mehr benötigte Versionen.',
            );
          version =
            Math.max(
              1,
              db
                .prepare(
                  'SELECT max(version) AS n FROM seating_versions WHERE class_id=? AND owner_id=?',
                )
                .get(group, owner).n || 0,
            ) + 1;
          expected = 0;
        }
        const old =
          version === 1
            ? db
                .prepare('SELECT revision,plan FROM seating_plans WHERE class_id=? AND owner_id=?')
                .get(group, owner)
            : db
                .prepare(
                  'SELECT revision,plan FROM seating_versions WHERE class_id=? AND owner_id=? AND version=?',
                )
                .get(group, owner, version);
        if (version > 1 && !newVersion && !old)
          throw new HttpError(404, 'Planversion nicht gefunden.');
        if ((old?.revision || 0) !== expected)
          throw new HttpError(
            409,
            'Dieser Sitzplan wurde inzwischen geändert. Ihr Entwurf bleibt erhalten. Bitte laden Sie den gespeicherten Stand neu oder speichern Sie eine neue private Version.',
          );
        const next = expected + 1,
          time = new Date().toISOString(),
          payload = plan ? JSON.stringify(plan) : null;
        if (version === 1)
          db.prepare(
            'INSERT INTO seating_plans VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,owner_id) DO UPDATE SET revision=excluded.revision,plan=excluded.plan,updated_at=excluded.updated_at,actor_name=excluded.actor_name',
          ).run(group, owner, next, payload, time, actor.name);
        else
          db.prepare(
            'INSERT INTO seating_versions VALUES(?,?,?,?,?,?,?) ON CONFLICT(class_id,owner_id,version) DO UPDATE SET revision=excluded.revision,plan=excluded.plan,updated_at=excluded.updated_at,actor_name=excluded.actor_name',
          ).run(group, owner, version, next, payload, time, actor.name);
        beforeAudit();
        const action = plan ? 'seat_save' : 'seat_delete',
          label = owner ? 'Privater Sitzplan · v' + version : 'Gemeinsamer Sitzplan';
        db.prepare(
          'INSERT INTO photo_audit(event_id,batch_id,time,actor_id,actor_name,class_id,member_id,member_name,action,before_version,after_version,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          randomUUID(),
          time,
          actor.id,
          actor.name,
          group,
          '',
          label,
          action,
          old?.plan ? createHash('sha256').update(old.plan).digest('hex') : null,
          payload ? createHash('sha256').update(payload).digest('hex') : null,
          next,
        );
        db.exec('COMMIT');
        return { version, revision: next, plan, updatedAt: time, updatedBy: actor.name };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    photoMembers(group) {
      return db
        .prepare('SELECT member_id FROM photos WHERE class_id=?')
        .all(group)
        .map((r) => r.member_id);
    },
    snapshot(group, allowed) {
      const rows = db
        .prepare('SELECT member_id,version,image FROM photos WHERE class_id=?')
        .all(group);
      return {
        revision: revision(group),
        total: rows.length,
        photos: rows
          .filter((r) => allowed.has(r.member_id))
          .map((r) => ({
            memberId: r.member_id,
            version: r.version,
            data: 'data:image/jpeg;base64,' + Buffer.from(r.image).toString('base64'),
          })),
      };
    },
    audit(group, before = Number.MAX_SAFE_INTEGER, { groups = null, query = '' } = {}) {
      const clauses = ['seq<?'],
        args = [before];
      if (group) {
        clauses.push('class_id=?');
        args.push(group);
      }
      if (groups !== null) {
        if (!groups.length) return { entries: [], next: null };
        clauses.push(`class_id IN (${groups.map(() => '?').join(',')})`);
        args.push(...groups);
      }
      if (query) {
        clauses.push(
          "instr(audit_fold(actor_name||' '||member_name||' '||action||' '||time||' '||class_id||' '||CASE action WHEN 'upload' THEN 'Foto hinzugefügt' WHEN 'replace' THEN 'Foto ersetzt' WHEN 'seat_save' THEN 'Sitzplan gespeichert' WHEN 'seat_delete' THEN 'Sitzplan gelöscht' ELSE 'Foto gelöscht' END),audit_fold(?))>0",
        );
        args.push(query);
      }
      const rows = db
        .prepare(
          'SELECT * FROM photo_audit WHERE ' +
            clauses.join(' AND ') +
            ' ORDER BY seq DESC LIMIT 51',
        )
        .all(...args);
      return { entries: rows.slice(0, 50), next: rows.length > 50 ? rows[49].seq : null };
    },
    mutate({
      group,
      expected,
      actor,
      upserts = [],
      remove = [],
      all = false,
      members = new Map(),
    }) {
      if (!Number.isSafeInteger(expected) || expected < 0)
        throw new HttpError(400, 'Ungültiger Bearbeitungsstand.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (revision(group) !== expected)
          throw new HttpError(
            409,
            'Fotos wurden zwischenzeitlich geändert. Bitte laden Sie die Klasse neu und prüfen Sie Ihre Auswahl erneut.',
          );
        const existing = db
            .prepare('SELECT member_id,version FROM photos WHERE class_id=?')
            .all(group),
          old = new Map(existing.map((r) => [r.member_id, r.version]));
        const targets = all ? [...old.keys()] : remove;
        const count = new Set(
          [...old.keys(), ...upserts.map((p) => p.id)].filter((id) => !targets.includes(id)),
        ).size;
        if (count > 100) throw new HttpError(400, 'Pro Klasse sind höchstens 100 Fotos möglich.');
        const changes = upserts.map((p) => ({
          id: p.id,
          action: old.has(p.id) ? 'replace' : 'upload',
          before: old.get(p.id) || null,
          after: createHash('sha256').update(p.image).digest('hex'),
          image: p.image,
        }));
        for (const id of targets)
          if (old.has(id))
            changes.push({
              id,
              action: all ? 'delete_all' : 'delete',
              before: old.get(id),
              after: null,
            });
        if (!changes.length) {
          db.exec('COMMIT');
          return { revision: expected, changed: 0 };
        }
        const next = expected + 1,
          batch = randomUUID(),
          time = new Date().toISOString();
        db.prepare(
          'INSERT INTO photo_classes(id,revision) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision',
        ).run(group, next);
        for (const change of changes) {
          if (change.image)
            db.prepare(
              'INSERT INTO photos VALUES(?,?,?,?) ON CONFLICT(class_id,member_id) DO UPDATE SET version=excluded.version,image=excluded.image',
            ).run(group, change.id, change.after, change.image);
          else
            db.prepare('DELETE FROM photos WHERE class_id=? AND member_id=?').run(group, change.id);
          beforeAudit();
          db.prepare(
            'INSERT INTO photo_audit(event_id,batch_id,time,actor_id,actor_name,class_id,member_id,member_name,action,before_version,after_version,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          ).run(
            randomUUID(),
            batch,
            time,
            actor.id,
            actor.name,
            group,
            change.id,
            members.get(change.id) || 'Nicht mehr in der Klasse',
            change.action,
            change.before,
            change.after,
            next,
          );
        }
        db.exec('COMMIT');
        return { revision: next, changed: changes.length };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
