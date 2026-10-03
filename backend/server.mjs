import http from 'node:http';
import { usageStore, usageActions, networkClassifier } from './usage.mjs';
import { join, dirname } from 'node:path';
import { photoStore, preparePhoto } from './photos.mjs';
import { HttpError } from './errors.mjs';
import { validateSeating } from './seating-validation.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, chmodSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { provider, teacherAllowed, rolesOf, groupsOf } from './auth.mjs';
import { catalogStore, validSelection } from './catalog.mjs';
import { tokenSource } from './idm-token.mjs';
import { allowedClasses, studentsOnly, idmClient, userUuid, directoryGroups } from './classes.mjs';
const origin = 'https://apps.school.example';
const sidName = '__Secure-klassentools-session',
  txName = '__Secure-klassentools-login';
const id = () => randomBytes(32).toString('base64url');
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((v) => v.trim().split('='))
      .filter(([k, v]) => k && v),
  );
}
function cookie(name, value, age, path = '/klassentools/') {
  return `${name}=${value}; Path=${path}; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createApp({
  getProvider,
  teacherUuid = '',
  studentUuid = '',
  catalog = [],
  idm = null,
  getIdmToken = null,
  adminUsers = [],
  classCatalog = null,
  photos = null,
  usage = null,
  classifyNetwork = () => 'unknown',
  now = Date.now,
}) {
  const transactions = new Map(),
    sessions = new Map();
  let photoBusy = false;
  const visits = new Map();
  let usageWindow = now(),
    usageRequests = 0;
  const visitCookie = '__Secure-klassentools-visit';
  const isAdmin = (info) => {
    try {
      return teacherAllowed(info, teacherUuid) && adminUsers.includes(userUuid(info));
    } catch {
      return false;
    }
  };
  // All protected endpoints share the same fail-closed session refresh.
  // Recheck after awaiting IServ: logout/expiry may happen while the request is in flight.
  const assertSession = (sid, session) => {
    if (!session || sessions.get(sid) !== session || session.expires <= now())
      throw new HttpError(401, 'Bitte melden Sie sich erneut an.');
  };
  const refreshSession = async (sid, session) => {
    try {
      assertSession(sid, session);
      const info = await (await getProvider()).refresh(session);
      assertSession(sid, session);
      session.info = info;
      session.checked = now();
    } catch {
      sessions.delete(sid);
      throw new HttpError(401, 'Bitte melden Sie sich erneut an.');
    }
  };
  const selection = () => classCatalog?.read() || { revision: 'initial', selected: null };
  const filterClasses = (info, groups, state = selection()) =>
    state.selected === null
      ? allowedClasses(info, catalog, () => groups)
      : groups
          .filter((g) => state.selected.includes(g.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  let rateStart = now(),
    starts = 0;
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const redirect = (res, url) => {
    res.writeHead(303, { Location: url });
    res.end();
  };
  let learningPruned = now();
  const prune = () => {
    // Housekeeping shares the existing server lifecycle; no additional scheduler.
    if (now() - learningPruned >= 60000) {
      photos?.pruneLearning?.(now());
      learningPruned = now();
    }
    for (const map of [transactions, sessions])
      for (const [key, value] of map) if (value.expires <= now()) map.delete(key);
  };
  const cleaner = setInterval(prune, 60000);
  cleaner.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      prune();
      if ((req.url || '').length > 8192) return json(res, 414, { error: 'Anfrage zu lang.' });
      const url = new URL(req.url, origin),
        jar = cookies(req);
      if (req.method === 'GET' && url.pathname === '/klassentools/api/health')
        return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/klassentools/oidc/login') {
        if (now() - rateStart > 60000) {
          rateStart = now();
          starts = 0;
        }
        if (++starts > 120 || transactions.size >= 500 || sessions.size >= 1000)
          return json(res, 429, { error: 'Bitte versuchen Sie es in einer Minute erneut.' });
        const flow = await (await getProvider()).begin();
        const tid = id();
        if (jar[txName]) transactions.delete(jar[txName]);
        transactions.set(tid, { ...flow, expires: now() + 300000 });
        res.setHeader('Set-Cookie', cookie(txName, tid, 300, '/klassentools/oidc/'));
        return redirect(res, flow.url);
      }
      if (req.method === 'GET' && url.pathname === '/klassentools/oidc/callback') {
        const flow = transactions.get(jar[txName]);
        transactions.delete(jar[txName]);
        res.setHeader('Set-Cookie', cookie(txName, '', 0, '/klassentools/oidc/'));
        if (!flow || !same(url.searchParams.get('state'), flow.state))
          return redirect(res, '/klassentools/?login=failed');
        if (url.searchParams.has('error'))
          return redirect(
            res,
            url.searchParams.get('error') === 'access_denied'
              ? '/klassentools/?login=denied'
              : '/klassentools/?login=failed',
          );
        const result = await (await getProvider()).complete(new URL(origin + req.url), flow);
        if (result.expires <= now()) return redirect(res, '/klassentools/?login=failed');
        if (teacherUuid && !teacherAllowed(result.info, teacherUuid))
          return redirect(res, '/klassentools/?login=denied');
        if (jar[sidName]) sessions.delete(jar[sidName]);
        const sid = id();
        sessions.set(sid, {
          ...result,
          csrf: id(),
          checked: now(),
          expires: Math.min(result.expires, now() + 3600000),
        });
        res.setHeader('Set-Cookie', [
          cookie(txName, '', 0, '/klassentools/oidc/'),
          cookie(sidName, sid, Math.floor((result.expires - now()) / 1000)),
        ]);
        return redirect(res, '/klassentools/?login=ok');
      }
      const sid = jar[sidName],
        session = sessions.get(sid);
      // Directory calls may outlive logout or expiry. Check both awaited boundaries
      // before their results can be used for a response or a database write.
      const directory = async (method, ...args) => {
        assertSession(sid, session);
        const token = await getIdmToken();
        assertSession(sid, session);
        const rows = await idm[method](token, ...args);
        assertSession(sid, session);
        return rows;
      };
      if (url.pathname === '/klassentools/api/usage') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Methode nicht erlaubt.' });
        if (!usage) return json(res, 503, { error: 'Statistik nicht verfügbar.' });
        if (req.headers.origin !== origin) return json(res, 403, { error: 'Ungültiger Ursprung.' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json')
          return json(res, 415, { error: 'JSON erforderlich.' });
        if (now() - usageWindow >= 60000) {
          usageWindow = now();
          usageRequests = 0;
          for (const [k, v] of visits) if (v.expires <= now()) visits.delete(k);
        }
        if (++usageRequests > 600 || visits.size >= 5000)
          return json(res, 429, { error: 'Zu viele Anfragen.' });
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024) return json(res, 413, { error: 'Anfrage zu groß.' });
          chunks.push(chunk);
        }
        let b;
        try {
          b = JSON.parse(Buffer.concat(chunks));
        } catch {
          return json(res, 400, { error: 'Ungültige Anfrage.' });
        }
        if (
          !b ||
          Object.keys(b).some(
            (k) => !['id', 'action', 'context', 'classId', 'amount'].includes(k),
          ) ||
          !usageActions.includes(b.action) ||
          !['demo', 'local', 'iserv'].includes(b.context) ||
          typeof b.id !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(b.id) ||
          !Number.isInteger(b.amount) ||
          b.amount < 0 ||
          b.amount > 500 ||
          typeof b.classId !== 'string' ||
          b.classId.length > 64
        )
          return json(res, 400, { error: 'Ungültiges Ereignis.' });
        const teacher = session && teacherAllowed(session.info, teacherUuid);
        let group = null;
        if (b.context === 'iserv') {
          if (!teacher || !idm || !getIdmToken)
            return json(res, 403, { error: 'Keine Klassenberechtigung.' });
          // Counting a local action needs no directory roundtrip or new data access.
          group = session.usageClasses?.find((g) => g.id === b.classId);
          if (!group) return json(res, 403, { error: 'Keine Klassenberechtigung.' });
        } else if (b.classId) return json(res, 400, { error: 'Ungültige Klasse.' });
        if (b.action === 'local_import' && b.context !== 'local')
          return json(res, 400, { error: 'Ungültiger Import.' });
        const actorId = teacher ? userUuid(session.info) : '';
        let key = jar[visitCookie],
          visit = visits.get(key);
        if (!visit || visit.expires <= now() || visit.actor !== actorId) {
          key = id();
          visit = { actor: actorId, expires: now() + 1800000, count: 0, window: now() };
          visits.set(key, visit);
        }
        if (now() - visit.window >= 60000) {
          visit.window = now();
          visit.count = 0;
        }
        if (++visit.count > 60) return json(res, 429, { error: 'Zu viele Ereignisse.' });
        visit.expires = now() + 1800000;
        res.setHeader('Set-Cookie', cookie(visitCookie, key, 1800));
        usage.record({
          id: b.id,
          session: key,
          actorId,
          actorName: teacher ? String(session.info.name || 'Lehrkraft').slice(0, 200) : '',
          action: b.action,
          context: b.context,
          classId: group?.id,
          className: group?.name,
          amount: b.amount,
          network: classifyNetwork(req),
        });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/klassentools/api/admin/usage') {
        if (!session) return json(res, 401, { error: 'Bitte melden Sie sich an.' });
        await refreshSession(sid, session);
        if (!isAdmin(session.info))
          return json(res, 403, { error: 'Nur für die Administration freigegeben.' });
        if (req.method !== 'GET') return json(res, 405, { error: 'Nur lesender Zugriff.' });
        const days = Number(url.searchParams.get('days') || 30);
        if (![1, 7, 30, 90].includes(days))
          return json(res, 400, { error: 'Ungültiger Zeitraum.' });
        if (!usage) return json(res, 503, { error: 'Statistik nicht verfügbar.' });
        return json(res, 200, usage.report(days));
      }
      if (req.method === 'POST' && url.pathname === '/klassentools/api/logout') {
        if (!session) return json(res, 401, { error: 'Nicht angemeldet.' });
        if (req.headers.origin !== origin || !same(req.headers['x-csrf-token'], session.csrf))
          return json(res, 403, { error: 'Ungültige Anfrage.' });
        sessions.delete(sid);
        res.setHeader('Set-Cookie', cookie(sidName, '', 0));
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/klassentools/api/admin/classes') {
        if (!session) return json(res, 401, { error: 'Bitte melden Sie sich an.' });
        await refreshSession(sid, session);
        if (!isAdmin(session.info))
          return json(res, 403, { error: 'Nur für die Administration freigegeben.' });
        if (!idm || !getIdmToken || !classCatalog)
          return json(res, 503, { error: 'Die Klassenverwaltung ist nicht eingerichtet.' });
        if (!['GET', 'PUT'].includes(req.method))
          return json(res, 405, { error: 'Methode nicht erlaubt.' });
        let body;
        if (req.method === 'PUT') {
          if (req.headers.origin !== origin || !same(req.headers['x-csrf-token'], session.csrf))
            return json(res, 403, { error: 'Ungültige Anfrage.' });
          if (req.headers['content-type']?.split(';')[0] !== 'application/json')
            return json(res, 415, { error: 'JSON erforderlich.' });
          if (Number(req.headers['content-length']) > 100000)
            return json(res, 413, { error: 'Anfrage zu groß.' });
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 100000) return json(res, 413, { error: 'Anfrage zu groß.' });
            chunks.push(chunk);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            return json(res, 400, { error: 'Ungültige Auswahl.' });
          }
          if (!body || !validSelection(body.selected) || typeof body.revision !== 'string')
            return json(res, 400, { error: 'Ungültige Auswahl.' });
        }
        const groups = directoryGroups(await directory('allGroups')).sort((a, b) =>
          a.name.localeCompare(b.name, 'de', { numeric: true }),
        );
        const state = selection(),
          selected = state.selected ?? filterClasses(session.info, groups, state).map((g) => g.id);
        if (req.method === 'GET')
          return json(res, 200, { groups, selected, revision: state.revision });
        const known = new Set([...groups.map((g) => g.id), ...selected]);
        if (body.selected.some((id) => !known.has(id)))
          return json(res, 400, { error: 'Unbekannte Gruppe. Bitte laden Sie die Liste neu.' });
        const saved = classCatalog.save(body.selected, body.revision);
        if (!saved)
          return json(res, 409, {
            error: 'Die Auswahl wurde zwischenzeitlich geändert. Bitte laden Sie die Liste neu.',
          });
        return json(res, 200, { selected: saved.selected, revision: saved.revision });
      }
      if (url.pathname === '/klassentools/api/admin/audit') {
        if (!session) return json(res, 401, { error: 'Bitte melden Sie sich an.' });
        await refreshSession(sid, session);
        if (!isAdmin(session.info))
          return json(res, 403, { error: 'Nur für die Administration freigegeben.' });
        if (req.method !== 'GET') return json(res, 405, { error: 'Nur lesender Zugriff.' });
        if (!photos) return json(res, 503, { error: 'Der Änderungsverlauf ist nicht verfügbar.' });
        const before = url.searchParams.has('before')
          ? Number(url.searchParams.get('before'))
          : Number.MAX_SAFE_INTEGER;
        const group = url.searchParams.get('group') || null;
        if (
          !Number.isSafeInteger(before) ||
          before < 1 ||
          (group && !/^[a-zA-Z0-9-]{1,64}$/.test(group))
        )
          return json(res, 400, { error: 'Ungültige Filter.' });
        const query = url.searchParams.get('q') || '',
          active = url.searchParams.get('active');
        if (query.length > 120 || (active && !['0', '1'].includes(active)))
          return json(res, 400, { error: 'Ungültige Suche.' });
        let groups = null;
        if (active === '1') {
          groups = selection().selected;
          if (groups === null) {
            if (!idm || !getIdmToken)
              return json(res, 503, { error: 'Klassenkatalog nicht verfügbar.' });
            groups = filterClasses(session.info, directoryGroups(await directory('allGroups'))).map(
              (g) => g.id,
            );
          }
        }
        return json(res, 200, photos.audit(group, before, { groups, query }));
      }
      const learningMatch = url.pathname.match(
        /^\/klassentools\/api\/classes\/([a-zA-Z0-9-]{1,64})\/(learning|companies)$/,
      );
      const learningAdmin = [
        '/klassentools/api/admin/companies',
        '/klassentools/api/admin/learning-audit',
      ].includes(url.pathname);
      if (learningMatch || learningAdmin) {
        if (!session) throw new HttpError(401, 'Bitte melden Sie sich an.');
        await refreshSession(sid, session);
        if (!teacherAllowed(session.info, teacherUuid))
          throw new HttpError(403, 'Zugang nur für Lehrkräfte.');
        if (!photos || !idm || !getIdmToken || !studentUuid)
          throw new HttpError(503, 'Lernen und Betriebe sind derzeit nicht verfügbar.');
        if (!['GET', 'POST'].includes(req.method))
          throw new HttpError(405, 'Methode nicht erlaubt.');
        const owner = userUuid(session.info),
          actor = String(session.info.name || 'Lehrkraft').slice(0, 200);
        if (learningAdmin && !isAdmin(session.info))
          throw new HttpError(403, 'Nur für die Administration freigegeben.');
        let group = learningMatch?.[1];
        if (group) {
          const groups = directoryGroups(await directory('groups', owner));
          if (!filterClasses(session.info, groups).some((g) => g.id === group))
            throw new HttpError(403, 'Kein Zugriff auf diese Klasse.');
        }
        let body = {};
        if (req.method === 'POST') {
          if (req.headers.origin !== origin || !same(req.headers['x-csrf-token'], session.csrf))
            throw new HttpError(403, 'Ungültige Anfrage.');
          if (req.headers['content-type']?.split(';')[0] !== 'application/json')
            throw new HttpError(415, 'JSON erforderlich.');
          let size = 0;
          const chunks = [];
          for await (const c of req) {
            size += c.length;
            if (size > 50000) throw new HttpError(413, 'Anfrage zu groß.');
            chunks.push(c);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            throw new HttpError(400, 'Ungültige Anfrage.');
          }
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new HttpError(400, 'Ungültige Anfrage.');
        }
        assertSession(sid, session);
        if (learningAdmin) {
          if (url.pathname.endsWith('learning-audit')) {
            if (req.method !== 'GET') throw new HttpError(405, 'Nur lesender Zugriff.');
            const q = url.searchParams.get('q') || '',
              g = url.searchParams.get('group') || '';
            if (q.length > 120 || (g && !/^[a-zA-Z0-9-]{1,64}$/.test(g)))
              throw new HttpError(400, 'Ungültiger Filter.');
            return json(res, 200, photos.learningAudit(g, q));
          }
          return json(res, 200, {
            companies:
              req.method === 'GET'
                ? photos.companies()
                : body.action === 'delete'
                  ? photos.deleteCompany(body, actor)
                  : photos.saveCompany(body, actor),
          });
        }
        const type = learningMatch[2];
        if (type === 'companies' && req.method === 'GET')
          return json(res, 200, photos.assignments(group));
        if (type === 'learning' && req.method === 'GET')
          return json(res, 200, { progress: photos.learningProgress(group, owner) });
        if (type === 'learning' && body.action === 'reset') {
          photos.resetLearning(group, owner, actor);
          return json(res, 200, { progress: {} });
        }
        if (type === 'learning' && body.action !== 'start')
          return json(res, 200, photos.learningAction(group, owner, body, now()));
        const members = studentsOnly(await directory('members', group), studentUuid, teacherUuid);
        assertSession(sid, session);
        if (type === 'companies')
          return json(
            res,
            200,
            photos.saveAssignments(
              group,
              body,
              members.map((m) => ({ ...m, name: m.first + ' ' + m.last })),
              actor,
            ),
          );
        const photoIds = new Set(photos.photoMembers(group));
        const data = photos.assignments(group);
        const people = members.map((p) => ({
          ...p,
          hasPhoto: photoIds.has(p.id),
          company: data.companies.find((c) => c.id === data.assignments[p.id])?.name || '',
        }));
        try {
          return json(
            res,
            200,
            photos.startLearning(group, owner, actor, people, body.settings || {}, now()),
          );
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, e.message);
        }
      }
      const seatingMatch = url.pathname.match(
        /^\/klassentools\/api\/classes\/([a-zA-Z0-9-]{1,64})\/seating$/,
      );
      if (seatingMatch) {
        if (!session) return json(res, 401, { error: 'Bitte melden Sie sich an.' });
        if (!['GET', 'POST', 'DELETE'].includes(req.method))
          return json(res, 405, { error: 'Methode nicht erlaubt.' });
        const group = seatingMatch[1];
        let classAccount = group;
        const authorize = async () => {
          assertSession(sid, session);
          await refreshSession(sid, session);
          if (!teacherAllowed(session.info, teacherUuid))
            throw new HttpError(403, 'Zugang nur für Lehrkräfte.');
          if (!photos || !idm || !getIdmToken || !studentUuid)
            throw new HttpError(503, 'Sitzpläne sind derzeit nicht verfügbar.');
          const groups = directoryGroups(await directory('groups', userUuid(session.info)));
          const allowed = filterClasses(session.info, groups).find((g) => g.id === group);
          if (!allowed) throw new HttpError(403, 'Kein Zugriff auf diese Klasse.');
          classAccount = allowed.account || allowed.name || group;
        };
        await authorize();
        const actorId = userUuid(session.info);
        const part = (value) =>
          String(value)
            .toLocaleLowerCase('de')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/ß/g, 'ss')
            .replace(/[^a-z0-9.-]+/g, '.')
            .replace(/^\.+|\.+$/g, '')
            .slice(0, 100);
        const label = (snapshot) => ({
          ...snapshot,
          name:
            part(session.info.preferred_username || session.info.name || actorId) +
            '.' +
            part(classAccount) +
            '.v' +
            snapshot.version,
        });
        if (req.method === 'GET')
          return json(res, 200, {
            shared: photos.seating(group, ''),
            private: label(photos.seating(group, actorId)),
            privateVersions: photos.seatingVersions(group, actorId).map(label),
          });
        if (req.headers.origin !== origin || !same(req.headers['x-csrf-token'], session.csrf))
          return json(res, 403, { error: 'Ungültige Anfrage.' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json')
          return json(res, 415, { error: 'JSON erforderlich.' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 100000) throw new HttpError(413, 'Sitzplan zu groß.');
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new HttpError(400, 'Ungültige Anfrage.');
        }
        if (
          !body ||
          !['shared', 'private'].includes(body.scope) ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0
        )
          throw new HttpError(400, 'Ungültiger Bearbeitungsstand.');
        const members = studentsOnly(await directory('members', group), studentUuid, teacherUuid);
        const plan =
          req.method === 'DELETE'
            ? null
            : validateSeating(body.plan, new Set(members.map((p) => p.id)));
        await authorize();
        if (userUuid(session.info) !== actorId)
          throw new HttpError(403, 'Die Anmeldung hat sich geändert.');
        let saved;
        try {
          saved = photos.saveSeating({
            group,
            owner: body.scope === 'private' ? actorId : '',
            expected: body.revision,
            plan,
            version: body.version ?? 1,
            newVersion: body.newVersion === true,
            actor: { id: actorId, name: String(session.info.name || 'Lehrkraft').slice(0, 200) },
          });
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(
            503,
            'Speichern fehlgeschlagen. Es wurden keine Änderungen übernommen. Bitte versuchen Sie es erneut.',
          );
        }
        return json(res, 200, body.scope === 'private' ? label(saved) : saved);
      }
      const photoMatch = url.pathname.match(
        /^\/klassentools\/api\/classes\/([a-zA-Z0-9-]{1,64})\/(photos|photo-audit)$/,
      );
      if (photoMatch) {
        if (!session) return json(res, 401, { error: 'Bitte melden Sie sich an.' });
        let photoClassName = '';
        const authorize = async () => {
          assertSession(sid, session);
          await refreshSession(sid, session);
          if (!teacherAllowed(session.info, teacherUuid))
            throw new HttpError(403, 'Zugang nur für Lehrkräfte.');
          if (!idm || !getIdmToken || !photos)
            throw new HttpError(503, 'Die Fotoverwaltung ist nicht verfügbar.');
          const groups = directoryGroups(await directory('groups', userUuid(session.info)));
          const matched = filterClasses(session.info, groups).find((g) => g.id === photoMatch[1]);
          if (!matched) throw new HttpError(403, 'Kein Zugriff auf diese Klasse.');
          photoClassName = matched.name;
        };
        await authorize();
        const group = photoMatch[1];
        if (photoMatch[2] === 'photo-audit') {
          return json(res, 403, {
            error: 'Der Änderungsverlauf steht ausschließlich in der Administration zur Verfügung.',
          });
        }
        if (!['GET', 'POST', 'DELETE'].includes(req.method))
          return json(res, 405, { error: 'Methode nicht erlaubt.' });
        const roster = async () =>
          studentsOnly(await directory('members', group), studentUuid, teacherUuid);
        if (req.method === 'GET') {
          const members = await roster();
          return json(res, 200, photos.snapshot(group, new Set(members.map((p) => p.id))));
        }
        if (req.headers.origin !== origin || !same(req.headers['x-csrf-token'], session.csrf))
          return json(res, 403, { error: 'Ungültige Anfrage.' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json')
          return json(res, 415, { error: 'JSON erforderlich.' });
        if (photoBusy)
          return json(res, 423, {
            error: 'Eine Fotoänderung läuft gerade. Bitte versuchen Sie es gleich erneut.',
          });
        photoBusy = true;
        try {
          const max = req.method === 'POST' ? 16000000 : 20000;
          let size = 0;
          const chunks = [];
          if (Number(req.headers['content-length']) > max)
            throw new HttpError(413, 'Die Fotoauswahl ist zu groß. Bitte weniger Fotos auswählen.');
          for await (const chunk of req) {
            size += chunk.length;
            if (size > max) throw new HttpError(413, 'Die Fotoauswahl ist zu groß.');
            chunks.push(chunk);
          }
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new HttpError(400, 'Ungültige Anfrage.');
          }
          if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0)
            throw new HttpError(400, 'Bearbeitungsstand fehlt. Bitte Klasse neu laden.');
          const actorId = userUuid(session.info),
            upserts = [];
          let remove = [],
            all = false;
          let members = await roster(),
            allowed = new Set(members.map((p) => p.id));
          if (req.method === 'POST') {
            if (
              !Array.isArray(body.photos) ||
              !body.photos.length ||
              body.photos.length > 60 ||
              new Set(body.photos.map((p) => p?.memberId)).size !== body.photos.length
            )
              throw new HttpError(400, 'Bitte 1 bis 60 eindeutig zugeordnete Fotos speichern.');
            for (const p of body.photos) {
              if (!p || !allowed.has(p.memberId))
                throw new HttpError(403, 'Eine Zielperson gehört nicht zur aktuellen Klasse.');
              upserts.push({ id: p.memberId, image: await preparePhoto(p.data) });
            }
          } else {
            all = body.all === true;
            if (all) {
              if (body.confirmClass !== group)
                throw new HttpError(400, 'Bestätigung der Klasse fehlt.');
            } else {
              remove = body.memberIds;
              if (
                !Array.isArray(remove) ||
                !remove.length ||
                remove.length > 100 ||
                new Set(remove).size !== remove.length ||
                remove.some((id) => typeof id !== 'string' || !allowed.has(id))
              )
                throw new HttpError(400, 'Ungültige Fotoauswahl.');
            }
          }
          // Decode can take time: revalidate role, class and targets immediately before commit.
          await authorize();
          if (userUuid(session.info) !== actorId)
            throw new HttpError(403, 'Die Anmeldung hat sich geändert.');
          members = await roster();
          allowed = new Set(members.map((p) => p.id));
          if (upserts.some((p) => !allowed.has(p.id)) || remove.some((id) => !allowed.has(id)))
            throw new HttpError(409, 'Die Klassenmitglieder haben sich geändert. Bitte neu laden.');
          let saved;
          try {
            saved = photos.mutate({
              group,
              expected: body.revision,
              actor: { id: actorId, name: String(session.info.name || 'Lehrkraft').slice(0, 200) },
              upserts,
              remove,
              all,
              members: new Map(members.map((p) => [p.id, p.first + ' ' + p.last])),
            });
          } catch (e) {
            if (e instanceof HttpError) throw e;
            throw new HttpError(
              503,
              'Speichern fehlgeschlagen. Es wurden keine Änderungen übernommen. Bitte versuchen Sie es erneut.',
            );
          }
          // Usage is supplementary; the transactional photo audit remains authoritative.
          try {
            if (usage) {
              const key = jar[visitCookie],
                visit = visits.get(key);
              usage.record({
                id: id(),
                session: visit && visit.actor === actorId && visit.expires > now() ? key : id(),
                actorId,
                actorName: String(session.info.name || 'Lehrkraft').slice(0, 200),
                action: req.method === 'POST' ? 'photo_save' : 'photo_delete',
                context: 'iserv',
                classId: group,
                className: photoClassName,
                amount: saved.changed,
                network: classifyNetwork(req),
              });
            }
          } catch {
            /* Photo commit must not fail due to statistics. */
          }
          return json(res, 200, saved);
        } finally {
          photoBusy = false;
        }
      }
      const classRequest =
        req.method === 'GET' &&
        (url.pathname === '/klassentools/api/classes' ||
          url.pathname.startsWith('/klassentools/api/classes/'));
      if (classRequest) {
        if (!session) return json(res, 401, { error: 'Bitte melden Sie sich an.' });
        // Refresh on every class access: group removal must take effect immediately.
        await refreshSession(sid, session);
        if (!teacherAllowed(session.info, teacherUuid))
          return json(res, 403, { error: 'Zugang nur für Lehrkräfte.' });
        if (!idm || !getIdmToken)
          return json(res, 503, {
            error: 'Die IServ-Mitgliederabfrage ist noch nicht freigegeben.',
          });
        const groups = directoryGroups(await directory('groups', userUuid(session.info)));
        const classes = filterClasses(session.info, groups);
        session.usageClasses = classes;
        if (url.pathname === '/klassentools/api/classes')
          return json(res, 200, { classes, rosterReady: !!idm && !!studentUuid });
        const match = url.pathname.match(
          /^\/klassentools\/api\/classes\/([a-zA-Z0-9-]{1,64})\/members$/,
        );
        const group = match && classes.find((g) => g.id === match[1]);
        if (!group) return json(res, 403, { error: 'Kein Zugriff auf diese Klasse.' });
        if (!studentUuid)
          return json(res, 503, {
            error: 'Die Student-Rollenkennung muss noch eingerichtet werden.',
          });
        const members = studentsOnly(
          await directory('members', group.id),
          studentUuid,
          teacherUuid,
        );
        return json(res, 200, { group, members, updatedAt: now(), photosEnabled: !!photos });
      }
      if (req.method === 'GET' && url.pathname === '/klassentools/api/session') {
        if (!session) return json(res, 200, { authenticated: false });
        if (now() - session.checked >= 60000) {
          await refreshSession(sid, session);
        }
        const teacher = teacherAllowed(session.info, teacherUuid);
        if (teacherUuid && !teacher) {
          sessions.delete(sid);
          return json(res, 403, { error: 'Zugang nur für Lehrkräfte.' });
        }
        return json(res, 200, {
          authenticated: true,
          teacher,
          admin: isAdmin(session.info),
          setupRequired: !teacherUuid,
          name: typeof session.info.name === 'string' ? session.info.name : 'IServ-Konto',
          roles: !teacherUuid ? rolesOf(session.info) : undefined,
          groups: teacher ? groupsOf(session.info) : [],
          csrf: session.csrf,
          expiresAt: session.expires,
        });
      }
      return json(res, 404, { error: 'Nicht gefunden.' });
    } catch (error) {
      if (error instanceof HttpError) return json(res, error.status, { error: error.message });
      // Never log OIDC exceptions: they can contain tokens, codes or claims.
      if (req.url?.startsWith('/klassentools/oidc/callback'))
        return redirect(res, '/klassentools/?login=failed');
      json(res, 503, {
        error: 'IServ ist derzeit nicht erreichbar. Bitte versuchen Sie es erneut.',
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  server.on('close', () => clearInterval(cleaner));
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (!dir) throw new Error('Missing service credentials');
  const secret = readFileSync(`${dir}/oidc-secret`, 'utf8').trim();
  if (!secret) throw new Error('Empty service credential');
  const settings = JSON.parse(
    readFileSync(process.env.KLASSENTOOLS_CONFIG || '/etc/klassentools/config.json', 'utf8'),
  );
  let instance;
  const getProvider = () => {
    if (!instance)
      instance = provider(settings.clientId, secret).catch(() => {
        instance = undefined;
        throw new Error('OIDC unavailable');
      });
    return instance;
  };
  const getIdmToken =
    settings.idmEnabled === true
      ? tokenSource(JSON.parse(readFileSync(`${dir}/idm-credentials`, 'utf8')))
      : null;
  if (getIdmToken) {
    const roles = await idmClient().roles(await getIdmToken());
    if (
      ![settings.teacherRoleUuid, settings.studentRoleUuid].every((id) =>
        roles.some((r) => r.hexUuid === id),
      )
    )
      throw new Error('IDM role setup invalid');
  }
  const classCatalog = settings.catalogPath
    ? catalogStore(settings.catalogPath, { required: true })
    : null;
  classCatalog?.read();
  const photos = settings.photoDatabasePath ? photoStore(settings.photoDatabasePath) : null;
  const usage = settings.photoDatabasePath
    ? usageStore(join(dirname(settings.photoDatabasePath), 'usage.sqlite'))
    : null;
  const app = createApp({
    classifyNetwork: networkClassifier(
      settings.schoolNetworks || [],
      settings.trustedUsageNetworkHeader === true,
    ),
    usage,
    photos,
    getIdmToken,
    getProvider,
    teacherUuid: settings.teacherRoleUuid || '',
    studentUuid: settings.studentRoleUuid || '',
    catalog: settings.classNames || [],
    adminUsers: settings.adminUserUuids || [],
    classCatalog,
    idm: settings.idmEnabled === true ? idmClient() : null,
  });
  app.listen('/run/klassentools/backend.sock', () => {
    chmodSync('/run/klassentools/backend.sock', 0o660);
    console.log('KlassenTools login service ready');
  });
}
