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

const state = { me: null, data: { events: [], ressorts: [], kpis: [] }, users: [], eventId: null, view: 'overview', ressortId: null, adminTab: 'users', userFilter: 'all' };
const TYPE_LABEL = { number: 'Anzahl', bool: 'Ja / Nein', date: 'Meilenstein', combo: 'Anzahl + Datum' };
const PALETTE = ['#2563EB', '#7C3AED', '#DB2777', '#0F766E', '#B45309', '#0891B2', '#65A30D', '#9333EA', '#DC2626', '#4B5563'];
const MIN_PASSWORD = 10;

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
  const [data, users] = await Promise.all([api('GET', '/api/state'), isAdmin() ? api('GET', '/api/admin/users') : null]);
  state.data = data;
  state.users = users || [];
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
const isNum = (k) => k.type === 'number' || k.type === 'combo';
const byId = (id) => state.data.kpis.find((k) => k.id === id);
const ressort = (id) => state.data.ressorts.find((r) => r.id === id);
const eventById = (id) => state.data.events.find((e) => e.id === id);
const curEvent = () => eventById(state.eventId);
// Führungsressort immer zuerst
const ressortsOf = (eventId) => state.data.ressorts.filter((r) => r.eventId === eventId).sort((a, b) => b.isLead - a.isLead);
const evRessorts = () => ressortsOf(state.eventId);
const leadRessort = () => evRessorts().find((r) => r.isLead);
const evKpis = () => state.data.kpis.filter((k) => k.eventId === state.eventId);
const owner = (k) => ressort(k.ressortId)?.name || 'Ressort';
const pct = (k) => (k.achieved ? 100 : isNum(k) && k.target > 0 ? Math.min(100, Math.round((k.current / k.target) * 100)) : 0);
const valueLabel = (k) => (isNum(k) ? fmt(k.current) + (k.unit ? ' ' + k.unit : '') : k.achieved ? 'Erreicht' : 'Offen');
const targetLabel = (k) => (isNum(k) ? fmt(k.target) + (k.unit ? ' ' + k.unit : '') : 'bis ' + de(k.deadline));
const openDeps = (k) => k.deps.map(byId).filter((d) => d && !d.achieved);
// Rechte – maßgeblich ist der Server, hier wird nur ein- und ausgeblendet.
const isAdmin = () => state.me?.role === 'admin';
const canEditRessort = (rid) => isAdmin() || (!!state.me?.ressortId && state.me.ressortId === rid);
const canEditKpi = (k) => canEditRessort(k.ressortId);
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
// Wie Element.append, überspringt aber null/false (bedingte Kinder)
const append = (parent, ...children) => parent.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
const dot = (color, sm) => el('span', { class: 'dot' + (sm ? ' sm' : ''), style: 'background:' + color });
const pill = (s) => el('span', { class: 'pill ' + s.key }, s.label);

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
  document.title = 'KPI';
  const root = $('#auth-root');
  root.hidden = false;
  const card = el('div', { class: 'auth-card' }, el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Eventkompass'));
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

async function authRegister(card) {
  append(card, el('h1', {}, 'Registrieren'), el('div', { class: 'muted small' }, 'Wähle dein Event und dein Ressort. Die Zuordnung kann danach nur ein Admin ändern.'));
  let opts;
  try { opts = await api('GET', '/api/public/registration-options'); } catch (e) { card.append(el('div', { class: 'error-box' }, e.message)); return; }
  const name = inp('r-name', { autocomplete: 'name', placeholder: 'Vor- und Nachname' });
  const email = inp('r-email', { type: 'email', autocomplete: 'username' });
  const pw = inp('r-pw', { type: 'password', autocomplete: 'new-password' });
  const evSel = el('select', { id: 'r-event' }, el('option', { value: '' }, 'Bitte wählen …'), ...opts.events.map((e) => el('option', { value: e.id }, e.name + (e.startDate ? ' · ' + de(e.startDate) : ''))));
  const rSel = el('select', { id: 'r-ressort', disabled: true });
  const newName = inp('r-new', { placeholder: 'Name des Ressorts', maxlength: 60 });
  const newField = field('Neues Ressort', newName, 'Ein Admin prüft den Namen und legt das Ressort an bzw. ordnet dich zu.');
  const syncRessorts = () => {
    const rs = opts.ressorts.filter((r) => r.eventId === evSel.value).sort((a, b) => b.isLead - a.isLead);
    rSel.replaceChildren(el('option', { value: '' }, 'Bitte wählen …'), ...rs.map((r) => el('option', { value: r.id }, r.name + (r.isLead ? ' (Event-Kennzahlen)' : ''))), el('option', { value: '__new' }, 'Mein Ressort fehlt …'));
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
    authForm([field('Name', name), field('E-Mail', email), field('Passwort', pw, `Mindestens ${MIN_PASSWORD} Zeichen.`), !noEvents && field('Event', evSel), !noEvents && field('Ressort', rSel), newField], 'Konto anlegen', async () => {
      if (!noEvents && !evSel.value) throw new Error('Bitte ein Event auswählen.');
      if (!noEvents && !rSel.value) throw new Error('Bitte ein Ressort auswählen.');
      if (pw.value.length < MIN_PASSWORD) throw new Error(`Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`);
      const isNew = rSel.value === '__new';
      const res = await api('POST', '/api/auth/register', { name: name.value, email: email.value, password: pw.value, eventId: evSel.value, ressortId: isNew ? null : rSel.value, newRessortName: isNew ? newName.value : '' });
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
  if (state.view === 'admin') return renderAdmin(main);
  if (!curEvent()) { main.append(el('div', { class: 'card empty' }, isAdmin() ? 'Noch kein Event. Lege unter „Verwaltung → Events“ eines an.' : 'Noch kein Event vorhanden.')); return; }
  if (state.view === 'ressort') renderRessort(main);
  else renderOverview(main);
}

function renderTopbar() {
  const ev = curEvent(); const events = state.data.events;
  document.title = ev ? ev.name + ' – KPI' : 'KPI';
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
    const ks = evKpis().filter((k) => k.ressortId === r.id);
    return el('button', { class: 'nav' + (state.view === 'ressort' && state.ressortId === r.id ? ' active' : ''), onClick: () => go('ressort', r.id) },
      dot(r.color), el('span', { class: 'grow' }, r.name), r.id === state.me.ressortId ? el('span', { class: 'mine', title: 'Dein Ressort' }, 'deins') : null,
      el('span', { class: 'muted small num' }, ks.filter((k) => k.achieved).length + '/' + ks.length));
  }));
  const ks = evKpis(); const ev = curEvent();
  const days = ev?.startDate ? Math.ceil((new Date(ev.startDate) - new Date()) / 86400000) : null;
  $('#side-note').replaceChildren(
    el('strong', {}, days !== null ? (days >= 0 ? `Noch ${days} Tage` : `Vor ${-days} Tagen`) : 'Kein Datum'),
    ev ? `${ev.name}: ${ks.filter((k) => !k.achieved).length} Kennzahlen offen, ${ks.filter((k) => !k.achieved && openDeps(k).length).length} warten auf Abhängigkeiten.` : ''
  );
}

function go(view, ressortId = null) { state.view = view; state.ressortId = ressortId; render(); }

function kpiTable(kpis, opts = {}) {
  const table = el('table', {},
    el('thead', {}, el('tr', {}, ...['Kennzahl', 'Typ', 'Ziel', 'Ist', 'Fortschritt', 'Status', 'Frist / erreicht', 'Abhängig von', ''].map((h) => el('th', {}, h)))),
    el('tbody'));
  const tb = $('tbody', table);
  if (!kpis.length) tb.append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, opts.empty || 'Noch keine Kennzahlen.')));
  for (const k of kpis) {
    const row = $('#tpl-kpi-row').content.firstElementChild.cloneNode(true);
    const s = status(k);
    $('.kpi-title', row).textContent = k.title;
    $('.kpi-sub', row).textContent = (opts.showOwner ? owner(k) + ' · ' : '') + (k.history[0] ? 'Zuletzt ' + deTime(k.history[0].at) + ' von ' + k.history[0].who : 'keine Änderung');
    $('.type-chip', row).textContent = TYPE_LABEL[k.type];
    $('.kpi-target', row).textContent = targetLabel(k);
    $('.kpi-current', row).textContent = valueLabel(k);
    $('.bar-fill', row).style.cssText = `width:${pct(k)}%;background:${s.color}`;
    $('.kpi-pct', row).textContent = isNum(k) || k.achieved ? pct(k) + '%' : '–';
    $('.kpi-status', row).replaceWith(pill(s));
    $('.kpi-dates', row).replaceChildren(el('div', {}, de(k.deadline)), el('div', { class: 'small', style: 'color:' + (k.achieved ? 'var(--ok-ink)' : 'var(--muted)') }, k.achieved ? 'erreicht am ' + de(k.achievedAt) : 'noch nicht erreicht'));
    const deps = k.deps.map(byId).filter(Boolean);
    $('.kpi-deps', row).replaceChildren(...(deps.length ? deps.map((d) => el('span', { class: 'chip ' + (d.achieved ? 'done' : 'open'), title: d.title }, d.title.length > 24 ? d.title.slice(0, 23) + '…' : d.title)) : [el('span', { class: 'muted small' }, '–')]));
    $('.act-history', row).addEventListener('click', () => modalHistory(k));
    if (canEditKpi(k)) {
      $('.act-value', row).addEventListener('click', () => modalValue(k));
      if (!isNum(k)) $('.act-value', row).disabled = true;
      $('.act-achieve', row).addEventListener('click', () => modalAchieve(k));
      $('.act-edit', row).addEventListener('click', () => modalKpiForm(k));
    } else {
      // Fremde Kennzahlen: nur lesen (Historie bleibt für alle sichtbar)
      ['.act-value', '.act-achieve', '.act-edit'].forEach((c) => $(c, row).remove());
    }
    tb.append(row);
  }
  return el('div', { class: 'table-wrap' }, table);
}

