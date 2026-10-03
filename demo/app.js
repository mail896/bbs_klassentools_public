import { createLearningUI } from './learning-ui.mjs?v=045fe86d9507';
import { colors, demoPeople } from './demo.mjs?v=9e9fedd7f899';
import { matchPhotos } from './photo-matching.mjs?v=7aed189788e4';
import { shuffle, groupSizes, draw, drawChances } from './logic.mjs?v=ff3b470a050d';
const $ = (id) => document.getElementById(id);
const entryCue = 'klassentools.entry';
const entryParams = new URL(location.href).searchParams;
const demoOnly = document.documentElement.dataset.demoOnly === 'true';
const adminPage = !demoOnly && entryParams.has('admin');
if (adminPage) {
  document.body.classList.add('admin-page');
  document.body.append(document.querySelector('footer'));
  document.title = 'Administration · KlassenTools';
  $('admin-access').hidden = false;
}
const landingPage =
  !adminPage &&
  !entryParams.has('demo') &&
  !entryParams.has('app') &&
  entryParams.get('login') !== 'ok';
document.body.classList.remove('entry-pending');
document.body.classList.toggle('landing-page', landingPage);
$('landing').hidden = !landingPage;
if (landingPage) document.title = 'KlassenTools · Unterricht mit einer Portion Zufall';
for (const link of document.querySelectorAll('#admin-back,#admin-access>a')) link.href = './?app=1';
let usageQueue = Promise.resolve();
function trackUsage(action, amount = 0) {
  if (demoOnly) return;
  const event = {
    id: crypto.randomUUID(),
    action,
    amount,
    context: selectedClass ? 'iserv' : localClass ? 'local' : 'demo',
    classId: selectedClass,
  };
  // Serialize requests so the first session cookie arrives before the next event.
  usageQueue = usageQueue
    .then(() =>
      fetch('./api/usage', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      }),
    )
    .catch(() => {});
}
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let theme = 'auto';
try {
  const stored = localStorage.getItem('klassentools.theme.v1');
  if (['auto', 'light', 'dark'].includes(stored)) theme = stored;
} catch {}
function applyTheme() {
  const dark = theme === 'dark' || (theme === 'auto' && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#111820' : '#f4f6f8';
  $('theme').value = theme;
}
$('theme').onchange = () => {
  theme = $('theme').value;
  applyTheme();
  try {
    localStorage.setItem('klassentools.theme.v1', theme);
  } catch {}
};
systemTheme.addEventListener('change', applyTheme);
applyTheme();
let seatingUI = null;
let seatingLoading = null;
let seatingOpenRequest = 0;
document.querySelector('.main-tabs').addEventListener('click', (event) => {
  if (event.target.closest('button')?.id !== 'seat-tab') seatingOpenRequest++;
});
$('seat-tab').onclick = async () => {
  if (running || classLoading) return;
  const request = ++seatingOpenRequest;
  try {
    seatingLoading ??= import('./seating-ui.mjs?v=1f4b5f4453f5').then(({ createSeatingUI }) => {
      seatingUI = createSeatingUI(seatingContext);
      return seatingUI;
    });
    const ui = await seatingLoading;
    if (request === seatingOpenRequest && !running && !classLoading) ui.open();
  } catch {
    seatingLoading = null;
    $('bottom-hint').textContent =
      'Der Sitzplan konnte nicht geladen werden. Bitte versuchen Sie es erneut.';
  }
};
const seatingContext = {
  get absent() {
    return absent;
  },
  get authSession() {
    return authSession;
  },
  get classLoading() {
    return classLoading;
  },
  get companyButton() {
    return companyButton;
  },
  get companyCaption() {
    return companyCaption;
  },
  get escapeHTML() {
    return escapeHTML;
  },
  get face() {
    return face;
  },
  get leaveLearning() {
    return leaveLearning;
  },
  get localClass() {
    return localClass;
  },
  get mode() {
    return mode;
  },
  set mode(value) {
    mode = value;
  },
  get people() {
    return people;
  },
  get random() {
    return random;
  },
  get result() {
    return result;
  },
  set result(value) {
    result = value;
  },
  get running() {
    return running;
  },
  get selectedClass() {
    return selectedClass;
  },
  get shuffle() {
    return shuffle;
  },
};
let adminUI = null;
let adminLoading = null;
async function openAdministration() {
  adminLoading ??= import('./administration-ui.mjs?v=82c79701758d')
    .then(({ createAdministrationUI }) => {
      adminUI = createAdministrationUI(adminContext);
      return adminUI;
    })
    .catch((error) => {
      adminLoading = null;
      throw error;
    });
  const ui = await adminLoading;
  if (authSession?.admin) await ui.open();
}
const adminContext = {
  get adminPage() {
    return adminPage;
  },
  get authSession() {
    return authSession;
  },
  get escapeHTML() {
    return escapeHTML;
  },
  get learningUI() {
    return learningUI;
  },
  get loadClasses() {
    return loadClasses;
  },
};
$('admin-open').onclick = () => {
  location.href = './?admin=classes';
};

let learningUI = null;
let people = demoPeople();
let localClass = false;
let selectedClass = '',
  classRequest = 0,
  classLoading = false;
let pendingPhotos = null,
  photoState = { enabled: false, revision: null, total: 0 },
  photoBusy = false,
  cropState = null;
function clearPhotoReview() {
  pendingPhotos = null;
  $('photo-review').replaceChildren();
  $('apply-photos').hidden = true;
  $('photo-review-tools').hidden = true;
  $('photo-review-count').textContent = '';
  $('crop-dialog').close();
  cropState = null;
}
$('management').addEventListener('close', clearPhotoReview);
$('management')
  .querySelector('form')
  .addEventListener('submit', (event) => event.preventDefault());
$('management').querySelector('.close').type = 'button';
$('cancel-photos').onclick = () => {
  if (!photoBusy) $('management').close();
};
$('management').querySelector('.close').onclick = () => {
  if (!photoBusy) $('management').close();
};
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const face = (p) =>
  p.photo
    ? `<img src="${p.photo}" alt="">`
    : Number.isInteger(p.demoPortrait)
      ? `<span class="demo-portrait" aria-hidden="true" style="background-position:${(p.demoPortrait % 6) * 20}% ${(Math.floor(p.demoPortrait / 6) * 100) / 3}%"></span>`
      : `<img class="avatar-placeholder" src="./avatar-placeholder.webp" alt="Kein Foto vorhanden">`;
const key = 'klassentools.demo.v1';
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(key)) || {};
} catch {}
let seen = Array.isArray(saved.seen)
  ? saved.seen.filter((id) => Number.isInteger(id) && id >= 0 && id < 24)
  : [];
let absent = new Set(),
  mode = 'pick',
  result = null,
  running = false,
  timer,
  pending;
$('fair').checked = saved.fair !== false;
$('animation').checked =
  saved.animation !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const active = () => people.filter((p) => !absent.has(p.id)).map((p) => p.id);
function save() {
  if (localClass) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ seen, fair: $('fair').checked, animation: $('animation').checked }),
    );
  } catch {
    $('bottom-hint').textContent = 'Speichern im Browser ist nicht verfügbar.';
  }
}
// Company details belong to the current roster; refresh on class opening or assignment.
function companyCaption(p) {
  const c = p?.companyInfo;
  return c ? `<span class="company-caption">${escapeHTML(c.short || c.name)}</span>` : '';
}
function companyButton(p) {
  return p?.companyInfo
    ? `<button type="button" class="company-info" data-company-info="${p.id}" aria-label="Ausbildungsbetrieb für ${escapeHTML(p.first + ' ' + p.last)}" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V3h12v18M16 10h4v11M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-3h2v3"/></svg></button>`
    : '';
}
const companyTip = document.createElement('div');
companyTip.id = 'company-tooltip';
companyTip.setAttribute('role', 'tooltip');
companyTip.hidden = true;
document.body.append(companyTip);
let companyAnchor = null,
  companyPinned = false;
