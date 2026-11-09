/* Eventkompass – Frontend (ohne Framework). Spricht mit /api/*. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};

const state = { me: null, data: { events: [], ressorts: [], objectives: [], keyResults: [] }, users: [], invites: [], eventId: null, view: 'overview', ressortId: null, adminTab: 'users', userFilter: 'all' };
const TYPE_LABEL = { number: 'Anzahl', bool: 'Ja / Nein' };
const PALETTE = ['#2563EB', '#7C3AED', '#DB2777', '#0F766E', '#B45309', '#0891B2', '#65A30D', '#9333EA', '#DC2626', '#4B5563'];
const MIN_PASSWORD = 10;
const APP_TITLE = 'Eventkompass';

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  // Session abgelaufen oder Einmal-Passwort: zurück zur Anmeldung, ohne zusätzliche Fehlermeldung.
  if (state.me && (res.status === 401 || json.code === 'PASSWORD_CHANGE_REQUIRED')) {
    if (res.status === 401) state.me = null;
    showAuth(res.status === 401 ? 'login' : 'password');
    throw Object.assign(new Error(json.error), { silent: true });
  }
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
async function reload() {
  const [data, users, invites] = await Promise.all([api('GET', '/api/state'), isAdmin() ? api('GET', '/api/admin/users') : null, isAdmin() ? api('GET', '/api/admin/invites') : null]);
  state.data = data;
  state.users = users || [];
  state.invites = invites || [];
  if (!state.data.events.find((e) => e.id === state.eventId)) state.eventId = state.data.events.find((e) => e.id === state.me.eventId)?.id || state.data.events[0]?.id || null;
  render();
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2200);
}
// Führt eine Änderung aus, lädt neu und meldet Erfolg (true) oder Fehler (false).
async function act(fn, msg) {
  try { await fn(); await reload(); if (msg) toast(msg); return true; } catch (e) { if (!e.silent) alert('Fehler: ' + e.message); return false; }
}

// ---------- Helfer ----------
const fmt = (n) => Number(n).toLocaleString('de-DE');
const de = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '–');
const deTime = (iso) => { const d = new Date(iso); return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
const todayIso = () => new Date().toISOString().slice(0, 10);
const isNum = (k) => k.type === 'number';
const byId = (id) => state.data.keyResults.find((k) => k.id === id);
const objective = (id) => state.data.objectives.find((o) => o.id === id);
const ressort = (id) => state.data.ressorts.find((r) => r.id === id);
const eventById = (id) => state.data.events.find((e) => e.id === id);
const curEvent = () => eventById(state.eventId);
// Führungsressort immer zuerst
const ressortsOf = (eventId) => state.data.ressorts.filter((r) => r.eventId === eventId).sort((a, b) => b.isLead - a.isLead);
const evRessorts = () => ressortsOf(state.eventId);
const leadRessort = () => evRessorts().find((r) => r.isLead);
// Archivierte Ziele und Schlüsselergebnisse tauchen nur im Archiv des Ressorts auf (für alle, die das Ressort bearbeiten dürfen)
const activeObjectives = () => state.data.objectives.filter((o) => !o.archivedAt);
const evObjectives = () => activeObjectives().filter((o) => o.eventId === state.eventId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const objectivesOf = (ressortId) => evObjectives().filter((o) => o.ressortId === ressortId);
const activeKrs = () => state.data.keyResults.filter((k) => !k.archivedAt);
const evKrs = () => activeKrs().filter((k) => k.eventId === state.eventId);
const krsOf = (o) => evKrs().filter((k) => k.objectiveId === o.id);
const owner = (k) => ressort(k.ressortId)?.name || 'Ressort';
const pct = (k) => (k.achieved ? 100 : isNum(k) && k.target > 0 ? Math.min(100, Math.round((k.current / k.target) * 100)) : 0);
const avgPct = (ks) => (ks.length ? Math.round(ks.reduce((a, k) => a + pct(k), 0) / ks.length) : 0);
const valueLabel = (k) => (isNum(k) ? fmt(k.current) + (k.unit ? ' ' + k.unit : '') : k.achieved ? 'Erreicht' : 'Offen');
const targetLabel = (k) => (isNum(k) ? fmt(k.target) + (k.unit ? ' ' + k.unit : '') : 'bis ' + de(k.deadline));
const openDeps = (k) => k.deps.map(byId).filter((d) => d && !d.archivedAt && !d.achieved);
const atRisk = (k) => ['risk', 'crit', 'late'].includes(status(k).key);
// Rechte – maßgeblich ist der Server, hier wird nur ein- und ausgeblendet.
const isAdmin = () => state.me?.role === 'admin';
const canEditRessort = (rid) => isAdmin() || (!!state.me?.ressortId && state.me.ressortId === rid);
const canEditKr = (k) => canEditRessort(k.ressortId);
const canEditObjective = (o) => canEditRessort(o.ressortId);
function status(k) {
  if (k.achieved) return { key: 'done', label: 'Erreicht', color: 'var(--ok)' };
  if (k.deadline && k.deadline < todayIso()) return { key: 'late', label: 'Überfällig', color: 'var(--crit)' };
  if (!isNum(k) && openDeps(k).length) return { key: 'blocked', label: 'Blockiert', color: 'var(--warn)' };
  if (isNum(k)) {
    const p = pct(k);
    if (p >= 70) return { key: 'ok', label: 'Im Plan', color: 'var(--plan)' };
    if (p >= 40) return { key: 'risk', label: 'Gefährdet', color: 'var(--warn)' };
    return { key: 'crit', label: 'Kritisch', color: 'var(--crit)' };
  }
  return { key: 'open', label: 'Offen', color: '#9CA3AF' };
}
// Ein Ziel ist erreicht, wenn alle seine Schlüsselergebnisse erreicht sind; sein Fortschritt ist deren Durchschnitt.
const objAchieved = (o, ks = krsOf(o)) => ks.length > 0 && ks.every((k) => k.achieved);
function objStatus(o) {
  const ks = krsOf(o);
  if (!ks.length) return { key: 'open', label: 'Noch ohne Schlüsselergebnisse', color: '#9CA3AF' };
  if (objAchieved(o, ks)) return { key: 'done', label: 'Erreicht', color: 'var(--ok)' };
  if (o.deadline && o.deadline < todayIso()) return { key: 'late', label: 'Überfällig', color: 'var(--crit)' };
  if (ks.some((k) => status(k).key === 'late')) return { key: 'late', label: 'Schlüsselergebnis überfällig', color: 'var(--crit)' };
  const p = avgPct(ks);
  if (p >= 70) return { key: 'ok', label: 'Im Plan', color: 'var(--plan)' };
  if (p >= 40) return { key: 'risk', label: 'Gefährdet', color: 'var(--warn)' };
  return { key: 'crit', label: 'Kritisch', color: 'var(--crit)' };
}
// Wie Element.append, überspringt aber null/false (bedingte Kinder)
const append = (parent, ...children) => parent.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
const dot = (color, sm) => el('span', { class: 'dot' + (sm ? ' sm' : ''), style: 'background:' + color });
const pill = (s) => el('span', { class: 'pill ' + s.key }, s.label);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

// ---------- Anmeldung & Registrierung ----------
function startApp(user) {
  state.me = user;
  if (user.mustChangePassword) return showAuth('password');
  $('#auth-root').replaceChildren();
  $('#auth-root').hidden = true;
  $('#app').hidden = false;
  return reload();
}

function showAuth(mode, notice) {
  $('#app').hidden = true;
  $('#modal-root').replaceChildren();
  document.title = APP_TITLE;
  const root = $('#auth-root');
  root.hidden = false;
  const card = el('div', { class: 'auth-card' });
  root.replaceChildren(el('div', { class: 'auth-wrap' }, card));
  ({ login: authLogin, register: authRegister, pending: authPending, password: authPassword })[mode](card, notice);
  setTimeout(() => $('input,select', card)?.focus(), 0);
}

const errorBox = () => el('div', { class: 'error-box', role: 'alert', hidden: true });
const showError = (box, msg) => { box.textContent = msg; box.hidden = !msg; };
// Formular mit Absenden per Enter; onSubmit wirft bei Fehlern, die Meldung erscheint im Formular.
function authForm(fields, label, onSubmit) {
  const err = errorBox();
  const submit = el('button', { class: 'btn wide', type: 'submit' }, label);
  const form = el('form', { class: 'auth-form', novalidate: true }, ...fields, err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(err, '');
    submit.disabled = true;
    try { await onSubmit(); } catch (ex) { showError(err, ex.message); } finally { submit.disabled = false; }
  });
  return form;
}

function authLogin(card, notice) {
  const email = inp('l-email', { type: 'email', autocomplete: 'username' });
  const pw = inp('l-pw', { type: 'password', autocomplete: 'current-password' });
  append(card,
    el('h1', {}, 'Anmelden'),
    notice ? el('div', { class: 'info-box small' }, notice) : null,
    authForm([field('E-Mail', email), field('Passwort', pw)], 'Anmelden', async () => {
      const { user } = await api('POST', '/api/auth/login', { email: email.value, password: pw.value });
      await startApp(user);
    }),
    el('div', { class: 'auth-switch muted small' }, 'Noch kein Konto? ', el('button', { class: 'link-btn', onClick: () => showAuth('register') }, 'Registrieren')));
}

// inviteId kommt aus dem Einladungslink (/#einladung=<id>): E-Mail ist vorgegeben, ggf. auch das Ressort.
async function authRegister(card, inviteId) {
  append(card, el('h1', {}, 'Registrieren'));
  let opts, invite = null;
  try { opts = await api('GET', '/api/public/registration-options'); } catch (e) { card.append(el('div', { class: 'error-box' }, e.message)); return; }
  if (inviteId) {
    try { invite = await api('GET', `/api/public/invites/${encodeURIComponent(inviteId)}`); } catch (e) { card.append(el('div', { class: 'error-box' }, e.message)); }
    history.replaceState(null, '', location.pathname);
  }
  const fixed = invite?.ressort;
  append(card, invite
    ? el('div', { class: 'info-box small' }, 'Du bist eingeladen – dein Konto ist nach der Registrierung sofort aktiv.', fixed ? ` Ressort: „${fixed.name}“ (${fixed.eventName}).` : '')
    : el('div', { class: 'muted small' }, 'Wähle dein Event und dein Ressort. Die Zuordnung kann danach nur ein Admin ändern.'));
  const name = inp('r-name', { autocomplete: 'name', placeholder: 'Vor- und Nachname' });
  const email = inp('r-email', { type: 'email', autocomplete: 'username', value: invite?.email || '', readonly: !!invite });
  const pw = inp('r-pw', { type: 'password', autocomplete: 'new-password' });
  const evSel = el('select', { id: 'r-event' }, el('option', { value: '' }, 'Bitte wählen …'), ...opts.events.map((e) => el('option', { value: e.id }, e.name + (e.startDate ? ' · ' + de(e.startDate) : ''))));
  const rSel = el('select', { id: 'r-ressort', disabled: true });
  const newName = inp('r-new', { placeholder: 'Name des Ressorts', maxlength: 60 });
  const newField = field('Neues Ressort', newName, invite ? 'Wird direkt angelegt; ein Admin prüft den Namen später.' : 'Ein Admin prüft den Namen und legt das Ressort an bzw. ordnet dich zu.');
  const syncRessorts = () => {
    const rs = opts.ressorts.filter((r) => r.eventId === evSel.value).sort((a, b) => b.isLead - a.isLead);
    rSel.replaceChildren(el('option', { value: '' }, 'Bitte wählen …'), ...rs.map((r) => el('option', { value: r.id }, r.name + (r.isLead ? ' (Event-Ziele)' : ''))), el('option', { value: '__new' }, 'Mein Ressort fehlt …'));
    rSel.disabled = !evSel.value;
    syncNew();
  };
  const syncNew = () => (newField.hidden = rSel.value !== '__new');
  evSel.addEventListener('change', syncRessorts);
  rSel.addEventListener('change', syncNew);
  if (opts.events.length === 1) evSel.value = opts.events[0].id;
  syncRessorts();
  // Ohne Events (frische Installation) kann sich nur der eingerichtete Admin registrieren – der Server entscheidet.
  const noEvents = !opts.events.length;
  append(card,
    noEvents ? el('div', { class: 'info-box small' }, 'Es ist noch kein Event angelegt.') : null,
    authForm([field('Name', name), field('E-Mail', email), field('Passwort', pw, `Mindestens ${MIN_PASSWORD} Zeichen.`), !noEvents && !fixed && field('Event', evSel), !noEvents && !fixed && field('Ressort', rSel), !fixed && newField], 'Konto anlegen', async () => {
      const choose = !noEvents && !fixed;
      if (choose && !evSel.value) throw new Error('Bitte ein Event auswählen.');
      if (choose && !rSel.value) throw new Error('Bitte ein Ressort auswählen.');
      if (pw.value.length < MIN_PASSWORD) throw new Error(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`);
      const isNew = !fixed && rSel.value === '__new';
      const res = await api('POST', '/api/auth/register', { name: name.value, email: email.value, password: pw.value, eventId: fixed ? fixed.eventId : evSel.value, ressortId: fixed ? fixed.id : isNew ? null : rSel.value, newRessortName: isNew ? newName.value : '' });
      if (res.status === 'active') await startApp(res.user);
      else showAuth('pending');
    }),
    el('div', { class: 'auth-switch muted small' }, 'Schon registriert? ', el('button', { class: 'link-btn', onClick: () => showAuth('login') }, 'Anmelden')));
}

function authPending(card) {
  append(card, el('h1', {}, 'Fast geschafft'),
    el('p', {}, 'Dein Konto ist angelegt und wartet auf die Freigabe durch einen Admin. Danach kannst du dich anmelden.'),
    el('button', { class: 'btn wide', onClick: () => showAuth('login') }, 'Zur Anmeldung'));
}

function authPassword(card) {
  const cur = inp('p-cur', { type: 'password', autocomplete: 'current-password' });
  const pw1 = inp('p-new', { type: 'password', autocomplete: 'new-password' });
  const pw2 = inp('p-new2', { type: 'password', autocomplete: 'new-password' });
  append(card, el('h1', {}, 'Neues Passwort setzen'),
    el('div', { class: 'muted small' }, 'Du hast dich mit einem Einmal-Passwort angemeldet. Bitte lege jetzt dein eigenes Passwort fest.'),
    authForm([field('Aktuelles Passwort', cur), field('Neues Passwort', pw1, `Mindestens ${MIN_PASSWORD} Zeichen.`), field('Neues Passwort wiederholen', pw2)], 'Passwort speichern', async () => {
      if (pw1.value !== pw2.value) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
      const { user } = await api('POST', '/api/auth/password', { currentPassword: cur.value, newPassword: pw1.value });
      await startApp(user);
    }),
    el('div', { class: 'auth-switch muted small' }, el('button', { class: 'link-btn', onClick: logout }, 'Abmelden')));
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  Object.assign(state, { me: null, users: [], view: 'overview', ressortId: null, adminTab: 'users', userFilter: 'all' });
  showAuth('login', 'Du bist abgemeldet.');
}

// ---------- Rendering ----------
function render() {
  renderTopbar();
  renderSidebar();
  const main = $('#main');
  main.replaceChildren();
  if (state.view === 'admin') renderAdmin(main);
  else if (!curEvent()) main.append(el('div', { class: 'card empty' }, isAdmin() ? 'Noch kein Event. Lege unter „Verwaltung → Events“ eines an.' : 'Noch kein Event vorhanden.'));
  else if (state.view === 'ressort') renderRessort(main);
  else renderOverview(main);
  labelTables(main);
}

// Spaltenüberschriften an die Zellen hängen – auf schmalen Bildschirmen zeigt das CSS
// Tabellenzeilen als Karten und nutzt `data-label` als Beschriftung.
function labelTables(root) {
  for (const t of root.querySelectorAll('table')) {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
  }
}

function renderTopbar() {
  const ev = curEvent(); const events = state.data.events;
  document.title = ev ? ev.name + ' – ' + APP_TITLE : APP_TITLE;
  // Titel oben links ist das Event; bei mehreren Events zugleich die Auswahl.
  // Die Auswahl liegt unsichtbar über dem Namen – so passt die Breite immer zum Titel.
  $('#event-title').replaceChildren(events.length > 1
    ? el('label', { class: 'title-picker' }, el('span', {}, ev?.name || 'Event wählen'), el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'),
      el('select', { class: 'title-select', 'aria-label': 'Event wählen', onChange: (e) => { state.eventId = e.target.value; if (state.view !== 'admin') state.view = 'overview'; render(); } },
        ...events.map((e) => el('option', { value: e.id, selected: e.id === state.eventId }, e.name))))
    : el('span', {}, ev?.name || 'Kein Event'));
  const me = state.me;
  const where = isAdmin() ? 'Admin' : [ressort(me.ressortId)?.name, eventById(me.eventId)?.name].filter(Boolean).join(' · ') || 'Kein Ressort zugeordnet';
  const menu = el('div', { class: 'menu', role: 'menu', hidden: true },
    el('button', { class: 'menu-item', role: 'menuitem', onClick: () => { menu.hidden = true; modalPassword(); } }, 'Passwort ändern'),
    el('button', { class: 'menu-item', role: 'menuitem', onClick: logout }, 'Abmelden'));
  const toggle = el('button', { class: 'user-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  } }, el('span', { class: 'user-info' }, el('span', { class: 'strong' }, me.name), el('span', { class: 'muted small' }, where)), el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'));
  $('#user-box').replaceChildren(toggle, menu);
}
const closeMenus = () => document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; m.previousElementSibling?.setAttribute('aria-expanded', 'false'); });

function renderSidebar() {
  document.querySelectorAll('.nav[data-view]').forEach((b) => b.classList.toggle('active', state.view === b.dataset.view));
  $('#nav-admin').hidden = !isAdmin();
  const pending = state.data.admin?.pendingUsers || 0;
  $('#pending-badge').hidden = !pending;
  $('#pending-badge').textContent = pending;
  $('#btn-new-ressort').hidden = !isAdmin();
  const rs = evRessorts();
  $('#ressort-count').textContent = rs.length;
  $('#nav-ressorts').replaceChildren(...rs.map((r) => {
    const os = objectivesOf(r.id);
    return el('button', { class: 'nav' + (state.view === 'ressort' && state.ressortId === r.id ? ' active' : ''), onClick: () => go('ressort', r.id) },
      dot(r.color), el('span', { class: 'grow' }, r.name), r.id === state.me.ressortId ? el('span', { class: 'mine', title: 'Dein Ressort' }, 'deins') : null,
      el('span', { class: 'muted small num', title: 'Ziele erreicht / gesamt' }, os.filter((o) => objAchieved(o)).length + '/' + os.length));
  }));
  const ks = evKrs(); const ev = curEvent();
  const days = ev?.startDate ? Math.ceil((new Date(ev.startDate) - new Date()) / 86400000) : null;
  $('#side-note').replaceChildren(
    el('strong', {}, days !== null ? (days >= 0 ? `Noch ${days} Tage` : `Vor ${-days} Tagen`) : 'Kein Datum'),
    ev ? `${ev.name}: ${plural(evObjectives().length, 'Ziel', 'Ziele')}, ${ks.filter((k) => !k.achieved).length} Schlüsselergebnisse offen, ${ks.filter((k) => !k.achieved && openDeps(k).length).length} warten auf Abhängigkeiten.` : ''
  );
}

function go(view, ressortId = null) { state.view = view; state.ressortId = ressortId; render(); }

// Tabelle der Schlüsselergebnisse eines Ziels
function krTable(krs, opts = {}) {
  const table = el('table', {},
    el('thead', {}, el('tr', {}, ...['Schlüsselergebnis', 'Typ', 'Zielwert', 'Ist', 'Fortschritt', 'Status', 'Frist / erreicht', 'Abhängig von', ''].map((h) => el('th', {}, h)))),
    el('tbody'));
  const tb = $('tbody', table);
  if (!krs.length) tb.append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, opts.empty || 'Noch keine Schlüsselergebnisse.')));
  for (const k of krs) {
    const row = $('#tpl-kr-row').content.firstElementChild.cloneNode(true);
    const s = status(k);
    $('.kr-title', row).textContent = k.title;
    $('.kr-sub', row).textContent = (opts.showOwner ? owner(k) + ' · ' : '') + (k.history[0] ? 'Zuletzt ' + deTime(k.history[0].at) + ' von ' + k.history[0].who : 'keine Änderung');
    $('.type-chip', row).textContent = TYPE_LABEL[k.type];
    $('.kr-target', row).textContent = targetLabel(k);
    $('.kr-current', row).textContent = valueLabel(k);
    $('.bar-fill', row).style.cssText = `width:${pct(k)}%;background:${s.color}`;
    $('.kr-pct', row).textContent = isNum(k) || k.achieved ? pct(k) + '%' : '–';
    $('.kr-status', row).replaceWith(pill(s));
    $('.kr-dates', row).replaceChildren(el('div', {}, de(k.deadline)), el('div', { class: 'small', style: 'color:' + (k.achieved ? 'var(--ok-ink)' : 'var(--muted)') }, k.achieved ? 'erreicht am ' + de(k.achievedAt) : 'noch nicht erreicht'));
    const deps = k.deps.map(byId).filter((d) => d && !d.archivedAt);
    $('.kr-deps', row).replaceChildren(...(deps.length ? deps.map((d) => el('span', { class: 'chip ' + (d.achieved ? 'done' : 'open'), title: d.title }, d.title.length > 24 ? d.title.slice(0, 23) + '…' : d.title)) : [el('span', { class: 'muted small' }, '–')]));
    // Ein Button je Zeile: eigene Schlüsselergebnisse bearbeiten, fremde nur ansehen (inkl. Historie)
    const btn = $('.act-open', row);
    const label = canEditKr(k) ? 'Bearbeiten' : 'Historie ansehen';
    btn.textContent = canEditKr(k) ? '✎' : '⟲';
    btn.title = label; btn.setAttribute('aria-label', label);
    btn.addEventListener('click', () => (canEditKr(k) ? modalKrForm(k) : modalHistory(k)));
    tb.append(row);
  }
  return el('div', { class: 'table-wrap' }, table);
}

// Ein Ziel als Karte: Kopf mit Fortschritt und Status, darunter seine Schlüsselergebnisse.
function objectiveBlock(o, opts = {}) {
  const ks = krsOf(o);
  const s = objStatus(o);
  const p = avgPct(ks);
  const editable = canEditObjective(o);
  const r = ressort(o.ressortId);
  return el('section', { class: 'card objective' },
    el('div', { class: 'obj-head' },
      el('div', { class: 'obj-main' },
        el('div', { class: 'sec-label' }, 'Ziel'),
        el('h2', {}, o.title),
        o.description ? el('div', { class: 'obj-desc' }, o.description) : null,
        el('div', { class: 'obj-meta' },
          opts.showOwner && r ? el('span', { class: 'with-dot' }, dot(r.color, true), r.name) : null,
          el('span', {}, `${ks.filter((k) => k.achieved).length} von ${plural(ks.length, 'Schlüsselergebnis', 'Schlüsselergebnissen')} erreicht`),
          o.deadline ? el('span', {}, 'Frist ' + de(o.deadline)) : null)),
      el('div', { class: 'obj-right' },
        el('span', { class: 'obj-pct num' }, p + '%'), pill(s),
        editable ? el('button', { class: 'btn ghost small-btn', onClick: () => modalObjectiveForm(o) }, 'Ziel bearbeiten') : null,
        editable ? el('button', { class: 'btn small-btn', onClick: () => modalKrForm(null, o) }, '+ Schlüsselergebnis') : null)),
    el('div', { class: 'obj-bar' }, el('div', { class: 'bar-fill', style: `width:${p}%;background:${s.color}` })),
    krTable(ks, { empty: editable ? 'Noch keine Schlüsselergebnisse – mit „+ Schlüsselergebnis“ anlegen.' : 'Noch keine Schlüsselergebnisse.' }));
}

// ---------- Startseite: Pflege-Check ----------
// Nicht ob Ziele erreicht werden, sondern ob sie sauber formuliert sind und jede Woche der Stand eingetragen wird.
const WEEK_STATE = {
  ok: { label: 'gepflegt', glyph: '✓' },
  stale: { label: 'nicht aktualisiert', glyph: '!' },
  invalid: { label: 'Formulierung prüfen', glyph: '✕' },
  none: { label: 'noch nicht angelegt', glyph: '' },
  future: { label: 'kommende Woche', glyph: '' },
};
const shortDate = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.';
const weekLabel = (w) => `W${w.index} · KW ${w.kw} (${shortDate(w.from)}–${shortDate(w.to)})`;
// Auf dem Smartphone entfällt die Spalte „Formulierung“ – der Hinweis steht dann unter dem Titel.
const checkInline = (issue) => (issue ? el('span', { class: 'check-inline', title: issue.text }, '✕ ' + issue.label) : null);
const checkBadge = (issue) => issue
  ? el('span', { class: 'check-badge bad', title: issue.text }, '✕ ' + issue.label)
  : el('span', { class: 'check-badge ok' }, '✓ ok');

function renderOverview(main) {
  const ev = curEvent();
  const wk = Check.eventWeeks(ev);
  const os = evObjectives(); const ks = evKrs();
  const fresh = ks.filter((k) => Check.isMaintained(k, wk.current)).length;
  const short = os.filter((o) => Check.objectiveIssue(o)).length;
  const vague = ks.filter((k) => Check.krIssue(k)).length;
  const lead = leadRessort();
  append(main,
    el('div', { class: 'head-row' },
      el('div', {}, el('div', { class: 'muted small strong' }, 'Event · ' + ev.name), el('h1', {}, 'Pflege-Check'),
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, 'Sind Ziele und Schlüsselergebnisse gut formuliert und jede Woche aktuell?')),
      el('div', { class: 'week-now' }, wk.current
        ? [el('div', { class: 'strong' }, `Woche ${wk.current.index} von ${wk.weeks.length}`), el('div', { class: 'muted small' }, `KW ${wk.current.kw} · ${de(wk.current.from)} – ${de(wk.current.to)}`)]
        : [el('div', { class: 'strong' }, 'Wochenzählung noch nicht gestartet'), el('div', { class: 'muted small' }, 'Beginnt am ' + de(wk.start))])),
    el('div', { class: 'grid grid-4' },
      stat('Diese Woche gepflegt', `${fresh}/${ks.length}`, 'Schlüsselergebnisse mit Wert, Kommentar oder Bestätigung', 'var(--ok)'),
      stat('Noch nicht aktualisiert', ks.length - fresh, wk.current ? `in KW ${wk.current.kw} – bis Sonntag eintragen` : 'Zählung startet später', 'var(--warn)'),
      stat('Ziele zu kurz', short, `von ${plural(os.length, 'Ziel', 'Zielen')} · mindestens ${Check.MIN_WORDS} Wörter`, 'var(--crit)'),
      stat('Nicht quantitativ', vague, `von ${plural(ks.length, 'Schlüsselergebnis', 'Schlüsselergebnissen')} · Anzahl mit Zielwert`, 'var(--crit)')),
    el('div', { class: 'legend muted small' },
      ...['ok', 'stale', 'invalid', 'future'].map((s) => el('span', {}, el('span', { class: 'wcell ' + s, 'aria-hidden': 'true' }, WEEK_STATE[s].glyph), WEEK_STATE[s].label)),
      el('span', {}, 'Rot in der Woche gilt nur für die laufende Woche; Ziele ohne Wochenspalten.')),
    ...evRessorts().map((r) => checkSection(r, wk)),
    lead && canEditRessort(lead.id) && !objectivesOf(lead.id).length ? el('div', { class: 'muted small' }, 'Die Event-Ziele legst du im Ressort „' + lead.name + '“ an.') : null
  );
  // Laufende Woche ins Bild holen, falls die Tabelle seitlich scrollt
  requestAnimationFrame(() => document.querySelectorAll('.check-wrap').forEach((wrap) => {
    const th = $('th.current', wrap);
    if (th) wrap.scrollLeft = Math.max(0, th.offsetLeft + th.offsetWidth - wrap.clientWidth + 80);
  }));
}

function checkSection(r, wk) {
  const os = objectivesOf(r.id);
  const ks = evKrs().filter((k) => k.ressortId === r.id);
  const weeks = wk.weeks;
  const open = ks.filter((k) => !Check.isMaintained(k, wk.current)).length;
  const short = os.filter((o) => Check.objectiveIssue(o)).length;
  const vague = ks.filter((k) => Check.krIssue(k)).length;
  const notes = [wk.current && open ? `${open} diese Woche offen` : null, short ? plural(short, 'Ziel zu kurz', 'Ziele zu kurz') : null, vague ? `${vague} nicht quantitativ` : null].filter(Boolean);
  const summary = el('span', { class: 'check-summary ' + (notes.length ? 'bad' : 'ok') }, notes.length ? notes.join(' · ') : ks.length ? '✓ alles gepflegt' : '');

  const head = el('tr', {}, el('th', {}, 'Ziel / Schlüsselergebnis'), el('th', {}, 'Formulierung'),
    ...weeks.map((w) => el('th', { class: 'wk ' + w.when, title: weekLabel(w) }, el('div', {}, 'W' + w.index), el('div', { class: 'kw' }, 'KW ' + w.kw))));
  const rows = [];
  for (const o of os) {
    const oks = krsOf(o);
    rows.push(el('tr', { class: 'obj-row' },
      el('td', {}, canEditObjective(o) ? el('button', { class: 'row-link strong', onClick: () => modalObjectiveForm(o), title: 'Ziel bearbeiten' }, o.title) : el('span', { class: 'strong' }, o.title), checkInline(Check.objectiveIssue(o))),
      el('td', {}, checkBadge(Check.objectiveIssue(o))),
      weeks.length ? el('td', { colspan: weeks.length, class: 'muted small' }, oks.length ? '' : 'noch keine Schlüsselergebnisse') : null));
    for (const k of oks) {
      const states = Check.krWeekStates(k, weeks);
      rows.push(el('tr', { class: 'kr-row' },
        el('td', {}, el('button', { class: 'row-link', onClick: () => (canEditKr(k) ? modalKrForm(k) : modalHistory(k)), title: canEditKr(k) ? 'Bearbeiten' : 'Historie ansehen' },
          el('span', { class: 'kr-name' }, k.title), el('span', { class: 'muted small' }, isNum(k) ? 'Zielwert ' + targetLabel(k) : 'Ja / Nein · ' + targetLabel(k))), checkInline(Check.krIssue(k))),
        el('td', {}, checkBadge(Check.krIssue(k))),
        ...states.map((s, i) => el('td', { class: 'wk ' + weeks[i].when },
          s === 'none' ? null : el('span', { class: 'wcell ' + s, role: 'img', title: `${weekLabel(weeks[i])}: ${WEEK_STATE[s].label}`, 'aria-label': `${weekLabel(weeks[i])}: ${WEEK_STATE[s].label}` }, WEEK_STATE[s].glyph)))));
    }
  }
  if (!os.length) rows.push(el('tr', {}, el('td', { colspan: 2 + weeks.length, class: 'empty' }, canEditRessort(r.id) ? 'Noch keine Ziele – in der Ressort-Ansicht mit „+ Ziel“ anlegen.' : 'Noch keine Ziele.')));
  return el('section', { class: 'card check-ressort' },
    el('div', { class: 'section-head' },
      el('div', { class: 'with-dot' }, dot(r.color), el('button', { class: 'row-link', onClick: () => go('ressort', r.id) }, el('h2', {}, r.name)), r.isLead ? el('span', { class: 'chip lead' }, 'Event-Ziele') : null),
      summary),
    el('div', { class: 'check-wrap' }, el('table', { class: 'check-table', style: '--weeks:' + weeks.length },
      el('colgroup', {}, el('col', { class: 'c-title' }), el('col', { class: 'c-form' }), ...weeks.map(() => el('col', { class: 'c-wk' }))),
      el('thead', {}, head), el('tbody', {}, ...rows))));
}

function stat(label, value, hint, color) {
  return el('div', { class: 'card stat' }, el('div', { class: 'label' }, dot(color, true), label), el('div', { class: 'value num' }, value), el('div', { class: 'muted small' }, hint));
}

function renderRessort(main) {
  const r = ressort(state.ressortId);
  if (!r) return go('overview');
  const os = objectivesOf(r.id);
  const ks = evKrs().filter((k) => k.ressortId === r.id);
  const done = ks.filter((k) => k.achieved).length;
  const editable = canEditRessort(r.id);
  const hint = r.isLead ? 'Führungsressort – pflegt die Event-Ziele' : 'Teams pflegen ihre Ziele und Schlüsselergebnisse hier selbst';
  append(main,
    el('div', { class: 'head-row' },
      el('div', {},
        el('div', { class: 'muted small strong' }, el('button', { class: 'link-btn', onClick: () => go('overview') }, 'Übersicht'), ' / Ressort'),
        el('h1', { style: 'display:flex;align-items:center;gap:10px' }, dot(r.color), r.name),
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, hint + (editable ? '' : ' · nur Lesen'))),
      el('div', { style: 'display:flex;gap:8px' },
        isAdmin() ? el('button', { class: 'btn ghost', onClick: () => modalRessortForm(r) }, 'Ressort bearbeiten') : null,
        editable ? el('button', { class: 'btn', onClick: () => modalObjectiveForm(null, r.id) }, '+ Ziel') : null)),
    el('div', { class: 'grid grid-5' },
      miniStat('Ziele', `${os.filter((o) => objAchieved(o)).length}/${os.length}`), miniStat('Schlüsselergebnisse', ks.length), miniStat('Erreicht', `${done}/${ks.length}`), miniStat('Fortschritt', avgPct(ks) + '%'),
      miniStat('Gefährdet', ks.filter(atRisk).length)),
    el('div', { class: 'stack' }, ...os.map(objectiveBlock),
      !os.length && el('div', { class: 'card empty' }, editable ? 'Noch keine Ziele – mit „+ Ziel“ das erste anlegen, danach Schlüsselergebnisse ergänzen.' : 'Noch keine Ziele.')),
    editable ? archiveSection(r) : null
  );
}
// Archiv eines Ressorts (Admin und Mitglieder des Ressorts): archivierte Ziele und Schlüsselergebnisse ansehen und wiederherstellen
function archiveSection(r) {
  const os = state.data.objectives.filter((o) => o.ressortId === r.id && o.archivedAt).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  const ks = state.data.keyResults.filter((k) => k.ressortId === r.id && k.archivedAt).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  if (!os.length && !ks.length) return null;
  const archivedBy = (x) => el('td', { class: 'small' }, de(x.archivedAt), x.archivedBy ? el('div', { class: 'muted' }, 'von ' + x.archivedBy) : null);
  return el('section', { class: 'card' }, el('details', { class: 'archive' },
    el('summary', { class: 'section-head' }, el('div', {}, el('h2', {}, `Archiv (${os.length + ks.length})`), el('div', { class: 'muted small' }, 'Archivierte Ziele und Schlüsselergebnisse – nur für dein Ressort und Admins sichtbar'))),
    os.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['Ziel', 'Schlüsselergebnisse', 'Archiviert', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...os.map((o) => el('tr', {},
        el('td', { class: 'strong' }, o.title),
        el('td', { class: 'num' }, state.data.keyResults.filter((k) => k.objectiveId === o.id).length),
        archivedBy(o),
        el('td', { class: 'actions' }, el('button', { class: 'btn small-btn', onClick: () => act(() => api('POST', `/api/objectives/${o.id}/restore`), 'Ziel wiederhergestellt') }, 'Wiederherstellen'))))))) : null,
    ks.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['Schlüsselergebnis', 'Ziel', 'Typ', 'Zielwert', 'Ist', 'Archiviert', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...ks.map((k) => el('tr', {},
        el('td', { class: 'strong' }, k.title),
        el('td', {}, objective(k.objectiveId)?.title || '–', objective(k.objectiveId)?.archivedAt ? el('span', { class: 'chip open', style: 'margin-left:6px' }, 'archiviert') : null),
        el('td', {}, el('span', { class: 'type-chip' }, TYPE_LABEL[k.type])),
        el('td', {}, targetLabel(k)), el('td', {}, valueLabel(k)),
        archivedBy(k),
        el('td', { class: 'actions' },
          el('button', { class: 'btn ghost small-btn', onClick: () => modalHistory(k) }, 'Historie'),
          el('button', { class: 'btn small-btn', onClick: () => act(() => api('POST', `/api/key-results/${k.id}/restore`), 'Schlüsselergebnis wiederhergestellt') }, 'Wiederherstellen'))))))) : null));
}
// Zahl der Ziele und Schlüsselergebnisse eines Ressorts bzw. Events, inkl. archivierter
const contentCount = (fn) => state.data.objectives.filter(fn).length + state.data.keyResults.filter(fn).length;
const archivedLabel = (r) => { const n = contentCount((x) => x.ressortId === r.id && x.archivedAt); return n ? el('span', { class: 'muted small' }, ` (+${n} archiviert)`) : null; };
const miniStat = (l, v) => el('div', { class: 'card stat', style: 'padding:16px 18px' }, el('div', { class: 'muted small strong' }, l), el('div', { class: 'num', style: 'font-size:24px;font-weight:700' }, v));

// ---------- Verwaltung (nur Admin) ----------
function renderAdmin(main) {
  if (!isAdmin()) return go('overview');
  const pending = state.users.filter((u) => u.status === 'pending').length;
  const tabs = [['users', 'Nutzer'], ['events', 'Events'], ['ressorts', 'Ressorts']];
  main.append(
    el('div', { class: 'head-row' }, el('div', {}, el('div', { class: 'muted small strong' }, 'Admin'), el('h1', {}, 'Verwaltung'))),
    el('div', { class: 'tabs', role: 'tablist' }, ...tabs.map(([id, label]) => el('button', { class: 'tab' + (state.adminTab === id ? ' active' : ''), role: 'tab', 'aria-selected': String(state.adminTab === id), onClick: () => { state.adminTab = id; render(); } },
      label, id === 'users' && pending ? el('span', { class: 'badge' }, pending) : null))));
  ({ users: adminUsers, events: adminEvents, ressorts: adminRessorts })[state.adminTab](main);
}

function adminUsers(main) {
  const until = state.data.admin?.autoApproveUntil;
  const setAuto = (iso) => act(() => api('PUT', '/api/admin/settings', { autoApproveUntil: iso }), iso ? 'Automatische Freischaltung aktiv' : 'Automatische Freischaltung beendet');
  const inHours = (h) => setAuto(new Date(Date.now() + h * 3600000).toISOString());
  const custom = inp('auto-until', { type: 'datetime-local' });
  main.append(until
    ? el('section', { class: 'card auto-card on' },
      el('div', { class: 'grow' }, el('div', { class: 'strong' }, 'Automatische Freischaltung aktiv'), el('div', { class: 'small' }, `Neue Registrierungen sind sofort aktiv – bis ${deTime(until)} Uhr. Neue Ressorts aus dem Freitext werden direkt angelegt und als „ungeprüft“ markiert.`)),
      el('button', { class: 'btn', onClick: () => setAuto(null) }, 'Jetzt beenden'))
    : el('section', { class: 'card auto-card' },
      el('div', { class: 'grow' }, el('div', { class: 'strong' }, 'Neue Registrierungen müssen freigegeben werden'), el('div', { class: 'muted small' }, 'Für eine begrenzte Zeit automatisch freischalten, z. B. während eines Kick-offs:')),
      el('div', { class: 'auto-actions' },
        el('button', { class: 'btn ghost small-btn', onClick: () => inHours(1) }, '1 Stunde'),
        el('button', { class: 'btn ghost small-btn', onClick: () => inHours(24) }, '24 Stunden'),
        el('button', { class: 'btn ghost small-btn', onClick: () => inHours(24 * 7) }, '7 Tage'),
        custom,
        el('button', { class: 'btn small-btn', onClick: () => custom.value ? setAuto(new Date(custom.value).toISOString()) : alert('Bitte Datum und Uhrzeit wählen.') }, 'Bis dann'))));

  const filters = [['all', 'Alle', () => true], ['pending', 'Wartet auf Freigabe', (u) => u.status === 'pending'], ['auto', 'Automatisch freigeschaltet', (u) => u.approvedBy === 'auto'], ['disabled', 'Gesperrt', (u) => u.status === 'disabled']];
  const [, , match] = filters.find(([id]) => id === state.userFilter) || filters[0];
  const list = state.users.filter(match).sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || a.name.localeCompare(b.name, 'de'));
  const STATUS = { pending: { key: 'risk', label: 'Wartet' }, active: { key: 'done', label: 'Aktiv' }, disabled: { key: 'crit', label: 'Gesperrt' } };
  const table = el('table', { class: 'admin-table' },
    el('thead', {}, el('tr', {}, ...['Name', 'Rolle', 'Event', 'Ressort', 'Status', 'Registriert', 'Freigabe', 'Letzter Login', ''].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...(list.length ? list.map((u) => {
      const r = ressort(u.ressortId);
      return el('tr', {},
        el('td', {}, el('div', { class: 'strong' }, u.name), el('div', { class: 'muted small' }, u.email)),
        el('td', {}, u.role === 'admin' ? 'Admin' : 'Mitglied'),
        el('td', {}, eventById(u.eventId)?.name || '–'),
        el('td', {}, r ? el('span', { class: 'with-dot' }, dot(r.color, true), r.name, r.unreviewed ? el('span', { class: 'chip open' }, 'ungeprüft') : null)
          : u.requestedRessortName ? el('span', { class: 'chip open' }, 'Wunsch: ' + u.requestedRessortName) : el('span', { class: 'muted' }, '–')),
        el('td', {}, pill(STATUS[u.status]), u.mustChangePassword ? el('div', { class: 'muted small' }, 'Einmal-Passwort') : null),
        el('td', { class: 'small' }, de(u.createdAt)),
        el('td', { class: 'small' }, ({ auto: 'automatisch', admin: 'Admin', invite: 'Einladung' })[u.approvedBy] || '–', u.approvedAt ? el('div', { class: 'muted' }, de(u.approvedAt)) : null),
        el('td', { class: 'small' }, u.lastLoginAt ? deTime(u.lastLoginAt) : '–'),
        el('td', { class: 'actions' }, el('button', { class: 'btn small-btn' + (u.status === 'pending' ? '' : ' ghost'), onClick: () => modalUser(u) }, u.status === 'pending' ? 'Prüfen' : 'Bearbeiten')));
    }) : [el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'Keine Nutzer in dieser Ansicht.'))])));
  main.append(inviteSection());
  main.append(el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('h2', {}, `Nutzer (${state.users.length})`),
      el('div', { class: 'filter-row' }, ...filters.map(([id, label, fn]) => el('button', { class: 'filter' + (state.userFilter === id ? ' active' : ''), onClick: () => { state.userFilter = id; render(); } }, `${label} (${state.users.filter(fn).length})`)))),
    el('div', { class: 'table-wrap' }, table)));
}

// Einladungen ohne Mailversand: Admin trägt die E-Mail ein und gibt den Link selbst weiter.
function inviteSection() {
  const email = inp('inv-email', { type: 'email', placeholder: 'name@beispiel.de', style: 'flex:1 1 220px' });
  const rSel = el('select', { id: 'inv-ressort', style: 'flex:1 1 220px' }, el('option', { value: '' }, 'Ressort wählt die Person selbst'),
    ...state.data.events.flatMap((ev) => ressortsOf(ev.id).map((r) => el('option', { value: r.id }, `${ev.name} · ${r.name}`))));
  const open = state.invites.filter((i) => !i.usedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ressortLabel = (i) => { const r = ressort(i.ressortId); return r ? `${eventById(r.eventId)?.name || ''} · ${r.name}` : 'wählt selbst'; };
  const invite = () => act(() => api('POST', '/api/admin/invites', { email: email.value, ressortId: rSel.value || null }), 'Einladung angelegt – jetzt den Link weitergeben');
  return el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('div', {}, el('h2', {}, `Einladungen (${open.length})`),
      el('div', { class: 'muted small' }, 'Wer sich mit einer eingeladenen E-Mail-Adresse registriert, ist ohne Freigabe aktiv. Den Link gibst du selbst weiter (es werden keine Mails verschickt).'))),
    el('div', { class: 'invite-form' }, email, rSel, el('button', { class: 'btn', onClick: invite }, 'Einladen')),
    open.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['E-Mail', 'Ressort', 'Eingeladen', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...open.map((i) => el('tr', {},
        el('td', { class: 'strong' }, i.email),
        el('td', {}, ressortLabel(i)),
        el('td', { class: 'small' }, de(i.createdAt), el('div', { class: 'muted' }, 'von ' + i.createdBy)),
        el('td', { class: 'actions' },
          el('button', { class: 'btn ghost small-btn', onClick: () => copyInviteLink(i) }, 'Link kopieren'),
          el('button', { class: 'btn ghost small-btn', onClick: () => confirm(`Einladung für ${i.email} zurückziehen?`) && act(() => api('DELETE', `/api/admin/invites/${i.id}`), 'Einladung zurückgezogen') }, 'Zurückziehen'))))))) : null);
}
// Zwischenablage gibt es nur über HTTPS/localhost – sonst den Link zum Kopieren anzeigen.
async function copyInviteLink(i) {
  const link = `${location.origin}/#einladung=${i.id}`;
  try { await navigator.clipboard.writeText(link); toast('Link kopiert'); } catch { window.prompt(`Einladungslink für ${i.email} – bitte kopieren:`, link); }
}

function adminEvents(main) {
  const count = (list, ev) => list.filter((x) => x.eventId === ev.id).length;
  main.append(el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('h2', {}, `Events (${state.data.events.length})`), el('button', { class: 'btn small-btn', onClick: () => modalEventForm(null) }, '+ Event')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['Name', 'Beginn', 'Ende', 'Wochen ab', 'Ressorts', 'Ziele', 'Schlüsselergebnisse', 'Nutzer', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...(state.data.events.length ? state.data.events.map((ev) => el('tr', {},
        el('td', { class: 'strong' }, ev.name), el('td', {}, de(ev.startDate)), el('td', {}, de(ev.endDate)), el('td', {}, ev.trackingStart ? `${de(ev.trackingStart)} (KW ${Check.isoWeek(ev.trackingStart)})` : '–'),
        el('td', { class: 'num' }, count(state.data.ressorts, ev)), el('td', { class: 'num' }, count(activeObjectives(), ev)), el('td', { class: 'num' }, count(activeKrs(), ev)), el('td', { class: 'num' }, count(state.users, ev)),
        el('td', { class: 'actions' }, el('button', { class: 'btn ghost small-btn', onClick: () => modalEventForm(ev) }, 'Bearbeiten'))))
        : [el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'Noch keine Events.'))]))))));
}

function adminRessorts(main) {
  const ev = curEvent();
  if (!ev) { main.append(el('div', { class: 'card empty' }, 'Noch kein Event. Lege zuerst unter „Events“ eines an.')); return; }
  const rs = evRessorts();
  main.append(el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('div', {}, el('h2', {}, `Ressorts von „${ev.name}“`), el('div', { class: 'muted small' }, 'Anderes Event? Oben in der Event-Auswahl wechseln.')),
      el('button', { class: 'btn small-btn', onClick: () => modalRessortForm(null) }, '+ Ressort')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['Ressort', 'Ziele', 'Schlüsselergebnisse', 'Nutzer', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rs.map((r) => el('tr', {},
        el('td', {}, el('span', { class: 'with-dot strong' }, dot(r.color), r.name, r.isLead ? el('span', { class: 'chip lead' }, 'Führung · Event-Ziele') : null, r.unreviewed ? el('span', { class: 'chip open' }, 'neu, ungeprüft') : null)),
        el('td', { class: 'num' }, objectivesOf(r.id).length),
        el('td', { class: 'num' }, activeKrs().filter((k) => k.ressortId === r.id).length, archivedLabel(r)),
        el('td', { class: 'num' }, state.users.filter((u) => u.ressortId === r.id).length),
        el('td', { class: 'actions' },
          r.unreviewed ? el('button', { class: 'btn small-btn', onClick: () => act(() => api('PUT', `/api/ressorts/${r.id}`, { unreviewed: false }), 'Ressort bestätigt') }, 'Bestätigen') : null,
          !r.isLead ? el('button', { class: 'btn ghost small-btn', onClick: () => modalMerge(r) }, 'Zusammenführen') : null,
          el('button', { class: 'btn ghost small-btn', onClick: () => modalRessortForm(r) }, 'Bearbeiten')))))))));
}

// ---------- Modals ----------
function openModal(title, sub, body, foot, wide) {
  const root = $('#modal-root');
  const close = () => root.replaceChildren();
  const modal = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'modal-head' }, el('div', {}, el('div', { class: 'muted small strong' }, sub), el('h2', {}, title)), el('button', { class: 'icon-btn', 'aria-label': 'Schließen', onClick: close }, '✕')),
    el('div', { class: 'modal-body' }, ...body),
    el('div', { class: 'modal-foot' }, ...foot(close)));
  const overlay = el('div', { class: 'overlay', onClick: (e) => e.target === overlay && close() }, modal);
  root.replaceChildren(overlay);
  setTimeout(() => $('input:not([disabled]),select:not([disabled]),textarea,button.on', modal)?.focus(), 0);
  return close;
}
const field = (label, input, hint, sub) => el('div', { class: 'field' }, el('label', { for: input.id }, label, sub ? el('span', {}, ' ' + sub) : null), input, hint ? el('div', { class: 'hint' }, hint) : null);
const inp = (id, attrs = {}) => el('input', { id, ...attrs });
const cancelBtn = (close) => el('button', { class: 'btn ghost', onClick: close }, 'Abbrechen');
const infoBox = (l, v) => el('div', { class: 'info-box' }, el('div', { class: 'l' }, l), el('div', { class: 'v num' }, v));
const closeOn = (close) => (ok) => ok && close();

// Historie als Zeitleiste (neueste zuerst)
function historyItems(k) {
  if (!k.history.length) return [el('div', { class: 'muted small' }, 'Noch keine Änderungen protokolliert.')];
  return k.history.map((h, i) => el('div', { class: 'hist' },
    el('div', { class: 'rail' }, dot(i === 0 ? 'var(--accent)' : '#D1D5DB'), el('div', { class: 'line' + (i === k.history.length - 1 ? ' end' : '') })),
    el('div', { class: 'body' },
      el('div', { class: 'row1' }, el('span', { class: 'strong', style: 'font-size:13px' }, h.kind), el('span', { class: 'muted small', style: 'white-space:nowrap' }, deTime(h.at) + ' · ' + h.who)),
      el('div', { class: 'num', style: 'margin-top:2px' }, h.from ? el('span', { class: 'muted' }, h.from) : null, h.from ? el('span', { style: 'color:#9CA3AF;margin:0 6px' }, '→') : null, el('span', { class: 'strong' }, h.to)),
      h.note ? el('div', { class: 'note' }, h.note) : null)));
}

// Nur lesen – für Schlüsselergebnisse anderer Ressorts
function modalHistory(k) {
  openModal(k.title, [owner(k), objective(k.objectiveId)?.title, 'Historie'].filter(Boolean).join(' · '),
    [el('div', { class: 'two' }, infoBox('Zielwert', targetLabel(k)), infoBox('Ist', valueLabel(k))), ...historyItems(k)],
    (close) => [el('span', { class: 'muted small left', style: 'align-self:center' }, `${k.history.length} Einträge · neueste zuerst`), el('button', { class: 'btn ghost', onClick: close }, 'Schließen')], true);
}

// Ziel anlegen und bearbeiten: Bezeichnung, Beschreibung, Frist; das Ressort wechselt nur ein Admin.
function modalObjectiveForm(o, ressortId) {
  const isNew = !o;
  const rid = isNew ? ressortId : o.ressortId;
  const title = inp('o-title', { value: o?.title || '', placeholder: 'z. B. Der Summit trägt sich wirtschaftlich selbst' });
  const desc = el('textarea', { id: 'o-desc', rows: 3, placeholder: 'Optional: Was soll am Ende anders sein? Warum ist das Ziel wichtig?' }, o?.description || '');
  const deadline = inp('o-deadline', { type: 'date', value: o?.deadline || '' });
  const ownerSel = el('select', { id: 'o-owner', disabled: !isAdmin() }, ...evRessorts().map((r) => el('option', { value: r.id, selected: rid === r.id }, r.name + (r.isLead ? ' (Event-Ziele)' : ''))));
  const ks = isNew ? [] : krsOf(o);
  const payload = () => ({ title: title.value.trim(), description: desc.value, deadline: deadline.value || null, ...(isAdmin() ? { ressortId: ownerSel.value } : {}) });
  // Pflege-Check: Ein Ziel braucht mindestens fünf Wörter – live mitzählen.
  const words = el('span', { class: 'word-count' });
  const countWords = () => {
    const n = Check.wordCount(title.value);
    words.className = 'word-count ' + (n >= Check.MIN_WORDS ? 'ok' : 'bad');
    words.textContent = `${n === 1 ? '1 Wort' : n + ' Wörter'} (mindestens ${Check.MIN_WORDS}).`;
  };
  title.addEventListener('input', countWords); countWords();
  openModal(isNew ? 'Neues Ziel' : o.title, isNew ? ressort(rid).name + ' · Ziel anlegen' : ressort(rid).name + ' · Ziel bearbeiten',
    [field('Bezeichnung', title, [words, ' Ein Ziel beschreibt als ganzer Satz, was am Ende anders sein soll – die Schlüsselergebnisse machen es messbar.']),
      field('Beschreibung', desc),
      el('div', { class: 'two' }, field('Frist', deadline), field('Ressort', ownerSel, isAdmin() ? (isNew ? null : 'Beim Wechsel wandern alle Schlüsselergebnisse mit; Abhängigkeiten ins alte Ressort werden gelöst.') : 'Zuordnung ändert nur ein Admin.')),
      !isNew ? el('div', { class: 'muted small' }, `${plural(ks.length, 'Schlüsselergebnis', 'Schlüsselergebnisse')} gehören zu diesem Ziel.`) : null],
    (close) => [
      !isNew && (ks.length
        ? el('span', { class: 'muted small left', style: 'align-self:center' }, 'Archivieren erst ohne aktive Schlüsselergebnisse möglich.')
        : el('button', { class: 'btn danger left', onClick: () => confirm(`„${o.title}“ archivieren? Das Ziel verschwindet aus den Listen und lässt sich im Ressort unter „Archiv“ wiederherstellen.`) && act(() => api('DELETE', `/api/objectives/${o.id}`), 'Ziel archiviert').then(closeOn(close)) }, 'Archivieren')),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => {
        if (!title.value.trim()) return alert('Bitte eine Bezeichnung angeben.');
        act(() => isNew ? api('POST', '/api/objectives', { ressortId: rid, ...payload() }) : api('PUT', `/api/objectives/${o.id}`, payload()), isNew ? 'Ziel angelegt' : 'Ziel gespeichert').then(closeOn(close)); } }, isNew ? 'Anlegen' : 'Speichern')]);
}

// Schlüsselergebnis anlegen und bearbeiten in einem Dialog: aktueller Stand (Ist-Wert bzw. Ja/Nein, Kommentar), Stammdaten, Historie
function modalKrForm(k, obj) {
  const isNew = !k;
  const o0 = isNew ? obj : objective(k.objectiveId);
  const title = inp('k-title', { value: k?.title || '', placeholder: 'z. B. Verkaufte Tickets' });
  const type = el('select', { id: 'k-type' }, ...Object.entries(TYPE_LABEL).map(([v, l]) => el('option', { value: v, selected: (k?.type || 'number') === v }, l)));
  const target = inp('k-target', { type: 'number', step: 'any', value: k && isNum(k) ? k.target : '' });
  const unit = inp('k-unit', { value: k?.unit || '', placeholder: 'Tickets, €, Speaker …' });
  const current = inp('k-current', { type: 'number', step: 'any', value: k ? k.current : 0 });
  const deadline = inp('k-deadline', { type: 'date', value: k?.deadline || '' });
  // Ziel wechseln: innerhalb des eigenen Ressorts jeder, in ein anderes Ressort nur Admins
  const choosable = evObjectives().filter((o) => isAdmin() || o.ressortId === o0.ressortId);
  const objSel = el('select', { id: 'k-objective' }, ...evRessorts().map((r) => {
    const os = choosable.filter((o) => o.ressortId === r.id);
    return os.length ? el('optgroup', { label: r.name }, ...os.map((o) => el('option', { value: o.id, selected: o.id === o0.id }, o.title))) : null;
  }));
  const selObjective = () => objective(objSel.value) || o0;
  const desc = el('textarea', { id: 'k-desc', rows: 2, placeholder: 'Optional: Was misst dieses Schlüsselergebnis, woher kommen die Daten?' }, k?.description || '');
  // Abhängigkeiten nur innerhalb desselben Ressorts (auch zu anderen Zielen des Ressorts)
  const depsBox = el('div', { class: 'deps-list' });
  const syncDeps = () => {
    const rid = selObjective().ressortId;
    const keep = rid === k?.ressortId ? k.deps : [];
    const candidates = evKrs().filter((x) => x.id !== k?.id && x.ressortId === rid);
    depsBox.replaceChildren(...(candidates.length ? candidates.map((x) => el('label', {}, el('input', { type: 'checkbox', value: x.id, checked: keep.includes(x.id) }), el('span', { class: 'grow' }, x.title, el('span', { class: 'muted small' }, ' · ' + (objective(x.objectiveId)?.title || ''))), el('span', { class: 'muted small' }, TYPE_LABEL[x.type])))
      : [el('span', { class: 'muted small' }, 'Keine weiteren Schlüsselergebnisse in diesem Ressort.')]));
  };
  objSel.addEventListener('change', syncDeps); syncDeps();

  // Aktueller Stand
  const form = { yes: !!k?.achieved };
  const yesB = el('button', { type: 'button', onClick: () => { form.yes = true; sync(); } }, '✓ Ja, erreicht');
  const noB = el('button', { type: 'button', onClick: () => { form.yes = false; sync(); } }, '✕ Nein, offen');
  const boolField = el('div', { class: 'field' }, el('label', {}, 'Erreicht?'), el('div', { class: 'toggle' }, yesB, noB));
  const achievedAt = inp('k-achieved-at', { type: 'date', value: k?.achievedAt || todayIso() });
  const dateField = field('Erreicht am', achievedAt);
  const note = el('textarea', { id: 'k-note', rows: 2, placeholder: 'Woher kommt der Wert? Link zum Beleg, Kontext …' });
  const depsWarn = el('div', { class: 'warn-box' });
  const numFields = el('div', { class: 'two' }, field('Zielwert', target, null, '(Pflicht)'), field('Einheit', unit));
  const curField = field(isNew ? 'Aktueller Ist-Wert' : 'Ist-Wert', current);
  function sync() {
    const n = type.value === 'number';
    numFields.hidden = !n; curField.hidden = !n; boolField.hidden = n || isNew;
    yesB.classList.toggle('on', form.yes); noB.classList.toggle('on', !form.yes);
    const reached = n ? Number(target.value) > 0 && Number(current.value) >= Number(target.value) : form.yes;
    dateField.hidden = isNew || !reached;
    const od = k ? openDeps(k) : [];
    depsWarn.hidden = isNew || !reached || k.achieved || !od.length;
    depsWarn.textContent = `Hinweis: ${od.length} Voraussetzung(en) noch offen (${od.map((d) => d.title).join(', ')}). Die Erreichung kann trotzdem eingetragen werden.`;
  }
  [type, target, current].forEach((x) => x.addEventListener('input', sync));
  // Ja/Nein lässt sich einmalig auf Anzahl umstellen (bereits erreicht → Ist-Wert = Zielwert). Andersherum nicht.
  const converting = () => !isNew && k.type === 'bool' && type.value === 'number';
  type.addEventListener('change', () => { if (converting()) { current.value = form.yes ? target.value : 0; sync(); } });
  target.addEventListener('input', () => { if (converting() && form.yes) { current.value = target.value; sync(); } });
  sync();
  if (!isNew && k.type !== 'bool') type.disabled = true;
  const boolWarn = el('div', { class: 'warn-box' }, 'Ja / Nein gilt im Pflege-Check als nicht messbar (rot). Besser als Anzahl mit Zielwert formulieren – z. B. „3 von 3 Pressemitteilungen veröffentlicht“.');
  const syncBoolWarn = () => { boolWarn.hidden = type.value !== 'bool'; };
  type.addEventListener('input', syncBoolWarn); syncBoolWarn();

  // Pflege-Check: Ist der Stand diese Woche schon eingetragen? Sonst „unverändert bestätigen“.
  let closeModal = () => {};
  const week = !isNew ? Check.eventWeeks(eventById(k.eventId) || {}).current : null;
  const fresh = week && Check.isMaintained(k, week);
  const checkState = !isNew && week ? el('div', { class: 'check-state ' + (fresh ? 'ok' : 'stale') },
    el('span', {}, fresh ? `✓ Stand für KW ${week.kw} ist eingetragen.` : `! Für KW ${week.kw} ist noch kein Stand eingetragen.`),
    el('button', { type: 'button', class: 'btn ghost small-btn', onClick: () => act(() => api('POST', `/api/key-results/${k.id}/confirm`, { note: note.value }), 'Stand bestätigt').then(closeOn(closeModal)) }, 'Stand unverändert bestätigen')) : null;

  const payload = () => ({ title: title.value.trim(), type: type.value, target: target.value, unit: unit.value.trim(), current: current.value, deadline: deadline.value || null, objectiveId: objSel.value, description: desc.value,
    deps: [...depsBox.querySelectorAll('input:checked')].map((c) => c.value).concat(selObjective().ressortId === k?.ressortId ? k.deps.filter((d) => byId(d)?.archivedAt) : []),
    ...(isNew ? {} : { achieved: form.yes, achievedAt: dateField.hidden ? undefined : achievedAt.value, note: note.value }) });
  const masterData = [field('Bezeichnung', title),
    el('div', { class: 'two' }, field('Typ', type, isNew ? null : k.type === 'bool' ? 'Lässt sich auf Anzahl umstellen, die Historie bleibt.' : 'Der Typ ist nach dem Anlegen fest.'), field('Ziel', objSel, isAdmin() ? null : 'Ziele anderer Ressorts ordnet nur ein Admin zu.')),
    boolWarn, numFields, isNew ? curField : null,
    field('Frist', deadline),
    field('Beschreibung', desc),
    el('div', { class: 'field' }, el('label', {}, 'Abhängig von ', el('span', {}, '(Voraussetzungen aus demselben Ressort)')), depsBox)];
  closeModal = openModal(isNew ? 'Neues Schlüsselergebnis' : k.title, isNew ? `${ressort(o0.ressortId).name} · ${o0.title}` : `${owner(k)} · ${o0?.title || ''} · bearbeiten`,
    isNew ? masterData : [
      el('div', { class: 'sec-label' }, 'Aktueller Stand'),
      checkState,
      el('div', { class: 'two' }, curField, boolField, infoBox('Zielwert', targetLabel(k))),
      dateField, depsWarn,
      field('Kommentar', note, 'Erscheint in der Historie, auch ohne andere Änderung.'),
      el('div', { class: 'sec-label', style: 'margin-top:8px' }, 'Stammdaten'),
      ...masterData,
      el('details', { class: 'hist-box' }, el('summary', {}, `Historie (${k.history.length})`), ...historyItems(k))],
    (close) => [
      !isNew && el('button', { class: 'btn danger left', onClick: () => confirm(`„${k.title}“ archivieren? Das Schlüsselergebnis verschwindet aus den Listen und lässt sich im Ressort unter „Archiv“ wiederherstellen.`) && act(() => api('DELETE', `/api/key-results/${k.id}`), 'Schlüsselergebnis archiviert').then(closeOn(close)) }, 'Archivieren'),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => {
        if (!title.value.trim()) return alert('Bitte eine Bezeichnung angeben.');
        if (type.value === 'number' && !(Number(target.value) > 0)) return alert('Bitte einen Zielwert größer als 0 angeben.');
        act(() => isNew ? api('POST', '/api/key-results', payload()) : api('PUT', `/api/key-results/${k.id}`, payload()), isNew ? 'Schlüsselergebnis angelegt' : 'Schlüsselergebnis gespeichert').then(closeOn(close)); } }, isNew ? 'Anlegen' : 'Speichern')], true);
}

function modalRessortForm(r) {
  const isNew = !r;
  const name = inp('r-name', { value: r?.name || '', placeholder: 'z. B. Marketing' });
  const color = inp('r-color', { type: 'color', value: r?.color || PALETTE[evRessorts().length % PALETTE.length], style: 'width:60px;padding:2px' });
  const payload = () => ({ name: name.value.trim(), color: color.value });
  openModal(isNew ? 'Neues Ressort' : r.name, isNew ? 'Ressort anlegen' : r.isLead ? 'Führungsressort bearbeiten' : 'Ressort bearbeiten',
    [field('Name', name), field('Farbe', color),
      !isNew ? el('div', { class: 'muted small' }, 'Wer das Ressort pflegt, legst du in der Nutzerliste fest (Verwaltung → Nutzer).') : null,
      r?.isLead ? el('div', { class: 'muted small' }, 'Das Führungsressort pflegt die Event-Ziele. Es lässt sich umbenennen, aber nicht löschen.') : null],
    (close) => [
      !isNew && !r.isLead && (contentCount((x) => x.ressortId === r.id)
        ? el('span', { class: 'muted small left', style: 'align-self:center' }, 'Löschen erst ohne Ziele und Schlüsselergebnisse möglich – vorher zusammenführen.')
        : el('button', { class: 'btn danger left', onClick: () => confirm(`Ressort „${r.name}“ löschen? Zugeordnete Nutzer verlieren ihre Zuordnung.`) && act(() => api('DELETE', `/api/ressorts/${r.id}`), 'Ressort gelöscht').then((ok) => { if (!ok) return; close(); if (state.view === 'ressort') go('overview'); }) }, 'Löschen')),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!name.value.trim()) return alert('Bitte einen Namen angeben.'); act(async () => { const res = isNew ? await api('POST', '/api/ressorts', { eventId: state.eventId, ...payload() }) : await api('PUT', `/api/ressorts/${r.id}`, payload()); if (isNew && state.view !== 'admin') { state.view = 'ressort'; state.ressortId = res.id; } }, isNew ? 'Ressort angelegt' : 'Ressort gespeichert').then(closeOn(close)); } }, isNew ? 'Anlegen' : 'Speichern')]);
}

function modalMerge(r) {
  const targets = evRessorts().filter((x) => x.id !== r.id);
  const sel = el('select', { id: 'm-into' }, ...targets.map((x) => el('option', { value: x.id }, x.name)));
  const nO = state.data.objectives.filter((o) => o.ressortId === r.id).length, nK = state.data.keyResults.filter((k) => k.ressortId === r.id).length, nU = state.users.filter((u) => u.ressortId === r.id).length;
  openModal(r.name, 'Ressort zusammenführen',
    [field('Zusammenführen mit', sel),
      el('div', { class: 'warn-box' }, `${plural(nO, 'Ziel', 'Ziele')}, ${plural(nK, 'Schlüsselergebnis', 'Schlüsselergebnisse')} und ${nU} Nutzer von „${r.name}“ wandern in das gewählte Ressort. „${r.name}“ wird danach gelöscht.`)],
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => act(() => api('POST', `/api/admin/ressorts/${r.id}/merge`, { intoId: sel.value }), 'Ressorts zusammengeführt').then(closeOn(close)) }, 'Zusammenführen')]);
}

function modalEventForm(ev) {
  const isNew = !ev;
  const name = inp('e-name', { value: ev?.name || '', placeholder: 'z. B. Summit 2027' });
  const start = inp('e-start', { type: 'date', value: ev?.startDate || '' });
  const end = inp('e-end', { type: 'date', value: ev?.endDate || '' });
  const tracking = inp('e-tracking', { type: 'date', value: ev?.trackingStart || Check.mondayOf(Check.localDay(new Date().toISOString())) });
  const payload = () => ({ name: name.value.trim(), startDate: start.value || null, endDate: end.value || null, trackingStart: tracking.value || undefined });
  openModal(isNew ? 'Neues Event' : ev.name, isNew ? 'Event anlegen' : 'Event bearbeiten',
    [field('Name', name), el('div', { class: 'two' }, field('Beginn', start), field('Ende', end)),
      field('Wochenzählung ab', tracking, 'Woche 1 des Pflege-Checks. Wird auf den Montag der gewählten Woche gesetzt; gezählt wird bis zum Eventende.'),
      isNew ? el('div', { class: 'muted small' }, 'Das Führungsressort für die Event-Ziele wird automatisch angelegt.') : null],
    (close) => [
      !isNew && (contentCount((x) => x.eventId === ev.id)
        ? el('span', { class: 'muted small left', style: 'align-self:center' }, 'Events mit Zielen oder Schlüsselergebnissen lassen sich nicht löschen.')
        : el('button', { class: 'btn danger left', onClick: () => confirm(`„${ev.name}“ mit seinen Ressorts löschen? Zugeordnete Nutzer verlieren ihre Zuordnung.`) && act(() => api('DELETE', `/api/events/${ev.id}`), 'Event gelöscht').then(closeOn(close)) }, 'Löschen')),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!name.value.trim()) return alert('Bitte einen Namen angeben.'); act(async () => { const res = isNew ? await api('POST', '/api/events', payload()) : await api('PUT', `/api/events/${ev.id}`, payload()); if (isNew) state.eventId = res.id; }, isNew ? 'Event angelegt' : 'Event gespeichert').then(closeOn(close)); } }, isNew ? 'Anlegen' : 'Speichern')]);
}

// Lesbares Einmal-Passwort ohne verwechselbare Zeichen
function randomPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint32Array(14))].map((n) => abc[n % abc.length]).join('');
}

function modalUser(u) {
  const isSelf = u.id === state.me.id;
  const name = inp('u-name', { value: u.name });
  const email = inp('u-email', { type: 'email', value: u.email });
  const role = el('select', { id: 'u-role' }, el('option', { value: 'member', selected: u.role === 'member' }, 'Mitglied'), el('option', { value: 'admin', selected: u.role === 'admin' }, 'Admin'));
  const status = el('select', { id: 'u-status' }, ...[['pending', 'Wartet auf Freigabe'], ['active', 'Aktiv'], ['disabled', 'Gesperrt']].map(([v, l]) => el('option', { value: v, selected: u.status === v }, l)));
  const evSel = el('select', { id: 'u-event' }, el('option', { value: '' }, '– kein Event –'), ...state.data.events.map((e) => el('option', { value: e.id, selected: e.id === u.eventId }, e.name)));
  const rSel = el('select', { id: 'u-ressort' });
  const newName = inp('u-new', { value: u.requestedRessortName || '', maxlength: 60 });
  const newField = field('Name des neuen Ressorts', newName, 'Gibt es schon ein Ressort mit diesem Namen im Event, wird es verwendet.');
  const wantsNew = !u.ressortId && !!u.requestedRessortName;
  const syncRessorts = (initial) => {
    rSel.replaceChildren(el('option', { value: '' }, '– kein Ressort –'), ...ressortsOf(evSel.value).map((r) => el('option', { value: r.id, selected: initial && r.id === u.ressortId }, r.name + (r.isLead ? ' (Event-Ziele)' : ''))),
      el('option', { value: '__new', selected: initial && wantsNew }, 'Neues Ressort anlegen …'));
    syncNew();
  };
  const syncNew = () => (newField.hidden = rSel.value !== '__new');
  evSel.addEventListener('change', () => syncRessorts(false));
  rSel.addEventListener('change', syncNew);
  syncRessorts(true);
  const pw = inp('u-pw', { value: randomPassword(), style: 'flex:1' });
  const payload = (extra = {}) => ({ name: name.value, email: email.value, role: role.value, status: status.value, eventId: evSel.value || null,
    ressortId: rSel.value === '__new' ? null : rSel.value || null, newRessortName: rSel.value === '__new' ? newName.value : '', ...extra });
  const save = (close, extra, msg) => act(() => api('PUT', `/api/admin/users/${u.id}`, payload(extra)), msg).then(closeOn(close));
  openModal(u.name, u.status === 'pending' ? 'Registrierung prüfen' : 'Nutzer bearbeiten',
    [wantsNew ? el('div', { class: 'warn-box' }, `Wunsch bei der Registrierung: neues Ressort „${u.requestedRessortName}“. Lege es an oder ordne ein bestehendes Ressort zu.`) : null,
      el('div', { class: 'two' }, field('Name', name), field('E-Mail', email)),
      el('div', { class: 'two' }, field('Rolle', role), field('Status', status)),
      el('div', { class: 'two' }, field('Event', evSel), field('Ressort', rSel)),
      newField,
      el('div', { class: 'field' }, el('label', { for: 'u-pw' }, 'Einmal-Passwort setzen'),
        el('div', { style: 'display:flex;gap:8px' }, pw, el('button', { class: 'btn ghost', onClick: () => act(() => api('POST', `/api/admin/users/${u.id}/password`, { password: pw.value }), 'Einmal-Passwort gesetzt – bitte sicher weitergeben') }, 'Setzen')),
        el('div', { class: 'hint' }, 'Bestehende Anmeldungen enden. Beim nächsten Login muss ein eigenes Passwort gewählt werden.'))],
    (close) => [
      !isSelf && el('button', { class: 'btn danger left', onClick: () => confirm(`Konto von „${u.name}“ löschen? Einträge in der Historie bleiben mit Namen erhalten.`) && act(() => api('DELETE', `/api/admin/users/${u.id}`), 'Nutzer gelöscht').then(closeOn(close)) }, 'Löschen'),
      cancelBtn(close),
      u.status === 'pending' ? el('button', { class: 'btn', onClick: () => save(close, { status: 'active' }, 'Nutzer freigegeben') }, 'Freigeben') : null,
      el('button', { class: u.status === 'pending' ? 'btn ghost' : 'btn', onClick: () => save(close, {}, 'Nutzer gespeichert') }, 'Speichern')], true);
}

function modalPassword() {
  const cur = inp('mp-cur', { type: 'password', autocomplete: 'current-password' });
  const pw1 = inp('mp-new', { type: 'password', autocomplete: 'new-password' });
  const pw2 = inp('mp-new2', { type: 'password', autocomplete: 'new-password' });
  openModal('Passwort ändern', state.me.name,
    [field('Aktuelles Passwort', cur), field('Neues Passwort', pw1, `Mindestens ${MIN_PASSWORD} Zeichen. Andere Anmeldungen werden beendet.`), field('Neues Passwort wiederholen', pw2)],
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => {
      if (pw1.value !== pw2.value) return alert('Die beiden neuen Passwörter stimmen nicht überein.');
      act(() => api('POST', '/api/auth/password', { currentPassword: cur.value, newPassword: pw1.value }), 'Passwort geändert').then(closeOn(close));
    } }, 'Speichern')]);
}

// ---------- Start ----------
$('#btn-new-ressort').addEventListener('click', () => curEvent() ? modalRessortForm(null) : alert('Bitte zuerst ein Event anlegen.'));
document.querySelectorAll('.nav[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#modal-root').replaceChildren(); closeMenus(); } });
document.addEventListener('click', (e) => !e.target.closest('.menu') && closeMenus());
const inviteId = (location.hash.match(/^#einladung=([\w-]+)$/) || [])[1];
api('GET', '/api/auth/me').then(({ user }) => startApp(user)).catch(() => (inviteId ? showAuth('register', inviteId) : showAuth('login')));
