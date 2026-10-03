import { DatabaseSync } from 'node:sqlite';
import { BlockList, isIP } from 'node:net';
import { chmodSync } from 'node:fs';
export const usageActions = ['view', 'class_open', 'pick', 'teams', 'local_import'];
export function usageStore(file, { now = Date.now } = {}) {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS usage_events (
 id TEXT PRIMARY KEY,time INTEGER NOT NULL,session TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,
 action TEXT NOT NULL,context TEXT NOT NULL,class_id TEXT NOT NULL,class_name TEXT NOT NULL,amount INTEGER NOT NULL,network TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS usage_time ON usage_events(time);`);
  const clean = () =>
    db.prepare('DELETE FROM usage_events WHERE time < ?').run(now() - 90 * 86400000);
  clean();
  let lastClean = now();
  const maintenance = setInterval(clean, 3600000);
  maintenance.unref();
  return {
    record(e) {
      if (now() - lastClean >= 3600000) {
        clean();
        lastClean = now();
      }
      db.prepare('INSERT OR IGNORE INTO usage_events VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        e.id,
        now(),
        e.session,
        e.actorId || '',
        e.actorName || '',
        e.action,
        e.context,
        e.classId || '',
        e.className || '',
        e.amount || 0,
        e.network || 'unknown',
      );
      // Bound disk use even if an anonymous client generates bogus requests.
      db.prepare(
        'DELETE FROM usage_events WHERE rowid IN (SELECT rowid FROM usage_events ORDER BY time DESC LIMIT -1 OFFSET 200000)',
      ).run();
    },
    report(days) {
      clean();
      const since = now() - days * 86400000;
      const all = (sql) => db.prepare(sql).all(since);
      return {
        days,
        retentionDays: 90,
        totals:
          all(`SELECT COUNT(*) events,COUNT(DISTINCT session) sessions,COUNT(DISTINCT NULLIF(actor_id,'')) teachers,
     SUM(action='view') views,SUM(action='pick') picks,SUM(action='teams') teams,
     SUM(action='photo_save') uploads,SUM(action='local_import') imports,COALESCE(SUM(CASE WHEN action='local_import' THEN amount ELSE 0 END),0) photos FROM usage_events WHERE time>=?`)[0],
        access: all(
          `SELECT CASE WHEN actor_id='' THEN 'anonymous' ELSE 'teacher' END access,COUNT(DISTINCT session) sessions,SUM(action='view') views,SUM(action='photo_save') uploads,SUM(action='local_import') imports,COALESCE(SUM(CASE WHEN action='local_import' THEN amount ELSE 0 END),0) photos FROM usage_events WHERE time>=? GROUP BY access`,
        ),
        networks: all(
          `SELECT network,COUNT(DISTINCT session) sessions,SUM(action='view') views FROM usage_events WHERE time>=? GROUP BY network`,
        ),
        teachers: all(
          `SELECT actor_id,MAX(actor_name) name,COUNT(DISTINCT session) sessions,SUM(action='view') views,SUM(action='pick') picks,SUM(action='teams') teams,SUM(action='local_import') imports,MAX(time) last FROM usage_events WHERE time>=? AND actor_id<>'' GROUP BY actor_id ORDER BY last DESC`,
        ),
        teacherClasses: all(
          `SELECT actor_id,MAX(actor_name) teacher,class_id,MAX(class_name) name,SUM(action='class_open') opens,SUM(action='pick') picks,SUM(action='teams') teams FROM usage_events WHERE time>=? AND actor_id<>'' AND context='iserv' GROUP BY actor_id,class_id ORDER BY teacher,name`,
        ),
        classes: all(
          `SELECT context,class_id,MAX(class_name) name,SUM(action='class_open') opens,SUM(action='pick') picks,SUM(action='teams') teams,COUNT(DISTINCT session) sessions FROM usage_events WHERE time>=? AND action<>'view' GROUP BY context,class_id ORDER BY sessions DESC`,
        ),
        recent: all(
          `SELECT time,actor_name,action,context,class_name,amount FROM usage_events WHERE time>=? ORDER BY time DESC LIMIT 100`,
        ),
      };
    },
    close() {
      clearInterval(maintenance);
      db.close();
    },
  };
}

export function networkClassifier(ranges = [], trusted = false) {
  const list = new BlockList();
  for (const range of ranges) {
    const [ip, prefix] = range.split('/');
    const family = isIP(ip);
    if (!family) throw new Error('Invalid school network');
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(ip, type);
    else {
      if (!/^\d+$/.test(prefix)) throw new Error('Invalid network prefix');
      list.addSubnet(ip, Number(prefix), type);
    }
  }
  return (req) => {
    const ip = req.headers['x-klassentools-client-ip'];
    const family = isIP(typeof ip === 'string' ? ip : '');
    if (!trusted || !ranges.length || !family) return 'unknown';
    return list.check(ip, family === 4 ? 'ipv4' : 'ipv6') ? 'school' : 'external';
  };
}
