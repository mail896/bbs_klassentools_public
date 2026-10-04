import { paginate } from './admin-ui.mjs?v=af1f701092f9';
import { setupLearningAdmin } from './learning-ui.mjs?v=5398dfa11e76';
const $ = (id) => document.getElementById(id);
export function createAdministrationUI(env) {
  let auditCursor = null;
  let adminState = null,
    adminBusy = false,
    adminRequest = 0;
  function adminDirty() {
    return adminState && [...adminState.selected].sort().join(',') !== adminState.original;
  }
  let adminGroupPage = 0;
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
              `<label class="admin-group"><input type="checkbox" data-group-id="${env.escapeHTML(g.id)}" ${adminState.selected.has(g.id) ? 'checked' : ''} ${adminBusy ? 'disabled' : ''}><span><strong>${env.escapeHTML(g.name)}</strong><small>${env.escapeHTML(g.account)}</small></span></label>`,
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
      const r = await fetch('./api/admin/classes', {
          credentials: 'same-origin',
          cache: 'no-store',
        }),
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
    if (!env.authSession?.admin) return;
    if (initial === 'usage') $('admin-usage-tab').click();
    else if (['audit', 'companies', 'learning'].includes(initial) && adminState)
      $('admin-' + initial + '-tab').click();
  }
  function leaveAdmin(e) {
    if (adminBusy || (adminDirty() && !confirm('Nicht gespeicherte Änderungen verwerfen?'))) {
      e.preventDefault();
      return false;
    }
    return true;
  }
  $('admin-back').onclick = leaveAdmin;
  window.addEventListener('beforeunload', (e) => {
    if (env.adminPage && (adminBusy || adminDirty())) {
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
    if (!adminState || adminBusy || !env.authSession?.csrf) return;
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
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': env.authSession.csrf },
          body: JSON.stringify({
            selected: [...adminState.selected],
            revision: adminState.revision,
          }),
        }),
        data = await r.json();
      if (request !== adminRequest) return;
      if (!r.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
      adminState.selected = new Set(data.selected);
      adminState.original = [...data.selected].sort().join(',');
      adminState.revision = data.revision;
      let notice = 'Klassenfreigaben gespeichert.';
      if (!env.adminPage)
        try {
          await env.loadClasses();
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
    if (env.adminPage) history.replaceState(null, '', '?admin=' + panel);
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
        const group =
          adminState?.groups.find((g) => g.id === entry.class_id)?.name || entry.class_id;
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

  const learningAdmin = setupLearningAdmin(env.learningUI, setAdminPanel);
  return { open: openAdminPage, reset: clearAdmin, groups: () => adminState?.groups || [] };
}
