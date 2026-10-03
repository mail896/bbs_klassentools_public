import { paginate } from './admin-ui.mjs?v=af1f701092f9';
import { createLearningUI, setupLearningAdmin } from './learning-ui.mjs?v=045fe86d9507';
import { colors, demoPeople } from './demo.mjs?v=9e9fedd7f899';
import { matchPhotos } from './photo-matching.mjs?v=7aed189788e4';
import {
  arrangeSeats,
  seatDimensions,
  rotateSeat,
  moveSeat,
  snapSeat,
  compactSeatRoom,
  seatRoomWidth,
  seatRoomHeight,
  seatDisplay,
} from './seating-layout.mjs?v=8bcf6a38d8cc';
import { drawSeatExport } from './seating-export.mjs?v=bbf03e43fb17';
import { shuffle, groupSizes, draw, drawChances } from './logic.mjs?v=ff3b470a050d';
const $ = (id) => document.getElementById(id);
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
let learningUI = null;
let people = demoPeople();
let localClass = false;
let selectedClass = '',
  classRequest = 0,
  classLoading = false;
let pendingPhotos = null,
  photoState = { enabled: false, revision: null, total: 0 },
  photoBusy = false,
  cropState = null,
  auditCursor = null;
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
      : `<img class="avatar-placeholder" src="./avatar-placeholder.png" alt="Kein Foto vorhanden">`;
const key = 'klassentools.demo.v1';
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(key)) || {};
} catch {}
let seen = Array.isArray(saved.seen)
  ? saved.seen.filter((id) => Number.isInteger(id) && id >= 0 && id < 24)
  : [];
const seatingPlans = new Map();
let seatSelection = null,
  seatDrag = null,
  seatFit = false;
let seatExportEpoch = 0,
  seatExportTimer,
  seatExportWork = null,
  seatExportReady = null;
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
    invalidateSeatExport();
    requestAnimationFrame(fitFullscreenGrid);
  };
function applyCompanies(data) {
  for (const p of people)
    p.companyInfo = data.companies.find((c) => c.id === data.assignments[p.memberId]) || null;
  closeCompanyTip();
  render();
  invalidateSeatExport();
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
  if (mode === 'seating') renderSeating();
  requestAnimationFrame(fitFullscreenGrid);
}
function clearResult() {
  result = null;
  render();
}
function lock(value) {
  running = value;
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
    if (!authSession.admin) clearAdmin();
    if (adminPage) {
      $('admin-access').hidden = !!authSession.admin;
      if (authSession.admin && $('admin-dialog').hidden) await openAdminPage();
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
      seatingPlans.clear();
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
    seatingPlans.clear();
    $('admin-open').hidden = true;
    clearAdmin();
    if (adminPage) $('admin-access').hidden = false;
    if (selectedClass) resetDemo();
    $('iserv-classes').hidden = true;
    $('auth-status').textContent =
      'Der Anmeldedienst ist momentan nicht verfügbar. Der lokale Fototest bleibt nutzbar.';
  }
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
    location.href = './?demo=1';
    return;
  }
  try {
    const r = await fetch('./api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': authSession.csrf },
    });
    if (!r.ok) throw new Error();
    location.href = './?demo=1';
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
  seatSelection = null;
  seatDrag = null;
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
      seatingPlans.clear();
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

let adminState = null,
  adminBusy = false,
  adminRequest = 0;
function adminDirty() {
  return adminState && [...adminState.selected].sort().join(',') !== adminState.original;
}
let learningAdmin,
  adminGroupPage = 0;
function clearAdmin() {
  learningAdmin?.reset();
  adminGroupPage = 0;
  for (const name of ['companies', 'learning']) $('admin-' + name + '-panel').replaceChildren();
  adminRequest++;
  adminState = null;
  adminBusy = false;
  $('admin-dialog').hidden = true;
  clearAudit();
  usageRequest++;
  $('usage-content').replaceChildren();
  $('admin-groups').replaceChildren();
  $('admin-search').value = '';
  $('admin-count').textContent = '';
  $('admin-status').textContent = '';
}
function renderAdmin() {
  const focused = document.activeElement?.dataset?.groupId;
  const query = $('admin-search').value.trim().toLocaleLowerCase('de');
  const rows = (adminState?.groups || []).filter(
    (g) =>
      (!$('admin-only-selected').checked || adminState.selected.has(g.id)) &&
      `${g.name} ${g.account}`.toLocaleLowerCase('de').includes(query),
  );
  paginate(
    $('admin-groups'),
    rows,
    20,
    (pageRows) =>
      pageRows
        .map(
          (g) =>
            `<label class="admin-group"><input type="checkbox" data-group-id="${escapeHTML(g.id)}" ${adminState.selected.has(g.id) ? 'checked' : ''} ${adminBusy ? 'disabled' : ''}><span><strong>${escapeHTML(g.name)}</strong><small>${escapeHTML(g.account)}</small></span></label>`,
        )
        .join(''),
    'Gruppen',
    adminGroupPage,
    (page) => {
      adminGroupPage = page;
    },
  );
  $('admin-count').textContent = adminState
    ? `${adminState.selected.size} als Klasse ausgewählt · ${rows.length} passende Gruppen`
    : '';
  $('admin-audit-tab').disabled = adminBusy || !adminState;
  $('admin-save').disabled = adminBusy || !adminDirty();
  $('admin-reload').disabled = adminBusy;
  if (focused)
    [...$('admin-groups').querySelectorAll('input')]
      .find((el) => el.dataset.groupId === focused)
      ?.focus();
}
async function fetchAdmin() {
  adminGroupPage = 0;
  const request = ++adminRequest;
  adminBusy = true;
  renderAdmin();
  $('admin-status').textContent = 'IServ-Gruppen werden geladen …';
  try {
    const r = await fetch('./api/admin/classes', { credentials: 'same-origin', cache: 'no-store' }),
      data = await r.json();
    if (request !== adminRequest) return;
    if (!r.ok) throw new Error(data.error || 'Gruppen konnten nicht geladen werden.');
    const known = new Set(data.groups.map((g) => g.id));
    const missing = data.selected
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: 'Nicht mehr in IServ verfügbar', account: id }));
    adminState = {
      groups: [...data.groups, ...missing],
      selected: new Set(data.selected),
      original: [...data.selected].sort().join(','),
      revision: data.revision,
    };
    $('admin-status').textContent = 'Auswahl prüfen und Änderungen speichern.';
  } catch (e) {
    if (request !== adminRequest) return;
    $('admin-status').textContent = e.message;
  } finally {
    if (request === adminRequest) {
      adminBusy = false;
      renderAdmin();
    }
  }
}
async function openAdminPage() {
  const initial = new URL(location.href).searchParams.get('admin');
  setAdminPanel('classes');
  $('admin-dialog').hidden = false;
  $('admin-search').value = '';
  $('admin-only-selected').checked = false;
  await fetchAdmin();
  if (!authSession?.admin) return;
  if (initial === 'usage') $('admin-usage-tab').click();
  else if (['audit', 'companies', 'learning'].includes(initial) && adminState)
    $('admin-' + initial + '-tab').click();
}
$('admin-open').onclick = () => {
  location.href = './?admin=classes';
};
function leaveAdmin(e) {
  if (adminBusy || (adminDirty() && !confirm('Nicht gespeicherte Änderungen verwerfen?'))) {
    e.preventDefault();
    return false;
  }
  return true;
}
$('admin-back').onclick = leaveAdmin;
window.addEventListener('beforeunload', (e) => {
  if (adminPage && (adminBusy || adminDirty())) {
    e.preventDefault();
    e.returnValue = '';
  }
});
$('admin-search').oninput = $('admin-only-selected').onchange = () => {
  adminGroupPage = 0;
  renderAdmin();
};
$('admin-groups').onchange = (e) => {
  const id = e.target.dataset.groupId;
  if (!id || !adminState || adminBusy) return;
  e.target.checked ? adminState.selected.add(id) : adminState.selected.delete(id);
  renderAdmin();
};
$('admin-reload').onclick = () => {
  if (!adminDirty() || confirm('Nicht gespeicherte Änderungen verwerfen und Gruppen neu laden?'))
    fetchAdmin();
};
$('admin-dialog').querySelector('form').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.isComposing && e.target.matches('input[type=search]')) {
    e.preventDefault();
    e.currentTarget.requestSubmit();
  }
};
$('admin-dialog').querySelector('form').onsubmit = (e) => {
  e.preventDefault();
  if (!$('admin-audit-panel').hidden) {
    clearTimeout(auditSearchTimer);
    loadPhotoAudit();
  } else if (!$('admin-learning-panel').hidden) $('learn-audit-load')?.click();
};
for (const button of $('admin-dialog').querySelectorAll('[data-admin-back]')) {
  button.onclick = (e) => {
    if (leaveAdmin(e)) location.href = './?app=1';
  };
}
$('admin-save').onclick = async () => {
  if (!adminState || adminBusy || !authSession?.csrf) return;
  if (
    !adminState.selected.size &&
    !confirm('Keine Klasse freigeben? Lehrkräfte können dann nur den lokalen Modus nutzen.')
  )
    return;
  const request = ++adminRequest;
  adminBusy = true;
  renderAdmin();
  $('admin-status').textContent = 'Auswahl wird gespeichert …';
  try {
    const r = await fetch('./api/admin/classes', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': authSession.csrf },
        body: JSON.stringify({ selected: [...adminState.selected], revision: adminState.revision }),
      }),
      data = await r.json();
    if (request !== adminRequest) return;
    if (!r.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
    adminState.selected = new Set(data.selected);
    adminState.original = [...data.selected].sort().join(',');
    adminState.revision = data.revision;
    let notice = 'Klassenfreigaben gespeichert.';
    if (!adminPage)
      try {
        await loadClasses();
      } catch {
        notice =
          'Gespeichert. Bitte laden Sie die Hauptseite neu, um Ihre Klassen zu aktualisieren.';
      }
    if (request !== adminRequest) return;
    $('class-status').textContent = notice;
    $('admin-status').textContent = notice;
  } catch (e) {
    if (request === adminRequest) $('admin-status').textContent = e.message;
  } finally {
    if (request === adminRequest) {
      adminBusy = false;
      renderAdmin();
    }
  }
};

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
      seatingPlans.clear();
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
let auditRequest = 0;
let auditPages = [null],
  auditPage = 0;
