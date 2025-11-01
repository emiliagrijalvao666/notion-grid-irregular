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
};

/* ----- State ----- */
const state = {
  filtersData: null,
  selected: { clients:[], projects:[], platforms:[], owners:[], statuses:[] },
  cursor: null,
  posts: [],
  loading: false,
  modal: { open:false, assets:[], index:0, lastFocus:null },
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/* ----- Init guards (evita UI muerta) ----- */
(function guardRequired(){
  const required = [
    'grid','btnMore','btnRefresh','btnClear','badgeCount','overlay','toasts','filters',
    'fClient','fProject','fPlatform','fOwner','fStatus','mClient','mProject','mPlatform','mOwner','mStatus',
    'modal','modalBackdrop','modalClose','vStage','vPrev','vNext','vDots','vCopy'
  ];
  const missing = required.filter(id => !document.getElementById(id));
  if (missing.length){ console.error('Faltan elementos en HTML:', missing); }
})();

/* ===== Boot ===== */
init();

async function init(){
  wireMenus();
  wireModal();

  els.more?.addEventListener('click', onMore);
  els.refresh?.addEventListener('click', ()=>refresh(true));
  els.clear?.addEventListener('click', clearFilters);

  // placeholders iniciales
  if (els.grid) els.grid.innerHTML = placeholderList(12);

  await loadFilters();
  await refresh(true);
}

/* =========================
   Filters UI
   ========================= */

function wireMenus(){
  // abrir/cerrar
  document.querySelectorAll('.select').forEach(sel=>{
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const open = sel.classList.contains('open');
      document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
      if(!open){ sel.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
      else     { btn.setAttribute('aria-expanded','false'); }
    });
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.select')) closeAllSelects();
  });
}

async function loadFilters(){
  try{
    showOverlay(true);
    const resp = await fetch('/api/filters');
    const json = await resp.json();
    if(!json.ok) throw new Error(json.error||'filters');

    state.filtersData = normalizeFilters(json);

    // ⚠️ Etiqueta SIEMPRE con .name; valor con .id (o string)
    renderMenu(els.mClient,   state.filtersData.clients,   'clients',   it=>it.name, it=>it.id,    {multi:true,  searchable:true});
    renderMenu(els.mProject,  state.filtersData.projects,  'projects',  it=>it.name, it=>it.id,    {multi:true,  searchable:true});
    renderMenu(els.mPlatform, state.filtersData.platforms, 'platforms', it=>it,      it=>it,       {multi:true,  searchable:true});
    renderMenu(els.mOwner,    state.filtersData.owners,    'owners',    it=>it.name, it=>it.id,    {multi:true,  searchable:true, initials:true});
    renderMenu(els.mStatus,   state.filtersData.statuses,  'statuses',  it=>it.name, it=>it.name,  {multi:false, searchable:true});

    setBtnText(els.fClient, "All Clients");
    setBtnText(els.fProject, "All Projects");
    setBtnText(els.fPlatform, "All Platforms");
    setOwnerBtnLabel();
    setBtnText(els.fStatus, "All Status");
  }catch(err){
    toast('No se pudieron cargar los filtros.');
    state.filtersData = {clients:[],projects:[],platforms:[],owners:[],statuses:[]};
  }finally{
    showOverlay(false);
  }
}

/* —— Normaliza respuesta de /api/filters para evitar UUID como label —— */
function normalizeFilters(json){
  const cleanName = (raw, fallback='Untitled')=>{
    if (!raw) return fallback;
    const s = String(raw).trim();
    // si parece UUID (contiene 3+ guiones), ignóralo como nombre visible
    const isUuidish = (s.match(/-/g)||[]).length >= 3;
    return isUuidish ? fallback : s;
  };

  const clients   = (json.clients||[]).map(c => ({
    id: c.id || c.value || c.name,
    name: cleanName(c.name)
  }));

  const projects  = (json.projects||[]).map(p => ({
    id: p.id || p.value || p.name,
    name: cleanName(p.name),
    clientIds: Array.isArray(p.clientIds) ? p.clientIds : []
  }));

  const platforms = (json.platforms||[])
    .map(p => (typeof p==='string' ? p : (p.name||'')))
    .filter(Boolean);

  // owners deben usar ID (people.contains) pero mostrar nombre
  const owners    = (json.owners||[]).map(o => ({
    id: o.id || o.value,
    name: cleanName(o.name, 'Unknown')
  }));

  const statuses  = (json.statuses||[])
    .map(s => ({ name: cleanName(s.name) }))
    .filter(s=>s.name);

  return { clients, projects, platforms, owners, statuses };
}

