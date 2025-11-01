// --- Elements ---
const els = {
  grid: document.getElementById('grid'),
  more: document.getElementById('btnMore'),
  refresh: document.getElementById('btnRefresh'),
  clear: document.getElementById('btnClear'),
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

// --- State ---
const state = {
  filtersData: null,
  selected: { clients:[], projects:[], platforms:[], owners:[], statuses:[] },
  cursor: null,
  posts: [],
  modal: { open:false, assets:[], index:0 }
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// --- Init ---
init();

async function init(){
  wireFilters();
  wireModal();
  els.more.addEventListener('click', onMore);
  els.refresh.addEventListener('click', ()=>refresh(true));
  els.clear.addEventListener('click', clearFilters);
  await loadFilters();
  await refresh(true);
}

// ========== Filters UI ==========
function wireFilters(){
  // open/close
  document.querySelectorAll('.select').forEach(sel=>{
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const open = sel.classList.contains('open');
      document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
      if(!open) sel.classList.add('open');
    });
  });
  document.addEventListener('click', ()=>{
    document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
  });
}

async function loadFilters(){
  const r = await fetch('/api/filters');
  const json = await ensureJson(r);
  if(!json.ok) throw new Error(json.error||'filters');

  // Normalize simple lists
  const normalize = (arr)=> (arr||[]).map(x=>{
    if(typeof x === 'string') return { id:x, name:x };
    return { id: x.id ?? x.value ?? x.name, name: x.name ?? String(x.id ?? x.value ?? '') };
  });

  state.filtersData = {
    clients:   normalize(json.clients),
    projects:  (json.projects||[]).map(p=>({
      id: p.id, name: p.name ?? p.title ?? '', clientIds: p.clientIds || p.clients || []
    })),
    platforms: normalize(json.platforms),
    owners:    normalize(json.owners), // <-- must include id (uuid) for Notion People
    statuses:  normalize(json.statuses)
  };

  renderMenu(els.mClient,  state.filtersData.clients,   'clients',  it=>it.name, it=>it.id);
  renderMenu(els.mProject, state.filtersData.projects,  'projects', it=>it.name, it=>it.id);
  renderMenu(els.mPlatform,state.filtersData.platforms, 'platforms',it=>it.name, it=>it.id);
  // owners -> value = id, label = name
  renderMenu(els.mOwner,   state.filtersData.owners,    'owners',   it=>it.name, it=>it.id);
  // status single-select (handled in toggleSelect)
  renderMenu(els.mStatus,  state.filtersData.statuses,  'statuses', it=>it.name, it=>it.id);

  setDefaultButtons();
}

function setDefaultButtons(){
  setBtnText(els.fClient,   'All Clients');
  setBtnText(els.fProject,  'All Projects');
  setBtnText(els.fPlatform, 'All Platforms');
  setBtnText(els.fOwner,    'All Owners');
  setBtnText(els.fStatus,   'All Status');
}

function renderMenu(container, list, key, labelFn, valueFn){
  container.innerHTML = '';

  // Search input
  const search = document.createElement('input');
  search.className = 'option';
  search.placeholder = 'Search...';
  search.style.marginBottom = '6px';
  container.appendChild(search);

  const box = document.createElement('div');
  container.appendChild(box);

  const render = (term='')=>{
    box.innerHTML = '';
    (list||[])
      .filter(it => (labelFn(it)||'').toLowerCase().includes(term.toLowerCase()))
      .forEach(it=>{
        const val = valueFn(it);
        const div = document.createElement('div');
        div.className = 'option';
        div.textContent = labelFn(it) || 'Unnamed';
        if(state.selected[key].includes(val)) div.classList.add('option--selected');
        div.addEventListener('click', ()=>{
          toggleSelect(key, val, labelFn(it));
          // re-render to update highlights
          render(search.value||'');
        });
        box.appendChild(div);
      });
  };
  search.addEventListener('input', e=>render(e.target.value));
  render();
}

function toggleSelect(key, val, label){
  const arr = state.selected[key];

  // single-select for status
  if(key==='statuses'){
    state.selected.statuses = arr[0]===val ? [] : [val];
  }else{
    const idx = arr.indexOf(val);
    if(idx>=0) arr.splice(idx,1); else arr.push(val);
    if(key==='clients') filterProjectsForClients();
  }

  updateButtonsText();
  refresh(true);
}