function closeCompanyTip() {
  companyAnchor?.setAttribute('aria-expanded', 'false');
  companyAnchor?.removeAttribute('aria-describedby');
  companyAnchor = null;
  companyPinned = false;
  companyTip.hidden = true;
}
function showCompanyTip(button, pinned = false) {
  const c = people.find((p) => p.id === Number(button.dataset.companyInfo))?.companyInfo;
  if (!c) return;
  closeCompanyTip();
  (button.closest('dialog') || document.body).append(companyTip);
  companyAnchor = button;
  companyPinned = pinned;
  companyTip.innerHTML = `<strong>${escapeHTML(c.name)}</strong>${c.city ? `<span>${escapeHTML(c.city)}</span>` : ''}${c.active === false || c.active === 0 ? '<small>Inaktiver Betrieb</small>' : ''}`;
  companyTip.style.zoom = 1 / (Number.parseFloat(getComputedStyle(document.body).zoom) || 1);
  companyTip.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-describedby', companyTip.id);
  const b = button.getBoundingClientRect(),
    t = companyTip.getBoundingClientRect();
  companyTip.style.left = Math.max(8, Math.min(innerWidth - t.width - 8, b.right - t.width)) + 'px';
  companyTip.style.top =
    Math.max(8, b.bottom + t.height + 12 < innerHeight ? b.bottom + 8 : b.top - t.height - 8) +
    'px';
}
document.addEventListener(
  'click',
  (event) => {
    const button = event.target.closest('[data-company-info]');
    if (button) {
      event.stopPropagation();
      if (companyAnchor === button && companyPinned) closeCompanyTip();
      else showCompanyTip(button, true);
    } else if (!companyTip.contains(event.target)) closeCompanyTip();
  },
  true,
);
document.addEventListener('pointerover', (event) => {
  const button = event.target.closest('[data-company-info]');
  if (button && event.pointerType !== 'touch' && !companyPinned) showCompanyTip(button);
});
document.addEventListener('pointerout', (event) => {
  if (
    !companyPinned &&
    companyAnchor?.contains(event.target) &&
    !companyAnchor.contains(event.relatedTarget)
  )
    closeCompanyTip();
});
document.addEventListener('focusin', (event) => {
  const button = event.target.closest('[data-company-info]');
  if (button) showCompanyTip(button);
  else closeCompanyTip();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeCompanyTip();
});
document.addEventListener('scroll', closeCompanyTip, true);
window.addEventListener('resize', closeCompanyTip);
for (const input of document.querySelectorAll('[data-show-companies]'))
  input.onchange = () => {
    document.body.classList.toggle('show-companies', input.checked);
    for (const other of document.querySelectorAll('[data-show-companies]'))
      other.checked = input.checked;
    closeCompanyTip();
    seatingUI?.invalidateExport();
    requestAnimationFrame(fitFullscreenGrid);
  };