function renderMenu(container, list, key, labelFn, valueFn, opts={multi:true, searchable:true, initials:false}){
  container.innerHTML = '';

  // search box
  if (opts.searchable){
    const sb = document.createElement('div');
    sb.className = 'search';
    const input = document.createElement('input');
    input.placeholder = 'Search...';
    const clear = document.createElement('button');
    clear.type='button'; clear.textContent='✕'; clear.title='Clear';
    sb.appendChild(input); sb.appendChild(clear);
    container.appendChild(sb);
    clear.addEventListener('click', ()=>{ input.value=''; renderList(''); input.focus(); });
    input.addEventListener('input', ()=> renderList(input.value));
  }

  const box = document.createElement('div');
  container.appendChild(box);

  const renderList = (term='')=>{
    box.innerHTML = '';
    const lower = term.toLowerCase();
    list
      .filter(it => (labelFn(it)||'').toLowerCase().includes(lower))
      .forEach(it=>{
        const val = valueFn(it);
        const lbl = labelFn(it) || 'Untitled';
        const div = document.createElement('div');
        div.className = 'option';
        div.setAttribute('role','option');
        div.setAttribute('aria-selected', isSelected(key,val) ? 'true':'false');

        // owners con chip de iniciales
        if (opts.initials){
          const badge = document.createElement('span');
          badge.className='owner-chip';
          badge.textContent = initials(lbl);
          badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;margin-right:6px;background:'+ownerColor(lbl)+';color:#fff;font-size:10px;font-weight:700;';
          div.appendChild(badge);
        }

        const txt = document.createElement('span');
        txt.textContent = lbl;
        div.appendChild(txt);

        if (isSelected(key,val)) div.classList.add('selected');

        div.addEventListener('click', (e)=>{
          e.stopPropagation();
          if (key==='statuses'){ // single-select
            state.selected.statuses = [val];
            closeAllSelects();
            setBtnText(els.fStatus, lbl);
            scheduleRefresh();
          } else {
            toggleSelect(key, val);
            highlightSelection(container, key, valueFn, labelFn);
            updateButtonsText();
            if (key==='clients') filterProjectsForClients();
            scheduleRefresh();
          }
        });

        box.appendChild(div);
      });
  };

  renderList('');
}

function highlightSelection(container, key, valueFn, labelFn){
  container.querySelectorAll('.option').forEach(el=>{
    const name = el.querySelector('span:last-child')?.textContent || '';
    const list = state.filtersData[key] || [];
    const it   = list.find(x => (labelFn(x)||'')===name);
    const val  = it ? valueFn(it) : name;
    const sel  = isSelected(key,val);
    el.classList.toggle('selected', sel);
    el.setAttribute('aria-selected', sel?'true':'false');
  });
}

function isSelected(key, val){ return state.selected[key].includes(val); }

function toggleSelect(key, val){
  const arr = state.selected[key];
  const ix = arr.indexOf(val);
  if (ix>=0) arr.splice(ix,1); else arr.push(val);
}

function filterProjectsForClients(){
  const all = state.filtersData.projects;
  const clients = state.selected.clients;
  let show = all;
  if (clients.length){
    show = all.filter(p => p.clientIds && p.clientIds.some(id => clients.includes(id)));
  }
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
  setBtnText(els.fProject, 'All Projects');
  state.selected.projects = [];
}

function updateButtonsText(){
  setBtnText(els.fClient,   state.selected.clients.length   ? `${state.selected.clients.length} selected`   : 'All Clients');
  setBtnText(els.fProject,  state.selected.projects.length  ? `${state.selected.projects.length} selected`  : 'All Projects');
  setBtnText(els.fPlatform, state.selected.platforms.length ? `${state.selected.platforms.length} selected` : 'All Platforms');
  setOwnerBtnLabel();
  setBtnText(els.fStatus,   state.selected.statuses.length  ? state.selected.statuses[0] : 'All Status');

  const active = state.selected.clients.length + state.selected.projects.length + state.selected.platforms.length + state.selected.owners.length + state.selected.statuses.length;
  if (els.clear) els.clear.disabled = active===0;
  if (els.badgeCount){
    els.badgeCount.textContent = String(active);
    els.badgeCount.hidden = active===0;
  }
}

function setOwnerBtnLabel(){
  if (!state.selected.owners.length){
    setBtnText(els.fOwner,'All Owners'); els.fOwner.title='All Owners'; return;
  }
  // map IDs -> names para la etiqueta
  const names = state.selected.owners
    .map(id => (state.filtersData.owners.find(o=>o.id===id)?.name) || 'Unknown');
  const chosen = names.slice(0,2);
  const more   = names.length - chosen.length;
  const label  = more>0 ? `${chosen.join(', ')} +${more}` : chosen.join(', ');
  setBtnText(els.fOwner, label);
  els.fOwner.title = names.join(', ');
}