function filterProjectsForClients(){
  const all = state.filtersData.projects;
  const selectedClients = state.selected.clients;
  const show = selectedClients.length
    ? all.filter(p => (p.clientIds||[]).some(id => selectedClients.includes(id)))
    : all;
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id);
  state.selected.projects = []; // reset projects if client filter changed
  setBtnText(els.fProject,'All Projects');
}

function updateButtonsText(){
  const s = state.selected;

  setBtnText(els.fClient,   s.clients.length   ? `${s.clients.length} selected`   : 'All Clients');
  setBtnText(els.fProject,  s.projects.length  ? `${s.projects.length} selected`  : 'All Projects');
  setBtnText(els.fPlatform, s.platforms.length ? `${s.platforms.length} selected` : 'All Platforms');

  // Owners: show initials when <=3
  if(!s.owners.length){ setBtnText(els.fOwner,'All Owners'); }
  else{
    const idx = new Map(state.filtersData.owners.map(o=>[o.id,o.name]));
    const initials = s.owners.map(id => (idx.get(id)||'')
      .split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase());
    setBtnText(els.fOwner, s.owners.length<=3 ? initials.join(', ') : `${s.owners.length} selected`);
  }

  setBtnText(els.fStatus,   s.statuses.length ? state.filtersData.statuses.find(x=>x.id===s.statuses[0])?.name || 'Status' : 'All Status');
}

function clearFilters(){
  state.selected = { clients:[], projects:[], platforms:[], owners:[], statuses:[] };
  setDefaultButtons();
  // re-render menus (para quitar resaltados)
  loadFilters().then(()=>refresh(true));
}

// ========== Data ==========
async function refresh(reset=false){
  if(reset){ state.cursor=null; state.posts=[]; }
  els.grid.innerHTML = skeleton(12);
  await fetchMore();
}

async function onMore(){ await fetchMore(); }

function buildParams(){
  const p = new URLSearchParams();
  p.set('pageSize','12');
  if(state.cursor) p.set('cursor', state.cursor);

  state.selected.clients.forEach(v=>p.append('client', v));
  state.selected.projects.forEach(v=>p.append('project', v));
  state.selected.platforms.forEach(v=>p.append('platform', v));
  state.selected.owners.forEach(v=>p.append('owner', v));     // <-- UUIDs
  state.selected.statuses.forEach(v=>p.append('status', v));  // single, pero listo por si acaso
  return p;
}

async function fetchMore(){
  // Try GET first
  let resp = await fetch(`/api/grid?${buildParams().toString()}`);
  let json;
  try { json = await ensureJson(resp); }
  catch(e){
    // Not JSON; fall back
    json = { ok:false, error:'Method not allowed' };
  }

  // If server expects POST
  if(!json.ok && (resp.status===405 || /method not allowed/i.test(json.error||''))){
    const body = {
      pageSize:12,
      cursor: state.cursor||null,
      client: state.selected.clients,
      project: state.selected.projects,
      platform: state.selected.platforms,
      owner: state.selected.owners,   // UUIDs
      status: state.selected.statuses // string
    };
    resp = await fetch('/api/grid', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    json = await ensureJson(resp);
  }

  if(!json.ok){
    els.grid.innerHTML = errorBox(json.error || 'Could not connect to /api/grid.');
    els.more.style.display = 'none';
    return;
  }

  state.cursor = json.next_cursor || null;
  state.posts = state.posts.concat(json.posts || []);
  renderGrid(state.posts);
  els.more.style.display = state.cursor ? 'inline-flex' : 'none';
}

async function ensureJson(r){
  const ct = r.headers.get('content-type')||'';
  if(!ct.includes('application/json')){
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { ok:false, error:t }; }
  }
  return r.json();
}

// ========== Render ==========
function renderGrid(list){
  // render cards
  const cards = list.map(renderCard);
  // pad to multiples of 12 with placeholders
  const rest = (12 - (cards.length % 12)) % 12;
  for(let i=0;i<rest;i++) cards.push(placeholderCard());
  els.grid.innerHTML = cards.join('');
  hookCardEvents();
}

