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

const state = { data: { events: [], ressorts: [], kpis: [] }, eventId: null, view: 'overview', ressortId: null, sel: null };
const TYPE_LABEL = { number: 'Anzahl', bool: 'Ja / Nein', date: 'Meilenstein', combo: 'Anzahl + Datum' };
const PALETTE = ['#2563EB', '#7C3AED', '#DB2777', '#0F766E', '#B45309', '#0891B2', '#65A30D', '#9333EA', '#DC2626', '#4B5563'];

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
async function reload() {
  state.data = await api('GET', '/api/state');
  if (!state.data.events.find((e) => e.id === state.eventId)) state.eventId = state.data.events[0]?.id || null;
  render();
}
const who = () => $('#who').value.trim() || 'Unbekannt';
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2200);
}
async function act(fn, msg) {
  try { await fn(); await reload(); if (msg) toast(msg); } catch (e) { alert('Fehler: ' + e.message); }
}

// ---------- Helfer ----------
const fmt = (n) => Number(n).toLocaleString('de-DE');
const de = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '–');
const deTime = (iso) => { const d = new Date(iso); return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
const todayIso = () => new Date().toISOString().slice(0, 10);
const isNum = (k) => k.type === 'number' || k.type === 'combo';
const byId = (id) => state.data.kpis.find((k) => k.id === id);
const ressort = (id) => state.data.ressorts.find((r) => r.id === id);
const curEvent = () => state.data.events.find((e) => e.id === state.eventId);
const evRessorts = () => state.data.ressorts.filter((r) => r.eventId === state.eventId);
const evKpis = () => state.data.kpis.filter((k) => k.eventId === state.eventId);
const owner = (k) => (k.ressortId ? ressort(k.ressortId)?.name || 'Ressort' : 'Event');
const ownerColor = (k) => (k.ressortId ? ressort(k.ressortId)?.color || '#6B7280' : '#111827');
const pct = (k) => (k.achieved ? 100 : isNum(k) && k.target > 0 ? Math.min(100, Math.round((k.current / k.target) * 100)) : 0);
const valueLabel = (k) => (isNum(k) ? fmt(k.current) + (k.unit ? ' ' + k.unit : '') : k.achieved ? 'Erreicht' : 'Offen');
const targetLabel = (k) => (isNum(k) ? fmt(k.target) + (k.unit ? ' ' + k.unit : '') : 'bis ' + de(k.deadline));
const openDeps = (k) => k.deps.map(byId).filter((d) => d && !d.achieved);
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
const dot = (color, sm) => el('span', { class: 'dot' + (sm ? ' sm' : ''), style: 'background:' + color });
const pill = (s) => el('span', { class: 'pill ' + s.key }, s.label);

// ---------- Rendering ----------
function render() {
  renderTopbar();
  renderSidebar();
  const main = $('#main');
  main.replaceChildren();
  if (!curEvent()) { main.append(el('div', { class: 'card empty' }, 'Noch kein Event. Lege oben rechts mit „+ Event“ eines an.')); return; }
  if (state.view === 'overview') renderOverview(main);
  else if (state.view === 'ressort') renderRessort(main);
  else renderGraph(main);
}

function renderTopbar() {
  const sel = $('#event-select');
  sel.replaceChildren(...state.data.events.map((e) => el('option', { value: e.id, selected: e.id === state.eventId }, e.name + (e.startDate ? ' · ' + de(e.startDate) : ''))));
  $('#btn-edit-event').disabled = !curEvent();
}

function renderSidebar() {
  document.querySelectorAll('.nav[data-view]').forEach((b) => b.classList.toggle('active', state.view === b.dataset.view));
  const rs = evRessorts();
  $('#ressort-count').textContent = rs.length;
  $('#nav-ressorts').replaceChildren(...rs.map((r) => {
    const ks = evKpis().filter((k) => k.ressortId === r.id);
    return el('button', { class: 'nav' + (state.view === 'ressort' && state.ressortId === r.id ? ' active' : ''), onClick: () => go('ressort', r.id) },
      dot(r.color), el('span', { class: 'grow' }, r.name), el('span', { class: 'muted small num' }, ks.filter((k) => k.achieved).length + '/' + ks.length));
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
  if (!kpis.length) tb.append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, opts.empty || 'Noch keine Kennzahlen – mit „+ Kennzahl“ anlegen.')));
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
    $('.kpi-deps', row).replaceChildren(...(deps.length ? deps.map((d) => el('span', { class: 'chip ' + (d.achieved ? 'done' : 'open'), title: d.title + ' (' + owner(d) + ')' }, d.title.length > 24 ? d.title.slice(0, 23) + '…' : d.title)) : [el('span', { class: 'muted small' }, '–')]));
    $('.act-value', row).addEventListener('click', () => modalValue(k));
    if (!isNum(k)) $('.act-value', row).disabled = true;
    $('.act-history', row).addEventListener('click', () => modalHistory(k));
    $('.act-achieve', row).addEventListener('click', () => modalAchieve(k));
    $('.act-edit', row).addEventListener('click', () => modalKpiForm(k));
    tb.append(row);
  }
  return el('div', { class: 'table-wrap' }, table);
}

