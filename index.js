/* =========================
   Frontend logic (IG Grid)
   ========================= */

/* ----- DOM refs ----- */
const els = {
  grid: document.getElementById('grid'),
  more: document.getElementById('btnMore'),
  refresh: document.getElementById('btnRefresh'),
  clear: document.getElementById('btnClear'),
  badgeCount: document.getElementById('badgeCount'),
  overlay: document.getElementById('overlay'),
  toasts: document.getElementById('toasts'),

  filtersWrap: document.getElementById('filters'),
  fClient: document.getElementById('fClient'),
  fProject: document.getElementById('fProject'),
  fPlatform: document.getElementById('fPlatform'),
  fOwner: document.getElementById('fOwner'),
  fStatus: document.getElementById('fStatus'),
  mClient: document.getElementById('mClient'),
  mProject: document.getElementById('mProject'),
  mPlatform: document.getElementById('mPlatform'),
  mOwner: document.getElementById('mOwner'),
  mStatus: document.getElementById('mStatus'),

  modal: document.getElementById('modal'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalClose: document.getElementById('modalClose'),
  vStage: document.getElementById('vStage'),
  vPrev: document.getElementById('vPrev'),
  vNext: document.getElementById('vNext'),
  vDots: document.getElementById('vDots'),
  vCopy: document.getElementById('vCopy'),

  // botón texto para filtros
  gear: document.getElementById('btnFiltersToggle'),
};

/* ----- State ----- */
const state = {
  filtersData: null,
  selected: { clients: [], projects: [], platforms: [], owners: [], statuses: [] },
  cursor: null,
  posts: [],
  loading: false,
  modal: { open: false, assets: [], index: 0, lastFocus: null },

  // lock desde URL (?client=...&project=...)
  locked: { clients: [], projects: [] },

  // mostrar/ocultar iniciales en cards
  showOwners: false,
};

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* Estado de drag (reordenar cards solo en frontend) */
let dragSrcIndex = null;
let isDraggingCard = false;

/* ----- Init guards (evita UI muerta) ----- */
(function guardRequired() {
  const required = [
    'grid',
    'btnMore',
    'btnRefresh',
    'btnClear',
    'badgeCount',
    'overlay',
    'toasts',
    'filters',
    'fClient',
    'fProject',
    'fPlatform',
    'fOwner',
    'fStatus',
    'mClient',
    'mProject',
    'mPlatform',
    'mOwner',
    'mStatus',
    'modal',
    'modalBackdrop',
    'modalClose',
    'vStage',
    'vPrev',
    'vNext',
    'vDots',
    'vCopy',
    // si falta el gear no rompemos nada, solo avisamos
  ];
  const missing = required.filter((id) => !document.getElementById(id));
  if (missing.length) {
    console.error('Faltan elementos en HTML:', missing);
  }
})();

/* ===== Boot ===== */
init();

async function init() {
  wireMenus();
  wireModal();

  els.more?.addEventListener('click', onMore);
  els.refresh?.addEventListener('click', () => refresh(true));
  els.clear?.addEventListener('click', clearFilters);

  // botón mostrar/ocultar filtros
  if (els.gear && els.filtersWrap) {
    els.gear.addEventListener('click', onToggleFilters);
  }

  // placeholders iniciales
  if (els.grid) els.grid.innerHTML = placeholderList(12);

  // 1) leemos filtros disponibles
  await loadFilters();

  // 2) aplicamos filtros que vengan desde la URL
  applyInitialURLFilters();

  // 3) primer refresh
  await refresh(true);
}

/* =========================
   Filters UI
   ========================= */

function wireMenus() {
  // abrir/cerrar
  document.querySelectorAll('.select').forEach((sel) => {
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', (e) => {
      // si está “lockeado” no se abre
      if (btn.getAttribute('aria-disabled') === 'true') return;
      e.stopPropagation();
      const open = sel.classList.contains('open');
      document.querySelectorAll('.select').forEach((s) => s.classList.remove('open'));
      if (!open) {
        sel.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.select')) closeAllSelects();
  });
}

async function loadFilters() {
  try {
    showOverlay(true);
    const resp = await fetch('/api/filters');
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'filters');

    state.filtersData = normalizeFilters(json);

    renderMenu(els.mClient, state.filtersData.clients, 'clients', (it) => it.name, (it) => it.id, {
      multi: true,
      searchable: true,
    });
    renderMenu(els.mProject, state.filtersData.projects, 'projects', (it) => it.name, (it) => it.id, {
      multi: true,
      searchable: true,
    });
    renderMenu(
      els.mPlatform,
      state.filtersData.platforms,
      'platforms',
      (it) => it,
      (it) => it,
      { multi: true, searchable: true }
    );
    renderMenu(els.mOwner, state.filtersData.owners, 'owners', (it) => it.name, (it) => it.id, {
      multi: true,
      searchable: true,
      initials: true,
    });
    renderMenu(
      els.mStatus,
      state.filtersData.statuses,
      'statuses',
      (it) => it.name,
      (it) => it.name,
      { multi: false, searchable: true }
    );

    setBtnText(els.fClient, 'All Clients');
    setBtnText(els.fProject, 'All Projects');
    setBtnText(els.fPlatform, 'All Platforms');
    setOwnerBtnLabel();
    setBtnText(els.fStatus, 'All Status');
  } catch (err) {
    toast('No se pudieron cargar los filtros.');
    state.filtersData = { clients: [], projects: [], platforms: [], owners: [], statuses: [] };
  } finally {
    showOverlay(false);
  }
}

function normalizeFilters(json) {
  const clients = (json.clients || []).map((c) => ({
    id: c.id || c.value || c.name,
    name: c.name || String(c.value || c.id || '') || 'Untitled',
  }));
  const projects = (json.projects || []).map((p) => ({
    id: p.id || p.value || p.name,
    name: p.name || String(p.value || p.id || '') || 'Untitled',
    clientIds: Array.isArray(p.clientIds) ? p.clientIds : [],
  }));
  const platforms = (json.platforms || [])
    .map((p) => (typeof p === 'string' ? p : p.name || ''))
    .filter(Boolean);
  const owners = (json.owners || []).map((o) => ({
    id: o.id || o.value,
    name: o.name || String(o.value || '') || 'Unknown',
  }));
  const statuses = (json.statuses || [])
    .map((s) => ({ name: s.name || String(s.value || '') }))
    .filter((s) => s.name);
  return { clients, projects, platforms, owners, statuses };
}

function renderMenu(
  container,
  list,
  key,
  labelFn,
  valueFn,
  opts = { multi: true, searchable: true, initials: false }
) {
  container.innerHTML = '';

  // search box
  if (opts.searchable) {
    const sb = document.createElement('div');
    sb.className = 'search';
    const input = document.createElement('input');
    input.placeholder = 'Search...';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = '✕';
    clear.title = 'Clear';
    sb.appendChild(input);
    sb.appendChild(clear);
    container.appendChild(sb);
    clear.addEventListener('click', () => {
      input.value = '';
      renderList('');
      input.focus();
    });
    input.addEventListener('input', () => renderList(input.value));
  }

  const box = document.createElement('div');
  container.appendChild(box);

  // 🔁 Toggle "Show owners / Hide owners" dentro del dropdown de owners
  let ownersToggleRow = null;
  if (key === 'owners') {
    ownersToggleRow = document.createElement('div');
    ownersToggleRow.className = 'option';
    ownersToggleRow.setAttribute('data-owner-toggle', '1');
    ownersToggleRow.textContent = state.showOwners ? 'Hide owners' : 'Show owners';
    ownersToggleRow.addEventListener('click', (e) => {
      e.stopPropagation();
      state.showOwners = !state.showOwners;
      ownersToggleRow.textContent = state.showOwners ? 'Hide owners' : 'Show owners';
      renderGrid(state.posts);
    });
    // va antes de la lista real
    container.insertBefore(ownersToggleRow, box);
  }

  const renderList = (term = '') => {
    box.innerHTML = '';
    const lower = term.toLowerCase();
    list
      .filter((it) => (labelFn(it) || '').toLowerCase().includes(lower))
      .forEach((it) => {
        const val = valueFn(it);
        const lbl = labelFn(it) || 'Untitled';
        const div = document.createElement('div');
        div.className = 'option';
        div.setAttribute('role', 'option');
        div.setAttribute('aria-selected', isSelected(key, val) ? 'true' : 'false');

        if (opts.initials) {
          const badge = document.createElement('span');
          badge.className = 'owner-chip';
          badge.textContent = initials(lbl);
          badge.style.cssText =
            'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;margin-right:6px;background:' +
            ownerColor(lbl) +
            ';color:#fff;font-size:10px;font-weight:700;';
          div.appendChild(badge);
        }

        const txt = document.createElement('span');
        txt.textContent = lbl;
        div.appendChild(txt);

        if (isSelected(key, val)) div.classList.add('selected');

        div.addEventListener('click', (e) => {
          e.stopPropagation();
          if (key === 'statuses') {
            state.selected.statuses = [val];
            closeAllSelects();
            setBtnText(els.fStatus, lbl);
            scheduleRefresh();
          } else {
            toggleSelect(key, val);
            highlightSelection(container, key, valueFn, labelFn);
            updateButtonsText();
            if (key === 'clients') filterProjectsForClients();
            scheduleRefresh();
          }
        });

        box.appendChild(div);
      });
  };

  renderList('');
}

function highlightSelection(container, key, valueFn, labelFn) {
  container.querySelectorAll('.option').forEach((el) => {
    // ignorar la fila especial de toggle owners
    if (el.getAttribute('data-owner-toggle') === '1') return;

    const name = el.querySelector('span:last-child')?.textContent || '';
    const list = state.filtersData[key] || [];
    const it = list.find((x) => (labelFn(x) || '') === name);
    const val = it ? valueFn(it) : name;
    const sel = isSelected(key, val);
    el.classList.toggle('selected', sel);
    el.setAttribute('aria-selected', sel ? 'true' : 'false');
  });
}

function isSelected(key, val) {
  return state.selected[key].includes(val);
}

function toggleSelect(key, val) {
  const arr = state.selected[key];
  const ix = arr.indexOf(val);
  if (ix >= 0) arr.splice(ix, 1);
  else arr.push(val);
}

function filterProjectsForClients() {
  const all = state.filtersData.projects;
  const clients = state.selected.clients;
  let show = all;
  if (clients.length) {
    show = all.filter((p) => p.clientIds && p.clientIds.some((id) => clients.includes(id)));
  }
  renderMenu(els.mProject, show, 'projects', (it) => it.name, (it) => it.id, {
    multi: true,
    searchable: true,
  });
  setBtnText(els.fProject, 'All Projects');
  state.selected.projects = [];
}

function updateButtonsText() {
  setBtnText(
    els.fClient,
    state.selected.clients.length ? `${state.selected.clients.length} selected` : 'All Clients'
  );
  setBtnText(
    els.fProject,
    state.selected.projects.length ? `${state.selected.projects.length} selected` : 'All Projects'
  );
  setBtnText(
    els.fPlatform,
    state.selected.platforms.length ? `${state.selected.platforms.length} selected` : 'All Platforms'
  );
  setOwnerBtnLabel();
  setBtnText(els.fStatus, state.selected.statuses.length ? state.selected.statuses[0] : 'All Status');

  const active =
    state.selected.clients.length +
    state.selected.projects.length +
    state.selected.platforms.length +
    state.selected.owners.length +
    state.selected.statuses.length;
  if (els.clear) els.clear.disabled = active === 0;
  if (els.badgeCount) {
    els.badgeCount.textContent = String(active);
    els.badgeCount.hidden = active === 0;
  }

  // cada vez que cambian filtros → reflejar en URL
  syncURLWithFilters();
}

function setOwnerBtnLabel() {
  if (!state.selected.owners.length) {
    setBtnText(els.fOwner, 'All Owners');
    els.fOwner.title = 'All Owners';
    return;
  }
  const names = state.selected.owners.map(
    (id) => state.filtersData.owners.find((o) => o.id === id)?.name || 'Unknown'
  );
  const chosen = names.slice(0, 2);
  const more = names.length - chosen.length;
  const label = more > 0 ? `${chosen.join(', ')} +${more}` : chosen.join(', ');
  setBtnText(els.fOwner, label);
  els.fOwner.title = names.join(', ');
}

function setBtnText(btn, txt) {
  if (btn) btn.textContent = txt;
}

function closeAllSelects() {
  document.querySelectorAll('.select').forEach((s) => {
    s.classList.remove('open');
    const b = s.querySelector('.select__