function setBtnText(btn, txt){ if(btn) btn.textContent = txt; }

function closeAllSelects(){
  document.querySelectorAll('.select').forEach(s=>{
    s.classList.remove('open');
    const b = s.querySelector('.select__btn'); b && b.setAttribute('aria-expanded','false');
  });
}

function clearFilters(){
  state.selected = { clients:[], projects:[], platforms:[], owners:[], statuses:[] };
  updateButtonsText();
  renderMenu(els.mProject, state.filtersData.projects, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
  setBtnText(els.fProject, 'All Projects');
  scheduleRefresh();
}

/* =========================
   Data flow (grid)
   ========================= */

let refreshTimer = null;
const REFRESH_DEBOUNCE_MS = 160;
function scheduleRefresh(){ clearTimeout(refreshTimer); refreshTimer = setTimeout(()=>refresh(true), REFRESH_DEBOUNCE_MS); }

async function refresh(reset=false){
  if (state.loading) return;
  if (reset){ state.cursor=null; state.posts=[]; }
  showOverlay(true);
  await fetchMore(true);
  showOverlay(false);
}

async function onMore(){
  if (state.loading) return;
  showMoreLoading(true);
  await fetchMore(false);
  showMoreLoading(false);
}

async function fetchMore(replace){
  try{
    state.loading = true;
    const params = new URLSearchParams();
    params.set('pageSize','12');
    if (state.cursor) params.set('cursor', state.cursor);
    state.selected.clients.forEach(v=>params.append('client', v));
    state.selected.projects.forEach(v=>params.append('project', v));
    state.selected.platforms.forEach(v=>params.append('platform', v));
    state.selected.owners.forEach(v=>params.append('owner', v));     // IDs
    state.selected.statuses.forEach(v=>params.append('status', v));  // single

    const resp = await fetch(`/api/grid?${params.toString()}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error||'grid');

    state.cursor = json.next_cursor || null;
    const posts = (json.posts||[]).map(mapPostShape);
    state.posts = replace ? posts : state.posts.concat(posts);

    renderGrid(state.posts);
    if (els.more) els.more.style.display = state.cursor ? 'inline-flex' : 'none';
  }catch(err){
    toast('No se pudo cargar el grid.');
    if (state.posts.length===0) els.grid.innerHTML = placeholderList(12);
  }finally{
    state.loading = false;
  }
}

function mapPostShape(p){
  const assets = Array.isArray(p.assets) ? p.assets : Array.isArray(p.media) ? p.media : [];
  return {
    id: p.id,
    title: p.title || 'Untitled',
    date: p.date || null,
    owner: p.owner || null,
    platforms: p.platforms || [],
    pinned: !!p.pinned,
    copy: p.copy || '',
    media: assets.map(a => ({ type: a.type==='video'?'video':'image', url: a.url||'' }))
  };
}

/* =========================
   Render
   ========================= */

function renderGrid(list){
  const cards = list.map(renderCard);
  const slots = (12 - (cards.length % 12)) % 12;
  if (list.length===0) els.grid.innerHTML = placeholderList(12);
  else els.grid.innerHTML = cards.join('') + placeholderList(slots);
  hookCardEvents();
}

function renderCard(p){
  const first = p.media && p.media[0];
  const isVideo = first && first.type==='video';
  const hasMulti = (p.media?.length||0) > 1;

  const ownerBadge = ownerSquare(p.owner);

  const badges = `
    <div class="card__badges">
      ${p.pinned ? `<span class="badge-ico" title="Pinned">${svgPin()}</span>` : ``}
      ${isVideo   ? `<span class="badge-ico" title="Video">${svgVideo()}</span>` : ``}
      ${hasMulti  ? `<span class="badge-ico" title="Carousel">${svgCarousel()}</span>` : ``}
      ${hasMulti  ? `<span class="badge-ico badge-ico__count" title="Items">${p.media.length}</span>` : ``}
    </div>
  `;

  const mediaEl = first
    ? (isVideo
        ? `<video class="card__media" preload="metadata" muted playsinline src="${escapeHtml(first.url)}"></video>`
        : `<img class="card__media" alt="" src="${escapeHtml(first.url)}" />`)
    : `<div class="placeholder">No content</div>`;

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

function ownerSquare(name){
  if (!name) return '';
  const col = ownerColor(name);
  return `<div class="card__owner" style="background:${col}" title="${escapeHtml(name)}">${initials(name)}</div>`;
}

function placeholderList(n){
  if (!n) return '';
  return Array.from({length:n},()=>`<div class="placeholder">No content</div>`).join('');
}

/* =========================
   Card events
   ========================= */

function hookCardEvents(){
  document.querySelectorAll('.card').forEach(card=>{
    const vid = card.querySelector('video.card__media');
    if (vid){
      vid.muted = true; vid.playsInline = true; vid.setAttribute('playsinline',''); vid.setAttribute('muted','');
      card.addEventListener('mouseenter', ()=>{ vid.play().catch(()=>{}); });
      card.addEventListener('mouseleave', ()=>{ try{ vid.pause(); vid.currentTime = 0; }catch{} });
    }
    card.addEventListener('click', ()=>openModal(card.dataset.id));
  });
}

/* =========================
   Modal
   ========================= */

function wireModal(){
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', e=>{
    if (e.key==='Escape') closeModal();
    if (!state.modal.open) return;
    if (e.key==='ArrowLeft')  moveModal(-1);
    if (e.key==='ArrowRight') moveModal(+1);
  });

  // swipe
  let sx=0;
  els.vStage.addEventListener('touchstart', e=>{ sx = e.touches[0].clientX; }, {passive:true});
  els.vStage.addEventListener('touchend', e=>{
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx)>40) moveModal(dx<0?+1:-1);
  }, {passive:true});

  els.vPrev.addEventListener('click', ()=>moveModal(-1));
  els.vNext.addEventListener('click', ()=>moveModal(+1));
}

function openModal(id){
  const post = state.posts.find(p=>p.id===id);
  if (!post) return;

  state.modal.open = true;
  state.modal.assets = post.media && post.media.length ? post.media : [{type:'image', url:''}];
  state.modal.index = 0;
  state.modal.lastFocus = document.activeElement;

  const copy = (post.copy||'').trim();
  els.vCopy.textContent = copy;
  els.vCopy.hidden = !copy;

  renderModal();
  document.body.style.overflow = 'hidden';
  els.modal.classList.add('is-open');
  els.vStage.setAttribute('tabindex','0');
  els.vStage.focus();
}

function closeModal(){
  state.modal.open = false;
  els.modal.classList.remove('is-open');
  document.body.style.overflow = '';
  els.vStage.innerHTML = '';
  els.vDots.innerHTML = '';
  els.vCopy.textContent = '';
  if (state.modal.lastFocus && state.modal.lastFocus.focus) state.modal.lastFocus.focus();
}

function moveModal(step){
  const tot = state.modal.assets.length;
  state.modal.index = (state.modal.index + step + tot) % tot;
  renderModal();
}

function renderModal(){
  const a = state.modal.assets[state.modal.index];
  els.vStage.innerHTML = (a.type==='video')
    ? `<video preload="metadata" controls playsinline src="${escapeHtml(a.url)}" style="max-width:100%;max-height:60vh;object-fit:contain"></video>`
    : `<img alt="" src="${escapeHtml(a.url)}" style="max-width:100%;max-height:60vh;object-fit:contain" />`;

  const tot = state.modal.assets.length;
  const cur = state.modal.index+1;
  const dots = Array.from({length:tot}, (_,i)=> i===state.modal.index ? '●' : '○').join(' ');
  els.vDots.textContent = (tot>1) ? `${cur}/${tot}  ${dots}` : '';
}

/* =========================
   UX helpers
   ========================= */

function showOverlay(v){ if(els.overlay) els.overlay.hidden = !v; }
function showMoreLoading(v){ if(!els.more) return; els.more.disabled=v; els.more.textContent = v?'Loading…':'Load more'; }
function toast(msg, ms=2500){
  const div = document.createElement('div'); div.className='toast'; div.textContent=msg;
  els.toasts.appendChild(div); setTimeout(()=>div.remove(), ms);
}
function fmtDate(iso){
  const d = new Date(iso); if(isNaN(d)) return '';
  const m = MONTHS[d.getMonth()], dd = String(d.getDate()).padStart(2,'0'); return `${m} ${dd}`;
}
function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function initials(name){ const n=(name||'').trim(); if(!n) return '??'; const p=n.split(/\s+/); const a=(p[0]||'')[0]||''; const b=(p[1]||'')[0]||''; return (a+b||a).toUpperCase(); }
const OWNER_COLORS = ['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
function ownerColor(name){ const s=(name||'').trim(); if(!s) return '#6B7280'; let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0; return OWNER_COLORS[Math.abs(h)%OWNER_COLORS.length]; }

/* ----- Icons ----- */
function svgPin(){ return `<svg viewBox="0 0 24 24"><path d="M14 3l7 7-4 1-3 7-2-2-2-2 7-3 1-4-4-4z"/></svg>`; }
function svgVideo(){ return `<svg viewBox="0 0 24 24"><path d="M17 10l4-2v8l-4-2v2H3V8h14v2z"/></svg>`; }
function svgCarousel(){ return `<svg viewBox="0 0 24 24"><path d="M3 7h14v10H3zM19 9h2v6h-2z"/></svg>`; }
