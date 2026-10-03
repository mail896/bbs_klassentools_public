// Pure learning rules shared by the protected server and the local fictional demo.
export const modes = ['photo-name', 'name-photo', 'cards', 'typing', 'company'];
export const normalizeName = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]/gu, '');
const distance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
export function matchesName(input, target, names) {
  const value = normalizeName(input),
    expected = normalizeName(target);
  if (!value || !expected) return false;
  if (value === expected) return true;
  if (names.some((n) => normalizeName(n) !== expected && normalizeName(n) === value)) return false;
  return (
    expected.length >= 5 &&
    distance(value, expected) <= 1 &&
    !names.some((n) => normalizeName(n) !== expected && distance(value, normalizeName(n)) <= 1)
  );
}
export function label(p, nameMode, people) {
  return nameMode === 'first' &&
    people.filter((x) => normalizeName(x.first) === normalizeName(p.first)).length === 1
    ? p.first
    : `${p.first} ${p.last}`;
}
export function createRound(people, settings, now = Date.now()) {
  if (
    !modes.includes(settings.mode) ||
    !['10', 'class', 'time', 'free'].includes(settings.limit) ||
    !['first', 'full'].includes(settings.names)
  )
    throw new Error('Ungültige Lerneinstellungen.');
  const eligible = people.filter((p) => p.hasPhoto && (settings.mode !== 'company' || p.company));
  if (!eligible.length)
    throw new Error(
      'Für diesen Modus sind noch keine passenden Fotos bzw. Betriebszuordnungen vorhanden.',
    );
  return {
    people: eligible,
    companies: [...new Set(people.map((p) => p.company).filter(Boolean))],
    settings,
    started: now,
    timing: settings.limit === 'time' && settings.mode !== 'cards' ? 'active-v1' : 'elapsed',
    pausedMs: 0,
    feedbackUntil: null,
    deadline: settings.limit === 'time' ? now + 60000 : null,
    goal: settings.limit === '10' ? 10 : settings.limit === 'class' ? eligible.length : 200,
    answered: 0,
    correct: 0,
    history: [],
    current: null,
    feedback: null,
    done: false,
  };
}
export function nextQuestion(round, progress, now = Date.now(), random = Math.random) {
  if (round.current && !round.feedback) return;
  if (!round.done && round.feedbackUntil && now < round.feedbackUntil) return;
  if (round.done || round.answered >= round.goal || (round.deadline && now >= round.deadline)) {
    round.done = true;
    return;
  }
  const key = (p) => `${p.id}|${round.settings.mode}|${round.settings.names}`;
  const recentCount = Math.min(2, round.people.length - 1);
  const recent = recentCount ? round.history.slice(-recentCount) : [];
  let pool = round.people.filter((p) => !recent.includes(p.id));
  const unseen = round.people.filter((p) => !round.history.includes(p.id));
  if (unseen.length || round.settings.limit === 'class') pool = unseen;
  if (!pool.length) {
    round.done = true;
    return;
  }
  const weighted = pool.map((p) => ({
    p,
    w:
      1 +
      (progress[key(p)]?.wrong || 0) * 2 +
      (progress[key(p)]?.due <= now ? 4 : 0) +
      (round.history.includes(p.id) ? 0 : 2),
  }));
  let draw = random() * weighted.reduce((s, x) => s + x.w, 0),
    target = weighted.at(-1).p;
  for (const x of weighted) {
    draw -= x.w;
    if (draw <= 0) {
      target = x.p;
      break;
    }
  }
  const alternatives = round.people
    .filter(
      (p) =>
        p.id !== target.id &&
        (!['photo-name', 'name-photo'].includes(round.settings.mode) ||
          !target.learningGroup ||
          p.learningGroup === target.learningGroup),
    )
    .map((p) => ({ p, r: random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 3)
    .map((x) => x.p);
  const choices = [target, ...alternatives]
    .map((p) => ({
      id: p.id,
      label: label(p, round.settings.names, round.people),
      company: p.company || '',
    }))
    .map((p) => ({ p, r: random() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
  const companyChoices =
    round.settings.mode === 'company'
      ? [
          target.company,
          ...[...new Set(round.companies || round.people.map((p) => p.company))]
            .filter((c) => c && c !== target.company)
            .map((c) => ({ c, r: random() }))
            .sort((a, b) => a.r - b.r)
            .slice(0, 3)
            .map((x) => x.c),
        ]
          .map((c) => ({ c, r: random() }))
          .sort((a, b) => a.r - b.r)
          .map((x) => x.c)
      : [];
  round.current = {
    id: target.id,
    label: label(target, round.settings.names, round.people),
    company: target.company || '',
    choices,
    companyChoices,
    index: round.answered,
  };
  round.feedback = null;
  round.feedbackUntil = null;
}
export function answerQuestion(round, progress, answer, now = Date.now()) {
  if (round.done || !round.current || round.feedback) return;
  if (round.deadline && now >= round.deadline) {
    round.done = true;
    return;
  }
  const q = round.current,
    mode = round.settings.mode;
  if (mode === 'cards') {
    const key = `${q.id}|${mode}|${round.settings.names}`;
    progress[key] = { views: (progress[key]?.views || 0) + 1 };
    round.answered++;
    round.history.push(q.id);
    round.feedback = {
      revealed: true,
      correct: null,
      label: q.label,
      id: q.id,
      company: q.company,
    };
    return;
  }
  if (round.deadline && round.timing === 'active-v1') {
    round.deadline += 2000;
    round.pausedMs += 2000;
    round.feedbackUntil = now + 2000;
  }
  const correct =
    mode === 'typing'
      ? matchesName(
          answer,
          q.label,
          round.people.map((p) => label(p, round.settings.names, round.people)),
        )
      : mode === 'company'
        ? answer === q.company
        : answer === q.id || q.choices.some((p) => p.id === answer && p.label === q.label);
  const key = `${q.id}|${mode}|${round.settings.names}`,
    old = progress[key] || { right: 0, wrong: 0, streak: 0, due: 0 };
  old.right += correct ? 1 : 0;
  old.wrong += correct ? 0 : 1;
  old.streak = correct ? old.streak + 1 : 0;
  old.due = now + (correct ? Math.min(30, 2 ** Math.min(old.streak - 1, 5)) * 86400000 : 120000);
  progress[key] = old;
  round.answered++;
  round.correct += correct ? 1 : 0;
  round.history.push(q.id);
  round.feedback = { correct, label: q.label, id: q.id, company: q.company };
}
export function roundView(r) {
  return {
    settings: r.settings,
    goal: r.goal,
    deadline: r.deadline,
    feedbackUntil: r.feedbackUntil,
    answered: r.answered,
    correct: r.correct,
    question: r.current,
    feedback: r.feedback,
    done: r.done,
  };
}