function renderOverview(main) {
  const ev = curEvent(); const ks = evKpis(); const lead = leadRessort();
  const rs = evRessorts().filter((r) => !r.isLead);
  const done = ks.filter((k) => k.achieved).length;
  const stats = ks.map(status);
  const total = ks.length ? Math.round(ks.reduce((a, k) => a + pct(k), 0) / ks.length) : 0;
  const circ = 2 * Math.PI * 28;
  const leadKs = lead ? ks.filter((k) => k.ressortId === lead.id) : [];
  main.append(
    el('div', { class: 'head-row' },
      el('div', {}, el('div', { class: 'muted small strong' }, 'Event · ' + ev.name), el('h1', {}, 'Zielerreichung gesamt')),
      lead && canEditRessort(lead.id) ? el('div', { style: 'display:flex;gap:8px' }, el('button', { class: 'btn', onClick: () => modalKpiForm(null, lead.id) }, '+ Event-Kennzahl')) : null),
    el('div', { class: 'grid grid-3' },
      el('div', { class: 'card ring-card' },
        svgEl(`<svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="Gesamtfortschritt ${total} Prozent"><circle cx="36" cy="36" r="28" fill="none" stroke="#E5E7EB" stroke-width="8"/><circle cx="36" cy="36" r="28" fill="none" stroke="#4F46E5" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(total / 100) * circ} ${circ}" transform="rotate(-90 36 36)"/><text x="36" y="41" text-anchor="middle" font-size="15" font-weight="700" fill="#111827" font-family="Inter,sans-serif">${total}%</text></svg>`),
        el('div', {}, el('div', { class: 'muted small' }, 'Gesamt'), el('div', { class: 'strong', style: 'font-size:13px' }, `${done} von ${ks.length} erreicht`))),
      stat('Erreicht', done, `von ${ks.length} Kennzahlen`, 'var(--ok)'),
      stat('Gefährdet / überfällig', stats.filter((s) => ['risk', 'crit', 'late'].includes(s.key)).length, 'braucht Aufmerksamkeit', 'var(--warn)')),
    el('section', { class: 'card' },
      el('div', { class: 'section-head' }, el('div', {}, el('h2', {}, 'Event-Kennzahlen'), el('div', { class: 'muted small' }, lead ? `Übergeordnete Ziele – gepflegt vom Ressort „${lead.name}“` : 'Übergeordnete Ziele'))),
      kpiTable(leadKs, { empty: 'Noch keine Event-Kennzahlen.' })),
    el('section', {},
      el('div', { class: 'head-row', style: 'margin-bottom:12px' }, el('h2', {}, 'Ressorts'), isAdmin() ? el('button', { class: 'btn ghost small-btn', onClick: () => modalRessortForm(null) }, '+ Ressort') : null),
      el('div', { class: 'grid grid-3' }, ...rs.map(ressortCard), !rs.length && el('div', { class: 'card empty' }, 'Noch keine Ressorts.')))
  );
}
function stat(label, value, hint, color) {
  return el('div', { class: 'card stat' }, el('div', { class: 'label' }, dot(color, true), label), el('div', { class: 'value num' }, value), el('div', { class: 'muted small' }, hint));
}
function svgEl(str) { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content.firstElementChild; }
function ressortCard(r) {
  const ks = evKpis().filter((k) => k.ressortId === r.id);
  const done = ks.filter((k) => k.achieved).length;
  const p = ks.length ? Math.round(ks.reduce((a, k) => a + pct(k), 0) / ks.length) : 0;
  const risky = ks.filter((k) => ['risk', 'crit', 'late'].includes(status(k).key)).length;
  const blocked = ks.filter((k) => !k.achieved && openDeps(k).length).length;
  const badges = [];
  if (risky) badges.push(pill({ key: 'risk', label: risky + ' gefährdet' }));
  if (blocked) badges.push(pill({ key: 'crit', label: blocked + ' blockiert' }));
  if (!risky && !blocked && ks.length) badges.push(pill({ key: 'done', label: 'alles im Plan' }));
  if (!ks.length) badges.push(pill({ key: 'open', label: 'noch keine Kennzahlen' }));
  return el('button', { class: 'card ressort-card', onClick: () => go('ressort', r.id) },
    el('div', { class: 'top' }, dot(r.color), el('span', { class: 'name' }, r.name)),
    el('div', { style: 'display:flex;justify-content:space-between' }, el('span', { class: 'muted small' }, `${ks.length} Kennzahlen · ${done} erreicht`), el('span', { class: 'strong num' }, p + '%')),
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${p}%;background:${r.color}` })),
    el('div', { class: 'chips' }, ...badges));
}

function renderRessort(main) {
  const r = ressort(state.ressortId);
  if (!r) return go('overview');
  const ks = evKpis().filter((k) => k.ressortId === r.id);
  const done = ks.filter((k) => k.achieved).length;
  const p = ks.length ? Math.round(ks.reduce((a, k) => a + pct(k), 0) / ks.length) : 0;
  const editable = canEditRessort(r.id);
  const hint = r.isLead ? 'Führungsressort – pflegt die Event-Kennzahlen' : 'Teams tragen ihre Kennzahlen hier selbst ein';
  main.append(
    el('div', { class: 'head-row' },
      el('div', {},
        el('div', { class: 'muted small strong' }, el('button', { class: 'link-btn', onClick: () => go('overview') }, 'Übersicht'), ' / Ressort'),
        el('h1', { style: 'display:flex;align-items:center;gap:10px' }, dot(r.color), r.name),
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, hint + (editable ? '' : ' · nur Lesen'))),
      el('div', { style: 'display:flex;gap:8px' },
        isAdmin() ? el('button', { class: 'btn ghost', onClick: () => modalRessortForm(r) }, 'Ressort bearbeiten') : null,
        editable ? el('button', { class: 'btn', onClick: () => modalKpiForm(null, r.id) }, '+ Kennzahl') : null)),
    el('div', { class: 'grid grid-4' },
      miniStat('Kennzahlen', ks.length), miniStat('Erreicht', `${done}/${ks.length}`), miniStat('Fortschritt', p + '%'),
      miniStat('Gefährdet', ks.filter((k) => ['risk', 'crit', 'late'].includes(status(k).key)).length)),
    el('section', { class: 'card' }, kpiTable(ks, { empty: editable ? 'Noch keine Kennzahlen – mit „+ Kennzahl“ anlegen.' : 'Noch keine Kennzahlen.' }))
  );
}
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
        el('td', { class: 'small' }, u.approvedBy === 'auto' ? 'automatisch' : u.approvedBy === 'admin' ? 'Admin' : '–', u.approvedAt ? el('div', { class: 'muted' }, de(u.approvedAt)) : null),
        el('td', { class: 'small' }, u.lastLoginAt ? deTime(u.lastLoginAt) : '–'),
        el('td', { class: 'actions' }, el('button', { class: 'btn small-btn' + (u.status === 'pending' ? '' : ' ghost'), onClick: () => modalUser(u) }, u.status === 'pending' ? 'Prüfen' : 'Bearbeiten')));
    }) : [el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'Keine Nutzer in dieser Ansicht.'))])));
  main.append(el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('h2', {}, `Nutzer (${state.users.length})`),
      el('div', { class: 'filter-row' }, ...filters.map(([id, label, fn]) => el('button', { class: 'filter' + (state.userFilter === id ? ' active' : ''), onClick: () => { state.userFilter = id; render(); } }, `${label} (${state.users.filter(fn).length})`)))),
    el('div', { class: 'table-wrap' }, table)));
}

function adminEvents(main) {
  const count = (list, ev) => list.filter((x) => x.eventId === ev.id).length;
  main.append(el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('h2', {}, `Events (${state.data.events.length})`), el('button', { class: 'btn small-btn', onClick: () => modalEventForm(null) }, '+ Event')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['Name', 'Beginn', 'Ende', 'Ressorts', 'Kennzahlen', 'Nutzer', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...(state.data.events.length ? state.data.events.map((ev) => el('tr', {},
        el('td', { class: 'strong' }, ev.name), el('td', {}, de(ev.startDate)), el('td', {}, de(ev.endDate)),
        el('td', { class: 'num' }, count(state.data.ressorts, ev)), el('td', { class: 'num' }, count(state.data.kpis, ev)), el('td', { class: 'num' }, count(state.users, ev)),
        el('td', { class: 'actions' }, el('button', { class: 'btn ghost small-btn', onClick: () => modalEventForm(ev) }, 'Bearbeiten'))))
        : [el('tr', {}, el('td', { colspan: 7, class: 'empty' }, 'Noch keine Events.'))]))))));
}

function adminRessorts(main) {
  const ev = curEvent();
  if (!ev) { main.append(el('div', { class: 'card empty' }, 'Noch kein Event. Lege zuerst unter „Events“ eines an.')); return; }
  const rs = evRessorts();
  main.append(el('section', { class: 'card' },
    el('div', { class: 'section-head' }, el('div', {}, el('h2', {}, `Ressorts von „${ev.name}“`), el('div', { class: 'muted small' }, 'Anderes Event? Oben in der Event-Auswahl wechseln.')),
      el('button', { class: 'btn small-btn', onClick: () => modalRessortForm(null) }, '+ Ressort')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'admin-table' },
      el('thead', {}, el('tr', {}, ...['Ressort', 'Kennzahlen', 'Nutzer', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rs.map((r) => el('tr', {},
        el('td', {}, el('span', { class: 'with-dot strong' }, dot(r.color), r.name, r.isLead ? el('span', { class: 'chip lead' }, 'Führung · Event-Kennzahlen') : null, r.unreviewed ? el('span', { class: 'chip open' }, 'neu, ungeprüft') : null)),
        el('td', { class: 'num' }, state.data.kpis.filter((k) => k.ressortId === r.id).length),
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

function modalValue(k) {
  const v = inp('f-value', { type: 'number', step: 'any', value: k.current });
  const note = el('textarea', { id: 'f-note', rows: 3, placeholder: 'Woher kommt der Wert? Was hat sich geändert?' });
  openModal(k.title, owner(k) + ' · Wert eingeben',
    [el('div', { class: 'two' }, infoBox('Zielwert', targetLabel(k)), infoBox('Bisheriger Ist-Wert', valueLabel(k))),
      field('Neuer Ist-Wert', v, null, `(${k.unit || 'Wert'})`),
      field('Kommentar', note, 'Erscheint in der Historie.'),
      el('div', { class: 'muted small' }, `Wird als Änderung von ${state.me.name} protokolliert.`)],
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => act(() => api('POST', `/api/kpis/${k.id}/value`, { value: v.value, note: note.value }), 'Wert gespeichert').then(closeOn(close)) }, 'Speichern')]);
}

function modalHistory(k) {
  const items = k.history.map((h, i) => el('div', { class: 'hist' },
    el('div', { class: 'rail' }, dot(i === 0 ? 'var(--accent)' : '#D1D5DB'), el('div', { class: 'line' + (i === k.history.length - 1 ? ' end' : '') })),
    el('div', { class: 'body' },
      el('div', { class: 'row1' }, el('span', { class: 'strong', style: 'font-size:13px' }, h.kind), el('span', { class: 'muted small', style: 'white-space:nowrap' }, deTime(h.at) + ' · ' + h.who)),
      el('div', { class: 'num', style: 'margin-top:2px' }, h.from ? el('span', { class: 'muted' }, h.from) : null, h.from ? el('span', { style: 'color:#9CA3AF;margin:0 6px' }, '→') : null, el('span', { class: 'strong' }, h.to)),
      h.note ? el('div', { class: 'note' }, h.note) : null)));
  openModal(k.title, owner(k) + ' · Historie',
    items.length ? items : [el('div', { class: 'empty' }, 'Noch keine Änderungen protokolliert.')],
    (close) => [el('span', { class: 'muted small left', style: 'align-self:center' }, `${k.history.length} Einträge · neueste zuerst`), el('button', { class: 'btn ghost', onClick: close }, 'Schließen')], true);
}

function modalAchieve(k) {
  const form = { yes: !!(k.type === 'combo' ? k.achievedFlag : k.achieved), value: k.current, date: k.achievedAt || todayIso() };
  const askBool = k.type !== 'number', askNum = isNum(k);
  const yesB = el('button', { onClick: () => { form.yes = true; sync(); } }, '✓ Ja, erreicht');
  const noB = el('button', { onClick: () => { form.yes = false; sync(); } }, '✕ Nein, offen');
  const num = inp('a-count', { type: 'number', step: 'any', value: k.current, onInput: (e) => { form.value = e.target.value; sync(); } });
  const date = inp('a-date', { type: 'date', value: form.date, onInput: (e) => (form.date = e.target.value) });
  const dateField = field('Erreicht am', date);
  const note = el('textarea', { id: 'a-note', rows: 2, placeholder: 'Link zum Beleg, Kontext, Besonderheiten …' });
  const od = openDeps(k);
  function sync() {
    yesB.classList.toggle('on', form.yes); noB.classList.toggle('on', !form.yes);
    const reached = k.type === 'number' ? Number(form.value) >= k.target : k.type === 'combo' ? form.yes && Number(form.value) >= k.target : form.yes;
    dateField.style.display = reached ? '' : 'none';
  }
  sync();
  openModal(k.title, owner(k) + ' · Ist-Erreichung eintragen',
    [el('div', { class: 'info-box', style: 'display:flex;gap:10px;align-items:center;font-size:13px' }, el('span', { class: 'type-chip' }, TYPE_LABEL[k.type]), el('span', {}, 'Ziel: ', el('strong', {}, targetLabel(k)), k.deadline ? ' bis ' + de(k.deadline) : '')),
      askBool && el('div', { class: 'field' }, el('label', {}, 'Erreicht?'), el('div', { class: 'toggle' }, yesB, noB)),
      askNum && field('Erreichte Anzahl', num, k.type === 'number' ? 'Liegt der Wert bei oder über dem Ziel, gilt die Kennzahl als erreicht.' : 'Bei „Anzahl + Datum“ müssen Ziel erreicht und „Ja“ gesetzt sein.', `(${k.unit || 'Wert'})`),
      dateField,
      field('Nachweis / Kommentar', note),
      od.length ? el('div', { class: 'warn-box' }, `Hinweis: ${od.length} Voraussetzung(en) noch offen (${od.map((d) => d.title).join(', ')}). Die Erreichung kann trotzdem eingetragen werden.`) : null],
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => act(() => api('POST', `/api/kpis/${k.id}/achieve`, { achieved: form.yes, value: askNum ? form.value : undefined, achievedAt: form.date, note: note.value }), 'Erreichung gespeichert').then(closeOn(close)) }, 'Erreichung speichern')]);
}

function modalKpiForm(k, ressortId) {
  const isNew = !k;
  const rid = isNew ? ressortId : k.ressortId;
  const title = inp('k-title', { value: k?.title || '', placeholder: 'z. B. Verkaufte Tickets' });
  const type = el('select', { id: 'k-type' }, ...Object.entries(TYPE_LABEL).map(([v, l]) => el('option', { value: v, selected: (k?.type || 'number') === v }, l)));
  const target = inp('k-target', { type: 'number', step: 'any', value: k ? k.target : '' });
  const unit = inp('k-unit', { value: k?.unit || '', placeholder: 'Tickets, €, Speaker …' });
  const current = inp('k-current', { type: 'number', step: 'any', value: k ? k.current : 0 });
  const deadline = inp('k-deadline', { type: 'date', value: k?.deadline || '' });
  // Ressort wechseln dürfen nur Admins
  const ownerSel = el('select', { id: 'k-owner', disabled: !isAdmin() }, ...evRessorts().map((r) => el('option', { value: r.id, selected: rid === r.id }, r.name + (r.isLead ? ' (Event-Kennzahlen)' : ''))));
  const desc = el('textarea', { id: 'k-desc', rows: 2, placeholder: 'Optional: Was misst diese Kennzahl, woher kommen die Daten?' }, k?.description || '');
  // Abhängigkeiten nur innerhalb desselben Ressorts
  const depsBox = el('div', { class: 'deps-list' });
  const syncDeps = () => {
    const keep = ownerSel.value === k?.ressortId ? k.deps : [];
    const candidates = evKpis().filter((x) => x.id !== k?.id && x.ressortId === ownerSel.value);
    depsBox.replaceChildren(...(candidates.length ? candidates.map((x) => el('label', {}, el('input', { type: 'checkbox', value: x.id, checked: keep.includes(x.id) }), el('span', { class: 'grow' }, x.title), el('span', { class: 'muted small' }, TYPE_LABEL[x.type])))
      : [el('span', { class: 'muted small' }, 'Keine weiteren Kennzahlen in diesem Ressort.')]));
  };
  ownerSel.addEventListener('change', syncDeps); syncDeps();
  const numFields = el('div', { class: 'two' }, field('Zielwert', target), field('Einheit', unit));
  const curField = field(isNew ? 'Aktueller Ist-Wert' : 'Ist-Wert', current, isNew ? null : 'Zum Nachtragen bitte „Wert eingeben“ nutzen – hier nicht änderbar.');
  if (!isNew) current.disabled = true;
  const syncType = () => { const n = type.value === 'number' || type.value === 'combo'; numFields.style.display = n ? '' : 'none'; curField.style.display = n ? '' : 'none'; };
  type.addEventListener('change', syncType); syncType();
  if (!isNew) type.disabled = true;
  const payload = () => ({ title: title.value.trim(), type: type.value, target: target.value, unit: unit.value.trim(), current: current.value, deadline: deadline.value || null, ressortId: ownerSel.value, description: desc.value, deps: [...depsBox.querySelectorAll('input:checked')].map((c) => c.value) });
  openModal(isNew ? 'Neue Kennzahl' : k.title, isNew ? ressort(rid).name + ' · anlegen' : owner(k) + ' · bearbeiten',
    [field('Bezeichnung', title),
      el('div', { class: 'two' }, field('Typ', type, isNew ? null : 'Der Typ ist nach dem Anlegen fest.'), field('Ressort', ownerSel, isAdmin() ? null : 'Zuordnung ändert nur ein Admin.')),
      numFields, curField,
      field('Frist / Zieldatum', deadline),
      field('Beschreibung', desc),
      el('div', { class: 'field' }, el('label', {}, 'Abhängig von ', el('span', {}, '(Voraussetzungen aus demselben Ressort)')), depsBox)],
    (close) => [
      !isNew && isAdmin() && el('button', { class: 'btn danger left', onClick: () => confirm(`„${k.title}“ wirklich löschen? Die Historie geht verloren.`) && act(() => api('DELETE', `/api/kpis/${k.id}`), 'Kennzahl gelöscht').then(closeOn(close)) }, 'Löschen'),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!title.value.trim()) return alert('Bitte eine Bezeichnung angeben.'); act(() => isNew ? api('POST', '/api/kpis', payload()) : api('PUT', `/api/kpis/${k.id}`, payload()), isNew ? 'Kennzahl angelegt' : 'Kennzahl gespeichert').then(closeOn(close)); } }, isNew ? 'Anlegen' : 'Speichern')], true);
}

function modalRessortForm(r) {
  const isNew = !r;
  const name = inp('r-name', { value: r?.name || '', placeholder: 'z. B. Marketing' });
  const color = inp('r-color', { type: 'color', value: r?.color || PALETTE[evRessorts().length % PALETTE.length], style: 'width:60px;padding:2px' });
  const payload = () => ({ name: name.value.trim(), color: color.value });
  openModal(isNew ? 'Neues Ressort' : r.name, isNew ? 'Ressort anlegen' : r.isLead ? 'Führungsressort bearbeiten' : 'Ressort bearbeiten',
    [field('Name', name), field('Farbe', color),
      !isNew ? el('div', { class: 'muted small' }, 'Wer das Ressort pflegt, legst du in der Nutzerliste fest (Verwaltung → Nutzer).') : null,
      r?.isLead ? el('div', { class: 'muted small' }, 'Das Führungsressort pflegt die Event-Kennzahlen. Es lässt sich umbenennen, aber nicht löschen.') : null],
    (close) => [
      !isNew && !r.isLead && el('button', { class: 'btn danger left', onClick: () => confirm(`„${r.name}“ und alle zugehörigen Kennzahlen löschen?`) && act(() => api('DELETE', `/api/ressorts/${r.id}`), 'Ressort gelöscht').then((ok) => { if (!ok) return; close(); if (state.view === 'ressort') go('overview'); }) }, 'Löschen'),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!name.value.trim()) return alert('Bitte einen Namen angeben.'); act(async () => { const res = isNew ? await api('POST', '/api/ressorts', { eventId: state.eventId, ...payload() }) : await api('PUT', `/api/ressorts/${r.id}`, payload()); if (isNew && state.view !== 'admin') { state.view = 'ressort'; state.ressortId = res.id; } }, isNew ? 'Ressort angelegt' : 'Ressort gespeichert').then(closeOn(close)); } }, isNew ? 'Anlegen' : 'Speichern')]);
}

function modalMerge(r) {
  const targets = evRessorts().filter((x) => x.id !== r.id);
  const sel = el('select', { id: 'm-into' }, ...targets.map((x) => el('option', { value: x.id }, x.name)));
  const nK = state.data.kpis.filter((k) => k.ressortId === r.id).length, nU = state.users.filter((u) => u.ressortId === r.id).length;
  openModal(r.name, 'Ressort zusammenführen',
    [field('Zusammenführen mit', sel),
      el('div', { class: 'warn-box' }, `${nK} Kennzahl(en) und ${nU} Nutzer von „${r.name}“ wandern in das gewählte Ressort. „${r.name}“ wird danach gelöscht.`)],
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => act(() => api('POST', `/api/admin/ressorts/${r.id}/merge`, { intoId: sel.value }), 'Ressorts zusammengeführt').then(closeOn(close)) }, 'Zusammenführen')]);
}

function modalEventForm(ev) {
  const isNew = !ev;
  const name = inp('e-name', { value: ev?.name || '', placeholder: 'z. B. Summit 2027' });
  const start = inp('e-start', { type: 'date', value: ev?.startDate || '' });
  const end = inp('e-end', { type: 'date', value: ev?.endDate || '' });
  const payload = () => ({ name: name.value.trim(), startDate: start.value || null, endDate: end.value || null });
  openModal(isNew ? 'Neues Event' : ev.name, isNew ? 'Event anlegen' : 'Event bearbeiten',
    [field('Name', name), el('div', { class: 'two' }, field('Beginn', start), field('Ende', end)),
      isNew ? el('div', { class: 'muted small' }, 'Das Führungsressort für die Event-Kennzahlen wird automatisch angelegt.') : null],
    (close) => [
      !isNew && el('button', { class: 'btn danger left', onClick: () => confirm(`„${ev.name}“ mit allen Ressorts und Kennzahlen löschen? Zugeordnete Nutzer verlieren ihre Zuordnung.`) && act(() => api('DELETE', `/api/events/${ev.id}`), 'Event gelöscht').then(closeOn(close)) }, 'Löschen'),
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
    rSel.replaceChildren(el('option', { value: '' }, '– kein Ressort –'), ...ressortsOf(evSel.value).map((r) => el('option', { value: r.id, selected: initial && r.id === u.ressortId }, r.name + (r.isLead ? ' (Event-Kennzahlen)' : ''))),
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
api('GET', '/api/auth/me').then(({ user }) => startApp(user)).catch(() => showAuth('login'));
