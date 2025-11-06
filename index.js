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

  // ⚙️ botón engranaje
  gear: document.getElementById('btnGear'),
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
};

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

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

  // ⚙️ wire del engranaje (mostrar/ocultar filtros)
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

function renderMenu(container, list, key, labelFn, valueFn, opts = { multi: true, searchable: true, initials: false }) {
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
    const b = s.querySelector('.select__btn');
    b && b.setAttribute('aria-expanded', 'false');
  });
}

function clearFilters() {
  // respetar los locks
  const lock = state.locked;
  state.selected = {
    clients: [...(lock.clients || [])],
    projects: [...(lock.projects || [])],
    platforms: [],
    owners: [],
    statuses: [],
  };
  updateButtonsText();
  renderMenu(els.mProject, state.filtersData.projects, 'projects', (it) => it.name, (it) => it.id, {
    multi: true,
    searchable: true,
  });
  setBtnText(els.fProject, 'All Projects');
  scheduleRefresh();
}

/* =========================
   Data flow (grid)
   ========================= */

let refreshTimer = null;
const REFRESH_DEBOUNCE_MS = 160;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(true), REFRESH_DEBOUNCE_MS);
}

async function refresh(reset = false) {
  if (state.loading) return;
  if (reset) {
    state.cursor = null;
    state.posts = [];
  }
  showOverlay(true);
  await fetchMore(true);
  showOverlay(false);
}

async function onMore() {
  if (state.loading) return;
  showMoreLoading(true);
  await fetchMore(false);
  showMoreLoading(false);
}

async function fetchMore(replace) {
  try {
    state.loading = true;
    const params = new URLSearchParams();
    params.set('pageSize', '12');
    if (state.cursor) params.set('cursor', state.cursor);
    state.selected.clients.forEach((v) => params.append('client', v));
    state.selected.projects.forEach((v) => params.append('project', v));
    state.selected.platforms.forEach((v) => params.append('platform', v));
    state.selected.owners.forEach((v) => params.append('owner', v));
    state.selected.statuses.forEach((v) => params.append('status', v));

    const resp = await fetch(`/api/grid?${params.toString()}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'grid');

    state.cursor = json.next_cursor || null;
    const posts = (json.posts || []).map(mapPostShape);
    state.posts = replace ? posts : state.posts.concat(posts);

    renderGrid(state.posts);
    if (els.more) els.more.style.display = state.cursor ? 'inline-flex' : 'none';
  } catch (err) {
    toast('No se pudo cargar el grid.');
    if (state.posts.length === 0) els.grid.innerHTML = placeholderList(12);
  } finally {
    state.loading = false;
  }
}

/* === mapPostShape con soporte external (thumb de Drive) === */
function mapPostShape(p) {
  const assets = Array.isArray(p.assets)
    ? p.assets
    : Array.isArray(p.media)
    ? p.media
    : [];
  return {
    id: p.id,
    title: p.title || 'Untitled',
    date: p.date || null,
    owner: p.owner || null,
    platforms: p.platforms || [],
    pinned: !!p.pinned,
    copy: p.copy || '',
    media: assets.map((a) => {
      if (a.type === 'external') {
        return {
          type: 'external',
          provider: a.provider || 'link',
          url: a.url || '',
          thumb: a.thumb || '',
        };
      }
      return {
        type: a.type === 'video' ? 'video' : 'image',
        url: a.url || '',
      };
    }),
  };
}

/* =========================
   Render
   ========================= */

function renderGrid(list) {
  const cards = list.map(renderCard);
  const slots = (12 - (cards.length % 12)) % 12;
  if (list.length === 0) els.grid.innerHTML = placeholderList(12);
  else els.grid.innerHTML = cards.join('') + placeholderList(slots);
  hookCardEvents();
}

/* === renderCard con prioridad IG & pin a la derecha === */
function renderCard(p) {
  const first = p.media && p.media[0];
  const hasMulti = (p.media?.length || 0) > 1;
  const isVideo = !hasMulti && first && first.type === 'video';
  const isExternal = first && first.type === 'external';

  const ownerBadge = ownerSquare(p.owner);

  const badges = `
    <div class="card__badges">
      ${hasMulti ? `<span class="badge-ico" title="Carousel">${svgCarousel()}</span>` : ``}
      ${!hasMulti && isVideo ? `<span class="badge-ico" title="Video">${svgVideo()}</span>` : ``}
      ${p.pinned ? `<span class="badge-ico" title="Pinned">${svgPin()}</span>` : ``}
    </div>
  `;

  let mediaEl = `<div class="placeholder">No content</div>`;
  if (first) {
    if (first.type === 'video') {
      mediaEl = `<video class="card__media" preload="metadata" muted playsinline src="${escapeHtml(
        first.url
      )}"></video>`;
    } else if (isExternal) {
      if (first.provider === 'drive' && first.thumb) {
        mediaEl = `<img class="card__media" alt="" src="${escapeHtml(first.thumb)}" />`;
      } else if (first.provider !== 'link') {
        const label = first.provider === 'canva' ? 'Canva' : (first.provider === 'drive' ? 'Drive' : 'Link');
        mediaEl = `<div class="card__external">${label}</div>`;
      } else {
        mediaEl = `<div class="card__external">Link</div>`;
      }
    } else {
      mediaEl = `<img class="card__media" alt="" src="${escapeHtml(first.url)}" />`;
    }
  }

  const date = p.date ? fmtDate(p.date) : '';

  return `
    <div class="card" data-id="${p.id}">
      ${ownerBadge}
      ${badges}
      ${mediaEl}
      <div class="card__hover">
        <div class="card__title">${escapeHtml(p.title)}</div>
        <div class="card__date">${date}</div>
      </div>
    </div>
  `;
}