function clearAudit() {
  clearTimeout(auditSearchTimer);
  auditRequest++;
  auditCursor = null;
  auditPages = [null];
  auditPage = 0;
  $('previous-photo-audit').disabled = true;
  $('photo-audit-page').textContent = '';
  $('photo-audit').replaceChildren();
  $('more-photo-audit').hidden = true;
  $('audit-status').textContent = '';
}
function setAdminPanel(panel) {
  clearAudit();
  usageRequest++;
  learningAdmin?.reset();
  for (const name of ['classes', 'audit', 'usage', 'companies', 'learning']) {
    $('admin-' + name + '-panel').hidden = name !== panel;
    $('admin-' + name + '-tab').setAttribute('aria-pressed', String(name === panel));
  }
  if (adminPage) history.replaceState(null, '', '?admin=' + panel);
}
$('admin-classes-tab').onclick = () => setAdminPanel('classes');
$('admin-audit-tab').onclick = () => {
  setAdminPanel('audit');
  $('audit-class-search').value = '';
  $('audit-query').value = '';
  $('audit-active').checked = true;
  renderAuditClasses();
  loadPhotoAudit();
};
async function loadPhotoAudit(direction = 0) {
  const request = ++auditRequest;
  $('more-photo-audit').disabled = true;
  $('previous-photo-audit').disabled = true;
  const nextPage = direction ? auditPage + direction : 0;
  const cursor = direction === 1 ? auditCursor : direction === -1 ? auditPages[nextPage] : null;
  if (!direction) {
    auditPages = [null];
    auditPage = 0;
    $('photo-audit').replaceChildren();
    auditCursor = null;
    $('more-photo-audit').hidden = true;
  }
  $('audit-status').textContent = 'Änderungsverlauf wird geladen …';
  const params = new URLSearchParams({
    active: $('audit-active').checked ? '1' : '0',
    q: $('audit-query').value.trim(),
  });
  if ($('audit-class').value) params.set('group', $('audit-class').value);
  if (cursor) params.set('before', cursor);
  try {
    const response = await fetch('./api/admin/audit?' + params, {
        credentials: 'same-origin',
        cache: 'no-store',
      }),
      data = await response.json();
    if (request !== auditRequest) return;
    if (!response.ok)
      throw new Error(data.error || 'Änderungsverlauf konnte nicht geladen werden.');
    auditPage = nextPage;
    auditPages[auditPage] = cursor;
    $('photo-audit').replaceChildren();
    for (const entry of data.entries) {
      const p = document.createElement('p');
      const action =
        {
          upload: 'Foto hinzugefügt',
          replace: 'Foto ersetzt',
          delete: 'Foto gelöscht',
          delete_all: 'Foto bei Klassenlöschung entfernt',
          seat_save: 'Sitzplan gespeichert',
          seat_delete: 'Sitzplan gelöscht',
        }[entry.action] || entry.action;
      const group = adminState?.groups.find((g) => g.id === entry.class_id)?.name || entry.class_id;
      p.textContent = `${new Date(entry.time).toLocaleString('de-DE')} · ${group} · ${entry.actor_name} · ${action}: ${entry.member_name} (Stand ${entry.revision})`;
      $('photo-audit').append(p);
    }
    auditCursor = data.next;
    $('more-photo-audit').hidden = false;
    $('photo-audit-page').textContent = `Seite ${auditPage + 1}`;
    $('audit-status').textContent = $('photo-audit').children.length
      ? `${$('photo-audit').children.length} Einträge angezeigt`
      : $('audit-query').value.trim() || $('audit-class').value
        ? 'Keine Änderungen für diese Filter gefunden.'
        : 'Noch keine Änderungen.';
  } catch (e) {
    if (request === auditRequest) $('audit-status').textContent = e.message;
  } finally {
    if (request === auditRequest) {
      $('more-photo-audit').disabled = !auditCursor;
      $('previous-photo-audit').disabled = auditPage === 0;
    }
  }
}
function renderAuditClasses() {
  const current = $('audit-class').value,
    q = $('audit-class-search').value.trim().toLocaleLowerCase('de');
  const groups = (adminState?.groups || []).filter(
    (g) =>
      (!$('audit-active').checked || adminState.original.split(',').includes(g.id)) &&
      `${g.name} ${g.account}`.toLocaleLowerCase('de').includes(q),
  );
  $('audit-class').replaceChildren(
    new Option($('audit-active').checked ? 'Alle freigegebenen Klassen' : 'Alle Klassen', ''),
    ...groups.map((g) => new Option(g.name, g.id)),
  );
  if (groups.some((g) => g.id === current)) $('audit-class').value = current;
}
let auditSearchTimer;
$('audit-class-search').oninput = () => {
  const previous = $('audit-class').value;
  renderAuditClasses();
  if (previous !== $('audit-class').value) loadPhotoAudit();
};
$('audit-active').onchange = () => {
  renderAuditClasses();
  loadPhotoAudit();
};
$('audit-query').oninput = () => {
  clearAudit();
  auditSearchTimer = setTimeout(() => loadPhotoAudit(), 250);
};
$('audit-class').onchange = () => loadPhotoAudit();
$('audit-search-button').onclick = () => {
  clearTimeout(auditSearchTimer);
  loadPhotoAudit();
};
$('more-photo-audit').onclick = () => loadPhotoAudit(1);
$('previous-photo-audit').onclick = () => loadPhotoAudit(-1);