function renderCard(p){
  const first = p.media && p.media[0];
  const isVideo = first && first.type === 'video';
  const hasMulti = (p.media||[]).length > 1;

  const badges = `
    ${p.pinned ? `<span class="badge">${svgPin()}</span>` : ``}
    ${isVideo ? `<span class="badge">${svgVideo()}</span>` : ``}
    ${hasMulti ? `<span class="badge">${svgCarousel()} <span>${p.media.length}</span></span>` : ``}
  `;

  const mediaEl = first
    ? (isVideo
        ? `<video class="card__media" muted preload="metadata" src="${first.url}"></video>`
        : `<img class="card__media" loading="lazy" src="${first.url}" alt="">`)
    : `<div class="placeholder">No content</div>`;

  const date = p.date ? fmtDate(p.date) : '';

  return `
    <article class="card" data-id="${p.id}">
      <div class="card__badges">${badges}</div>
      ${mediaEl}
      <div class="card__meta">
        <div class="card__title">${escapeHtml(p.title||'')}</div>
        <div class="card__date">${date}</div>
      </div>
    </article>
  `;
}

function placeholderCard(){
  return `<div class="card"><div class="placeholder">No content</div></div>`;
}

function skeleton(n){
  return Array.from({length:n}, ()=>`<div class="card"></div>`).join('');
}

function errorBox(msg){
  return `<div class="error">${escapeHtml(msg)}</div>`;
}

// ========== Card events ==========
function hookCardEvents(){
  document.querySelectorAll('.card').forEach(card=>{
    // hover preview for videos
    const vid = card.querySelector('video.card__media');
    if(vid){
      card.addEventListener('mouseenter', ()=>{ try{vid.play()}catch{} });
      card.addEventListener('mouseleave', ()=>{ try{vid.pause()}catch{} });
    }
    card.addEventListener('click', ()=>openModal(card.dataset.id));
  });
}

// ========== Modal ==========
function wireModal(){
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape') closeModal();
    if(!state.modal.open) return;
    if(e.key==='ArrowLeft') moveModal(-1);
    if(e.key==='ArrowRight') moveModal(+1);
  });
  // swipe
  let sx=0;
  els.vStage.addEventListener('touchstart', e=>{ sx=e.touches[0].clientX; }, {passive:true});
  els.vStage.addEventListener('touchend', e=>{
    const dx = e.changedTouches[0].clientX - sx;
    if(Math.abs(dx)>40) moveModal(dx<0?+1:-1);
  }, {passive:true});
  els.vPrev.addEventListener('click', ()=>moveModal(-1));
  els.vNext.addEventListener('click', ()=>moveModal(+1));
}

function openModal(id){
  const post = state.posts.find(p=>p.id===id);
  if(!post) return;
  state.modal.open = true;
  state.modal.assets = (post.media && post.media.length) ? post.media : [{type:'image', url:''}];
  state.modal.index = 0;
  els.vCopy.textContent = (post.copy||'').trim();
  renderModal();
  document.body.style.overflow = 'hidden';
  els.modal.classList.add('is-open');
}

function closeModal(){
  state.modal.open = false;
  els.modal.classList.remove('is-open');
  document.body.style.overflow = '';
  els.vStage.innerHTML = '';
  els.vDots.innerHTML = '';
}

function moveModal(step){
  const tot = state.modal.assets.length;
  state.modal.index = (state.modal.index + step + tot) % tot;
  renderModal();
}

function renderModal(){
  const a = state.modal.assets[state.modal.index];
  els.vStage.innerHTML = (a && a.type==='video')
    ? `<video controls autoplay muted src="${a.url}" style="max-width:100%;max-height:100%"></video>`
    : `<img src="${a?.url||''}" alt="" />`;
  const tot = state.modal.assets.length;
  const cur = state.modal.index+1;
  const dots = state.modal.assets.map((_,i)=>`<span style="opacity:${i===state.modal.index?1:.3}">•</span>`).join(' ');
  els.vDots.innerHTML = `${cur}/${tot} ${dots}`;
}

// ========== Icons (white UI) ==========
function svgPin(){
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2l3 6 5 1-8 9-8-9 5-1 3-6z" stroke="#111" stroke-width="1.5" fill="none"/></svg>`;
}
function svgVideo(){
  return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3" stroke="#111" stroke-width="1.5"/><path d="M10 9l6 3-6 3V9z" fill="#111"/></svg>`;
}
function svgCarousel(){
  return `<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="6" width="12" height="12" rx="2" stroke="#111" stroke-width="1.5"/><rect x="8" y="4" width="12" height="12" rx="2" stroke="#111" stroke-width="1.5"/></svg>`;
}

// ========== Utils ==========
function fmtDate(iso){
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const m = MONTHS[d.getMonth()];
  const dd = String(d.getDate()).padStart(2,'0');
  return `${m} ${dd}`;
}
function escapeHtml(s){
  return (s||"").replace(/[&<>"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