function renderOverview(main) {
  const ev = curEvent(); const ks = evKpis(); const rs = evRessorts();
  const done = ks.filter((k) => k.achieved).length;
  const stats = ks.map(status);
  const total = ks.length ? Math.round(ks.reduce((a, k) => a + pct(k), 0) / ks.length) : 0;
  const circ = 2 * Math.PI * 28;
  main.append(
    el('div', { class: 'head-row' },
      el('div', {}, el('div', { class: 'muted small strong' }, 'Event · ' + ev.name), el('h1', {}, 'Zielerreichung gesamt')),
      el('div', { style: 'display:flex;gap:8px' }, el('button', { class: 'btn', onClick: () => modalKpiForm(null, null) }, '+ Event-Kennzahl'))),
    el('div', { class: 'grid grid-5' },
      el('div', { class: 'card ring-card' },
        svgEl(`<svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="Gesamtfortschritt ${total} Prozent"><circle cx="36" cy="36" r="28" fill="none" stroke="#E5E7EB" stroke-width="8"/><circle cx="36" cy="36" r="28" fill="none" stroke="#4F46E5" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(total / 100) * circ} ${circ}" transform="rotate(-90 36 36)"/><text x="36" y="41" text-anchor="middle" font-size="15" font-weight="700" fill="#111827" font-family="Inter,sans-serif">${total}%</text></svg>`),
        el('div', {}, el('div', { class: 'muted small' }, 'Gesamt'), el('div', { class: 'strong', style: 'font-size:13px' }, `${done} von ${ks.length} erreicht`))),
      stat('Erreicht', done, `von ${ks.length} Kennzahlen`, 'var(--ok)'),
      stat('Im Plan', stats.filter((s) => s.key === 'ok').length, 'über 70 % Zielerreichung', 'var(--plan)'),
      stat('Gefährdet / überfällig', stats.filter((s) => ['risk', 'crit', 'late'].includes(s.key)).length, 'braucht Aufmerksamkeit', 'var(--warn)'),
      stat('Blockiert', ks.filter((k) => !k.achieved && openDeps(k).length).length, 'warten auf Voraussetzungen', 'var(--crit)')),
    el('section', { class: 'card' },
      el('div', { class: 'section-head' }, el('div', {}, el('h2', {}, 'Event-Kennzahlen'), el('div', { class: 'muted small' }, 'Übergeordnete Ziele – speisen sich aus den Ressort-Kennzahlen'))),
      kpiTable(ks.filter((k) => !k.ressortId), { empty: 'Noch keine Event-Kennzahlen.' })),
    el('section', {},
      el('div', { class: 'head-row', style: 'margin-bottom:12px' }, el('h2', {}, 'Ressorts'), el('button', { class: 'btn ghost small-btn', onClick: () => modalRessortForm(null) }, '+ Ressort')),
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
  const initials = (r.lead || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return el('button', { class: 'card ressort-card', onClick: () => go('ressort', r.id) },
    el('div', { class: 'top' }, dot(r.color), el('span', { class: 'name' }, r.name), el('span', { class: 'avatar', title: r.lead }, initials)),
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
  main.append(
    el('div', { class: 'head-row' },
      el('div', {},
        el('div', { class: 'muted small strong' }, el('button', { class: 'link-btn', onClick: () => go('overview') }, 'Übersicht'), ' / Ressort'),
        el('h1', { style: 'display:flex;align-items:center;gap:10px' }, dot(r.color), r.name),
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, 'Leitung ' + (r.lead || '–') + ' · Teams tragen ihre Kennzahlen hier selbst ein')),
      el('div', { style: 'display:flex;gap:8px' },
        el('button', { class: 'btn ghost', onClick: () => modalRessortForm(r) }, 'Ressort bearbeiten'),
        el('button', { class: 'btn ghost', onClick: () => go('graph') }, 'Abhängigkeiten'),
        el('button', { class: 'btn', onClick: () => modalKpiForm(null, r.id) }, '+ Kennzahl'))),
    el('div', { class: 'grid grid-4' },
      miniStat('Kennzahlen', ks.length), miniStat('Erreicht', `${done}/${ks.length}`), miniStat('Fortschritt', p + '%'),
      miniStat('Gefährdet', ks.filter((k) => ['risk', 'crit', 'late'].includes(status(k).key)).length)),
    el('section', { class: 'card' }, kpiTable(ks))
  );
}
const miniStat = (l, v) => el('div', { class: 'card stat', style: 'padding:16px 18px' }, el('div', { class: 'muted small strong' }, l), el('div', { class: 'num', style: 'font-size:24px;font-weight:700' }, v));

// ---------- Abhängigkeits-Graph ----------
function renderGraph(main) {
  const ks = evKpis(); const rs = evRessorts();
  const colW = 236, nodeW = 196, nodeH = 84, rowH = 108, top = 64, left = 24;
  const cols = [{ id: null, name: 'Event', color: '#111827' }, ...rs];
  const pos = {}; let maxRows = 1;
  cols.forEach((c, ci) => {
    const list = ks.filter((k) => (k.ressortId || null) === c.id);
    maxRows = Math.max(maxRows, list.length);
    list.forEach((k, ri) => (pos[k.id] = { x: left + ci * colW, y: top + ri * rowH }));
  });
  const W = left * 2 + cols.length * colW - (colW - nodeW), H = top + maxRows * rowH + 8;
  const sel = state.sel ? byId(state.sel) : null;
  const related = new Set();
  if (sel) { related.add(sel.id); sel.deps.forEach((d) => related.add(d)); ks.forEach((k) => k.deps.includes(sel.id) && related.add(k.id)); }

  let paths = '';
  for (const t of ks) for (const sid of t.deps) {
    const s = byId(sid); if (!s || !pos[s.id] || !pos[t.id]) continue;
    const ps = pos[s.id], pt = pos[t.id], cy = nodeH / 2; let d;
    if (ps.x === pt.x) { const x = ps.x + nodeW; d = `M${x} ${ps.y + cy} C${x + 40} ${ps.y + cy}, ${x + 40} ${pt.y + cy}, ${x} ${pt.y + cy}`; }
    else if (ps.x > pt.x) { const sx = ps.x, tx = pt.x + nodeW, mid = (sx + tx) / 2; d = `M${sx} ${ps.y + cy} C${mid} ${ps.y + cy}, ${mid} ${pt.y + cy}, ${tx} ${pt.y + cy}`; }
    else { const sx = ps.x + nodeW, tx = pt.x, mid = (sx + tx) / 2; d = `M${sx} ${ps.y + cy} C${mid} ${ps.y + cy}, ${mid} ${pt.y + cy}, ${tx} ${pt.y + cy}`; }
    const dim = sel && !(s.id === sel.id || t.id === sel.id);
    const color = dim ? '#D1D5DB' : s.achieved ? '#15803D' : '#B45309';
    const marker = dim ? 'arrDim' : s.achieved ? 'arrOk' : 'arrOpen';
    paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${dim ? 1.5 : 2}" ${s.achieved ? '' : 'stroke-dasharray="6 5"'} marker-end="url(#${marker})"/>`;
  }
  const mk = (id, c) => `<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8z" fill="${c}"/></marker>`;
  const svg = svgEl(`<svg class="graph-svg" width="${W}" height="${H}" aria-hidden="true"><defs>${mk('arrOk', '#15803D')}${mk('arrOpen', '#B45309')}${mk('arrDim', '#D1D5DB')}</defs>${paths}</svg>`);

  const inner = el('div', { class: 'graph-inner', style: `width:${W}px;height:${H}px` },
    ...cols.map((c, ci) => el('div', { class: 'graph-col', style: `left:${left + ci * colW}px;width:${nodeW}px;border-color:${c.color}` }, dot(c.color, true), c.name)),
    svg,
    ...ks.map((k) => {
      const p = pos[k.id]; const s = status(k);
      return el('button', { class: 'node' + (sel?.id === k.id ? ' sel' : '') + (sel && !related.has(k.id) ? ' dim' : ''), style: `left:${p.x}px;top:${p.y}px;width:${nodeW}px;height:${nodeH}px`, onClick: () => { state.sel = state.sel === k.id ? null : k.id; render(); } },
        el('div', { class: 'meta' }, el('span', {}, TYPE_LABEL[k.type]), dot(s.color, true)),
        el('div', { class: 't' }, k.title),
        el('div', { class: 'small num', style: 'color:#4B5563' }, valueLabel(k) + (isNum(k) ? ' von ' + fmt(k.target) : '')));
    }));

  const side = el('aside', { class: 'card graph-side' });
  if (!sel) side.append(el('div', { class: 'strong' }, 'Kein Knoten gewählt'), el('div', { class: 'muted', style: 'font-size:13px' }, 'Klicke eine Kennzahl im Graphen, um ihre Voraussetzungen und Auswirkungen zu sehen.'),
    el('div', { class: 'warn-box' }, el('strong', {}, ks.filter((k) => !k.achieved && openDeps(k).length).length + ' Kennzahlen'), ' warten aktuell auf nicht erfüllte Voraussetzungen.'));
  else {
    const rel = (d) => { const s = status(d); return el('div', { class: 'rel' }, dot(s.color, true), el('span', { class: 'grow' }, d.title), el('span', { class: 'muted small' }, s.label)); };
    const deps = sel.deps.map(byId).filter(Boolean), dependents = ks.filter((k) => k.deps.includes(sel.id));
    side.append(
      el('div', { class: 'muted small strong' }, owner(sel)), el('div', { style: 'font-weight:700;font-size:17px;margin-top:-8px' }, sel.title),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, pill(status(sel)), el('span', { style: 'font-size:13px;color:#4B5563' }, valueLabel(sel) + ' / ' + targetLabel(sel))),
      el('div', {}, el('div', { class: 'sec-label' }, `Setzt voraus (${deps.length})`), el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, ...(deps.length ? deps.map(rel) : [el('span', { class: 'muted small' }, 'Keine Voraussetzungen')]))),
      el('div', {}, el('div', { class: 'sec-label' }, `Wirkt auf (${dependents.length})`), el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, ...(dependents.length ? dependents.map(rel) : [el('span', { class: 'muted small' }, 'Keine abhängigen Kennzahlen')]))),
      el('div', { style: 'display:flex;gap:8px;margin-top:4px' },
        el('button', { class: 'btn', style: 'flex:1', onClick: () => modalAchieve(sel) }, 'Ist-Erreichung'),
        el('button', { class: 'btn ghost', style: 'flex:1', onClick: () => modalHistory(sel) }, 'Historie'),
        el('button', { class: 'btn ghost', style: 'flex:1', onClick: () => modalKpiForm(sel) }, 'Bearbeiten')));
  }

  main.append(
    el('div', { class: 'head-row' },
      el('div', {}, el('div', { class: 'muted small strong' }, 'Event · ' + curEvent().name), el('h1', {}, 'Abhängigkeiten der Kennzahlen'), el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, 'Pfeile zeigen von der Voraussetzung zur abhängigen Kennzahl. Knoten anklicken für Details; Abhängigkeiten pflegst du über „Bearbeiten“.')),
      el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'width:22px;height:2px;background:#15803D;display:inline-block' }), 'Voraussetzung erfüllt'), el('span', {}, el('i', { style: 'width:22px;border-top:2px dashed #B45309;display:inline-block' }), 'Noch offen / blockiert'))),
    el('div', { class: 'graph-wrap' }, el('section', { class: 'card graph-canvas' }, inner), side)
  );
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
  setTimeout(() => $('input,select,textarea,button.on', modal)?.focus(), 0);
  return close;
}
const field = (label, input, hint, sub) => el('div', { class: 'field' }, el('label', { for: input.id }, label, sub ? el('span', {}, ' ' + sub) : null), input, hint ? el('div', { class: 'hint' }, hint) : null);
const inp = (id, attrs = {}) => el('input', { id, ...attrs });
const cancelBtn = (close) => el('button', { class: 'btn ghost', onClick: close }, 'Abbrechen');
const infoBox = (l, v) => el('div', { class: 'info-box' }, el('div', { class: 'l' }, l), el('div', { class: 'v num' }, v));