let usageRequest = 0;
const usageLabels = {
  view: 'Aufruf',
  class_open: 'Klasse geöffnet',
  pick: 'Einzelauswahl',
  teams: 'Teams gebildet',
  local_import: 'Lokaler Fotoimport',
  photo_save: 'Fotos gespeichert',
  photo_delete: 'Fotos gelöscht',
};
function usageTable(title, heads, rows) {
  const section = document.createElement('section'),
    heading = document.createElement('h3'),
    wrap = document.createElement('div'),
    table = document.createElement('table');
  heading.textContent = title;
  wrap.className = 'usage-table';
  const header = table.createTHead().insertRow();
  for (const label of heads) {
    const th = document.createElement('th');
    th.textContent = label;
    header.append(th);
  }
  const body = table.createTBody();
  const fill = (pageRows) => {
    body.replaceChildren();
    for (const values of pageRows) {
      const tr = body.insertRow();
      for (const value of values) tr.insertCell().textContent = value ?? 0;
    }
    if (!pageRows.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = heads.length;
      cell.textContent = 'Noch keine Nutzung im gewählten Zeitraum.';
    }
  };
  wrap.append(table);
  section.append(heading);
  if (rows.length > 20) {
    const pages = document.createElement('div');
    paginate(
      pages,
      rows,
      20,
      (pageRows, content) => {
        fill(pageRows);
        content.append(wrap);
      },
      'Einträge',
    );
    section.append(pages);
  } else {
    fill(rows);
    section.append(wrap);
  }
  return section;
}
async function loadUsage() {
  const request = ++usageRequest;
  $('usage-status').textContent = 'Statistik wird geladen …';
  $('usage-content').replaceChildren();
  try {
    const response = await fetch('./api/admin/usage?days=' + $('usage-days').value, {
        credentials: 'same-origin',
        cache: 'no-store',
      }),
      data = await response.json();
    if (request !== usageRequest) return;
    if (!response.ok) throw new Error(data.error || 'Statistik nicht verfügbar.');
    const total = data.totals,
      context = (r) =>
        r.context === 'iserv'
          ? r.name || r.class_name
          : r.context === 'local'
            ? 'Lokaler Fototest'
            : 'DEMO-Klasse';
    $('usage-status').textContent =
      `${total.views || 0} Aufrufe · ${total.sessions} Sitzungen · ${total.teachers} Lehrkräfte · ${total.picks || 0} Einzelauswahlen · ${total.teams || 0} Teambildungen`;
    $('usage-content').append(
      usageTable(
        'Anmeldung',
        [
          'Zugang',
          'Sitzungen',
          'Aufrufe',
          'Lokale Importe',
          'Lokal geladene Fotos',
          'Speichervorgänge',
        ],
        data.access.map((r) => [
          r.access === 'teacher' ? 'Mit IServ' : 'Ohne Anmeldung',
          r.sessions,
          r.views,
          r.imports,
          r.photos,
          r.uploads,
        ]),
      ),
      usageTable(
        'Herkunft',
        ['Netz', 'Sitzungen', 'Aufrufe'],
        data.networks.map((r) => [
          {
            school: 'Schulnetz',
            external: 'Außerhalb',
            unknown: 'Unbekannt / noch nicht konfiguriert',
          }[r.network],
          r.sessions,
          r.views,
        ]),
      ),
      usageTable(
        'Lehrkräfte',
        ['Name', 'Sitzungen', 'Aufrufe', 'Auswahlen', 'Teams', 'Lokale Importe', 'Zuletzt'],
        data.teachers.map((r) => [
          r.name,
          r.sessions,
          r.views,
          r.picks,
          r.teams,
          r.imports,
          new Date(r.last).toLocaleString('de-DE'),
        ]),
      ),
      usageTable(
        'Lehrkräfte je Klasse',
        ['Lehrkraft', 'Klasse', 'Geöffnet', 'Auswahlen', 'Teams'],
        data.teacherClasses.map((r) => [r.teacher, r.name, r.opens, r.picks, r.teams]),
      ),
      usageTable(
        'Klassen und Modi',
        ['Klasse / Modus', 'Sitzungen', 'Geöffnet', 'Auswahlen', 'Teams'],
        data.classes.map((r) => [context(r), r.sessions, r.opens, r.picks, r.teams]),
      ),
      usageTable(
        'Letzte 100 Aktivitäten',
        ['Zeit', 'Nutzung durch', 'Aktion', 'Klasse / Modus', 'Anzahl'],
        data.recent.map((r) => [
          new Date(r.time).toLocaleString('de-DE'),
          r.actor_name || 'Ohne Anmeldung',
          usageLabels[r.action],
          context(r),
          r.amount || '–',
        ]),
      ),
    );
  } catch (e) {
    if (request === usageRequest) $('usage-status').textContent = e.message;
  }
}
$('admin-usage-tab').onclick = () => {
  setAdminPanel('usage');
  loadUsage();
};
$('usage-days').onchange = loadUsage;
$('usage-reload').onclick = loadUsage;

