// Pure preparation for the class uploader; receives an already authorized roster.
const normalize = (value) =>
  String(value)
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replace(/[.,_\s\u2010-\u2015-]+/g, ' ')
    .trim();
const fold = (value) =>
  normalize(value)
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    previous = row;
  }
  return previous[b.length];
}
export function matchPhoto(filename, roster) {
  if (
    typeof filename !== 'string' ||
    filename.length > 255 ||
    /[\\/]/.test(filename) ||
    !Array.isArray(roster) ||
    roster.length > 1000
  )
    throw new Error('Invalid matching input');
  if (!/\.(jpe?g|png|webp)$/i.test(filename)) return { status: 'unsupported', candidates: [] };
  const stem = filename.replace(/\.[^.]+$/, '');
  const forms = (p) => [p.account, `${p.first} ${p.last}`, `${p.last} ${p.first}`];
  if (
    roster.some(
      (p) =>
        !p ||
        ![p.id, p.account, p.first, p.last].every(
          (v) => typeof v === 'string' && v.length > 0 && v.length <= 255,
        ),
    ) ||
    new Set(roster.map((p) => p.id)).size !== roster.length
  )
    throw new Error('Invalid roster');
  const exact = roster.filter((p) => forms(p).some((v) => normalize(v) === normalize(stem)));
  if (exact.length)
    return {
      status: exact.length === 1 ? 'exact' : 'ambiguous',
      candidates: exact.map((p) => ({ id: p.id, reason: 'name' })),
    };
  const comparable = fold(stem);
  const candidates = roster
    .map((p) => ({
      id: p.id,
      distance: Math.min(...forms(p).map((v) => distance(comparable, fold(v)))),
    }))
    .filter((p) => p.distance <= Math.min(3, Math.floor(comparable.length * 0.2)))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, 5);
  return { status: candidates.length ? 'suggestion' : 'unmatched', candidates };
}
export function matchPhotos(filenames, roster) {
  if (!Array.isArray(filenames) || filenames.length > 200) throw new Error('Too many photos');
  const results = filenames.map((filename) => ({ filename, ...matchPhoto(filename, roster) }));
  const counts = new Map();
  for (const r of results)
    if (r.status === 'exact') {
      const id = r.candidates[0].id;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  return results.map((r) =>
    r.status === 'exact' && counts.get(r.candidates[0].id) > 1 ? { ...r, status: 'duplicate' } : r,
  );
}