function modalValue(k) {
  const v = inp('f-value', { type: 'number', step: 'any', value: k.current });
  const note = el('textarea', { id: 'f-note', rows: 3, placeholder: 'Woher kommt der Wert? Was hat sich geändert?' });
  openModal(k.title, owner(k) + ' · Wert eingeben',
    [el('div', { class: 'two' }, infoBox('Zielwert', targetLabel(k)), infoBox('Bisheriger Ist-Wert', valueLabel(k))),
      field('Neuer Ist-Wert', v, null, `(${k.unit || 'Wert'})`),
      field('Kommentar', note, 'Erscheint in der Historie.'),
      el('div', { class: 'muted small' }, `Wird als Änderung von ${who()} protokolliert.`)],
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => act(() => api('POST', `/api/kpis/${k.id}/value`, { value: v.value, note: note.value, who: who() }), 'Wert gespeichert').then(close) }, 'Speichern')]);
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
    (close) => [cancelBtn(close), el('button', { class: 'btn', onClick: () => act(() => api('POST', `/api/kpis/${k.id}/achieve`, { achieved: form.yes, value: askNum ? form.value : undefined, achievedAt: form.date, note: note.value, who: who() }), 'Erreichung gespeichert').then(close) }, 'Erreichung speichern')]);
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
  const ownerSel = el('select', { id: 'k-owner' }, el('option', { value: '', selected: !rid }, 'Event (übergeordnet)'), ...evRessorts().map((r) => el('option', { value: r.id, selected: rid === r.id }, r.name)));
  const desc = el('textarea', { id: 'k-desc', rows: 2, placeholder: 'Optional: Was misst diese Kennzahl, woher kommen die Daten?' }, k?.description || '');
  const depsBox = el('div', { class: 'deps-list' }, ...evKpis().filter((x) => x.id !== k?.id).map((x) => el('label', {}, el('input', { type: 'checkbox', value: x.id, checked: k?.deps.includes(x.id) }), el('span', { class: 'grow' }, x.title), el('span', { class: 'muted small' }, owner(x)))));
  const numFields = el('div', { class: 'two' }, field('Zielwert', target), field('Einheit', unit));
  const curField = field(isNew ? 'Aktueller Ist-Wert' : 'Ist-Wert', current, isNew ? null : 'Zum Nachtragen bitte „Wert eingeben“ nutzen – hier nicht änderbar.');
  if (!isNew) current.disabled = true;
  const syncType = () => { const n = type.value === 'number' || type.value === 'combo'; numFields.style.display = n ? '' : 'none'; curField.style.display = n ? '' : 'none'; };
  type.addEventListener('change', syncType); syncType();
  if (!isNew) type.disabled = true;
  const payload = () => ({ title: title.value.trim(), type: type.value, target: target.value, unit: unit.value.trim(), current: current.value, deadline: deadline.value || null, ressortId: ownerSel.value || null, description: desc.value, deps: [...depsBox.querySelectorAll('input:checked')].map((c) => c.value), who: who() });
  openModal(isNew ? 'Neue Kennzahl' : k.title, isNew ? (rid ? ressort(rid).name : 'Event') + ' · anlegen' : owner(k) + ' · bearbeiten',
    [field('Bezeichnung', title),
      el('div', { class: 'two' }, field('Typ', type, isNew ? null : 'Der Typ ist nach dem Anlegen fest.'), field('Zugeordnet zu', ownerSel)),
      numFields, curField,
      field('Frist / Zieldatum', deadline),
      field('Beschreibung', desc),
      el('div', { class: 'field' }, el('label', {}, 'Abhängig von ', el('span', {}, '(Voraussetzungen)')), depsBox)],
    (close) => [
      !isNew && el('button', { class: 'btn danger left', onClick: () => confirm(`„${k.title}“ wirklich löschen? Die Historie geht verloren.`) && act(() => api('DELETE', `/api/kpis/${k.id}`), 'Kennzahl gelöscht').then(close) }, 'Löschen'),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!title.value.trim()) return alert('Bitte eine Bezeichnung angeben.'); act(() => isNew ? api('POST', '/api/kpis', { eventId: state.eventId, ...payload() }) : api('PUT', `/api/kpis/${k.id}`, payload()), isNew ? 'Kennzahl angelegt' : 'Kennzahl gespeichert').then(close); } }, isNew ? 'Anlegen' : 'Speichern')], true);
}