// Seating coordinates are stored in room orientation; display is from the teacher’s side.
function seatContext() {
  const key = selectedClass || (localClass ? 'local' : 'demo');
  const signature = people.map((p) => p.memberId || `${p.id}:${p.first}:${p.last}`).join('|');
  let entry = seatingPlans.get(key);
  if (!entry || entry.signature !== signature) {
    const plan = {
      size: 2,
      layout: 'u',
      rows: 3,
      teacher: { x: 500, y: 80 },
      tables: [],
      pinned: [],
      saved: null,
    };
    plan.tables = Array.from({ length: Math.ceil(people.length / 2) }, (_, i) => ({
      x: 0,
      y: 0,
      slots: [people[i * 2]?.id ?? null, people[i * 2 + 1]?.id ?? null],
    }));
    arrangeSeats(plan, 'u');
    entry = {
      signature,
      shared: plan,
      initial: structuredClone(plan),
      private: null,
      view: 'shared',
    };
    seatingPlans.set(key, entry);
    seatSelection = null;
  }
  return entry;
}
function seatPlan() {
  const e = seatContext();
  return e[e.view];
}
function seatLimit(plan) {
  return Math.ceil(people.length / plan.size) + 4;
}
function seatDesk(key) {
  return key === 'teacher' ? seatPlan().teacher : seatPlan().tables[Number(key)];
}
function seatNotify(text) {
  $('seat-status').textContent = text;
}
function seatPerson(id) {
  return people.find((p) => p.id === id);
}
function seatTile(id, table, index) {
  const p = seatPerson(id),
    plan = seatPlan(),
    chosen = id !== null && seatSelection === id,
    locked = plan.pinned.includes(id);
  const label = p ? `${p.first} ${p.last}${absent.has(id) ? ' · abwesend' : ''}` : 'Freier Platz';
  return `<div class="seat-place ${chosen ? 'seat-selected' : ''} ${p && absent.has(id) ? 'seat-absent' : ''}"><button class="seat-person" ${p ? 'draggable="true"' : ''} data-seat-person="${id ?? ''}" data-seat-table="${table}" data-seat-index="${index}" aria-label="${escapeHTML(label)}" aria-pressed="${chosen}">${p ? `<span class="seat-face">${face(p)}</span><span class="seat-name">${escapeHTML(p.first)}<small>${escapeHTML(p.last)}</small>${companyCaption(p)}</span>` : '<span class="seat-empty">＋<small>Freier Platz</small></span>'}</button>${companyButton(p)}${p ? `<button class="seat-pin" data-seat-pin="${id}" aria-pressed="${locked}" title="${locked ? 'Fixierung lösen' : 'Bei Zufallsverteilung auf diesem Platz lassen'}">${locked ? 'Fixiert' : 'Fixieren'}</button>` : ''}</div>`;
}
let seatDragging = false;
function fitSeatRoom() {
  if (seatDragging) return;
  const room = $('seat-room'),
    view = $('seat-viewport');
  if (!view || view.hidden || mode !== 'seating' || !room.offsetWidth || !view.clientWidth) return;
  const available = Math.max(
    220,
    innerHeight - Math.max(16, view.getBoundingClientRect().top) - 28,
  );
  const scale = seatFit
    ? Math.min(1, (view.clientWidth - 2) / room.offsetWidth, available / room.offsetHeight)
    : Math.min(1, Math.max(0.65, (view.clientWidth - 2) / room.offsetWidth));
  room.style.top = '0px';
  room.style.transform = `scale(${scale})`;
  room.style.left = Math.max(0, (view.clientWidth - room.offsetWidth * scale) / 2) + 'px';
  view.style.height = room.offsetHeight * scale + 2 + 'px';
  view.classList.toggle('seat-overview', seatFit);
  if (seatFit) {
    view.scrollTop = 0;
    view.scrollLeft = 0;
  }
  $('seat-fit').setAttribute('aria-pressed', String(seatFit));
  $('seat-detail').setAttribute('aria-pressed', String(!seatFit));
  $('seat-zoom').textContent = Math.round(scale * 100) + ' %';
}
function renderSeating() {
  invalidateSeatExport();
  const current = seatContext();
  if (selectedClass && !current.remote && !current.busy && !current.error && !classLoading) {
    loadSeatPlans();
    return;
  }
  for (const control of $('seating-panel').querySelectorAll(
    '.seat-toolbar button,.seat-toolbar select,.seat-view-tools button',
  ))
    control.disabled = classLoading || !!current.busy;
  if (classLoading) {
    $('seat-tables').replaceChildren();
    $('seat-unplaced').replaceChildren();
    $('seat-count').textContent = '';
    seatNotify('Klasse wird geladen …');
    return;
  }
  const entry = seatContext(),
    plan = seatPlan();
  plan.room = { width: seatRoomWidth(plan), height: seatRoomHeight(plan) };
  $('seat-storage-mode').textContent = selectedClass ? 'IServ-Klasse' : 'Lokaler Entwurf';
  $('seat-storage-note').textContent = selectedClass
    ? 'Gemeinsame Pläne stehen den berechtigten Lehrkräften dieser Klasse zur Verfügung. Private Pläne sind nur für Ihr Konto sichtbar. Speichern und Löschen werden für die Administration protokolliert.'
    : 'DEMO und lokaler Fototest: Entwürfe bleiben nur bis zum Neuladen in diesem Browserfenster.';
  const options = [new Option(selectedClass ? 'Gemeinsamer Sitzplan' : 'Klassenentwurf', 'shared')];
  if (selectedClass) {
    for (const v of entry.meta?.privateVersions || [])
      options.push(new Option(v.name, v.version === 1 ? 'private' : 'private:' + v.version));
    if (entry.private && !entry.meta?.private?.plan)
      options.push(
        new Option(
          'Private Kopie · noch nicht gespeichert',
          entry.meta?.private?.version > 1 ? 'private:' + entry.meta.private.version : 'private',
        ),
      );
  } else options.push(new Option('Meine private Kopie', 'private'));
  $('seat-plan').replaceChildren(...options);
  $('seat-save').textContent = selectedClass ? 'Sitzplan speichern' : 'Entwurf merken';
  $('seat-copy').textContent = selectedClass
    ? 'Als privaten Sitzplan speichern'
    : 'Private Kopie anlegen';
  $('seat-restore').hidden = !!selectedClass;
  $('seat-reload').hidden = !selectedClass;
  $('seat-delete').hidden = !selectedClass;
  const meta = entry.meta?.[entry.view],
    dirty = entry.remote && JSON.stringify(seatDocument(plan)) !== entry.baselines?.[entry.view];
  $('seat-save-state').textContent = selectedClass
    ? entry.busy
      ? 'Bitte warten …'
      : entry.error ||
        (dirty
          ? 'Ungespeicherte Änderungen. '
          : meta?.plan
            ? 'Gespeichert. '
            : 'Noch kein gespeicherter Plan. ') +
          (meta?.updatedAt
            ? 'Stand ' + new Date(meta.updatedAt).toLocaleString('de-DE') + ' · ' + meta.updatedBy
            : '')
    : '';
  $('seat-plan').value =
    entry.view === 'private' && entry.meta?.private?.version > 1
      ? 'private:' + entry.meta.private.version
      : entry.view;
  if (!selectedClass) $('seat-plan').options[1].disabled = !entry.private;
  $('seat-new-version').hidden = !selectedClass || entry.view !== 'private';
  $('seat-new-version').disabled = !entry.remote || !entry.meta?.private?.plan;
  $('seat-size').value = String(plan.size);
  $('seat-row-count').value = String(plan.rows || 3);
  $('seat-row-count').disabled = plan.layout !== 'rows';
  $('seat-u').setAttribute('aria-pressed', String(plan.layout === 'u'));
  $('seat-rows').setAttribute('aria-pressed', String(plan.layout === 'rows'));
  $('seat-restore').disabled = !plan.saved;
  $('seat-copy').disabled = entry.view === 'private';
  $('seat-tables').innerHTML = plan.tables
    .map(
      (t, i) =>
        `<section class="seat-table ${t.vertical ? 'seat-vertical' : ''}" style="left:${seatDisplay(t, seatDimensions(t).w, seatDimensions(t).h, plan).x}px;top:${seatDisplay(t, seatDimensions(t).w, seatDimensions(t).h, plan).y}px" aria-label="Tisch ${i + 1}"><div class="seat-desk-tools"><button class="seat-handle" data-seat-desk="${i}" aria-label="Tisch ${i + 1} verschieben; Pfeiltasten zum Bewegen, Umschalt für Feinschritte">⠿ Tisch ${i + 1}</button><button class="seat-rotate" data-seat-rotate="${i}" aria-label="Tisch ${i + 1} drehen" title="${t.vertical ? 'Querformat' : 'Hochkant'}">↻</button></div><div class="seat-places">${t.slots.map((id, j) => seatTile(id, i, j)).join('')}</div></section>`,
    )
    .join('');
  const assigned = new Set(plan.tables.flatMap((t) => t.slots).filter((id) => id !== null));
  const unplaced = people.filter((p) => !assigned.has(p.id));
  $('seat-unplaced').innerHTML = unplaced.map((p) => seatTile(p.id, -1, -1)).join('');
  $('seat-unplaced-count').textContent = String(unplaced.length);
  $('seat-count').textContent =
    `${plan.tables.length} Tische · ${plan.tables.length * plan.size} Plätze · ${assigned.size} zugeordnet`;
  $('seat-unseat').disabled = seatSelection === null;
  $('seat-remove').disabled = !plan.tables.some((t) => t.slots.every((id) => id === null));
  $('seat-add').disabled = plan.tables.length >= seatLimit(plan);
  $('seat-limit').textContent = `Maximal ${seatLimit(plan)} Tische: Bedarf plus 4 Reservetische.`;
  const teacherPosition = seatDisplay(plan.teacher, 200, 56, plan);
  $('seat-teacher').style.left = teacherPosition.x + 'px';
  $('seat-teacher').style.top = teacherPosition.y + 'px';
  $('seat-room').style.width = seatRoomWidth(plan) + 'px';
  $('seat-room').style.height = seatRoomHeight(plan) + 'px';
  if (entry.busy) {
    for (const el of $('seating-panel').querySelectorAll('button,select')) el.disabled = true;
  } else {
    if (selectedClass) $('seat-save').disabled = !entry.remote || !!entry.error;
    $('seat-reload').disabled = false;
    $('seat-delete').disabled = !entry.remote || !meta?.plan;
    $('seat-teacher').disabled = false;
  }
  requestAnimationFrame(() => {
    fitSeatRoom();
    scheduleSeatExport();
  });
}
function seatMove(id, table, index) {
  if (seatContext().busy) return;
  const plan = seatPlan();
  if (!seatPerson(id)) return;
  const source = plan.tables.find((t) => t.slots.includes(id)),
    position = source?.slots.indexOf(id);
  const target = table >= 0 ? plan.tables[table] : null,
    other = target?.slots[index] ?? null;
  if (plan.pinned.includes(id) || (other !== null && plan.pinned.includes(other))) {
    seatNotify('Bitte zuerst die Fixierung des betroffenen Platzes lösen.');
    return;
  }
  if (target && (!Number.isInteger(index) || index < 0 || index >= plan.size)) return;
  if (source) source.slots[position] = other;
  if (target) target.slots[index] = id;
  seatSelection = null;
  renderSeating();
  seatNotify(target ? 'Sitzplatz geändert.' : 'Schüler unter „Noch ohne Platz“ abgelegt.');
}
$('seat-tab').onclick = () => {
  if (running) return;
  leaveLearning();
  mode = 'seating';
  seatFit = false;
  result = null;
  document.body.classList.add('seating-mode');
  $('seating-panel').hidden = false;
  for (const id of ['pick-tab', 'team-tab', 'seat-tab'])
    $(id).setAttribute('aria-selected', String(id === 'seat-tab'));
  renderSeating();
  if (!seatContext().busy && !seatContext().error)
    seatNotify(
      'Tische am Griff verschieben. Schüler ziehen oder erst den Schüler, dann den Zielplatz anklicken.',
    );
};
$('seating-panel').addEventListener('click', (e) => {
  if (seatContext().busy) return;
  const rotation = e.target.closest('[data-seat-rotate]');
  if (rotation) {
    const plan = seatPlan(),
      index = Number(rotation.dataset.seatRotate);
    rotateSeat(plan.tables[index]);
    renderSeating();
    $('seat-tables').querySelector(`[data-seat-rotate="${index}"]`).focus({ preventScroll: true });
    seatNotify('Tisch gedreht. Die Sitzzuordnung bleibt erhalten.');
    return;
  }
  const pin = e.target.closest('[data-seat-pin]');
  if (pin) {
    const plan = seatPlan(),
      id = Number(pin.dataset.seatPin);
    plan.pinned = plan.pinned.includes(id)
      ? plan.pinned.filter((x) => x !== id)
      : [...plan.pinned, id];
    renderSeating();
    return;
  }
  const button = e.target.closest('[data-seat-person]');
  if (!button) return;
  const id = button.dataset.seatPerson === '' ? null : Number(button.dataset.seatPerson);
  if (seatSelection !== null) {
    if (id === seatSelection) {
      seatSelection = null;
      renderSeating();
    } else
      seatMove(seatSelection, Number(button.dataset.seatTable), Number(button.dataset.seatIndex));
  } else if (id !== null) {
    seatSelection = id;
    renderSeating();
    seatNotify('Jetzt den Zielplatz anklicken – belegte Plätze werden getauscht.');
  }
});
$('seating-panel').addEventListener('dragstart', (e) => {
  const b = e.target.closest('[data-seat-person]');
  if (!b || b.dataset.seatPerson === '') return;
  seatDrag = Number(b.dataset.seatPerson);
  e.dataTransfer.setData('text/plain', String(seatDrag));
  e.dataTransfer.effectAllowed = 'move';
});
$('seating-panel').addEventListener('dragover', (e) => {
  if (
    seatDrag !== null &&
    (e.target.closest('[data-seat-person]') || e.target.closest('.seat-tray'))
  )
    e.preventDefault();
});
$('seating-panel').addEventListener('drop', (e) => {
  if (seatDrag === null) return;
  const b = e.target.closest('[data-seat-person]');
  if (!b && !e.target.closest('.seat-tray')) return;
  e.preventDefault();
  seatMove(seatDrag, b ? Number(b.dataset.seatTable) : -1, b ? Number(b.dataset.seatIndex) : -1);
  seatDrag = null;
});
$('seating-panel').addEventListener('dragend', () => {
  seatDrag = null;
});
$('seat-unseat').onclick = () => {
  if (seatSelection !== null) seatMove(seatSelection, -1, -1);
};
$('seat-random').onclick = () => {
  const plan = seatPlan(),
    fixed = new Set([...plan.pinned, ...absent]);
  const pool = shuffle(
    people.filter((p) => !fixed.has(p.id)).map((p) => p.id),
    random,
  );
  for (const t of plan.tables)
    for (let i = 0; i < t.slots.length; i++)
      if (!fixed.has(t.slots[i])) t.slots[i] = pool.shift() ?? null;
  seatSelection = null;
  renderSeating();
  seatNotify('Neu verteilt. Fixierte und abwesende Schüler behalten ihren Platz.');
};
for (const [id, layout] of [
  ['seat-u', 'u'],
  ['seat-rows', 'rows'],
])
  $(id).onclick = () => {
    if (!confirm('Tische neu anordnen? Die Sitzzuordnung bleibt erhalten.')) return;
    arrangeSeats(seatPlan(), layout);
    renderSeating();
    seatNotify(layout === 'u' ? 'U-Form angeordnet.' : 'Tische in Reihen angeordnet.');
  };