function applyCompanies(data) {
  for (const p of people)
    p.companyInfo = data.companies.find((c) => c.id === data.assignments[p.memberId]) || null;
  closeCompanyTip();
  render();
  seatingUI?.invalidateExport();
}
function card(p) {
  return `<div class="person-shell"><button class="person ${absent.has(p.id) ? 'absent' : ''}" data-id="${p.id}" aria-pressed="${absent.has(p.id)}" aria-label="${escapeHTML(p.first)} ${escapeHTML(p.last)}: ${absent.has(p.id) ? 'abwesend, wieder aufnehmen' : 'anwesend, ausschließen'}"><div class="portrait" style="--portrait:${p.color}">${face(p)}${absent.has(p.id) ? '<span class="badge">abwesend</span>' : ''}</div><div class="person-name"><span class="first">${escapeHTML(p.first)}</span><span class="last">${escapeHTML(p.last)}</span>${companyCaption(p)}</div></button>${companyButton(p)}</div>`;
}
function update() {
  const n = classLoading ? 0 : active().length;
  $('present-count').textContent = n;
  $('all-present').hidden = absent.size === 0;
  $('pool').textContent = `${active().filter((id) => !seen.includes(id)).length} noch im Lostopf`;
  const limit = Math.max(0, n - 1),
    input = $('pick-count');
  input.max = limit;
  input.min = n < 2 ? 0 : 1;
  input.value = n < 2 ? 0 : Math.max(1, Math.min(limit, Number(input.value) || 1));
  input.disabled = running || n < 2;
  $('minus').disabled = running || Number(input.value) <= 1;
  $('plus').disabled = running || Number(input.value) >= limit;
  $('pick-hint').hidden = n >= 2 || classLoading;
  $('team-count').max = Math.floor(n / 2);
  $('team-label').textContent =
    $('team-method').value === 'size' ? 'Gewünschte Teamgröße' : 'Anzahl der Teams';
  try {
    const sizes = groupSizes(n, Number($('team-count').value), $('team-method').value);
    $('team-preview').textContent = sizes.every((size) => size === sizes[0])
      ? `${sizes.length} Teams mit je ${sizes[0]}`
      : `${sizes.length} Teams · ${[...new Set(sizes)].map((size) => `${sizes.filter((n) => n === size).length} × ${size}`).join(' + ')}`;
  } catch (e) {
    $('team-preview').textContent = e.message;
  }
  $('manage').disabled = classLoading || photoBusy || running;
  $('start').disabled = running || (mode === 'pick' ? n < 2 : n < 4);
  $('print').disabled = running;
  $('export').disabled = running;
}
let signalStarted = 0;
// Decorative glyphs remain independent of the fixed, pre-draw probability.
function paintSignal(phase) {
  const glyphs = '01アイウエカキクケコサシスセソナニヌネノラリルレロ<>[]{}:≡∴';
  $('random-signal').dataset.active = 'true';
  $('random-signal').dataset.phase = phase;
  if (!signalStarted) signalStarted = performance.now();
  const chatter = [
    'DO NOTHING LOOP',
    'REALITÄT PUFFERN',
    'ZUFALL KOMPILIEREN',
    'ANTWORT: 42',
    'SCHICKSAL SORTIEREN',
    'MATRIX ENTSCHLÜSSELN',
  ];
  $('signal-label').textContent =
    phase === 'scan'
      ? chatter[Math.floor((performance.now() - signalStarted) / 850) % chatter.length]
      : 'MATRIX ENTSCHLÜSSELT';
  if (phase === 'scan')
    $('signal-code').textContent = Array.from(
      { length: 48 },
      () => glyphs[Math.floor(Math.random() * glyphs.length)],
    ).join('');
  else $('signal-code').textContent = '▰ ▰ ▰  //  SEQUENZ ABGESCHLOSSEN  //  ✓';
}
function render() {
  closeCompanyTip();
  signalStarted = 0;
  delete $('random-signal').dataset.active;
  delete $('random-signal').dataset.phase;
  $('signal-code').textContent = '';
  $('signal-label').textContent = '';
  $('signal-chance').textContent = '';
  $('grid').dataset.large = String(people.length > 24);
  $('grid').className = 'grid';
  $('grid').innerHTML = (
    classLoading
      ? []
      : localClass
        ? people
        : [...people].sort(
            (a, b) => a.last.localeCompare(b.last, 'de') || a.first.localeCompare(b.first, 'de'),
          )
  )
    .map(card)
    .join('');
  $('announcement').textContent = '';
  $('back').hidden = true;
  $('stage-title').textContent = 'Bereit für die nächste Runde';
  $('bottom-hint').textContent = '';
  update();
  if (mode === 'seating') seatingUI?.render();
  requestAnimationFrame(fitFullscreenGrid);
}
function clearResult() {
  result = null;
  render();
}
function lock(value) {
  running = value;
  $('grid').setAttribute('aria-busy', String(value));
  document
    .querySelectorAll('aside input, aside select, aside button, .main-tabs button, #grid button')
    .forEach((el) => (el.disabled = value));
  $('manage').disabled = value;
  $('class-select').disabled = value;
  $('back').disabled = value;
  $('skip').hidden = !value;
  $('skip').disabled = false;
  update();
}
function finish(immediate = false) {
  clearInterval(timer);
  if (!pending) return;
  if ($('random-signal').dataset.active) paintSignal('done');
  const zoom =
    pending.type === 'pick' &&
    !immediate &&
    $('animation').checked &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const origins = new Map();
  if (zoom)
    pending.selected.forEach((id) =>
      origins.set(id, $('grid').querySelector(`[data-id="${id}"]`).getBoundingClientRect()),
    );
  result = pending;
  pending = null;
  lock(false);
  $('back').hidden = false;
  if (result.type === 'pick') {
    seen = result.seen;
    save();
    $('grid').className = 'grid result';
    $('grid').innerHTML = result.selected.map((id) => card(people[id])).join('');
    $('grid')
      .querySelectorAll('.person')
      .forEach((el) => {
        el.disabled = true;
        el.classList.add('chosen');
        el.removeAttribute('aria-pressed');
        el.setAttribute(
          'aria-label',
          people[Number(el.dataset.id)].first +
            ' ' +
            people[Number(el.dataset.id)].last +
            ' ausgewählt',
        );
      });
    $('announcement').textContent =
      result.selected.length === 1
        ? 'Sie sind an der Reihe!'
        : `${result.selected.length} Schülerinnen und Schüler sind an der Reihe!`;
    $('bottom-hint').textContent = result.crossed
      ? 'Die vorherige Runde ist abgeschlossen. Eine neue Runde hat begonnen.'
      : 'Zufällig ausgewählt aus den heute Anwesenden.';
  } else {
    $('grid').className = 'grid teams' + ($('animation').checked ? '' : ' no-motion');
    $('grid').innerHTML = result.groups
      .map(
        (group, i) =>
          `<section class="team" style="--team:${['#b1f18b', '#a8cfff', '#edbc86', '#c6b3f0', '#83d4c7', '#f1aab6'][i % 6]}"><h3>Team ${i + 1}<small>${group.length} dabei</small></h3>${group
            .map((id, j) => {
              const p = people[id];
              return `<div class="team-person" style="animation-delay:${$('animation').checked ? j * 0.08 : 0}s"><span class="mini" style="--portrait:${p.color}">${face(p)}</span><div><span class="first">${escapeHTML(p.first)}</span><span class="last">${escapeHTML(p.last)}</span>${companyCaption(p)}</div>${companyButton(p)}</div>`;
            })
            .join('')}</section>`,
      )
      .join('');
    $('announcement').textContent = `${result.groups.length} Teams. Los geht’s!`;
    $('bottom-hint').textContent = 'Zufällig gemischt. Möglichst gleichmäßig verteilt.';
  }
  $('stage-title').textContent = 'Ihre Auswahl';
  update();
  fitFullscreenGrid();
  if (zoom) {
    lock(true);
    $('skip').hidden = true;
    const animations = [...$('grid').querySelectorAll('.chosen')].map((el) => {
      const from = origins.get(Number(el.dataset.id)),
        to = el.getBoundingClientRect(),
        scale = parseFloat(getComputedStyle(document.body).zoom) || 1;
      return el.animate(
        [
          {
            transform: `translate(${(from.left - to.left) / scale}px,${(from.top - to.top) / scale}px) scale(${from.width / to.width},${from.height / to.height})`,
          },
          { transform: 'translate(0,0) scale(1,1)' },
        ],
        { duration: 850, easing: 'cubic-bezier(.22,.7,.2,1)', fill: 'none' },
      );
    });
    Promise.allSettled(animations.map((a) => a.finished)).then(() => {
      lock(false);
      $('grid')
        .querySelectorAll('.chosen')
        .forEach((el) => (el.disabled = true));
    });
  }
}
$('start').onclick = () => {
  const ids = active();
  let candidate;
  try {
    if (mode === 'pick')
      candidate = {
        type: 'pick',
        ...draw(ids, seen, Number($('pick-count').value), $('fair').checked, random),
      };
    else {
      const sizes = groupSizes(ids.length, Number($('team-count').value), $('team-method').value);
      const mixed = shuffle(ids, random);
      let offset = 0;
      candidate = {
        type: 'teams',
        groups: sizes.map((size) => {
          const group = mixed.slice(offset, offset + size);
          offset += size;
          return group;
        }),
      };
    }
  } catch (e) {
    $('announcement').textContent = e.message;
    return;
  }
  trackUsage(
    mode === 'pick' ? 'pick' : 'teams',
    mode === 'pick' ? candidate.selected.length : candidate.groups.length,
  );
  render();
  pending = candidate;
  lock(true);
  $('stage-title').textContent = 'Der Zufall entscheidet …';
  if (!$('animation').checked || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish();
    return;
  }
  if (mode === 'pick') {
    const count = candidate.selected.length,
      odds = drawChances(ids, seen, count, $('fair').checked);
    const percent = (value) =>
      new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }).format(value);
    const context = `${ids.length} ANWESEND · ${count} ${count === 1 ? 'PLATZ' : 'PLÄTZE'}`;
    $('signal-chance').textContent =
      odds.previous === null
        ? `${context} · CHANCE PRO PERSON: ${percent(odds.chance)}`
        : `${context} · NOCH IM LOSTOPF (${odds.available}): ${percent(odds.chance)} · BEREITS GEZOGEN: ${percent(odds.previous)}`;
  }
  const grid = $('grid');
  grid.classList.add('shuffling');
  fitFullscreenGrid();
  const cards = new Map(
    [...grid.querySelectorAll('[data-id]')].map((el) => [Number(el.dataset.id), el]),
  );
  const survivors = candidate.type === 'pick' ? candidate.selected : [];
  const eliminate = shuffle(
    ids.filter((id) => !survivors.includes(id)),
    random,
  );
  const started = performance.now();
  let nextElimination = started + 1600;
  // Each light fades independently; starting the next one does not cut it off.
  const illuminate = (pool, count, duration = 650) => {
    const available = pool.filter((id) => !cards.get(id).classList.contains('shimmer'));
    shuffle(available, random)
      .slice(0, count)
      .forEach((id) => {
        const el = cards.get(id);
        el.style.setProperty('--shuffle-duration', duration + 'ms');
        el.classList.add('shimmer');
        const ended = (event) => {
          if (event.animationName !== 'shuffle-light') return;
          el.classList.remove('shimmer');
          el.removeEventListener('animationend', ended);
        };
        el.addEventListener('animationend', ended);
      });
  };
  const tick = () => {
    if (!pending) return;
    const now = performance.now(),
      elapsed = now - started;
    paintSignal('scan');
    if (candidate.type === 'teams') {
      if (elapsed >= 3000) {
        paintSignal('locked');
        timer = setTimeout(finish, 700);
        return;
      }
      illuminate(ids, 1, 600);
      timer = setTimeout(tick, 110 + Math.max(0, elapsed - 2200) / 10);
      return;
    }
    if (eliminate.length && now >= nextElimination) {
      const count = eliminate.length > 6 ? Math.ceil((eliminate.length - 6) / 3) : 1;
      eliminate.splice(0, count).forEach((id, index) => {
        const el = cards.get(id);
        el.style.transitionDelay = `${index * 40}ms`;
        el.classList.add('eliminated');
      });
      nextElimination = now + (eliminate.length > 3 ? 250 : 500 + (3 - eliminate.length) * 140);
    }
    if (!eliminate.length && elapsed >= 1600) {
      survivors.forEach((id) => cards.get(id).classList.add('chosen'));
      grid.classList.add('settled');
      paintSignal('locked');
      timer = setTimeout(finish, 3000);
      return;
    }
    const remaining = ids.filter((id) => !cards.get(id).classList.contains('eliminated'));
    const suspense = eliminate.length <= 3 && elapsed >= 1600;
    illuminate(remaining, 1, suspense ? 950 : 620);
    // Brisk middle, then deliberately ease off for the last few candidates.
    timer = setTimeout(tick, suspense ? 260 : elapsed < 900 ? 140 : 105);
  };
  timer = setTimeout(tick, 180);
};
$('skip').onclick = () => finish(true);
$('grid').onclick = (e) => {
  const button = e.target.closest('[data-id]');
  if (!button || running || result) return;
  const id = Number(button.dataset.id);
  absent.has(id) ? absent.delete(id) : absent.add(id);
  render();
  $('grid').querySelector(`[data-id="${id}"]`).focus();
};
for (const [id, next] of [
  ['pick-tab', 'pick'],
  ['team-tab', 'teams'],
])
  $(id).onclick = () => {
    leaveLearning();
    document.body.classList.remove('seating-mode');
    $('seating-panel').hidden = true;
    $('seat-tab').setAttribute('aria-selected', 'false');
    mode = next;
    $('pick-tab').setAttribute('aria-selected', mode === 'pick');
    $('team-tab').setAttribute('aria-selected', mode === 'teams');
    $('pick-settings').hidden = mode !== 'pick';
    $('team-settings').hidden = mode !== 'teams';
    $('fair-settings').hidden = mode !== 'pick';
    $('draw-history').hidden = mode !== 'pick';
    $('mode-title').textContent = mode === 'pick' ? 'Einzelauswahl' : 'Teams';
    $('mode-hint').textContent =
      mode === 'pick'
        ? 'Eine faire Wahl. Ein bisschen Spannung.'
        : 'Neue Teams. Neue Perspektiven.';
    $('start').querySelector('span').textContent = mode === 'pick' ? 'Auswählen' : 'Teams bilden';
    clearResult();
  };