function ownerSquare(name) {
  if (!name) return '';
  const col = ownerColor(name);
  return `<div class="card__owner" style="background:${col}" title="${escapeHtml(
    name
  )}">${initials(name)}</div>`;
}

function placeholderList(n) {
  if (!n) return '';
  return Array.from({ length: n }, () => `<div class="placeholder">No content</div>`).join('');
}

/* =========================
   Card events
   ========================= */

function hookCardEvents() {
  document.querySelectorAll('.card').forEach((card) => {
    const vid = card.querySelector('video.card__media');
    if (vid) {
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', '');
      vid.setAttribute('muted', '');
      card.addEventListener('mouseenter', () => {
        vid.play().catch(() => {});
      });
      card.addEventListener('mouseleave', () => {
        try {
          vid.pause();
          vid.currentTime = 0;
        } catch {}
      });
    }
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

/* =========================
   Modal
   ========================= */

function wireModal() {
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (!state.modal.open) return;
    if (e.key === 'ArrowLeft') moveModal(-1);
    if (e.key === 'ArrowRight') moveModal(+1);
  });

  // swipe
  let sx = 0;
  els.vStage.addEventListener(
    'touchstart',
    (e) => {
      sx = e.touches[0].clientX;
    },
    { passive: true }
  );
  els.vStage.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) moveModal(dx < 0 ? +1 : -1);
    },
    { passive: true }
  );

  els.vPrev.addEventListener('click', () => moveModal(-1));
  els.vNext.addEventListener('click', () => moveModal(+1));
}

function openModal(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return;

  state.modal.open = true;
  state.modal.assets = post.media && post.media.length ? post.media : [{ type: 'image', url: '' }];
  state.modal.index = 0;
  state.modal.lastFocus = document.activeElement;

  const copy = (post.copy || '').trim();
  els.vCopy.textContent = copy;
  els.vCopy.hidden = !copy;

  renderModal();
  document.body.style.overflow = 'hidden';
  els.modal.classList.add('is-open');
  els.vStage.setAttribute('tabindex', '0');
  els.vStage.focus();
}

function closeModal() {
  state.modal.open = false;
  els.modal.classList.remove('is-open');
  document.body.style.overflow = '';
  els.vStage.innerHTML = '';
  els.vDots.innerHTML = '';
  els.vCopy.textContent = '';
  if (state.modal.lastFocus && state.modal.lastFocus.focus) state.modal.lastFocus.focus();
}

function moveModal(step) {
  const tot = state.modal.assets.length;
  state.modal.index = (state.modal.index + step + tot) % tot;
  renderModal();
}

/* === renderModal: video sin autoplay, pero con hover play === */
function renderModal() {
  const a = state.modal.assets[state.modal.index];

  if (a.type === 'video') {
    // SIN autoplay ni muted: se abre normal, con audio, y se reproduce sólo al hover
    els.vStage.innerHTML = `<video class="viewer__video" controls playsinline src="${escapeHtml(
      a.url
    )}" style="max-width:100%;max-height:60vh;object-fit:contain"></video>`;

    const vid = els.vStage.querySelector('.viewer__video');
    if (vid) {
      vid.addEventListener('mouseenter', () => {
        vid.play().catch(() => {});
      });
      vid.addEventListener('mouseleave', () => {
        try {
          vid.pause();
        } catch {}
      });
    }
  } else if (a.type === 'external') {
    if (a.provider === 'canva') {
      els.vStage.innerHTML = `
        <div style="width:100%;display:flex;flex-direction:column;gap:8px;align-items:center">
          <iframe src="${escapeHtml(
            a.url
          )}" style="width:100%;min-height:60vh;border:0;" allow="autoplay; encrypted-media"></iframe>
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="btn" style="text-decoration:none">Open in Canva</a>
        </div>`;
    } else {
      els.vStage.innerHTML = `<iframe src="${escapeHtml(
        a.url
      )}" style="width:100%;min-height:60vh;border:0;" allow="autoplay; encrypted-media"></iframe>`;
    }
  } else {
    els.vStage.innerHTML = `<img alt="" src="${escapeHtml(
      a.url
    )}" style="max-width:100%;max-height:60vh;object-fit:contain" />`;
  }

  const tot = state.modal.assets.length;
  const cur = state.modal.index + 1;
  const dots = Array.from({ length: tot }, (_, i) => (i === state.modal.index ? '●' : '○')).join(' ');
  els.vDots.textContent = tot > 1 ? `${cur}/${tot}  ${dots}` : '';
}