$('seat-size').onchange = () => {
  const plan = seatPlan(),
    size = Number($('seat-size').value);
  if (
    !confirm(
      'Tischart wechseln und neu anordnen? Die Schüler werden übernommen; Fixierungen werden gelöst.',
    )
  ) {
    $('seat-size').value = String(plan.size);
    $('seat-row-count').value = String(plan.rows || 3);
    $('seat-row-count').disabled = plan.layout !== 'rows';
    $('seat-u').setAttribute('aria-pressed', String(plan.layout === 'u'));
    $('seat-rows').setAttribute('aria-pressed', String(plan.layout === 'rows'));
    return;
  }
  const ids = plan.tables.flatMap((t) => t.slots).filter((id) => id !== null);
  plan.size = size;
  plan.pinned = [];
  plan.tables = Array.from(
    { length: Math.ceil(Math.max(people.length, ids.length) / size) },
    (_, i) => ({
      x: 0,
      y: 0,
      slots: Array.from({ length: size }, (_, j) => ids[i * size + j] ?? null),
    }),
  );
  arrangeSeats(plan, plan.layout);
  renderSeating();
  seatNotify('Tischart geändert.');
};
$('seat-row-count').onchange = () => {
  const p = seatPlan(),
    rows = Number($('seat-row-count').value);
  if (!confirm('Tische in ' + rows + ' Reihen neu anordnen? Die Sitzzuordnung bleibt erhalten.')) {
    $('seat-row-count').value = String(p.rows || 3);
    return;
  }
  p.rows = rows;
  arrangeSeats(p, 'rows');
  renderSeating();
  seatNotify(rows + ' Tischreihen angeordnet.');
};
$('seat-add').onclick = () => {
  const p = seatPlan();
  if (p.tables.length >= seatLimit(p)) return;
  const width = seatRoomWidth(p);
  const vertical = $('seat-orientation').value === 'vertical';
  const { w, h } = seatDimensions({ vertical });
  let spot = null;
  for (let y = 180; !spot; y += h + 34)
    for (let x = 40; x + w <= width - 40; x += w + 20) {
      if (
        !(
          x < p.teacher.x + 220 &&
          x + w + 20 > p.teacher.x &&
          y < p.teacher.y + 80 &&
          y + h + 20 > p.teacher.y
        ) &&
        !p.tables.some(
          (t) =>
            x < t.x + seatDimensions(t).w + 20 &&
            x + w + 20 > t.x &&
            y < t.y + seatDimensions(t).h + 20 &&
            y + h + 20 > t.y,
        )
      ) {
        spot = { x, y };
        break;
      }
    }
  p.tables.push({ ...spot, vertical, slots: Array(p.size).fill(null) });
  renderSeating();
  seatNotify('Tisch auf einer freien Fläche hinzugefügt. Am Griff können Sie ihn verschieben.');
  requestAnimationFrame(() =>
    $('seat-tables').lastElementChild.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    }),
  );
};
$('seat-remove').onclick = () => {
  const p = seatPlan();
  p.tables = p.tables.filter((t) => t.slots.some((id) => id !== null));
  compactSeatRoom(p);
  renderSeating();
  seatNotify('Leere Tische entfernt.');
};
$('seat-compact').onclick = () => {
  compactSeatRoom(seatPlan());
  renderSeating();
  seatNotify(
    'Äußere Leerflächen verkleinert. Tischanordnung unverändert. Bitte speichern Sie den geänderten Plan.',
  );
};
$('seat-copy').onclick = async () => {
  const e = seatContext();
  if (e.busy) return;
  if (
    e.private &&
    seatDirty(e) &&
    !confirm('Ungespeicherte Änderungen am privaten Entwurf ersetzen?')
  )
    return;
  const newVersion = !!e.meta?.private?.plan;
  e.private = structuredClone(e.shared);
  e.private.saved = null;
  e.view = 'private';
  seatSelection = null;
  renderSeating();
  if (selectedClass) {
    await saveSeatPlan(false, newVersion);
  } else {
    seatNotify('Private Kopie angelegt. Änderungen betreffen nur diese Kopie in diesem Fenster.');
  }
};
$('seat-plan').onchange = () => {
  const entry = seatContext(),
    value = $('seat-plan').value;
  if (selectedClass && value.startsWith('private')) {
    const version = Number(value.split(':')[1] || 1);
    if (entry.meta?.private?.version !== version) {
      if (
        entry.private &&
        JSON.stringify(seatDocument(entry.private)) !== entry.baselines?.private &&
        !confirm('Ungespeicherte Änderungen am privaten Plan verwerfen und andere Version laden?')
      ) {
        renderSeating();
        return;
      }
      const snapshot = entry.meta.privateVersions.find((v) => v.version === version);
      if (snapshot) {
        entry.private = seatDecode(snapshot.plan);
        entry.meta.private = snapshot;
        entry.baselines.private = JSON.stringify(seatDocument(entry.private));
      }
    }
  }
  entry.view = value === 'shared' ? 'shared' : 'private';
  seatSelection = null;
  renderSeating();
  seatNotify('Plan gewechselt.');
};
$('seat-save').onclick = () => {
  if (selectedClass) {
    saveSeatPlan();
    return;
  }
  const p = seatPlan();
  p.saved = structuredClone({
    size: p.size,
    layout: p.layout,
    rows: p.rows,
    teacher: p.teacher,
    tables: p.tables,
    pinned: p.pinned,
  });
  renderSeating();
  seatNotify(
    'Stand in diesem Browserfenster gemerkt. Noch keine dauerhafte oder gemeinsame Speicherung.',
  );
};
$('seat-restore').onclick = () => {
  const p = seatPlan();
  if (!p.saved || !confirm('Zum gemerkten Stand zurückkehren?')) return;
  Object.assign(p, structuredClone(p.saved));
  seatSelection = null;
  renderSeating();
  seatNotify('Gemerkten Stand geladen.');
};
$('seat-room').addEventListener('keydown', (e) => {
  if (seatContext().busy) return;
  const b = e.target.closest('[data-seat-desk]'),
    delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[
      e.key
    ];
  if (!b || !delta) return;
  e.preventDefault();
  const t = seatDesk(b.dataset.seatDesk);
  const step = e.shiftKey ? 1 / 20 : 1;
  moveSeat(seatPlan(), t, t.x - delta[0] * step, t.y - delta[1] * step);
  renderSeating();
  $('seat-room').querySelector(`[data-seat-desk="${b.dataset.seatDesk}"]`).focus();
});
$('seat-room').addEventListener('pointerdown', (e) => {
  if (seatContext().busy) return;
  const b = e.target.closest('[data-seat-desk]');
  if (!b || e.button !== 0) return;
  e.preventDefault();
  const plan = seatPlan(),
    t = seatDesk(b.dataset.seatDesk),
    room = $('seat-room');
  const snapshot = structuredClone(plan);
  const start = {
    x: e.clientX,
    y: e.clientY,
    tx: t.x,
    ty: t.y,
    left: parseFloat(room.style.left) || 0,
  };
  const scale = room.getBoundingClientRect().width / room.offsetWidth;
  seatDragging = true;
  b.setPointerCapture(e.pointerId);
  const move = (ev) => {
    Object.assign(plan.teacher, snapshot.teacher);
    plan.tables.forEach((table, i) => {
      table.x = snapshot.tables[i].x;
      table.y = snapshot.tables[i].y;
    });
    plan.room = { width: seatRoomWidth(snapshot), height: seatRoomHeight(snapshot) };
    const position = snapSeat(
      plan,
      t,
      start.tx - (ev.clientX - start.x) / scale,
      start.ty - (ev.clientY - start.y) / scale,
      ev.shiftKey ? 0 : 10 / scale,
    );
    const growth = moveSeat(plan, t, position.x, position.y);
    room.style.width = plan.room.width + 'px';
    room.style.height = plan.room.height + 'px';
    // Keep the drag's original screen coordinate system until the pointer is released.
    room.style.left = start.left - growth.left * scale + 'px';
    room.style.top = -growth.top * scale + 'px';
    for (const handle of room.querySelectorAll('[data-seat-desk]')) {
      const teacher = handle.dataset.seatDesk === 'teacher';
      const point = seatDesk(handle.dataset.seatDesk);
      const dims = teacher ? { w: 200, h: 56 } : seatDimensions(point);
      const position = seatDisplay(point, dims.w, dims.h, plan);
      const element = teacher ? handle : handle.closest('.seat-table');
      element.style.left = position.x + 'px';
      element.style.top = position.y + 'px';
    }
  };
  const end = () => {
    b.removeEventListener('pointermove', move);
    b.removeEventListener('pointerup', end);
    b.removeEventListener('pointercancel', cancel);
    b.removeEventListener('lostpointercapture', end);
    seatDragging = false;
    renderSeating();
    if (
      seatRoomWidth(plan) > seatRoomWidth(snapshot) ||
      seatRoomHeight(plan) > seatRoomHeight(snapshot)
    )
      seatNotify('Raum automatisch erweitert. Bitte speichern Sie den geänderten Sitzplan.');
  };
  const cancel = () => {
    Object.assign(plan, snapshot);
    end();
  };
  b.addEventListener('lostpointercapture', end);
  b.addEventListener('pointermove', move);
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', cancel);
});
new ResizeObserver(fitSeatRoom).observe($('seat-viewport'));
window.addEventListener('resize', fitSeatRoom);
for (const [id, fit] of [
  ['seat-fit', true],
  ['seat-detail', false],
])
  $(id).onclick = () => {
    seatFit = fit;
    fitSeatRoom();
  };

