import { HttpError } from './errors.mjs';

export function validateSeating(input, members) {
  const bad = () => {
    throw new HttpError(400, 'Ungültiger Sitzplan. Bitte prüfen Sie Tische und Sitzplätze.');
  };
  if (
    !input ||
    ![1, 2].includes(input.size) ||
    !['u', 'rows'].includes(input.layout) ||
    !Number.isInteger(input.rows) ||
    input.rows < 2 ||
    input.rows > 6
  )
    bad();
  const point = (p) => {
    if (
      !p ||
      !Number.isInteger(p.x) ||
      !Number.isInteger(p.y) ||
      p.x < 0 ||
      p.x > 30000 ||
      p.y < 60 ||
      p.y > 30000
    )
      bad();
    return { x: p.x, y: p.y };
  };
  if (
    input.room &&
    (!Number.isInteger(input.room.width) ||
      !Number.isInteger(input.room.height) ||
      input.room.width < 1200 ||
      input.room.width > 31000 ||
      input.room.height < 700 ||
      input.room.height > 31000)
  )
    bad();
  const teacher = point(input.teacher),
    seen = new Set();
  if (
    !Array.isArray(input.tables) ||
    input.tables.length > Math.ceil(members.size / input.size) + 4 ||
    input.tables.length > 204
  )
    bad();
  const tables = input.tables.map((t) => {
    const xy = point(t);
    if (!Array.isArray(t.slots) || t.slots.length !== input.size) bad();
    const slots = t.slots.map((id) => {
      if (id === null) return null;
      if (typeof id !== 'string' || !members.has(id))
        throw new HttpError(
          409,
          'Die Klassenmitglieder haben sich geändert. Bitte laden Sie die Klasse neu.',
        );
      if (seen.has(id)) bad();
      seen.add(id);
      return id;
    });
    if (t.vertical !== undefined && typeof t.vertical !== 'boolean') bad();
    return { ...xy, slots, ...(t.vertical !== undefined ? { vertical: t.vertical } : {}) };
  });
  if (
    !Array.isArray(input.pinned) ||
    input.pinned.length > members.size ||
    new Set(input.pinned).size !== input.pinned.length ||
    input.pinned.some((id) => typeof id !== 'string' || !members.has(id))
  )
    bad();
  return {
    size: input.size,
    layout: input.layout,
    rows: input.rows,
    ...(input.room ? { room: { width: input.room.width, height: input.room.height } } : {}),
    teacher,
    tables,
    pinned: input.pinned,
  };
}