$('minus').onclick = () => {
  $('pick-count').value = Math.max(1, Number($('pick-count').value) - 1);
  update();
};
$('plus').onclick = () => {
  $('pick-count').value = Math.min(
    Math.max(0, active().length - 1),
    Number($('pick-count').value) + 1,
  );
  update();
};
$('pick-count').onchange = update;
$('team-method').onchange = update;
$('team-count').oninput = update;
$('fair').onchange = save;
$('animation').onchange = save;
$('reset').onclick = () => {
  seen = [];
  save();
  clearResult();
  $('announcement').textContent = 'Alle sind wieder im Lostopf.';
};
$('all-present').onclick = () => {
  absent.clear();
  clearResult();
};
$('back').onclick = clearResult;
$('print').onclick = () => window.print();
$('export').onclick = () => {
  const rows = [['Klasse', 'Team / Auswahl', 'Vorname', 'Nachname']];
  if (result?.type === 'teams')
    result.groups.forEach((group, i) =>
      group.forEach((id) =>
        rows.push([
          $('class-name').textContent,
          `Team ${i + 1}`,
          people[id].first,
          people[id].last,
        ]),
      ),
    );
  else
    (result?.selected || active()).forEach((id) =>
      rows.push([
        $('class-name').textContent,
        result ? 'Auswahl' : 'Anwesend',
        people[id].first,
        people[id].last,
      ]),
    );
  const csv =
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map(
            (cell) =>
              '"' + (/^[=+@\-\t\r]/.test(cell) ? "'" + cell : cell).replaceAll('"', '""') + '"',
          )
          .join(';'),
      )
      .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'klassentools-auswahl.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $('announcement').textContent = 'Vollbild ist in diesem Browser nicht verfügbar.';
  }
};
$('manage').onclick = async () => {
  clearPhotoReview();
  $('import-status').textContent = '';
  updatePhotoManagement();
  $('management').showModal();
  learningUI?.manageCompanies();
  if (photoState.enabled) {
    setPhotoBusy(true);
    try {
      await refreshPhotos();
      updatePhotoManagement();
    } catch (e) {
      $('import-status').textContent = e.message;
    } finally {
      setPhotoBusy(false);
      updatePhotoManagement();
    }
  }
};
render();
animateClassEntrance();

$('local-files').onchange = $('local-photos').onchange = async (event) => {
  if (photoBusy) return;
  const files = [...event.target.files].filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
  if (!files.length || files.length > 60) {
    $('import-status').textContent = 'Bitte 1 bis 60 PNG-, JPEG- oder WebP-Bilder auswählen.';
    return;
  }
  $('import-status').textContent = 'Bilder werden lokal geprüft …';
  const imported = [];
  const targetClass = selectedClass,
    targetRequest = classRequest;
  clearPhotoReview();
  try {
    for (const file of files) {
      $('import-status').textContent =
        `Foto ${imported.length + 1} von ${files.length} wird vorbereitet …`;
      if (file.size > 10 * 1024 * 1024)
        throw new Error('Ein Bild ist größer als 10 MB. Bitte verkleinern.');
      const base = file.name.replace(/\.[^.]+$/, '');
      let first, last;
      if (base.includes('_')) {
        [last, ...first] = base.split('_');
        first = first.join(' ');
      } else {
        [first, ...last] = base.split('.');
        last = last.join(' ');
      }
      if (!targetClass && (!first || !last))
        throw new Error('Dateinamen bitte als vorname.nachname oder Nachname_Vorname angeben.');
      const raw = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.src = raw;
      await img.decode();
      if (img.width * img.height > 20000000)
        throw new Error('Ein Bild hat mehr als 20 Megapixel. Bitte verkleinern.');
      // Re-encode locally: bound memory and discard embedded metadata before display.
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').fillStyle = '#e5e9ed';
      canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const id = imported.length;
      imported.push({
        id,
        filename: file.name,
        first,
        last,

        color: colors[id % colors.length],
        source: canvas.toDataURL('image/jpeg', 0.9),
        crop: { x: 0.5, y: 0.35, zoom: 1, fit: false },
        photo: makePortrait(img, { x: 0.5, y: 0.35, zoom: 1, fit: false }),
      });
    }
    if (targetRequest !== classRequest || targetClass !== selectedClass || !$('management').open)
      throw new Error('Die Klasse wurde gewechselt. Bitte erneut auswählen.');
    if (targetClass) {
      showPhotoReview(imported, targetRequest, targetClass);
      return;
    }
    selectedClass = '';
    classRequest++;
    $('class-select').value = '';
    $('class-status').textContent = '';
    localClass = true;
    people = imported;
    seen = [];
    absent.clear();
    result = null;
    $('class-select').options[0].text = 'Lokale Testklasse (TEMP)';
    $('class-name').textContent = 'Lokale Testklasse';
    $('class-total').textContent = people.length + ' Schülerinnen und Schüler';
    $('attendance-total').textContent = ' / ' + people.length + ' anwesend';
    document.querySelector('.local-note').textContent =
      'Lokale Fotos und Namen werden nicht hochgeladen oder gespeichert. Neuladen beendet den Fototest.';
    $('pick-count').value = 1;
    $('team-count').value = Math.min(4, Math.floor(people.length / 2));
    $('management').close();
    render();
    trackUsage('local_import', imported.length);
  } catch (e) {
    $('import-status').textContent = e.message || 'Ein Bild konnte nicht gelesen werden.';
    $('import-status').scrollIntoView({ block: 'center' });
  } finally {
    event.target.value = '';
  }
};