function modalRessortForm(r) {
  const isNew = !r;
  const name = inp('r-name', { value: r?.name || '', placeholder: 'z. B. Marketing' });
  const lead = inp('r-lead', { value: r?.lead || '', placeholder: 'Verantwortliche Person' });
  const color = inp('r-color', { type: 'color', value: r?.color || PALETTE[evRessorts().length % PALETTE.length], style: 'width:60px;padding:2px' });
  const payload = () => ({ name: name.value.trim(), lead: lead.value.trim(), color: color.value });
  openModal(isNew ? 'Neues Ressort' : r.name, isNew ? 'Ressort anlegen' : 'Ressort bearbeiten',
    [field('Name', name), field('Leitung', lead), field('Farbe', color)],
    (close) => [
      !isNew && el('button', { class: 'btn danger left', onClick: () => confirm(`„${r.name}“ und alle zugehörigen Kennzahlen löschen?`) && act(() => api('DELETE', `/api/ressorts/${r.id}`), 'Ressort gelöscht').then(() => { close(); go('overview'); }) }, 'Löschen'),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!name.value.trim()) return alert('Bitte einen Namen angeben.'); act(async () => { const res = isNew ? await api('POST', '/api/ressorts', { eventId: state.eventId, ...payload() }) : await api('PUT', `/api/ressorts/${r.id}`, payload()); if (isNew) { state.view = 'ressort'; state.ressortId = res.id; } }, isNew ? 'Ressort angelegt' : 'Ressort gespeichert').then(close); } }, isNew ? 'Anlegen' : 'Speichern')]);
}

