export function userUuid(info) {
  const ids = [info.uuid, info['iserv:uuid']].filter((v) => v !== undefined);
  if (
    !ids.length ||
    ids.some(
      (v) =>
        typeof v !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    ) ||
    new Set(ids.map((v) => v.toLowerCase())).size !== 1
  )
    throw new Error('Missing or conflicting verified user UUID');
  return ids[0].toLowerCase();
}
export function directoryGroups(rows) {
  if (!Array.isArray(rows) || rows.length > 2000) throw new Error('Invalid group collection');
  return rows
    .filter((g) => !g.deleted)
    .map((g) => {
      if (![g.hexUuid, g.group, g.name].every((v) => typeof v === 'string' && v.length))
        throw new Error('Invalid group');
      return { id: g.hexUuid, account: g.group, name: g.name };
    });
}
// CSV supplies only known class names; membership always comes from IServ.
export function allowedClasses(info, catalog, groupsOf) {
  const names = new Set(catalog.map((s) => s.normalize('NFC').toLocaleLowerCase('de')));
  return groupsOf(info)
    .filter(
      (g) =>
        names.has(g.name.normalize('NFC').toLocaleLowerCase('de')) ||
        names.has(g.account.normalize('NFC').toLocaleLowerCase('de')),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}
export function studentsOnly(members, studentUuid, teacherUuid) {
  if (!studentUuid || !teacherUuid) throw new Error('Role configuration missing');
  if (!Array.isArray(members) || members.length > 1000)
    throw new Error('Invalid member collection');
  const result = [],
    ids = new Set();
  for (const user of members) {
    if (!Array.isArray(user.roles)) throw new Error('Missing roles');
    const roles = user.roles.map((r) => r?.hexUuid);
    if (roles.some((r) => typeof r !== 'string')) throw new Error('Invalid roles');
    if (!roles.includes(studentUuid) || roles.includes(teacherUuid) || user.deleted || user.locked)
      continue;
    if (
      ![user.hexUuid, user.user, user.firstname, user.lastname].every(
        (v) => typeof v === 'string' && v.length > 0,
      ) ||
      ids.has(user.hexUuid)
    )
      throw new Error('Invalid student');
    ids.add(user.hexUuid);
    result.push({
      id: user.hexUuid,
      account: user.user,
      first: user.firstname,
      last: user.lastname,
    });
  }
  return result.sort(
    (a, b) => a.last.localeCompare(b.last, 'de') || a.first.localeCompare(b.first, 'de'),
  );
}
export function idmClient(fetchImplementation = fetch) {
  const request = async (path, token, attributes) => {
    const url = new URL('/iserv/idm/api/v1/' + path, 'https://idm.school.example');
    url.searchParams.set('_attributes', attributes);
    const r = await fetchImplementation(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('IDM unavailable or unauthorized');
    // Bounded response, including when Content-Length is absent.
    const reader = r.body.getReader();
    let size = 0;
    const parts = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) {
        await reader.cancel();
        throw new Error('IDM response too large');
      }
      parts.push(Buffer.from(value));
    }
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!Array.isArray(data)) throw new Error('Unexpected IDM collection');
    return data;
  };
  return {
    groups: (token, user) => {
      if (!/^[0-9a-f-]{36}$/i.test(user)) throw new Error('Invalid user UUID');
      return request(
        `users/${encodeURIComponent(user)}/groups`,
        token,
        'hexUuid,group,name,deleted',
      );
    },
    allGroups: (token) => request('groups', token, 'hexUuid,group,name,deleted'),
    roles: (token) => request('roles', token, 'hexUuid,role,name'),
    members: (token, group) => {
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(group)) throw new Error('Invalid group ID');
      return request(
        `groups/${encodeURIComponent(group)}/members`,
        token,
        'hexUuid,user,firstname,lastname,locked,deleted,roles.hexUuid',
      );
    },
  };
}