function seatDocument(plan, remote = false) {
  const member = (id) => (remote ? (seatPerson(id)?.memberId ?? null) : id);
  return {
    size: plan.size,
    layout: plan.layout,
    rows: plan.rows,
    ...(plan.room ? { room: plan.room } : {}),
    teacher: plan.teacher,
    tables: plan.tables.map((t) => ({
      x: t.x,
      y: t.y,
      ...(t.vertical !== undefined ? { vertical: t.vertical } : {}),
      slots: t.slots.map((id) => (id === null ? null : member(id))),
    })),
    pinned: plan.pinned.map(member).filter((id) => id !== null),
  };
}
function seatDecode(plan) {
  const ids = new Map(people.map((p) => [p.memberId, p.id]));
  return {
    ...structuredClone(plan),
    tables: plan.tables.map((t) => ({ ...t, slots: t.slots.map((id) => ids.get(id) ?? null) })),
    pinned: plan.pinned.map((id) => ids.get(id)).filter((id) => id !== undefined),
    saved: null,
  };
}
function seatDirty(entry) {
  return (
    !!entry.remote &&
    ['shared', 'private'].some(
      (scope) =>
        entry[scope] && JSON.stringify(seatDocument(entry[scope])) !== entry.baselines?.[scope],
    )
  );
}
async function seatRequest(group, method = 'GET', body) {
  const response = await fetch('./api/classes/' + encodeURIComponent(group) + '/seating', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-CSRF-Token': authSession?.csrf || '' }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const e = new Error(data.error || 'Sitzplan konnte nicht geladen werden.');
    e.status = response.status;
    throw e;
  }
  return data;
}
async function loadSeatPlans(force = false) {
  const entry = seatContext(),
    group = selectedClass;
  if (!group || entry.busy) return;
  if (
    force &&
    seatDirty(entry) &&
    !confirm('Ungespeicherte Änderungen verwerfen und gespeicherte Sitzpläne neu laden?')
  )
    return;
  entry.busy = true;
  entry.error = '';
  renderSeating();
  seatNotify('Gespeicherte Sitzpläne werden geladen …');
  try {
    const data = await seatRequest(group);
    if (selectedClass !== group || seatingPlans.get(group) !== entry) return;
    if (!data.shared || !data.private)
      throw new Error('Sitzplan-Speicherung ist noch nicht verfügbar.');
    entry.remote = true;
    entry.meta = data;
    entry.meta.privateVersions = data.privateVersions || [data.private].filter((v) => v.plan);
    if (!data.private.plan && entry.meta.privateVersions.length)
      entry.meta.private = entry.meta.privateVersions[0];
    entry.baselines = {};
    for (const scope of ['shared', 'private']) {
      if (data[scope].plan) entry[scope] = seatDecode(data[scope].plan);
      else if (scope === 'private') entry.private = null;
      else entry.shared = structuredClone(entry.initial);
      if (entry[scope])
        entry[scope].room = {
          width: seatRoomWidth(entry[scope]),
          height: seatRoomHeight(entry[scope]),
        };
      entry.baselines[scope] = entry[scope] ? JSON.stringify(seatDocument(entry[scope])) : null;
    }
    if (entry.view === 'private' && !entry.private) entry.view = 'shared';
    seatSelection = null;
    seatNotify(
      'Gespeicherte Sitzpläne geladen. Änderungen werden erst mit „Speichern“ übernommen.' +
        (entry[entry.view].layout === 'u' &&
        entry[entry.view].tables.some((t) => t.vertical === undefined)
          ? ' Für längs stehende Seitentische wählen Sie einmal „U-Form“.'
          : ''),
    );
  } catch (e) {
    if (selectedClass === group && seatingPlans.get(group) === entry) {
      entry.error = e.message;
      seatNotify(e.message);
    }
  } finally {
    entry.busy = false;
    if (selectedClass === group && seatingPlans.get(group) === entry) renderSeating();
  }
}
async function saveSeatPlan(remove = false, newVersion = false) {
  const entry = seatContext(),
    group = selectedClass,
    scope = entry.view;
  if (!group || !entry.remote || entry.busy) return;
  if (
    remove &&
    !confirm(
      scope === 'shared'
        ? 'Gemeinsamen Sitzplan für diese Klasse löschen? Dies betrifft alle berechtigten Lehrkräfte.'
        : 'Ihren privaten Sitzplan löschen?',
    )
  )
    return;
  const document = seatDocument(entry[scope], true);
  entry.busy = true;
  renderSeating();
  seatNotify(remove ? 'Sitzplan wird gelöscht …' : 'Sitzplan wird gespeichert …');
  try {
    const data = await seatRequest(group, remove ? 'DELETE' : 'POST', {
      scope,
      revision: entry.meta[scope].revision,
      version: entry.meta[scope].version || 1,
      newVersion,
      ...(!remove ? { plan: document } : {}),
    });
    if (selectedClass !== group || seatingPlans.get(group) !== entry) return;
    entry.meta[scope] = data;
    if (scope === 'private') {
      entry.meta.privateVersions = (entry.meta.privateVersions || []).filter(
        (v) => v.version !== data.version,
      );
      if (data.plan) entry.meta.privateVersions.push(data);
      entry.meta.privateVersions.sort((a, b) => a.version - b.version);
    }
    if (remove) {
      entry[scope] = scope === 'private' ? null : structuredClone(entry.initial);
      if (scope === 'private') entry.view = 'shared';
    }
    if (entry[scope])
      entry[scope].room = {
        width: seatRoomWidth(entry[scope]),
        height: seatRoomHeight(entry[scope]),
      };
    entry.baselines[scope] = entry[scope] ? JSON.stringify(seatDocument(entry[scope])) : null;
    seatNotify(
      remove
        ? 'Sitzplan gelöscht. Der Vorgang ist protokolliert.'
        : 'Sitzplan dauerhaft gespeichert. ' +
            (scope === 'shared'
              ? 'Berechtigte Lehrkräfte können diesen Stand laden.'
              : 'Nur Ihr Konto kann diesen Plan laden.'),
    );
  } catch (e) {
    if (selectedClass === group && seatingPlans.get(group) === entry) seatNotify(e.message);
  } finally {
    entry.busy = false;
    if (selectedClass === group && seatingPlans.get(group) === entry) renderSeating();
  }
}
window.addEventListener('beforeunload', (e) => {
  if ([...seatingPlans.values()].some(seatDirty)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
$('seat-reload').onclick = () => loadSeatPlans(true);
$('seat-delete').onclick = () => saveSeatPlan(true);
$('seat-new-version').onclick = () => saveSeatPlan(false, true);

// Render exports locally; no student data leaves the browser for this operation.
function invalidateSeatExport() {
  seatExportEpoch++;
  clearTimeout(seatExportTimer);
  seatExportReady = null;
  seatExportWork = null;
  $('seat-print-image').removeAttribute('src');
  $('seat-print-wait').hidden = false;
}
function scheduleSeatExport() {
  clearTimeout(seatExportTimer);
  seatExportTimer = setTimeout(() => {
    if (mode === 'seating' && !classLoading) prepareSeatExport().catch(() => {});
  }, 150);
}
function seatExportSnapshot() {
  const room = $('seat-room'),
    bounds = room.getBoundingClientRect(),
    scale = bounds.width / room.offsetWidth;
  const rect = (el) => {
    const b = el.getBoundingClientRect();
    return {
      x: (b.x - bounds.x) / scale,
      y: (b.y - bounds.y) / scale,
      w: b.width / scale,
      h: b.height / scale,
    };
  };
  const plan = seatPlan(),
    entry = seatContext(),
    assigned = new Set(plan.tables.flatMap((t) => t.slots));
  const desks = [...room.querySelectorAll('.seat-table')].map((el, i) => ({
    box: rect(el),
    label: 'Tisch ' + (i + 1),
    slots: [...el.querySelectorAll('.seat-person')].map((button) => {
      const id = button.dataset.seatPerson === '' ? null : Number(button.dataset.seatPerson),
        person = id === null ? null : seatPerson(id);
      return {
        box: rect(button),
        person: person
          ? {
              company: document.body.classList.contains('show-companies')
                ? person.companyInfo?.short || person.companyInfo?.name || ''
                : '',
              first: person.first,
              last: person.last,
              photo: person.photo,
              demoPortrait: person.demoPortrait,
            }
          : null,
        face: person ? rect(button.querySelector('.seat-face')) : null,
        name: person ? rect(button.querySelector('.seat-name')) : null,
        companyBox:
          person &&
          document.body.classList.contains('show-companies') &&
          button.querySelector('.company-caption')
            ? rect(button.querySelector('.company-caption'))
            : null,
        nameAlign: person
          ? getComputedStyle(button.querySelector('.seat-name')).textAlign
          : 'center',
        pinned: plan.pinned.includes(id),
        absent: absent.has(id),
      };
    }),
  }));
  const dirty =
    entry.remote && JSON.stringify(seatDocument(plan)) !== entry.baselines?.[entry.view];
  return {
    width: room.offsetWidth,
    height: room.offsetHeight,
    desks,
    board: rect(room.querySelector('.seat-front')),
    teacher: rect($('seat-teacher')),
    className: $('class-name').textContent,
    planName: $('seat-plan').selectedOptions[0]?.textContent || 'Sitzplan',
    note: dirty ? 'Ungespeicherter Entwurf' : !selectedClass ? 'Lokaler Entwurf' : '',
    unplaced: people
      .filter((p) => !assigned.has(p.id))
      .map(
        (p) =>
          p.first +
          ' ' +
          p.last +
          (document.body.classList.contains('show-companies') && p.companyInfo
            ? ' · ' + (p.companyInfo.short || p.companyInfo.name)
            : ''),
      ),
    count: people.length,
    date: new Date().toLocaleDateString('de-DE'),
  };
}
function loadSeatExportImage(src) {
  return new Promise((resolve) => {
    const img = new Image(),
      timer = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        resolve(null);
      }, 10000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}
async function prepareSeatExport() {
  if (seatExportReady) return seatExportReady;
  if (seatExportWork) return seatExportWork;
  if (mode !== 'seating' || classLoading || seatContext().busy)
    throw new Error('Bitte warten Sie, bis der Sitzplan geladen ist.');
  const epoch = seatExportEpoch,
    snapshot = seatExportSnapshot();
  const source = (p) =>
    p.photo ||
    (Number.isInteger(p.demoPortrait) ? './demo-portraits.png' : './avatar-placeholder.png');
  const sources = [
    ...new Set(
      snapshot.desks.flatMap((t) => t.slots.filter((s) => s.person).map((s) => source(s.person))),
    ),
  ];
  const work = (async () => {
    const images = new Map(
      await Promise.all(sources.map(async (src) => [src, await loadSeatExportImage(src)])),
    );
    if (epoch !== seatExportEpoch)
      throw new Error('Der Plan wurde geändert. Bitte starten Sie den Export erneut.');
    const result = drawSeatExport(snapshot, images, source);
    result.snapshot = snapshot;
    seatExportReady = result;
    $('seat-print-image').src = result.data;
    $('seat-print-image').alt = 'Sitzplan ' + snapshot.className + ' · ' + snapshot.planName;
    $('seat-print-wait').hidden = true;
    $('seat-print').classList.toggle('seat-landscape', result.width > result.height);
    return result;
  })();
  seatExportWork = work;
  try {
    return await work;
  } finally {
    if (seatExportWork === work) seatExportWork = null;
  }
}
async function exportSeatPlan(print) {
  const button = $(print ? 'seat-print-button' : 'seat-image');
  button.disabled = true;
  try {
    fitSeatRoom();
    const exported = await prepareSeatExport();
    if (exported.missing)
      seatNotify(
        'Ein Foto konnte nicht geladen werden und wird im Export durch Initialen ersetzt.',
      );
    if (print) {
      await $('seat-print-image').decode();
      window.print();
    } else {
      const a = document.createElement('a');
      a.href = exported.data;
      a.download =
        ('Sitzplan-' + exported.snapshot.className + '-' + exported.snapshot.planName)
          .replace(/[^a-zA-Z0-9äöüÄÖÜß._-]+/g, '-')
          .slice(0, 180) + '.png';
      a.click();
      if (!exported.missing) seatNotify('Sitzplan als PNG-Bild gespeichert.');
    }
  } catch (e) {
    seatNotify(
      e.message || 'Der Sitzplan konnte nicht exportiert werden. Bitte versuchen Sie es erneut.',
    );
  } finally {
    button.disabled = false;
  }
}
$('seat-print-button').onclick = () => exportSeatPlan(true);
$('seat-image').onclick = () => exportSeatPlan(false);

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
  groups: () => adminState?.groups || [],
});
learningAdmin = setupLearningAdmin(learningUI, setAdminPanel);
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