function modalEventForm(ev) {
  const isNew = !ev;
  const name = inp('e-name', { value: ev?.name || '', placeholder: 'z. B. Summit 2027' });
  const start = inp('e-start', { type: 'date', value: ev?.startDate || '' });
  const end = inp('e-end', { type: 'date', value: ev?.endDate || '' });
  const payload = () => ({ name: name.value.trim(), startDate: start.value || null, endDate: end.value || null });
  openModal(isNew ? 'Neues Event' : ev.name, isNew ? 'Event anlegen' : 'Event bearbeiten',
    [field('Name', name), el('div', { class: 'two' }, field('Beginn', start), field('Ende', end))],
    (close) => [
      !isNew && el('button', { class: 'btn danger left', onClick: () => confirm(`„${ev.name}“ mit allen Ressorts und Kennzahlen löschen?`) && act(() => api('DELETE', `/api/events/${ev.id}`), 'Event gelöscht').then(() => { close(); go('overview'); }) }, 'Löschen'),
      cancelBtn(close),
      el('button', { class: 'btn', onClick: () => { if (!name.value.trim()) return alert('Bitte einen Namen angeben.'); act(async () => { const res = isNew ? await api('POST', '/api/events', payload()) : await api('PUT', `/api/events/${ev.id}`, payload()); if (isNew) { state.eventId = res.id; state.view = 'overview'; } }, isNew ? 'Event angelegt' : 'Event gespeichert').then(close); } }, isNew ? 'Anlegen' : 'Speichern')]);
}

// ---------- Start ----------
$('#who').value = localStorage.getItem('okr.who') || '';
$('#who').addEventListener('change', (e) => localStorage.setItem('okr.who', e.target.value));
$('#event-select').addEventListener('change', (e) => { state.eventId = e.target.value; state.sel = null; go('overview'); });
$('#btn-new-event').addEventListener('click', () => modalEventForm(null));
$('#btn-edit-event').addEventListener('click', () => curEvent() && modalEventForm(curEvent()));
$('#btn-new-ressort').addEventListener('click', () => curEvent() ? modalRessortForm(null) : alert('Bitte zuerst ein Event anlegen.'));
document.querySelectorAll('.nav[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
document.addEventListener('keydown', (e) => e.key === 'Escape' && $('#modal-root').replaceChildren());
reload().catch((e) => alert('Server nicht erreichbar: ' + e.message));