/* =========================
   URL sync (lock)
   ========================= */

function applyInitialURLFilters() {
  const url = new URL(window.location.href);
  const pClient = url.searchParams.getAll('client');
  const pProject = url.searchParams.getAll('project');
  const pOwner = url.searchParams.getAll('owner');
  const pPlatform = url.searchParams.getAll('platform');
  const pStatus = url.searchParams.getAll('status');

  // guardamos cuáles son los que vienen "fijados" desde el portal
  state.locked.clients = [...pClient];
  state.locked.projects = [...pProject];

  // los ponemos en el state seleccionado
  state.selected.clients = [...pClient];
  state.selected.projects = [...pProject];
  state.selected.owners = [...pOwner];
  state.selected.platforms = [...pPlatform];
  state.selected.statuses = [...pStatus];

  updateButtonsText();

  // si viene client → filtrar los projects que se muestran
  if (pClient.length) filterProjectsForClients();

  // --- LOCK VISUAL: deshabilita selecciones que llegaron por URL ---
  if (state.locked.clients.length && els.fClient) {
    els.fClient.setAttribute('aria-disabled', 'true');
  }
  if (state.locked.projects.length && els.fProject) {
    els.fProject.setAttribute('aria-disabled', 'true');
  }
}

function syncURLWithFilters() {
  const url = new URL(window.location.href);

  url.searchParams.delete('client');
  url.searchParams.delete('project');
  url.searchParams.delete('platform');
  url.searchParams.delete('owner');
  url.searchParams.delete('status');

  state.selected.clients.forEach((v) => url.searchParams.append('client', v));
  state.selected.projects.forEach((v) => url.searchParams.append('project', v));
  state.selected.platforms.forEach((v) => url.searchParams.append('platform', v));
  state.selected.owners.forEach((v) => url.searchParams.append('owner', v));
  state.selected.statuses.forEach((v) => url.searchParams.append('status', v));

  window.history.replaceState(null, '', url.toString());
}

/* =========================
   UX helpers
   ========================= */

function showOverlay(v) {
  if (els.overlay) els.overlay.hidden = !v;
}
function showMoreLoading(v) {
  if (!els.more) return;
  els.more.disabled = v;
  els.more.textContent = v ? 'Loading…' : 'Load more';
}
function toast(msg, ms = 2500) {
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  els.toasts.appendChild(div);
  setTimeout(() => div.remove(), ms);
}
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const m = MONTHS[d.getMonth()],
    dd = String(d.getDate()).padStart(2, '0');
  return `${m} ${dd}`;
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function initials(name) {
  const n = (name || '').trim();
  if (!n) return '??';
  const p = n.split(/\s+/);
  const a = (p[0] || '')[0] || '';
  const b = (p[1] || '')[0] || '';
  return (a + b || a).toUpperCase();
}
const OWNER_COLORS = [
  '#10B981',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#3B82F6',
  '#EF4444',
  '#FCD34D',
  '#14B8A6',
  '#A855F7',
  '#22C55E',
];
function ownerColor(name) {
  const s = (name || '').trim();
  if (!s) return '#6B7280';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return OWNER_COLORS[Math.abs(h) % OWNER_COLORS.length];
}

/* ----- Icons minimal blancos ----- */
function svgPin() {
  return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.5 2H5.5V3.5H6.5V10L4.5 12V13.5H9.25V18.5H10.75V13.5H15.5V12L13.5 10V3.5H14.5V2Z" fill="white"/>
    </svg>
  `;
}

function svgVideo() {
  return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 5V15L15 10L7 5Z" fill="white"/>
    </svg>
  `;
}

function svgCarousel() {
  return `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6" width="9" height="9" rx="2" stroke="white" stroke-width="1.4" fill="none"/>
      <rect x="6" y="4" width="9" height="9" rx="2" stroke="white" stroke-width="1.1" fill="none" opacity="0.75"/>
      <rect x="8" y="2" width="9" height="9" rx="2" stroke="white" stroke-width="0.9" fill="none" opacity="0.5"/>
    </svg>
  `;
}

/* =========================
   Filters toggle (gear)
   ========================= */

function onToggleFilters() {
  if (!els.filtersWrap || !els.gear) return;
  const hidden = els.filtersWrap.classList.toggle('filters--hidden');
  els.gear.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  els.gear.title = hidden ? 'Show filters' : 'Hide filters';
}
