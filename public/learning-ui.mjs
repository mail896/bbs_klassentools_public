import { paginate } from './admin-ui.mjs?v=af1f701092f9';
import {
  createRound,
  createPracticeRound,
  readyQuestion,
  nextQuestion,
  answerQuestion,
  roundView,
} from './learning-core.mjs?v=638833fa0af4';
const modeLabels = {
  'photo-name': 'Foto → Name',
  'name-photo': 'Name → Foto',
  cards: 'Karteikarten',
  typing: 'Namen eingeben',
  company: 'Ausbildungsbetrieb',
};
export function createLearningUI({
  context,
  face,
  escapeHTML: esc,
  groups,
  onCompanies = () => {},
  notify,
}) {
  const $ = (id) => document.getElementById(id),
    host = $('learning-panel');
  let epoch = 0,
    round = null,
    progress = {},
    localRound = null,
    busy = false,
    tick = null,
    advance = null,
    companyGeneration = 0,
    companyBusy = false,
    purpose = 'learn',
    questionTick = null,
    questionPreparing = false;
  const api = async (path, body) => {
    const c = context(),
      response = await fetch('./api/' + path, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': c.csrf || '' } : {},
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.');
    return data;
  };
  const status = (t) => {
    $('learn-status').textContent = t;
    $('learn-status').className = '';
  };
  const prefix = () => `classes/${encodeURIComponent(context().group)}/`;
  const person = (id) => context().people.find((p) => String(p.memberId || p.id) === id);
  const portrait = (id, caption = '') => {
    const p = person(id);
    return p
      ? `<div class="learn-photo">${face(p)}</div>${caption ? `<strong>${esc(caption)}</strong>` : ''}`
      : '';
  };
  const intro = () => {
    const c = context();
    const people = c.local
      ? c.people
      : [...c.people].sort(
          (a, b) => a.last.localeCompare(b.last, 'de') || a.first.localeCompare(b.first, 'de'),
        );
    return `<div class="learn-intro"><div class="learn-intro-background grid" data-large="${people.length > 24}" aria-hidden="true">${people
      .map(
        (p) =>
          `<div class="learn-background-card"><div class="portrait">${face(p)}</div><div class="person-name"><span class="first">${esc(p.first)}</span><span class="last">${esc(p.last)}</span></div></div>`,
      )
      .join(
        '',
      )}</div><div class="learn-intro-content"><div class="learn-symbol" aria-hidden="true"><span>?</span><span>✓<small>Name erkannt</small></span></div><div class="learn-intro-copy"><h2>Wer ist wer?</h2><p>Gesichter kennenlernen. Namen behalten.</p><p>Wählen Sie Lernen oder Quiz und starten Sie Ihre Runde.</p></div></div></div>`;
  };
  const dataKey = 'klassentools.learning.demo.v1';
  const saveLocal = () => {
    if (context().group || context().local) return;
    try {
      localStorage.setItem(dataKey, JSON.stringify(progress));
    } catch {
      status('Lernfortschritt kann in diesem Browser nicht gespeichert werden.');
    }
  };
  function personal() {
    const mode = $('learn-mode').value,
      names = $('learn-names').value;
    const list = context()
      .people.map((p) => progress[`${p.memberId || p.id}|${mode}|${names}`])
      .filter(Boolean);
    $('learn-progress').textContent =
      mode === 'cards'
        ? `${list.length} Namen angesehen · ohne Bewertung`
        : `${list.length} ${list.length === 1 ? 'Name' : 'Namen'} geübt · ${list.filter((p) => p.streak >= 3).length} sicher · ${list.filter((p) => p.due <= Date.now()).length} zur Wiederholung fällig`;
  }
  host.innerHTML = `<aside class="learn-settings"><h2>Namen lernen</h2><p>Gesichter wiedererkennen. Namen sicher behalten.</p><div class="learn-purpose" role="group" aria-label="Lernen oder Quiz"><button type="button" id="learn-purpose-learn" aria-pressed="true">Lernen</button><button type="button" id="learn-purpose-quiz" aria-pressed="false">Quiz</button></div><p id="learn-purpose-hint"></p><label for="learn-mode">Übungsart</label><select id="learn-mode">${Object.entries(
    modeLabels,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      '',
    )}</select><label for="learn-names">Namen</label><select id="learn-names"><option value="full">Vor- und Nachname</option><option value="first">Vorname (bei gleichen Namen vollständig)</option></select><label for="learn-limit">Runde</label><select id="learn-limit"><option value="10">10 Fragen</option><option value="class">Ganze Klasse</option><option value="time">60 Sekunden</option><option value="free">Ohne Zeitdruck üben (bis 200 Fragen)</option></select><button type="button" class="primary" id="learn-start">Lernrunde starten</button><button type="button" id="learn-finish" hidden>Runde beenden</button><p id="learn-progress"></p><p id="learn-storage"></p><button type="button" id="learn-reset">Meinen Lernfortschritt zurücksetzen</button></aside><section class="learn-stage"><div class="learn-top"><strong id="learn-count"></strong><span id="learn-clock"></span></div><div class="learn-surface work-surface"><div id="learn-question"><h2>Wer ist wer?</h2><p>Wählen Sie einen Modus und starten Sie Ihre erste Runde.</p></div><div id="learn-timer" hidden><div class="learn-timer-caption"><span>Zeit für diese Frage</span><span id="learn-seconds"></span></div><div id="learn-time-track" role="progressbar" aria-label="Verbleibende Antwortzeit" aria-valuemin="0"><div id="learn-time-bar"></div></div></div><p id="learn-status" role="status" aria-live="polite"></p><button id="learn-next" type="button" hidden>Weiter</button></div></section>`;
  function configure() {
    const learning = purpose === 'learn';
    for (const value of ['learn', 'quiz'])
      $('learn-purpose-' + value).setAttribute('aria-pressed', String(value === purpose));
    $('learn-purpose-hint').textContent = learning
      ? 'In Ihrem Tempo. Lösungen bleiben sichtbar, bis Sie weitergehen.'
      : '5 Sekunden für Namen und Fotos, 10 für Betriebe, 20 beim Eintippen. Danach automatisch weiter.';
    for (const option of $('learn-mode').options) {
      option.hidden = option.disabled = learning
        ? option.value === 'typing'
        : option.value === 'cards';
    }
    if ($('learn-mode').selectedOptions[0].disabled) $('learn-mode').value = 'photo-name';
    for (const option of $('learn-limit').options) {
      option.hidden = option.disabled = learning
        ? option.value === 'time'
        : option.value === 'free';
    }
    if ($('learn-limit').selectedOptions[0].disabled) $('learn-limit').value = '10';
    $('learn-start').textContent = learning ? 'Lernrunde starten' : 'Quiz starten';
    personal();
  }
  for (const value of ['learn', 'quiz'])
    $('learn-purpose-' + value).onclick = () => {
      if (busy || (round && !round.done)) return;
      purpose = value;
      round = null;
      localRound = null;
      configure();
      $('learn-question').innerHTML = intro();
      $('learn-count').textContent =
        value === 'learn' ? 'Lernen in Ihrem Tempo' : 'Bereit für Ihr Quiz';
      status('');
      render();
    };
  configure();
  function controls() {
    for (const b of host.querySelectorAll('button')) b.disabled = busy;
    for (const id of [
      'learn-purpose-learn',
      'learn-purpose-quiz',
      'learn-mode',
      'learn-names',
      'learn-limit',
      'learn-start',
      'learn-reset',
    ])
      $(id).disabled = busy || (!!round && !round.done) || context().loading;
  }
  function questionControls() {
    const disabled = busy || questionPreparing;
    $('learn-question')
      .querySelectorAll('[data-answer], #learn-input, #learn-input-form button')
      .forEach((el) => {
        el.disabled = disabled;
      });
  }
  async function prepareQuestion(version, index) {
    questionPreparing = true;
    questionControls();
    const root = $('learn-question');
    const images = [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {}));
    // Demo portraits are a CSS sprite, so load that shared image as well.
    if (root.querySelector('.demo-portrait')) {
      const img = new Image();
      img.src = './demo-portraits.webp';
      images.push(img.decode().catch(() => {}));
    }
    await Promise.race([Promise.all(images), new Promise((resolve) => setTimeout(resolve, 4000))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (version !== epoch || round?.question?.index !== index || round?.done || round?.feedback)
      return;
    questionPreparing = false;
    await action('ready');
  }
  function startQuestionClock() {
    const duration = round.questionMs;
    if (!duration || round.feedback || round.done) return;
    if (!round.question.ready) {
      questionPreparing = true;
      const version = epoch,
        index = round.question.index;
      // render() runs inside run(); start the readiness request after that request finishes.
      advance = setTimeout(() => prepareQuestion(version, index), 0);
      return;
    }
    questionPreparing = false;
    const ends = performance.now() + Math.max(0, round.question.deadline - round.serverNow);
    $('learn-timer').hidden = false;
    const track = $('learn-time-track');
    track.setAttribute('aria-valuemax', String(duration / 1000));
    const update = () => {
      const remaining = Math.max(0, ends - performance.now());
      const seconds = Math.ceil(remaining / 1000);
      $('learn-seconds').textContent = seconds + ' s';
      track.setAttribute('aria-valuenow', String(seconds));
      $('learn-time-bar').style.transform = `scaleX(${Math.min(1, remaining / duration)})`;
      $('learn-timer').classList.toggle('is-ending', remaining <= 2000);
      if (!remaining && !busy) {
        clearInterval(questionTick);
        action('answer', '');
      }
    };
    update();
    questionTick = setInterval(update, 50);
  }
  async function run(fn) {
    if (busy) return;
    const version = epoch;
    busy = true;
    for (const b of host.querySelectorAll('button')) b.disabled = true;
    try {
      await fn(version);
    } catch (e) {
      if (version === epoch) {
        status(e.message + ' Sie können den Vorgang erneut versuchen.');
        if (round?.feedback && !round.done) $('learn-next').hidden = false;
        else if (round?.questionMs && !round.question.ready && !round.done) {
          $('learn-next').textContent = 'Frage erneut starten';
          $('learn-next').hidden = false;
        }
      }
    } finally {
      if (version === epoch) {
        busy = false;
        controls();
        questionControls();
      }
    }
  }
  function render() {
    host.classList.toggle('learn-running', !!round && !round.done);
    clearInterval(tick);
    clearInterval(questionTick);
    questionPreparing = false;
    $('learn-timer').hidden = true;
    clearTimeout(advance);
    $('learn-finish').hidden = !round || round.done;
    $('learn-next').hidden = true;
    $('learn-next').textContent =
      round?.answered >= round?.goal
        ? 'Runde abschließen'
        : round?.settings.mode === 'cards'
          ? 'Nächste Karte'
          : 'Nächste Frage';
    controls();
    $('learn-status').className = '';
    if (!round) return;
    $('learn-count').textContent =
      `${round.answered}${round.settings.limit === 'free' || round.settings.limit === 'time' ? '' : ' / ' + round.goal}${round.settings.mode === 'cards' ? ' Karten angesehen' : ` beantwortet · ${round.correct} richtig`}`;
    const clock = () => {
      $('learn-clock').textContent =
        round?.deadline && !round.done
          ? Math.max(
              0,
              Math.ceil((round.deadline - Math.max(Date.now(), round.feedbackUntil || 0)) / 1000),
            ) +
            ' Sekunden' +
            (round.feedbackUntil > Date.now() ? ' · Pause' : '')
          : '';
      if (
        round?.deadline &&
        !round.done &&
        Date.now() >= round.deadline &&
        !busy &&
        (!round.questionMs || round.feedback)
      )
        action('finish');
    };
    clock();
    if (round.deadline && !round.done) tick = setInterval(clock, 500);
    if (round.done) {
      const learning = round.settings.purpose === 'learn';
      const cards = round.settings.mode === 'cards';
      const percentage = round.answered ? Math.round((round.correct / round.answered) * 100) : 0;
      $('learn-count').textContent = 'Runde abgeschlossen';
      $('learn-question').innerHTML =
        `<div class="learn-summary"><div class="learn-trophy" aria-hidden="true">${cards || learning ? '<svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><rect x="13" y="14" width="43" height="54" rx="5" fill="#ffe33b" stroke="#b78b16" stroke-width="3"/><rect x="24" y="8" width="43" height="54" rx="5" fill="#d9f9e2" stroke="#368050" stroke-width="3"/><path d="m34 34 8 8 15-19" stroke="#368050" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M22 17H9v10c0 12 9 17 20 17m29-27h13v10c0 12-9 17-20 17" stroke="#b78b16" stroke-width="5"/><path d="M22 10h36v22c0 13-7 21-18 21s-18-8-18-21Z" fill="#ffe33b" stroke="#b78b16" stroke-width="3"/><path d="M40 53v13" stroke="#b78b16" stroke-width="7"/><path d="M25 68h30v6H25z" fill="#b78b16"/><path d="m40 18 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" fill="#d2a522"/></svg>'}</div><h2>${learning ? 'Diese Namen haben Sie geübt' : cards ? 'Namen kennengelernt' : 'Ihr Quizergebnis'}</h2><p class="learn-result">${learning ? `${round.answered} ${cards ? 'Karten angesehen' : 'Antworten geübt'}` : cards ? `${round.answered} Karten angesehen` : `${round.correct} von ${round.answered} richtig`}</p>${cards || learning ? '' : `<div class="learn-summary-stats"><div><strong>${round.correct}</strong><span>✓ Richtig</span></div><div><strong>${round.answered - round.correct}</strong><span>✕ Noch üben</span></div><div><strong>${percentage} %</strong><span>Trefferquote</span></div></div>`}<p>${learning ? 'Sie bestimmen das Tempo. Ihr Fortschritt hilft bei der nächsten Übung.' : cards ? 'Testen Sie Ihre Namenkenntnisse auch in einem Quiz.' : round.answered === 0 ? 'Starten Sie eine neue Runde, wenn Sie bereit sind.' : percentage === 100 ? 'Alle Antworten richtig – weiter so!' : 'Mit jeder Runde werden die Namen vertrauter.'}</p><button type="button" class="primary" id="learn-restart">Noch eine Runde</button></div>`;
      if (!learning && round.review?.length) {
        const section = document.createElement('section');
        section.className = 'learn-review';
        section.innerHTML = `<h3>Diese Namen noch einmal üben</h3><div class="learn-review-people">${round.review.map((p) => `<div>${portrait(p.id, p.label)}</div>`).join('')}</div><button type="button" id="learn-practice">Als Karteikarten üben</button>`;
        $('learn-question').querySelector('.learn-summary').append(section);
        $('learn-practice').onclick = () => action('practice');
      }
      $('learn-restart').onclick = () => $('learn-start').click();
      status(
        context().group
          ? 'Ihr Lernfortschritt ist gespeichert.'
          : context().local
            ? 'Der Fortschritt dieses Fototests bleibt nur in dieser Sitzung.'
            : 'Ihr Lernfortschritt bleibt in diesem Browser.',
      );
      personal();
      return;
    }
    const q = round.question;
    if (!q) return;
    if (round.settings.mode === 'cards') {
      const cardKey = `${q.id}:${q.index}`;
      if ($('learn-flip')?.dataset.question !== cardKey) {
        $('learn-question').innerHTML =
          `<button type="button" id="learn-flip" data-question="${esc(cardKey)}" aria-label="Lernkarte umdrehen" aria-pressed="false"><span class="learn-flip-inner"><span class="learn-flip-front">${portrait(q.id)}</span><span class="learn-flip-back"><strong>${esc(q.label)}</strong>${q.company ? `<small>${esc(q.company)}</small>` : ''}</span></span></button><p>Klicken Sie zum Aufdecken. Beim Zurückdrehen folgt die nächste Karte.</p>`;
        $('learn-flip').onclick = () => {
          if (!round.feedback) action('answer', 'reveal');
          else {
            if (!$('learn-flip').classList.contains('is-flipped')) return;
            const flipped = $('learn-flip').classList.toggle('is-flipped');
            $('learn-flip').setAttribute('aria-pressed', String(flipped));
            $('learn-flip').setAttribute(
              'aria-label',
              flipped ? q.label + ' – Karte umdrehen' : 'Lernkarte umdrehen',
            );
            $('learn-flip').disabled = true;
            const version = epoch;
            advance = setTimeout(
              () => {
                if (version === epoch) action('next');
              },
              matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550,
            );
          }
        };
      }
      if (round.feedback) {
        $('learn-flip').classList.add('is-flipped');
        $('learn-flip').setAttribute('aria-pressed', 'true');
        $('learn-flip').setAttribute('aria-label', q.label + ' – Karte umdrehen');
      }
      status('');
      return;
    }
    if (round.feedback) {
      const f = round.feedback;
      $('learn-question').innerHTML =
        `<div class="learn-reveal">${portrait(f.id, f.label)}${f.company ? `<p>${esc(f.company)}</p>` : ''}</div>`;
      status(
        f.correct
          ? '✓ Richtig!'
          : (f.timedOut ? '⌛ Zeit abgelaufen – richtig ist: ' : '✕ Falsch – richtig ist: ') +
              (round.settings.mode === 'company' ? f.company : f.label),
      );
      $('learn-status').className = f.correct ? 'learn-correct' : 'learn-wrong';
      const version = epoch;
      if (round.settings.purpose === 'learn') $('learn-next').hidden = false;
      else
        advance = setTimeout(() => {
          if (version === epoch && round?.feedback && !round.done) action('next');
        }, 2000);
      return;
    }
    status('');
    const mode = round.settings.mode;
    $('learn-question').innerHTML =
      (mode === 'name-photo'
        ? `<h2>Wer ist ${esc(q.label)}?</h2>`
        : `<div class="learn-prompt">${portrait(q.id)}</div>`) +
      (mode === 'typing'
        ? '<form id="learn-input-form"><label for="learn-input">Wie heißt diese Person?</label><input id="learn-input" maxlength="160" autocomplete="off" required><button type="submit" class="primary">Antwort prüfen</button></form>'
        : `<div class="learn-choices ${mode === 'name-photo' ? 'learn-photo-choices' : ''}">${mode === 'company' ? (q.companyChoices || [...new Set(q.choices.map((p) => p.company))]).map((c) => `<button type="button" data-answer="${esc(c)}">${esc(c)}</button>`).join('') : q.choices.map((p, i) => `<button type="button" ${mode === 'name-photo' ? `aria-label="Foto ${i + 1}"` : ''} data-answer="${esc(p.id)}">${mode === 'name-photo' ? portrait(p.id) : esc(p.label)}</button>`).join('')}</div>`);
    $('learn-question')
      .querySelectorAll('[data-answer]')
      .forEach((b) => (b.onclick = () => action('answer', b.dataset.answer)));
    startQuestionClock();
    $('learn-input')?.focus({ preventScroll: true });
    if ($('learn-input-form'))
      $('learn-input-form').onsubmit = (e) => {
        e.preventDefault();
        action('answer', $('learn-input').value);
      };
  }
  async function action(action, answer) {
    clearTimeout(advance);
    await run(async (version) => {
      const body = {
        id: round.id,
        index: round.answered,
        action,
        ...(answer !== undefined ? { answer } : {}),
      };
      let response;
      if (context().group) response = await api(prefix() + 'learning', body);
      else {
        if (action === 'practice') {
          localRound = createPracticeRound(localRound);
          nextQuestion(localRound, progress);
        } else if (action === 'ready') readyQuestion(localRound);
        else if (action === 'answer') answerQuestion(localRound, progress, answer);
        else if (action === 'next') nextQuestion(localRound, progress);
        else localRound.done = true;
        response = { id: 'demo', ...roundView(localRound) };
        saveLocal();
      }
      if (version !== epoch) return;
      round = response;
      if (action === 'practice') {
        purpose = 'learn';
        $('learn-mode').value = round.settings.mode;
        $('learn-names').value = round.settings.names;
        $('learn-limit').value = round.settings.limit;
        configure();
      }
      if (response.progress) progress = response.progress;
      render();
    });
  }
  $('learn-next').onclick = () =>
    action(round?.questionMs && !round.question.ready ? 'ready' : 'next');
  $('learn-finish').onclick = () => action('finish');
  $('learn-mode').onchange = $('learn-names').onchange = personal;
  $('learn-start').onclick = () =>
    run(async (version) => {
      const settings = {
        purpose,
        mode: $('learn-mode').value,
        names: $('learn-names').value,
        limit: $('learn-limit').value,
      };
      let response;
      if (context().group)
        response = await api(prefix() + 'learning', { action: 'start', settings });
      else {
        const people = context().people.map((p) => ({
          id: String(p.memberId || p.id),
          first: p.first,
          learningGroup: context().local ? undefined : p.learningGroup,
          last: p.last,
          hasPhoto: !!p.photo || Number.isInteger(p.demoPortrait),
          company: context().local
            ? ''
            : ['Musterwerk GmbH', 'Beispieltechnik AG', 'Lernwerkstatt OHG', 'Demo-Handel KG'][
                p.id % 4
              ],
        }));
        localRound = createRound(people, settings);
        nextQuestion(localRound, progress);
        response = { id: 'demo', ...roundView(localRound) };
      }
      if (version !== epoch) return;
      round = response;
      render();
      if (matchMedia('(max-width: 750px)').matches)
        host.querySelector('.learn-stage').scrollIntoView({ block: 'start' });
    });
  $('learn-reset').onclick = () => {
    if (!confirm('Nur Ihren eigenen Lernfortschritt für diese Klasse zurücksetzen?')) return;
    run(async (version) => {
      if (context().group) await api(prefix() + 'learning', { action: 'reset' });
      if (version !== epoch) return;
      progress = {};
      saveLocal();
      personal();
      status('Ihr Lernfortschritt wurde zurückgesetzt.');
    });
  };
  function reset({ keepLocalProgress = false } = {}) {
    const retained = keepLocalProgress && context().local && !context().group ? progress : {};
    epoch++;
    busy = false;
    round = null;
    localRound = null;
    progress = retained;
    companyGeneration++;
    clearInterval(tick);
    clearInterval(questionTick);
    questionPreparing = false;
    $('learn-timer').hidden = true;
    clearTimeout(advance);
    $('company-assignment').replaceChildren();
    $('learn-question').innerHTML = intro();
    $('learn-count').textContent = 'Bereit für Ihre Lernrunde';
    $('learn-clock').textContent = '';
    status('');
    render();
  }
  async function open() {
    reset({ keepLocalProgress: true });
    const version = epoch;
    $('learn-storage').textContent = context().group
      ? 'Ihr Fortschritt wird privat für Ihr IServ-Konto gespeichert.'
      : context().local
        ? 'Eigene lokale Klasse: Fortschritt nur in diesem Browserfenster. Neuladen verwirft ihn.'
        : 'DEMO: Fortschritt nur in diesem Browser.';
    try {
      if (context().group) {
        busy = true;
        controls();
        const data = await api(prefix() + 'learning');
        if (version !== epoch) return;
        progress = data.progress;
      } else if (!context().local) {
        try {
          const stored = JSON.parse(localStorage.getItem(dataKey));
          progress = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        } catch {
          progress = {};
        }
      }
      personal();
    } catch (e) {
      if (version === epoch) status(e.message);
    } finally {
      if (version === epoch) {
        busy = false;
        controls();
      }
    }
  }
  $('management').addEventListener('close', () => companyGeneration++);
  async function manageCompanies() {
    const generation = ++companyGeneration;
    const current = () => generation === companyGeneration && version === epoch;
    const version = epoch,
      group = context().group;
    $('company-assignment').innerHTML =
      '<h3>Ausbildungsbetriebe</h3><p>Zuordnungen werden für berechtigte Lehrkräfte gemeinsam gespeichert und protokolliert.</p>';
    if (!group) {
      $('company-assignment').innerHTML += '<p>Für eigene IServ-Klassen verfügbar.</p>';
      return;
    }
    try {
      const data = await api(prefix() + 'companies');
      if (!current()) return;
      onCompanies(data);
      const opts = (selected) =>
        '<option value="">Kein Betrieb zugeordnet</option>' +
        data.companies
          .filter((c) => c.active || c.id === selected)
          .map(
            (c) =>
              `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name + (c.city ? ' · ' + c.city : '') + (!c.active ? ' (inaktiv)' : ''))}</option>`,
          )
          .join('');
      $('company-assignment').innerHTML +=
        `<label>Betrieb suchen<input id="company-filter" type="search" placeholder="Name oder Ort"></label><div id="company-search-results" aria-live="polite"></div><label>Für markierte Schüler<select id="company-bulk">${opts('')}</select></label><button type="button" id="company-bulk-apply">Auf Markierte anwenden</button><div class="company-rows">${context()
          .people.map(
            (p) =>
              `<div class="company-row"><input type="checkbox" data-company-check="${esc(p.memberId)}" aria-label="${esc(p.first + ' ' + p.last)} markieren"><span>${esc(p.first + ' ' + p.last)}</span><select data-company-member="${esc(p.memberId)}" aria-label="Betrieb für ${esc(p.first + ' ' + p.last)}">${opts(data.assignments[p.memberId])}</select></div>`,
          )
          .join(
            '',
          )}</div><button type="button" id="company-save" class="primary">Betriebszuordnungen speichern</button><p id="company-status" role="status"></p>`;
      for (const select of $('company-assignment').querySelectorAll('[data-company-member]'))
        select.dataset.savedValue = select.value;
      const filterCompanies = () => {
        const q = $('company-filter').value.trim().toLocaleLowerCase('de');
        const matches = data.companies.filter(
          (c) => c.active && `${c.name} ${c.city} ${c.short}`.toLocaleLowerCase('de').includes(q),
        );
        const bulk = $('company-bulk'),
          selected = bulk.value;
        bulk.innerHTML =
          '<option value="">Kein Betrieb zugeordnet</option>' +
          data.companies
            .filter((c) => c.id === selected || (c.active && matches.includes(c)))
            .map(
              (c) =>
                `<option value="${esc(c.id)}">${esc(c.name + (c.city ? ' · ' + c.city : ''))}</option>`,
            )
            .join('');
        bulk.value = selected;
        $('company-search-results').innerHTML = q
          ? matches.length
            ? matches
                .map(
                  (c) =>
                    `<button type="button" data-company-match="${esc(c.id)}" aria-pressed="${c.id === selected}">${esc(c.name + (c.city ? ' · ' + c.city : ''))}</button>`,
                )
                .join('')
            : '<p>Kein passender Betrieb gefunden.</p>'
          : '';
      };
      $('company-filter').oninput = filterCompanies;
      $('company-filter').onkeydown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          filterCompanies();
        }
      };
      $('company-search-results').onclick = (event) => {
        const button = event.target.closest('[data-company-match]');
        if (!button) return;
        $('company-bulk').value = button.dataset.companyMatch;
        filterCompanies();
      };
      $('company-bulk-apply').onclick = () => {
        for (const c of $('company-assignment').querySelectorAll('[data-company-check]:checked')) {
          const s = [...$('company-assignment').querySelectorAll('[data-company-member]')].find(
            (s) => s.dataset.companyMember === c.dataset.companyCheck,
          );
          s.value = $('company-bulk').value;
        }
      };
      $('company-save').onclick = async () => {
        const button = $('company-save');
        if (companyBusy) return;
        companyBusy = true;
        button.disabled = true;
        try {
          const assignments = Object.fromEntries(
            [...$('company-assignment').querySelectorAll('[data-company-member]')].map((s) => [
              s.dataset.companyMember,
              s.value,
            ]),
          );
          const saved = await api(`classes/${encodeURIComponent(group)}/companies`, {
            revision: data.revision,
            assignments,
          });
          if (!current()) return;
          data.revision = saved.revision;
          onCompanies(saved);
          $('company-status').textContent = 'Zuordnungen gespeichert.';
          $('management').close();
          notify('Betriebszuordnungen gespeichert.');
        } catch (e) {
          if (current()) $('company-status').textContent = e.message;
        } finally {
          companyBusy = false;
          button.disabled = false;
        }
      };
    } catch (e) {
      if (current()) $('company-assignment').textContent = e.message;
    }
  }
  return {
    open,
    reset,
    manageCompanies,
    api,
    groups,
    esc,
    context,
    get companyBusy() {
      return companyBusy;
    },
    companiesDirty: () =>
      [...$('company-assignment').querySelectorAll('[data-company-member]')].some(
        (select) => select.value !== select.dataset.savedValue,
      ),
  };
}
export function setupLearningAdmin(ui, activate) {
  let generation = 0,
    searchTimer;
  const reset = () => {
    generation++;
    clearTimeout(searchTimer);
  };
  const $ = (id) => document.getElementById(id),
    esc = ui.esc;
  const roundNames = {
    10: '10 Fragen',
    class: 'Ganze Klasse',
    time: '60 Sekunden',
    free: 'Freies Üben',
  };
  const describe = (d) =>
    d.mode
      ? `${modeLabels[d.mode]} · ${roundNames[d.limit]} · ${d.names === 'first' ? 'Vornamen' : 'Vollständige Namen'} · ${d.mode === 'cards' ? `${d.total} Karten angesehen · ohne Bewertung` : `${d.right} von ${d.total} richtig (${d.accuracy} %)`}${!d.complete ? ' · vorzeitig beendet / freie Runde' : ''}`
      : d.member
        ? `${d.member}: ${d.before || 'kein Betrieb'} → ${d.after || 'kein Betrieb'}`
        : d.name
          ? `${d.name}${d.city ? ' · ' + d.city : ''} · ${d.removed !== undefined ? `${d.removed} Zuordnungen entfernt` : d.count !== undefined ? `${d.count} Zuordnungen entfernt` : d.active ? 'aktiv' : 'inaktiv'}`
          : 'Persönlicher Fortschritt gelöscht';
  const companies = async () => {
    const version = generation;
    const host = $('admin-companies-panel');
    host.textContent = 'Betriebe werden geladen …';
    try {
      const data = await ui.api('admin/companies');
      if (version !== generation || !ui.context().admin || host.hidden) return;
      host.innerHTML =
        '<h2>Ausbildungsbetriebe</h2><p>Betriebe suchen, bearbeiten oder löschen. Löschen entfernt auch vorhandene Zuordnungen.</p><label>Suche<input id="admin-company-search" type="search"></label><div id="admin-company-list"></div><h3>Betrieb bearbeiten</h3><label>Name<input id="company-name" maxlength="120" required></label><label>Ort<input id="company-city" maxlength="80"></label><label>Kurzbezeichnung<input id="company-short" maxlength="50"></label><label><input id="company-active" type="checkbox" checked> Aktiv</label><button type="button" id="company-new">Neuer Betrieb</button><button type="button" id="company-admin-save" class="primary">Betrieb speichern</button><p id="company-admin-status" role="status"></p>';
      let selected = null;
      const edit = (c) => {
        selected = c;
        $('company-name').value = c?.name || '';
        $('company-city').value = c?.city || '';
        $('company-short').value = c?.short || '';
        $('company-active').checked = c ? !!c.active : true;
      };
      const list = () => {
        const q = $('admin-company-search').value.toLocaleLowerCase('de');
        $('admin-company-list').replaceChildren(
          ...data.companies
            .filter((c) => (c.name + ' ' + c.city).toLocaleLowerCase('de').includes(q))
            .map((c) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.textContent =
                c.name + (c.city ? ' · ' + c.city : '') + (!c.active ? ' (inaktiv)' : '');
              b.onclick = () => edit(c);
              const row = document.createElement('div');
              row.className = 'admin-company-row';
              const remove = document.createElement('button');
              remove.type = 'button';
              remove.className = 'company-delete';
              remove.textContent = 'Löschen';
              remove.setAttribute('aria-label', c.name + ' löschen');
              remove.onclick = async () => {
                if (
                  !confirm(
                    `„${c.name}“ löschen? Vorhandene Schülerzuordnungen werden entfernt. Der Änderungsverlauf bleibt erhalten.`,
                  )
                )
                  return;
                remove.disabled = true;
                try {
                  const result = await ui.api('admin/companies', {
                    action: 'delete',
                    id: c.id,
                    revision: c.revision,
                  });
                  if (version !== generation || !ui.context().admin || host.hidden) return;
                  data.companies = result.companies;
                  if (selected?.id === c.id) edit(null);
                  list();
                  $('company-admin-status').textContent = 'Betrieb gelöscht.';
                } catch (e) {
                  if (version === generation && !host.hidden && ui.context().admin)
                    $('company-admin-status').textContent = e.message;
                } finally {
                  remove.disabled = false;
                }
              };
              row.append(b, remove);
              return row;
            }),
        );
      };
      list();
      $('admin-company-search').oninput = list;
      $('company-new').onclick = () => edit(null);
      $('company-admin-save').onclick = async () => {
        const b = $('company-admin-save');
        b.disabled = true;
        try {
          const result = await ui.api('admin/companies', {
            id: selected?.id,
            revision: selected?.revision || 0,
            name: $('company-name').value,
            city: $('company-city').value,
            short: $('company-short').value,
            active: $('company-active').checked,
          });
          if (version !== generation || !ui.context().admin || host.hidden) return;
          data.companies = result.companies;
          list();
          edit(null);
          $('company-admin-status').textContent = 'Betrieb gespeichert und protokolliert.';
        } catch (e) {
          if (version === generation && !host.hidden && ui.context().admin)
            $('company-admin-status').textContent = e.message;
        } finally {
          b.disabled = false;
        }
      };
    } catch (e) {
      if (version === generation && !host.hidden) host.textContent = e.message;
    }
  };
  const scoreGroups = (rows, className) => {
    const groups = new Map();
    for (const row of rows) {
      const d = row.detail;
      const key = [
        className(row.class_id),
        modeLabels[d.mode],
        roundNames[d.limit] +
          (d.limit === 'time'
            ? d.timing === 'active-v1'
              ? ' (aktive Zeit)'
              : ' (bisherige Zeitwertung)'
            : ''),
        d.names === 'first' ? 'Vornamen' : 'Vollständige Namen',
        `${d.pool} Personen`,
        d.questionMs ? `${d.questionMs / 1000} Sekunden je Frage` : 'Ohne Fragenzeitlimit',
      ].join(' · ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups].map(
      ([title, list]) =>
        `<article class="score-group"><h4>${esc(title)}</h4><div class="admin-table-scroll"><table class="admin-history-table"><thead><tr><th>Platz</th><th>Lehrkraft</th><th>Richtig</th><th>Quote</th><th>Zeit</th></tr></thead><tbody>${list.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.actor)}</td><td>${r.detail.right} / ${r.detail.total}</td><td>${r.detail.accuracy} %</td><td>${r.detail.seconds} s</td></tr>`).join('')}</tbody></table></div></article>`,
    );
  };
  const audit = async () => {
    const version = generation;
    const host = $('admin-learning-panel');
    host.innerHTML =
      '<h2>Namen lernen · Highscores & Protokoll</h2><p>Nur Administration. Ranglisten getrennt nach Klasse, Modus, Namensumfang und Rundentyp. Nur abgeschlossene Quizrunden werden gewertet. Lernen speichert den persönlichen Fortschritt ohne Rangliste. Lernrunden werden 90 Tage aufbewahrt. Trainingsergebnisse sind kein Prüfungsnachweis. Auswertung der bis zu 500 neuesten passenden Ereignisse.</p><div class="admin-filters"><label>Klasse<select id="learn-audit-class"><option value="">Alle Klassen</option>' +
      ui
        .groups()
        .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`)
        .join('') +
      '</select></label><label>Suche<input id="learn-audit-search" maxlength="120" type="search"></label><button type="button" id="learn-audit-load">Suchen / neu laden</button></div><div id="learn-audit-results"></div>';
    let request = 0;
    const load = async () => {
      clearTimeout(searchTimer);
      if (version !== generation || host.hidden || !ui.context().admin) return;
      const currentRequest = ++request;
      const target = $('learn-audit-results');
      target.textContent = 'Wird geladen …';
      try {
        const data = await ui.api(
          'admin/learning-audit?group=' +
            encodeURIComponent($('learn-audit-class').value) +
            '&q=' +
            encodeURIComponent($('learn-audit-search').value),
        );
        if (
          version !== generation ||
          !ui.context().admin ||
          host.hidden ||
          !target.isConnected ||
          currentRequest !== request
        )
          return;
        const className = (id) => ui.groups().find((g) => g.id === id)?.name || id || '–';
        target.innerHTML =
          '<section class="admin-history-section"><h3>Beste abgeschlossene Runden</h3><div id="learn-scores-pages"></div></section><section class="admin-history-section"><h3>Änderungs- und Lernprotokoll</h3><div id="learn-events-pages"></div></section>';
        paginate(
          $('learn-scores-pages'),
          scoreGroups(data.highscores, className),
          5,
          (rows) => rows.join('') || '<p>Keine passenden Wertungen vorhanden.</p>',
          'Wertungen',
        );
        paginate(
          $('learn-events-pages'),
          data.entries,
          20,
          (rows) =>
            '<div class="admin-table-scroll"><table class="admin-history-table"><thead><tr><th>Zeitpunkt</th><th>Lehrkraft / Klasse</th><th>Vorgang</th></tr></thead><tbody>' +
            rows
              .map(
                (r) =>
                  `<tr><td>${esc(new Date(r.time).toLocaleString('de-DE'))}</td><td><strong>${esc(r.actor)}</strong><small>${esc(className(r.class_id))}</small></td><td><strong>${esc(r.action)}</strong><small>${esc(describe(r.detail))}</small></td></tr>`,
              )
              .join('') +
            '</tbody></table></div>',
          'Einträge',
        );
      } catch (e) {
        if (version !== generation || host.hidden || currentRequest !== request) return;
        target.textContent = e.message;
      }
    };
    $('learn-audit-search').oninput = () => {
      clearTimeout(searchTimer);
      request++;
      searchTimer = setTimeout(load, 250);
    };
    $('learn-audit-load').onclick = load;
    $('learn-audit-class').onchange = load;
    await load();
  };
  $('admin-companies-tab').onclick = () => {
    activate('companies');
    companies();
  };
  $('admin-learning-tab').onclick = () => {
    activate('learning');
    audit();
  };
  return { reset };
}
