export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function groupSizes(total, value, method) {
  if (!Number.isInteger(total) || total < 4)
    throw new Error(
      'Für Teams werden mindestens vier anwesende Schülerinnen und Schüler benötigt.',
    );
  if (!Number.isInteger(value) || value < 2 || value > Math.floor(total / 2))
    throw new Error(`Bitte eine Zahl zwischen 2 und ${Math.floor(total / 2)} eingeben.`);
  const count =
    method === 'count'
      ? value
      : Math.max(2, Math.min(Math.floor(total / 2), Math.round(total / value)));
  return Array.from(
    { length: count },
    (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0),
  );
}
export function draw(active, seen, count, fair, random = Math.random) {
  if (active.length < 2)
    throw new Error('Für eine Zufallsauswahl müssen mindestens zwei Schüler anwesend sein.');
  if (!Number.isInteger(count) || count < 1 || count >= active.length)
    throw new Error(
      `Bitte zwischen 1 und ${active.length - 1} auswählen; mindestens eine Person bleibt übrig.`,
    );
  if (!fair) return { selected: shuffle(active, random).slice(0, count), seen, crossed: false };
  const available = active.filter((id) => !seen.includes(id));
  const first = shuffle(available, random).slice(0, count);
  if (first.length === count)
    return { selected: first, seen: [...new Set([...seen, ...first])], crossed: false };
  const next = shuffle(
    active.filter((id) => !first.includes(id)),
    random,
  ).slice(0, count - first.length);
  return { selected: [...first, ...next], seen: next, crossed: true };
}

// Inclusion probabilities before a draw, including a fair-round boundary.
export function drawChances(active, seen, count, fair) {
  if (active.length < 2 || !Number.isInteger(count) || count < 1 || count >= active.length)
    throw new Error('Ungültige Auswahlanzahl');
  const available = fair ? active.filter((id) => !seen.includes(id)).length : active.length;
  if (!available)
    return { available: active.length, fresh: true, chance: count / active.length, previous: null };
  if (count <= available)
    return {
      available,
      fresh: false,
      chance: count / available,
      previous: available < active.length ? 0 : null,
    };
  return {
    available,
    fresh: false,
    chance: 1,
    previous: (count - available) / (active.length - available),
  };
}