let authSession = null;
const classMembers = new Map();
async function loadSession() {
  if (demoOnly) {
    authSession = { authenticated: false };
    $('login-link').hidden = true;
    $('admin-open').hidden = true;
    $('logout').hidden = true;
    $('auth-status').textContent =
      'Öffentliche DEMO · fiktive Namen und KI-Porträts · ohne Server-Speicherung';
    $('landing-login').href = '../';
    $('landing-login').textContent = 'Zur Projektseite →';
    document.querySelector('.landing-access').textContent =
      'Hier können Sie die DEMO-Klasse ohne Anmeldung ausprobieren. IServ und dauerhafte Speicherung benötigen eine eigene Serverinstallation.';
    return;
  }
  try {
    const response = await fetch('./api/session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('session');
    authSession = await response.json();
    $('logout').hidden = !authSession.authenticated;
    $('admin-open').hidden = !authSession.admin || adminPage;
    if (!authSession.admin) adminUI?.reset();
    if (adminPage) {
      $('admin-access').hidden = !!authSession.admin;
      if (authSession.admin && $('admin-dialog').hidden) await openAdministration();
    }
    document
      .querySelector('.account-bar')
      .classList.toggle('signed-in', !!authSession.authenticated);
    if (authSession.authenticated && authSession.teacher && !adminPage) await loadClasses();
    else {
      $('iserv-classes').hidden = true;
      if (selectedClass) resetDemo();
    }
    $('login-link').hidden = !!authSession.authenticated;
    if (landingPage) {
      $('landing-login').href = authSession.authenticated ? './?app=1' : './oidc/login';
      $('landing-login').firstChild.textContent = authSession.authenticated
        ? 'Zu Ihren Klassen '
        : 'Mit IServ anmelden ';
    }
    $('auth-roles').replaceChildren();
    $('auth-roles').hidden = true;
    if (!authSession.authenticated) {
      classMembers.clear();
      seatingUI?.reset();
      $('auth-status').textContent = 'Nicht angemeldet · Demo und lokaler Fototest verfügbar.';
      return;
    }
    if (authSession.setupRequired) {
      $('auth-status').textContent =
        `IServ hat Sie angemeldet (${authSession.name}). Die Teacher-Rollenkennung muss noch administrativ bestätigt werden. Klassenfunktionen sind bis dahin gesperrt. Bitte übermitteln Sie nur die Kennung der Teacher-Rolle an die Administration.`;
      $('auth-roles').hidden = false;
      for (const role of authSession.roles) {
        const item = document.createElement('li');
        item.textContent = `${role.name}: ${role.uuid}`;
        $('auth-roles').append(item);
      }
    } else {
      $('auth-status').textContent = `Angemeldet als ${authSession.name} · Lehrkraft`;
    }
  } catch {
    classMembers.clear();
    seatingUI?.reset();
    $('admin-open').hidden = true;
    adminUI?.reset();
    if (adminPage) $('admin-access').hidden = false;
    if (selectedClass) resetDemo();
    $('iserv-classes').hidden = true;
    $('auth-status').textContent =
      'Der Anmeldedienst ist momentan nicht verfügbar. Der lokale Fototest bleibt nutzbar.';
  }
}
// A one-shot, tab-local cue also survives the external IServ login redirect.
let leavingLanding = false;
async function enterFromLanding(href) {
  if (leavingLanding) return;
  leavingLanding = true;
  try {
    sessionStorage.setItem(entryCue, String(Date.now()));
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
  const fade = $('landing').animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 240,
    fill: 'forwards',
  });
  window.addEventListener(
    'pageshow',
    () => {
      fade.cancel();
      leavingLanding = false;
    },
    { once: true },
  );
  await fade.finished.catch(() => {});
  location.href = href;
}
$('landing-login').addEventListener('click', (event) => {
  if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  void enterFromLanding(event.currentTarget.href);
});
function animateClassEntrance() {
  let timestamp;
  try {
    timestamp = Number(sessionStorage.getItem(entryCue));
    sessionStorage.removeItem(entryCue);
  } catch {
    return;
  }
  if (landingPage || adminPage || !timestamp || Date.now() - timestamp > 600000) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('app-main').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    return;
  }
  const grid = $('grid');
  const bounds = grid.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY =
    bounds.top + Math.min(bounds.height, Math.max(240, innerHeight - bounds.top - 40)) / 2;
  // Measure every destination before starting transforms, so the stack shares one origin.
  const cards = [...grid.children].map((card) => ({ card, rect: card.getBoundingClientRect() }));
  const stackWidth = Math.min(380, bounds.width * 0.5, Math.max(180, innerHeight - 120) * 0.4);
  const travel = Math.min(150, Math.max(12, (bounds.width - stackWidth * 1.35 - 80) / 2));
  const smooth = 'cubic-bezier(.45,0,.55,1)';
  const animations = cards.map(({ card, rect }, index) => {
    const angle = ((index * 7) % 21) - 10;
    const x = centerX - rect.left - rect.width / 2 + ((index % 5) - 2) * 16;
    const y = centerY - rect.top - rect.height / 2 + ((index % 3) - 1) * 10;
    const scale = Math.max(1, Math.min(2.8, stackWidth / rect.width));
    const stack = `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`;
    const direction = index % 2 ? 1 : -1;
    const shuffled = `translate(${x + direction * travel}px, ${y - direction * 18}px) rotate(${angle + direction * 12}deg) scale(${scale})`;
    return card.animate(
      [
        { opacity: 1, transform: stack },
        { opacity: 1, transform: stack, offset: 0.06, easing: smooth },
        { opacity: 1, transform: shuffled, offset: 0.24, easing: smooth },
        { opacity: 1, transform: stack, offset: 0.42, easing: 'cubic-bezier(.45,0,.3,1)' },
        { opacity: 1, transform: 'translate(0, -3px) rotate(0deg) scale(1.015)', offset: 0.94 },
        { opacity: 1, transform: 'translate(0, 0) rotate(0deg) scale(1)' },
      ],
      { id: 'class-entry', duration: 3800, delay: Math.min(index, 23) * 10, fill: 'backwards' },
    );
  });
  // Fade the stack as one surface to avoid translucent faces flashing through each other.
  animations.push(grid.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 }));
  // Interaction or a changed viewport settles the cards immediately in their usable positions.
  const stop = () => animations.forEach((animation) => animation.cancel());
  window.addEventListener('resize', stop, { once: true });
  $('app-main').addEventListener('pointerdown', stop, { once: true });
  $('app-main').addEventListener('keydown', stop, { once: true });
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    window.removeEventListener('resize', stop);
    $('app-main').removeEventListener('pointerdown', stop);
    $('app-main').removeEventListener('keydown', stop);
  });
}
$('landing-demo').onclick = async (e) => {
  e.preventDefault();
  await initialSession;
  if (!authSession) {
    $('landing-status').textContent =
      'Der Anmeldestatus konnte nicht geprüft werden. Bitte laden Sie die Seite erneut.';
    return;
  }
  if (!authSession.authenticated) {
    void enterFromLanding('./?demo=1');
    return;
  }
  try {
    const r = await fetch('./api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': authSession.csrf },
    });
    if (!r.ok) throw new Error();
    void enterFromLanding('./?demo=1');
  } catch {
    $('landing-status').textContent = 'Abmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.';
  }
};
$('logout').onclick = async () => {
  if (!authSession?.csrf) return;
  try {
    const r = await fetch('./api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': authSession.csrf },
    });
    if (!r.ok) throw new Error('logout');
    await loadSession();
  } catch {
    $('auth-status').textContent = 'Abmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.';
  }
};
const loginResult = entryParams.get('login');
const initialSession = loadSession();
initialSession.then(() => {
  if (!adminPage) trackUsage('view');
  if (loginResult) {
    history.replaceState(
      null,
      '',
      location.pathname +
        (adminPage ? '?admin=classes' : loginResult === 'ok' ? '?app=1' : '') +
        location.hash,
    );
    if (['denied', 'failed'].includes(loginResult)) {
      const title =
        loginResult === 'denied'
          ? 'Kein Zugang zu IServ-Klassen'
          : 'IServ-Anmeldung nicht erfolgreich';
      const rule =
        'Die Klassenfunktionen stehen ausschließlich Lehrkräften zur Verfügung, die Mitglied der jeweiligen freigegebenen Klasse sind. Mit einem Schülerkonto ist dieser Zugang nicht möglich.';
      const next =
        loginResult === 'denied'
          ? 'Bitte wechseln Sie in IServ zu Ihrem Lehrkraftkonto. Alternativ können Sie die DEMO ohne Anmeldung ausprobieren.'
          : 'Ihre Anmeldung konnte nicht bestätigt werden. Prüfen Sie bitte, ob Sie in IServ mit Ihrem Lehrkraftkonto angemeldet sind, und versuchen Sie es erneut. Alternativ können Sie die DEMO ohne Anmeldung ausprobieren.';
      const status = $(landingPage ? 'landing-status' : 'auth-status');
      if (landingPage) {
        const heading = document.createElement('h2');
        heading.textContent = title;
        const restriction = document.createElement('p');
        restriction.className = 'login-restriction';
        restriction.textContent = rule;
        const guidance = document.createElement('p');
        guidance.textContent = next;
        status.replaceChildren(heading, restriction, guidance);
      } else status.textContent = title + '. ' + rule + ' ' + next;
      status.setAttribute('tabindex', '-1');
      status.focus();
    }
  }
});

