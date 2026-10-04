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

const $ = (id) => document.getElementById(id);
export function createSeatingUI(env) {
  const seatingPlans = new Map();
  let seatSelection = null,
    seatDrag = null,
    seatFit = false;
  let seatExportEpoch = 0,
    seatExportTimer,
    seatExportWork = null,
    seatExportReady = null;
  // Seating coordinates are stored in room orientation; display is from the teacher’s side.
  function seatContext() {
    const key = env.selectedClass || (env.localClass ? 'local' : 'demo');
    const signature = env.people.map((p) => p.memberId || `${p.id}:${p.first}:${p.last}`).join('|');
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
      plan.tables = Array.from({ length: Math.ceil(env.people.length / 2) }, (_, i) => ({
        x: 0,
        y: 0,
        slots: [env.people[i * 2]?.id ?? null, env.people[i * 2 + 1]?.id ?? null],
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
    return Math.ceil(env.people.length / plan.size) + 4;
  }
  function seatDesk(key) {
    return key === 'teacher' ? seatPlan().teacher : seatPlan().tables[Number(key)];
  }
  function seatNotify(text) {
    $('seat-status').textContent = text;
  }
  function seatPerson(id) {
    return env.people.find((p) => p.id === id);
  }
  function seatTile(id, table, index) {
    const p = seatPerson(id),
      plan = seatPlan(),
      chosen = id !== null && seatSelection === id,
      locked = plan.pinned.includes(id);
    const label = p
      ? `${p.first} ${p.last}${env.absent.has(id) ? ' · abwesend' : ''}`
      : 'Freier Platz';
    return `<div class="seat-place ${chosen ? 'seat-selected' : ''} ${p && env.absent.has(id) ? 'seat-absent' : ''}"><button class="seat-person" ${p ? 'draggable="true"' : ''} data-seat-person="${id ?? ''}" data-seat-table="${table}" data-seat-index="${index}" aria-label="${env.escapeHTML(label)}" aria-pressed="${chosen}">${p ? `<span class="seat-face">${env.face(p)}</span><span class="seat-name">${env.escapeHTML(p.first)}<small>${env.escapeHTML(p.last)}</small>${env.companyCaption(p)}</span>` : '<span class="seat-empty">＋<small>Freier Platz</small></span>'}</button>${env.companyButton(p)}${p ? `<button class="seat-pin" data-seat-pin="${id}" aria-pressed="${locked}" title="${locked ? 'Fixierung lösen' : 'Bei Zufallsverteilung auf diesem Platz lassen'}">${locked ? 'Fixiert' : 'Fixieren'}</button>` : ''}</div>`;
  }
  let seatDragging = false;
  function fitSeatRoom() {
    if (seatDragging) return;
    const room = $('seat-room'),
      view = $('seat-viewport');
    if (!view || view.hidden || env.mode !== 'seating' || !room.offsetWidth || !view.clientWidth)
      return;
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
    if (
      env.selectedClass &&
      !current.remote &&
      !current.busy &&
      !current.error &&
      !env.classLoading
    ) {
      loadSeatPlans();
      return;
    }
    for (const control of $('seating-panel').querySelectorAll(
      '.seat-toolbar button,.seat-toolbar select,.seat-view-tools button',
    ))
      control.disabled = env.classLoading || !!current.busy;
    if (env.classLoading) {
      $('seat-tables').replaceChildren();
      $('seat-unplaced').replaceChildren();
      $('seat-count').textContent = '';
      seatNotify('Klasse wird geladen …');
      return;
    }
    const entry = seatContext(),
      plan = seatPlan();
    plan.room = { width: seatRoomWidth(plan), height: seatRoomHeight(plan) };
    $('seat-storage-mode').textContent = env.selectedClass ? 'IServ-Klasse' : 'Lokaler Entwurf';
    $('seat-storage-note').textContent = env.selectedClass
      ? 'Gemeinsame Pläne stehen den berechtigten Lehrkräften dieser Klasse zur Verfügung. Private Sitzpläne sind nur für Ihr Konto sichtbar. Das Speichern und Löschen gemeinsamer und privater Pläne wird für die Administration protokolliert.'
      : 'DEMO und lokaler Fototest: Entwürfe bleiben nur bis zum Neuladen in diesem Browserfenster.';
    const options = [
      new Option(env.selectedClass ? 'Gemeinsamer Sitzplan' : 'Klassenentwurf', 'shared'),
    ];
    if (env.selectedClass) {
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
    $('seat-save').textContent = env.selectedClass ? 'Sitzplan speichern' : 'Entwurf merken';
    $('seat-copy').textContent = env.selectedClass
      ? 'Als privaten Sitzplan speichern'
      : 'Private Kopie anlegen';
    $('seat-restore').hidden = !!env.selectedClass;
    $('seat-reload').hidden = !env.selectedClass;
    $('seat-delete').hidden = !env.selectedClass;
    const meta = entry.meta?.[entry.view],
      dirty = entry.remote && JSON.stringify(seatDocument(plan)) !== entry.baselines?.[entry.view];
    $('seat-save-state').textContent = env.selectedClass
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
    if (!env.selectedClass) $('seat-plan').options[1].disabled = !entry.private;
    $('seat-new-version').hidden = !env.selectedClass || entry.view !== 'private';
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
    const unplaced = env.people.filter((p) => !assigned.has(p.id));
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
      if (env.selectedClass) $('seat-save').disabled = !entry.remote || !!entry.error;
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
  function open() {
    if (env.running) return;
    env.leaveLearning();
    env.mode = 'seating';
    seatFit = false;
    env.result = null;
    document.body.classList.add('seating-mode');
    $('seating-panel').hidden = false;
    for (const id of ['pick-tab', 'team-tab', 'seat-tab'])
      $(id).setAttribute('aria-selected', String(id === 'seat-tab'));
    renderSeating();
    if (!seatContext().busy && !seatContext().error)
      seatNotify(
        'Tische am Griff verschieben. Schüler ziehen oder erst den Schüler, dann den Zielplatz anklicken.',
      );
  }
  $('seating-panel').addEventListener('click', (e) => {
    if (seatContext().busy) return;
    const rotation = e.target.closest('[data-seat-rotate]');
    if (rotation) {
      const plan = seatPlan(),
        index = Number(rotation.dataset.seatRotate);
      rotateSeat(plan.tables[index]);
      renderSeating();
      $('seat-tables')
        .querySelector(`[data-seat-rotate="${index}"]`)
        .focus({ preventScroll: true });
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
      fixed = new Set([...plan.pinned, ...env.absent]);
    const pool = env.shuffle(
      env.people.filter((p) => !fixed.has(p.id)).map((p) => p.id),
      env.random,
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
      { length: Math.ceil(Math.max(env.people.length, ids.length) / size) },
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
    if (
      !confirm('Tische in ' + rows + ' Reihen neu anordnen? Die Sitzzuordnung bleibt erhalten.')
    ) {
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
    if (env.selectedClass) {
      await saveSeatPlan(false, newVersion);
    } else {
      seatNotify('Private Kopie angelegt. Änderungen betreffen nur diese Kopie in diesem Fenster.');
    }
  };
  $('seat-plan').onchange = () => {
    const entry = seatContext(),
      value = $('seat-plan').value;
    if (env.selectedClass && value.startsWith('private')) {
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
    if (env.selectedClass) {
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
    const ids = new Map(env.people.map((p) => [p.memberId, p.id]));
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
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': env.authSession?.csrf || '' }
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
      group = env.selectedClass;
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
      if (env.selectedClass !== group || seatingPlans.get(group) !== entry) return;
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
      if (env.selectedClass === group && seatingPlans.get(group) === entry) {
        entry.error = e.message;
        seatNotify(e.message);
      }
    } finally {
      entry.busy = false;
      if (env.selectedClass === group && seatingPlans.get(group) === entry) renderSeating();
    }
  }
  async function saveSeatPlan(remove = false, newVersion = false) {
    const entry = seatContext(),
      group = env.selectedClass,
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
      if (env.selectedClass !== group || seatingPlans.get(group) !== entry) return;
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
      if (env.selectedClass === group && seatingPlans.get(group) === entry) seatNotify(e.message);
    } finally {
      entry.busy = false;
      if (env.selectedClass === group && seatingPlans.get(group) === entry) renderSeating();
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
      if (env.mode === 'seating' && !env.classLoading) prepareSeatExport().catch(() => {});
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
          absent: env.absent.has(id),
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
      note: dirty ? 'Ungespeicherter Entwurf' : !env.selectedClass ? 'Lokaler Entwurf' : '',
      unplaced: env.people
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
      count: env.people.length,
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
    if (env.mode !== 'seating' || env.classLoading || seatContext().busy)
      throw new Error('Bitte warten Sie, bis der Sitzplan geladen ist.');
    const epoch = seatExportEpoch,
      snapshot = seatExportSnapshot();
    const source = (p) =>
      p.photo ||
      (Number.isInteger(p.demoPortrait) ? './demo-portraits.webp' : './avatar-placeholder.webp');
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

  return {
    open,
    render: renderSeating,
    invalidateExport: invalidateSeatExport,
    reset() {
      seatingPlans.clear();
      seatSelection = null;
      invalidateSeatExport();
    },
    clearSelection() {
      seatSelection = null;
      seatDrag = null;
    },
  };
}