function resetDemo() {
  learningUI?.reset();
  seatingUI?.clearSelection();
  $('seat-tables').replaceChildren();
  $('seat-unplaced').replaceChildren();
  classLoading = false;
  clearPhotoReview();
  photoState = { enabled: false, revision: null, total: 0 };
  $('stored-photo-list').replaceChildren();
  $('stored-photos').hidden = true;
  classRequest++;
  if (running) finish(true);
  selectedClass = '';
  localClass = false;
  people = demoPeople();
  seen = [];
  absent.clear();
  result = null;
  $('class-select').value = '';
  $('class-select').options[0].text = 'DEMO-Klasse';
  $('class-name').textContent = 'DEMO-Klasse';
  $('class-total').textContent = '24 Schülerinnen und Schüler';
  $('attendance-total').textContent = ' / 24 anwesend';
  document.querySelector('.local-note').textContent =
    'Demo-Einstellungen und Ziehungsverlauf bleiben in diesem Browser.';
  $('pick-count').value = 1;
  $('team-count').value = 4;
  render();
  if ($('management').open) updatePhotoManagement();
}
async function loadClasses() {
  const r = await fetch('./api/classes', { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) throw new Error('classes');
  const data = await r.json();
  if (!Array.isArray(data.classes)) throw new Error('classes');
  for (const id of classMembers.keys())
    if (!data.classes.some((g) => g.id === id)) classMembers.delete(id);
  $('iserv-classes').hidden = false;
  $('class-select').replaceChildren(
    new Option(localClass && !selectedClass ? 'Lokale Testklasse (TEMP)' : 'DEMO-Klasse', ''),
    ...data.classes.map((g) => new Option(g.name, g.id)),
  );
  if (selectedClass && !data.classes.some((g) => g.id === selectedClass)) {
    resetDemo();
    $('class-status').textContent = 'Die Klasse ist nicht mehr freigegeben.';
  }
  $('class-select').value = selectedClass;
  if (!data.classes.length)
    $('class-status').textContent = 'Keine freigegebenen Klassenmitgliedschaften gefunden.';
}
async function openClass() {
  const id = $('class-select').value;
  if (!id) {
    resetDemo();
    $('class-status').textContent = '';
    if (mode === 'learning') learningUI?.open();
    trackUsage('class_open');
    return;
  }
  // Clear the previous class immediately, including when loading fails.
  resetDemo();
  classLoading = true;
  selectedClass = id;
  $('class-select').value = id;
  localClass = true;
  people = [];
  render();
  $('class-name').textContent = 'Klasse wird geladen';
  $('class-total').textContent = '';
  $('attendance-total').textContent = '';
  const request = ++classRequest;
  $('class-status').textContent = 'Aktuelle Mitglieder werden geladen …';
  try {
    if (authSession?.expiresAt && Date.now() >= authSession.expiresAt) {
      classMembers.clear();
      seatingUI?.reset();
      throw new Error('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    }
    let data = classMembers.get(id);
    if (!data) {
      const r = await fetch('./api/classes/' + encodeURIComponent(id) + '/members', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Die Klasse konnte nicht geladen werden.');
      if (request !== classRequest) return;
      classMembers.set(id, data);
    }
    if (request !== classRequest) return;
    people = data.members.map((p, id) => ({
      ...p,
      memberId: p.id,
      id,

      color: colors[id % colors.length],
    }));
    $('class-name').textContent = data.group.name;
    $('class-total').textContent = people.length + ' Schülerinnen und Schüler';
    $('attendance-total').textContent = ' / ' + people.length + ' anwesend';
    document.querySelector('.local-note').textContent =
      'Aktuelle Schülerliste aus IServ. Namen und Ziehungsverlauf dieser Klasse bleiben nur in dieser Sitzung.';
    $('class-status').textContent =
      'Aus IServ geladen · ' +
      new Date(data.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    $('team-count').value = Math.max(2, Math.min(4, Math.floor(people.length / 2)));
    photoState = { enabled: data.photosEnabled === true, revision: null, total: 0 };
    if (photoState.enabled) {
      $('class-status').textContent = 'Klassenfotos werden geladen …';
      await refreshPhotos();
    }
    if (request !== classRequest) return;
    try {
      const companies = await photoRequest('GET', undefined, 'companies');
      if (request !== classRequest) return;
      for (const p of people)
        p.companyInfo =
          companies.companies.find((c) => c.id === companies.assignments[p.memberId]) || null;
    } catch {
      if (request !== classRequest) return;
      // A missing company service must not block the class itself.
    }
    classLoading = false;
    render();
    if (mode === 'learning') learningUI?.open();
    trackUsage('class_open');
    $('class-status').textContent =
      'Aus IServ geladen · ' +
      new Date(data.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    if (request !== classRequest) return;
    resetDemo();
    $('class-status').textContent = e.message;
  }
}
$('class-select').onchange = openClass;
// No background IServ polling; rosters live only in this page's memory.

function fitFullscreenGrid() {
  if (mode === 'seating') return;
  const grid = $('grid');
  if (
    !document.fullscreenElement ||
    innerWidth <= 700 ||
    grid.classList.contains('result') ||
    grid.classList.contains('teams') ||
    !people.length
  ) {
    grid.style.removeProperty('grid-template-columns');
    return;
  }
  const scale = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const stage = document.querySelector('.stage'),
    main = document.querySelector('main');
  const px = (el, prop) => parseFloat(getComputedStyle(el)[prop]) || 0;
  // Reserve room for the footer, explanatory text and the animation strip.
  const reserve =
    document.querySelector('footer').getBoundingClientRect().height / scale +
    px(main, 'paddingBottom') +
    px(stage, 'paddingBottom') +
    px($('selection-surface'), 'paddingBottom') +
    2 +
    Math.max(44, $('random-signal').offsetHeight) +
    18;
  const height = innerHeight / scale - grid.getBoundingClientRect().top / scale - reserve;
  const width = grid.getBoundingClientRect().width / scale,
    gap = px(grid, 'columnGap'),
    rowGap = px(grid, 'rowGap');
  const cards = [...grid.querySelectorAll('.person')];
  if (!cards.length || height <= 0) return;
  for (let pass = 0; pass < 3; pass++) {
    const label = Math.max(
      ...cards.map((el) => el.querySelector('.person-name').getBoundingClientRect().height / scale),
    );
    let best = { size: 0, columns: 1 };
    for (let columns = 1; columns <= Math.min(cards.length, 20); columns++) {
      const rows = Math.ceil(cards.length / columns);
      const size = Math.floor(
        Math.min(
          (width - (columns - 1) * gap) / columns,
          (height - (rows - 1) * rowGap) / rows - label,
        ),
      );
      if (size > best.size) best = { size, columns };
    }
    if (best.size <= 0) return;
    grid.style.gridTemplateColumns = `repeat(${best.columns}, ${best.size}px)`;
  }
}
function fitFullscreen() {
  let scale =
    document.fullscreenElement && innerWidth > 700
      ? Math.max(1, Math.min(innerWidth / 1920, innerHeight / 1320))
      : 1;
  document.documentElement.style.setProperty('--presentation-scale', scale);
  if (document.fullscreenElement && innerWidth > 700) {
    fitFullscreenGrid();
    const controlsBottom = document.querySelector('aside').getBoundingClientRect().bottom;
    const footerHeight = document.querySelector('footer').getBoundingClientRect().height;
    const needed = controlsBottom + footerHeight + 32 * scale;
    if (needed > innerHeight) {
      scale = Math.max(0.65, (scale * (innerHeight - 12)) / needed);
      document.documentElement.style.setProperty('--presentation-scale', scale);
    }
  }
  $('fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement));
  $('fullscreen').querySelector('span').textContent = document.fullscreenElement
    ? 'Vollbild beenden'
    : 'Vollbild';
  fitFullscreenGrid();
}
document.addEventListener('fullscreenchange', fitFullscreen);
window.addEventListener('resize', fitFullscreen);
const presentationObserver = new ResizeObserver(() => {
  if (document.fullscreenElement) fitFullscreenGrid();
});
for (const el of document.querySelectorAll('header,footer,.class-heading,.stage-top'))
  presentationObserver.observe(el);

$('apply-photos').onclick = async () => {
  if (photoBusy) return;
  if (
    !pendingPhotos ||
    pendingPhotos.request !== classRequest ||
    pendingPhotos.classId !== selectedClass ||
    !authSession?.authenticated
  ) {
    clearPhotoReview();
    $('import-status').textContent = 'Die Klasse ist nicht mehr aktiv. Bitte erneut auswählen.';
    return;
  }
  const chosen = [...$('photo-review').querySelectorAll('select')].filter((s) => s.value !== '');
  if (!chosen.length) {
    $('import-status').textContent = 'Bitte mindestens ein Foto zuordnen.';
    return;
  }
  if (new Set(chosen.map((s) => s.value)).size !== chosen.length) {
    $('import-status').textContent = 'Bitte jeder Person nur ein Foto zuordnen.';
    return;
  }
  let assignments = chosen.map((select) => ({
    person: people.find((p) => String(p.id) === select.value),
    file: pendingPhotos.files[Number(select.dataset.photoIndex)],
  }));
  if (assignments.some((a) => !a.person || !a.file)) return;
  assignments = assignments.filter(
    (a) => a.file.savedPhoto !== a.file.photo || a.file.persistedMemberId !== a.person.memberId,
  );
  if (!assignments.length) {
    $('management').close();
    savedPhotoNotice('Alle ausgewählten Änderungen sind gespeichert.');
    return;
  }
  if (photoState.enabled) {
    if (photoState.revision === null) {
      $('import-status').textContent = 'Fotostand fehlt. Bitte schließen und neu öffnen.';
      return;
    }
    const replacements = assignments.filter((a) => a.person.photoVersion).length;
    if (
      replacements &&
      !confirm(`${replacements} vorhandene Fotos in ${$('class-name').textContent} ersetzen?`)
    )
      return;
    setPhotoBusy(true);
    const request = classRequest;
    let committed = false;
    try {
      const data = await photoRequest('POST', {
        revision: photoState.revision,
        photos: assignments.map((a) => ({ memberId: a.person.memberId, data: a.file.photo })),
      });
      committed = true;
      if (request !== classRequest) return;
      photoState.revision = data.revision;
      await refreshPhotos();
      if (request !== classRequest) return;
      $('class-status').textContent = `${data.changed} Fotos dauerhaft gespeichert`;
      $('management').close();
    } catch (e) {
      $('import-status').textContent =
        (committed ? 'Fotos sind gespeichert. Anzeige bitte neu laden. ' : '') + e.message;
    } finally {
      setPhotoBusy(false);
    }
    return;
  }
  for (const a of assignments) a.person.photo = a.file.photo;
  $('class-status').textContent = `${assignments.length} Fotos zugeordnet · nur in dieser Sitzung`;
  document.querySelector('.local-note').textContent =
    'IServ-Klasse mit lokalen Fotos. Neuladen oder Klassenwechsel entfernt sie.';
  $('management').close();
  render();
};

function updatePhotoReview() {
  const selects = [...$('photo-review').querySelectorAll('select')];
  const counts = new Map();
  for (const s of selects) if (s.value !== '') counts.set(s.value, (counts.get(s.value) || 0) + 1);
  let ready = 0;
  for (const select of selects) {
    const row = select.closest('.photo-review-row'),
      valid = select.value !== '' && counts.get(select.value) === 1;
    row.dataset.state = valid ? 'ready' : 'open';
    row.querySelector('small').textContent = valid
      ? '✓ Zugeordnet'
      : select.value !== ''
        ? '! Doppelt zugeordnet – bitte korrigieren'
        : '! Zuordnung offen';
    row.hidden = $('photo-review-open-only').checked && valid;
    if (valid) ready++;
  }
  $('photo-review-count').textContent = `${ready} zugeordnet · ${selects.length - ready} offen`;
}
$('photo-review').addEventListener('change', updatePhotoReview);
$('photo-review-open-only').onchange = updatePhotoReview;

function makePortrait(image, crop, canvas = document.createElement('canvas')) {
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e5e9ed';
  ctx.fillRect(0, 0, 640, 640);
  if (crop.fit) {
    const scale = Math.min(640 / image.width, 640 / image.height);
    const w = image.width * scale,
      h = image.height * scale;
    ctx.drawImage(image, (640 - w) / 2, (640 - h) / 2, w, h);
  } else {
    const size = Math.min(image.width, image.height) / crop.zoom;
    ctx.drawImage(
      image,
      (image.width - size) * crop.x,
      (image.height - size) * crop.y,
      size,
      size,
      0,
      0,
      640,
      640,
    );
  }
  return canvas.toDataURL('image/jpeg', 0.85);
}
function showPhotoReview(imported, request, classId) {
  const matches = matchPhotos(
    imported.map((p) => p.filename),
    people.map((p) => ({ ...p, id: String(p.id) })),
  );
  pendingPhotos = { files: imported, request, classId };
  $('photo-review').innerHTML = matches
    .map(
      (m, i) =>
        `<div class="photo-review-row"><img src="${imported[i].photo}" alt=""><span>${escapeHTML(m.filename)}<small></small></span><select data-photo-index="${i}" aria-label="Zuordnung für ${escapeHTML(m.filename)}"><option value="">Nicht übernehmen</option>${[
          ...people,
        ]
          .sort((a, b) => {
            const rank = (id) => {
              const i = m.candidates.findIndex((c) => c.id === String(id));
              return i < 0 ? Infinity : i;
            };
            return (
              rank(a.id) - rank(b.id) ||
              a.last.localeCompare(b.last, 'de') ||
              a.first.localeCompare(b.first, 'de')
            );
          })
          .map(
            (p) =>
              `<option value="${p.id}" ${imported[i].target === p.id || (m.status === 'exact' && m.candidates[0].id === String(p.id)) ? 'selected' : ''}>${escapeHTML(p.first + ' ' + p.last)}${m.status === 'suggestion' && m.candidates.some((c) => c.id === String(p.id)) ? ' (Vorschlag)' : ''}</option>`,
          )
          .join(
            '',
          )}</select><button type="button" data-crop-index="${i}">Ausschnitt</button></div>`,
    )
    .join('');
  $('photo-review-tools').hidden = false;
  $('photo-review-open-only').checked = matches.some((m) => m.status !== 'exact');
  updatePhotoReview();
  $('apply-photos').hidden = false;
  $('apply-photos').textContent = photoState.enabled
    ? 'Fotos dauerhaft speichern'
    : 'Zuordnung übernehmen';
  $('import-status').textContent =
    `${imported.length} Fotos vorbereitet. ` +
    (photoState.enabled
      ? 'Bitte prüfen und mit „Fotos dauerhaft speichern“ bestätigen.'
      : 'Bitte prüfen und mit „Zuordnung übernehmen“ bestätigen.');
  requestAnimationFrame(() => $('apply-photos').scrollIntoView({ block: 'center' }));
}
$('photo-review').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-crop-index]');
  if (!button || photoBusy || !pendingPhotos) return;
  const owner = pendingPhotos,
    index = Number(button.dataset.cropIndex),
    file = owner.files[index];
  const select = $('photo-review').querySelector(`[data-photo-index="${index}"]`);
  const person = select?.value !== '' ? people.find((p) => String(p.id) === select?.value) : null;
  const image = new Image();
  image.src = file.source || file.photo;
  let state;
  try {
    await image.decode();
    if (pendingPhotos !== owner) return;
    state = {
      owner,
      index,
      image,
      person,
      initial: file.crop || { x: 0.5, y: 0.35, zoom: 1, fit: false },
      direct: !!(person?.memberId && selectedClass && photoState.enabled),
      companies: null,
      companySaved: false,
      photoSaved: false,
    };
    cropState = state;
    $('crop-title').textContent = person
      ? 'Foto & Betrieb – ' + person.first + ' ' + person.last
      : 'Bildausschnitt anpassen';
    $('crop-x').value = state.initial.x;
    $('crop-y').value = state.initial.y;
    $('crop-zoom').value = state.initial.zoom;
    $('crop-fit').checked = state.initial.fit;
    $('crop-settings').open = !file.stored;
    $('crop-company').hidden = !state.direct;
    $('crop-company-search').value = '';
    $('crop-company-select').replaceChildren();
    $('crop-company-results').textContent = '';
    $('crop-status').textContent = state.direct
      ? 'Betriebszuordnung wird geladen …'
      : person
        ? 'Änderungen werden mit der Fotoauswahl übernommen.'
        : 'Ordnen Sie das Foto zuerst einer Person zu, um einen Betrieb auszuwählen.';
    $('crop-apply').textContent = state.direct ? 'Änderungen speichern' : 'Ausschnitt übernehmen';
    $('crop-apply').disabled = state.direct;
    paintCrop();
    $('crop-dialog').showModal();
    if (state.direct) {
      state.companies = await photoRequest('GET', undefined, 'companies');
      if (cropState !== state || pendingPhotos !== owner) return;
      state.company = state.companies.assignments[person.memberId] || '';
      updateCropCompanies(state.company);
      $('crop-status').textContent = file.stored
        ? 'Foto und Betrieb können unabhängig voneinander geändert werden.'
        : 'Speichert dieses Foto und den Betrieb. Weitere ausgewählte Fotos bleiben zur Prüfung offen.';
      $('crop-apply').disabled = false;
    }
  } catch (e) {
    if (pendingPhotos !== owner || (state && cropState !== state)) return;
    if ($('crop-dialog').open)
      $('crop-status').textContent =
        e.message || 'Betriebszuordnung konnte nicht geladen werden. Bitte erneut öffnen.';
    else $('import-status').textContent = 'Das Bild konnte nicht geöffnet werden.';
  }
});
function updateCropCompanies(selected = $('crop-company-select').value) {
  if (!cropState?.companies) return;
  const query = $('crop-company-search').value.trim().toLocaleLowerCase('de');
  const matches = cropState.companies.companies.filter(
    (c) =>
      (c.active || c.id === cropState.company) &&
      `${c.name} ${c.city} ${c.short}`.toLocaleLowerCase('de').includes(query),
  );
  const visible = cropState.companies.companies.filter(
    (c) => c.id === selected || matches.includes(c),
  );
  $('crop-company-select').innerHTML =
    '<option value="">Kein Betrieb zugeordnet</option>' +
    visible
      .map(
        (c) =>
          `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name + (c.city ? ' · ' + c.city : '') + (!c.active ? ' (inaktiv)' : ''))}</option>`,
      )
      .join('');
  $('crop-company-select').value = selected;
  $('crop-company-results').textContent = query
    ? `${matches.length} passende Betriebe${selected && !matches.some((c) => c.id === selected) ? ' · aktuelle Auswahl bleibt erhalten' : ''}`
    : '';
}
$('crop-company-search').oninput = () => updateCropCompanies();
$('crop-company-search').onkeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    updateCropCompanies();
  }
};
function cropValues() {
  return {
    x: Number($('crop-x').value),
    y: Number($('crop-y').value),
    zoom: Number($('crop-zoom').value),
    fit: $('crop-fit').checked,
  };
}
function paintCrop() {
  if (!cropState) return;
  makePortrait(cropState.image, cropValues(), $('crop-preview'));
  for (const id of ['crop-x', 'crop-y', 'crop-zoom']) $(id).disabled = $('crop-fit').checked;
}
for (const id of ['crop-x', 'crop-y', 'crop-zoom', 'crop-fit']) $(id).oninput = paintCrop;
$('crop-cancel').onclick = () => {
  if (!photoBusy) $('crop-dialog').close();
};
let savedNoticeTimer;
function savedPhotoNotice(text) {
  let toast = $('company-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'company-toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = '✓ ' + text;
  toast.hidden = false;
  clearTimeout(savedNoticeTimer);
  savedNoticeTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}
$('crop-apply').onclick = async () => {
  const state = cropState;
  if (photoBusy || !state || pendingPhotos !== state.owner) return;
  const file = state.owner.files[state.index],
    crop = cropValues();
  const changed = JSON.stringify(crop) !== JSON.stringify(state.initial);
  const photo = changed ? makePortrait(state.image, crop) : file.photo;
  if (!state.direct) {
    file.crop = crop;
    file.photo = photo;
    $('photo-review')
      .querySelector(`[data-photo-index="${state.index}"]`)
      .closest('.photo-review-row')
      .querySelector('img').src = photo;
    $('crop-dialog').close();
    return;
  }
  if (
    !state.companies ||
    state.owner.request !== classRequest ||
    state.owner.classId !== selectedClass
  )
    return;
  const company = $('crop-company-select').value;
  setPhotoBusy(true);
  for (const control of $('crop-dialog').querySelectorAll('button,input,select'))
    control.disabled = true;
  $('crop-status').textContent = 'Änderungen werden gespeichert …';
  try {
    if (company !== state.company) {
      const data = await photoRequest(
        'POST',
        { revision: state.companies.revision, assignments: { [state.person.memberId]: company } },
        'companies',
      );
      if (cropState !== state) return;
      state.companySaved = true;
      state.companies = data;
      state.company = company;
      applyCompanies(data);
    }
    if (!file.stored || changed) {
      const data = await photoRequest('POST', {
        revision: photoState.revision,
        photos: [{ memberId: state.person.memberId, data: photo }],
      });
      if (cropState !== state) return;
      photoState.revision = data.revision;
      file.photo = photo;
      file.crop = crop;
      file.stored = true;
      file.savedPhoto = photo;
      file.persistedMemberId = state.person.memberId;
      state.initial = crop;
      state.photoSaved = true;
      await refreshPhotos();
    }
    if (cropState !== state) return;
    const single = state.owner.files.length === 1;
    $('crop-dialog').close();
    if (single) $('management').close();
    else {
      updatePhotoManagement();
      $('import-status').textContent =
        'Einzeländerung gespeichert. Weitere Fotos können weiter geprüft werden.';
    }
    savedPhotoNotice('Foto und Betriebszuordnung gespeichert.');
  } catch (e) {
    if (cropState === state)
      $('crop-status').textContent =
        (state.companySaved ? 'Betriebszuordnung bereits gespeichert. ' : '') +
        (state.photoSaved ? 'Foto bereits gespeichert. ' : '') +
        e.message +
        ' Nicht gespeicherte Änderungen bleiben im Dialog. Bei einem Konflikt bitte neu öffnen.';
  } finally {
    setPhotoBusy(false);
    for (const control of $('crop-dialog').querySelectorAll('button,input,select'))
      control.disabled = false;
    paintCrop();
  }
};
$('crop-dialog').addEventListener('cancel', (event) => {
  if (photoBusy) event.preventDefault();
});
$('crop-dialog').addEventListener('close', () => {
  cropState = null;
});
function setPhotoBusy(value) {
  photoBusy = value;
  $('stored-photo-list')
    .querySelectorAll('button,input')
    .forEach((el) => (el.disabled = value));
  for (const id of [
    'apply-photos',
    'local-files',
    'local-photos',
    'delete-selected-photos',
    'delete-all-photos',
    'cancel-photos',
    'class-select',
    'logout',
    'manage',
  ])
    $(id).disabled = value;
  $('management').querySelector('.close').disabled = value;
}
$('management').addEventListener('cancel', (event) => {
  if (photoBusy) event.preventDefault();
});
async function photoRequest(method, body, suffix = 'photos') {
  const request = classRequest;
  const response = await fetch(`./api/classes/${encodeURIComponent(selectedClass)}/${suffix}`, {
    method,
    signal: AbortSignal.timeout(15000),
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-CSRF-Token': authSession?.csrf || '' }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    if (request === classRequest && (response.status === 401 || response.status === 403)) {
      classMembers.clear();
      seatingUI?.reset();
      resetDemo();
      $('management').close();
    }
    throw new Error(data.error || 'Fotoanfrage fehlgeschlagen.');
  }
  return data;
}
async function refreshPhotos() {
  const request = classRequest;
  photoState.revision = null;
  const data = await photoRequest('GET');
  if (request !== classRequest) return;
  if (!Number.isSafeInteger(data.revision) || !Array.isArray(data.photos))
    throw new Error('Fotostand konnte nicht geladen werden.');
  for (const p of people) {
    delete p.photo;
    delete p.photoVersion;
  }
  for (const photo of data.photos) {
    const p = people.find((p) => p.memberId === photo.memberId);
    if (p && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo.data)) {
      p.photo = photo.data;
      p.photoVersion = photo.version;
    }
  }
  await Promise.all(
    people
      .filter((p) => p.photo)
      .map(async (p) => {
        const img = new Image();
        img.src = p.photo;
        try {
          await img.decode();
        } catch {}
      }),
  );
  if (request !== classRequest) return;
  classLoading = false;
  photoState = { enabled: true, revision: data.revision, total: data.total };
  document.querySelector('.local-note').textContent =
    'Klassenfotos werden gemeinsam gespeichert. Änderungen werden für die Administration protokolliert.';
  render();
}
function updatePhotoManagement() {
  $('photo-title').textContent = selectedClass
    ? 'Fotos · ' + $('class-name').textContent
    : 'Lokaler Fototest';
  $('photo-intro').textContent = photoState.enabled
    ? 'Fotos werden nach Bestätigung für diese Klasse gespeichert. Andere berechtigte Lehrkräfte sehen dieselben Fotos. Änderungen werden protokolliert.'
    : selectedClass
      ? 'Fotos werden dieser Klasse nur für die aktuelle Sitzung zugeordnet.'
      : 'Fotos und Namen bleiben nur in diesem Browserfenster. Neuladen beendet den Fototest; es erfolgt kein Upload.';
  $('stored-photos').hidden = !photoState.enabled;
  const stored = people.filter((p) => p.photoVersion);
  $('stored-photo-count').textContent =
    `${photoState.total} Fotos gespeichert · ${stored.length} bei aktuellen Mitgliedern`;
  $('stored-photo-list').innerHTML = stored
    .map(
      (p) =>
        `<div class="stored-photo-row"><label class="check"><input type="checkbox" data-delete-member="${escapeHTML(p.memberId)}"><img src="${p.photo}" alt=""><span>${escapeHTML(p.first + ' ' + p.last)}${companyCaption(p)}</span></label>${companyButton(p)}<button type="button" data-edit-photo="${p.id}" ${photoBusy ? 'disabled' : ''}>Anpassen</button></div>`,
    )
    .join('');
  $('delete-all-photos').disabled = photoBusy || !photoState.total || photoState.revision === null;
  $('delete-selected-photos').disabled =
    photoBusy || !stored.length || photoState.revision === null;
}
$('stored-photo-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-photo]');
  if (!button || photoBusy) return;
  const p = people[Number(button.dataset.editPhoto)];
  if (!p?.photo) return;
  showPhotoReview(
    [
      {
        filename: p.account + '.jpg',
        source: p.photo,
        photo: p.photo,
        target: p.id,
        stored: true,
        crop: { x: 0.5, y: 0.5, zoom: 1, fit: false },
      },
    ],
    classRequest,
    selectedClass,
  );
  $('photo-review-open-only').checked = false;
  updatePhotoReview();
  $('photo-review').querySelector('[data-crop-index]').click();
});
async function deletePhotos(all) {
  if (photoBusy || photoState.revision === null) return;
  const ids = [...$('stored-photo-list').querySelectorAll('input:checked')].map(
    (e) => e.dataset.deleteMember,
  );
  if (!all && !ids.length) {
    $('import-status').textContent = 'Bitte Fotos zum Löschen markieren.';
    return;
  }
  if (
    !confirm(
      `${all ? 'Alle ' + photoState.total : ids.length} Fotos der Klasse ${$('class-name').textContent} dauerhaft löschen? Die Schülerliste bleibt erhalten.`,
    )
  )
    return;
  const request = classRequest;
  setPhotoBusy(true);
  let committed = false;
  try {
    const result = await photoRequest('DELETE', {
      revision: photoState.revision,
      ...(all ? { all: true, confirmClass: selectedClass } : { memberIds: ids }),
    });
    committed = true;
    if (request !== classRequest) return;
    clearPhotoReview();
    await refreshPhotos();
    if (request !== classRequest) return;
    updatePhotoManagement();
    $('import-status').textContent =
      `${result.changed} Fotos gelöscht. Der Vorgang ist protokolliert.`;
  } catch (e) {
    $('import-status').textContent =
      (committed ? 'Fotos wurden gelöscht. Anzeige bitte neu laden. ' : '') + e.message;
  } finally {
    setPhotoBusy(false);
  }
}
$('delete-selected-photos').onclick = () => deletePhotos(false);
$('delete-all-photos').onclick = () => deletePhotos(true);

function leaveLearning() {
  if (mode === 'learning') learningUI?.reset();
  document.body.classList.remove('learning-mode');
  $('learning-panel').hidden = true;
  $('learn-tab').setAttribute('aria-selected', 'false');
}
learningUI = createLearningUI({
  onCompanies: applyCompanies,
  notify: savedPhotoNotice,
  context: () => ({
    group: selectedClass,
    people,
    csrf: authSession?.csrf,
    local: localClass,
    admin: !!authSession?.admin,
    loading: classLoading,
  }),
  face,
  escapeHTML,
  groups: () => adminUI?.groups() || [],
});

$('learn-tab').onclick = () => {
  if (running || classLoading) return;
  mode = 'learning';
  result = null;
  document.body.classList.remove('seating-mode');
  document.body.classList.add('learning-mode');
  $('seating-panel').hidden = true;
  $('learning-panel').hidden = false;
  for (const id of ['pick-tab', 'team-tab', 'seat-tab', 'learn-tab'])
    $(id).setAttribute('aria-selected', String(id === 'learn-tab'));
  learningUI.open();
};
