// ---------- Elements ----------
const els = {
  grid: document.getElementById('grid'),
  more: document.getElementById('btnMore'),
  refresh: document.getElementById('btnRefresh'),
  clear: document.getElementById('btnClear'),
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
  vCopy: document.getElementById('vCopy')
};

const state = {
  filtersData: null,
  selected: { clients:[], projects:[], platforms:[], owners:[], statuses:[] },
  cursor: null,
  posts: [],
  modal: { open:false, assets:[], index:0 }
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ---------- Init ----------
init();
async function init(){
  wireFilters();
  wireModal();
  els.more.addEventListener('click', onMore);
  els.refresh.addEventListener('click', async ()=>{ await loadFilters(); await refresh(true); });
  els.clear.addEventListener('click', onClear);
  await loadFilters();
  await refresh(true);
}

// ---------- Filters UI ----------
function wireFilters(){
  document.querySelectorAll('.select').forEach(sel=>{
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', ()=>{
      const open = sel.classList.contains('open');
      document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
      if(!open) sel.classList.add('open');
    });
  });
  document.addEventListener('click', e=>{
    if(!e.target.closest('.select')) document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
  });
}

function ownerInitials(n){ return (n||'').trim().split(/\s+/).map(s=>s[0]).join('').slice(0,3).toUpperCase(); }
function labelOwners(list){
  if(!list?.length) return 'All Owners';
  const inits = list.slice(0,2).map(o=>ownerInitials(o.name)).join(', ');
  return list.length>2 ? `${inits} +${list.length-2}` : inits;
}

async function loadFilters(){
  const fx = await (await fetch('/api/filters')).json();
  if(!fx.ok) throw new Error(fx.error||'filters');
  state.filtersData = fx;

  renderMenu(els.mClient,   fx.clients,   'clients',   it=>it.name, it=>it.id);
  renderMenu(els.mProject,  fx.projects,  'projects',  it=>it.name, it=>it.id);
  renderMenu(els.mPlatform, fx.platforms, 'platforms', it=>it.name, it=>it.name);
  renderMenu(els.mOwner,    fx.owners,    'owners',    it=>it.name, it=>it.id);
  renderMenu(els.mStatus,   fx.statuses,  'statuses',  it=>it.name, it=>it.name);

  setBtnText(els.fClient,'All Clients');
  setBtnText(els.fProject,'All Projects');
  setBtnText(els.fPlatform,'All Platforms');
  setBtnText(els.fOwner,'All Owners');
  setBtnText(els.fStatus,'All Status');
}

function renderMenu(container, list, key, labelFn, valueFn){
  container.innerHTML = '';
  const search = document.createElement('input');
  search.className = 'option'; search.placeholder = 'Search...'; search.style.marginBottom='6px';
  container.appendChild(search);

  const box = document.createElement('div'); container.appendChild(box);

  const render = (term='')=>{
    box.innerHTML = '';
    list
      .filter(it => (labelFn(it)||'').toLowerCase().includes(term.toLowerCase()))
      .forEach(it=>{
        const div = document.createElement('div');
        div.className = 'option';
        div.textContent = labelFn(it) || 'No name';
        div.addEventListener('click', ()=>{ toggleSelect(key, valueFn(it), labelFn(it)); });
        if(state.selected[key]?.includes(valueFn(it))) div.style.fontWeight='700';
        box.appendChild(div);
      });
  };
  search.addEventListener('input', e=>render(e.target.value));
  render();
}

function toggleSelect(key, val, label){
  // Status = single
  if(key==='statuses'){
    state.selected.statuses = (state.selected.statuses[0]===val) ? [] : [val];
    setBtnText(els.fStatus, state.selected.statuses[0] || 'All Status');
    refresh(true);
    return;
  }
  // Multi
  const arr = state.selected[key];
  const i = arr.indexOf(val);
  if(i>=0) arr.splice(i,1); else arr.push(val);

  if(key==='clients') filterProjectsForClients();
  updateButtonsText();
  refresh(true);
}

function filterProjectsForClients(){
  const chosen = state.selected.clients;
  const all = state.filtersData.projects || [];
  const show = chosen.length ? all.filter(p => (p.clientIds||[]).some(id => chosen.includes(id))) : all;
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id);
  state.selected.projects = [];
  setBtnText(els.fProject,'All Projects');
}

function updateButtonsText(){
  const s = state.selected;
  setBtnText(els.fClient,   s.clients.length   ? `${s.clients.length} selected`   : 'All Clients');
  setBtnText(els.fProject,  s.projects.length  ? `${s.projects.length} selected`  : 'All Projects');
  setBtnText(els.fPlatform, s.platforms.length ? `${s.platforms.length} selected` : 'All Platforms');

  const ownersFull = state.filtersData.owners.filter(o => s.owners.includes(o.id));
  setBtnText(els.fOwner, ownersFull.length ? labelOwners(ownersFull) : 'All Owners');
}

function setBtnText(btn, txt){ btn.textContent = txt; }
function onClear(){
  state.selected = { clients:[], projects:[], platforms:[], owners:[], statuses:[] };
  updateButtonsText(); filterProjectsForClients(); refresh(true);
}

// ---------- Data ----------
async function refresh(reset=false){
  if(reset){ state.cursor=null; state.posts=[]; }
  els.grid.innerHTML = skeleton(12);
  await fetchMore();
}
async function onMore(){ await fetchMore(); }

async function fetchMore(){
  const params = new URLSearchParams();
  params.set('pageSize','12');
  if(state.cursor) params.set('cursor', state.cursor);

  state.selected.clients.forEach(v=>params.append('client', v));
  state.selected.projects.forEach(v=>params.append('project', v));
  state.selected.platforms.forEach(v=>params.append('platform', v));
  state.selected.owners.forEach(v=>params.append('owner', v));
  state.selected.statuses.forEach(v=>params.append('status', v));

  const resp = await fetch(`/api/grid?${params.toString()}`);
  const json = await resp.json();
  if(!json.ok){ els.grid.innerHTML = errorBox(json.error||'Could not connect to /api/grid.'); return; }

  state.cursor = json.next_cursor;
  state.posts = state.posts.concat(json.posts||[]);
  renderGrid(state.posts);
  els.more.style.display = state.cursor ? 'inline-flex' : 'none';
}

// ---------- Render ----------
function renderGrid(list){
  const cards = list.map(renderCard);
  const rest = (12 - (cards.length % 12)) % 12;
  for(let i=0;i<rest;i++) cards.push(placeholderCard());
  els.grid.innerHTML = cards.join('');
  hookCardEvents();
}

function renderCard(p){
  const first = p.media?.[0];
  const hasMulti = (p.media?.length||0) > 1;
  const isVideo = first?.type === 'video';

  const badges = `
    <div class="card__badges">
      ${p.pinned ? `<span class="badge">${svgPin()}</span>` : ``}
      ${isVideo ? `<span class="badge">${svgVideo()}</span>` : ``}
      ${hasMulti ? `<span class="badge">${svgCarousel()}</span>` : ``}
    </div>`;

  const mediaEl = first
    ? (isVideo
      ? `<video class="card__media" muted preload="metadata" src="${first.url}"></video>`
      : `<img class="card__media" loading="lazy" src="${first.url}" alt="">`)
    : `<div class="card__media card__placeholder"></div>`;

  const date = p.date ? fmtDate(p.date) : '';

  return `
  <article class="card" data-id="${p.id}">
    ${badges}
    ${mediaEl}
    <div class="card__info">
      <div class="card__title">${escapeHtml(p.title||'No title')}</div>
      <div class="card__date">${date}</div>
    </div>
  </article>`;
}

function placeholderCard(){
  return `<article class="card card--empty"><div class="card__media"></div><div class="card__placeholder">No content</div></article>`;
}

function skeleton(n){ return Array.from({length:n},()=>`<article class="card"><div class="card__media"></div></article>`).join(''); }
function errorBox(msg){ return `<div class="card--empty" style="padding:16px;text-align:center">${escapeHtml(msg)}</div>`; }

// ---------- Card events ----------
function hookCardEvents(){
  document.querySelectorAll('.card').forEach(card=>{
    const vid = card.querySelector('video.card__media');
    if(vid){
      card.addEventListener('mouseenter', ()=>{ try{vid.play()}catch{} });
      card.addEventListener('mouseleave', ()=>{ try{vid.pause()}catch{} });
    }
    card.addEventListener('click', ()=>openModal(card.dataset.id));
  });
}

// ---------- Modal ----------
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
  els.vStage.addEventListener('touchstart', e=>{ sx=e.touches[0].clientX }, {passive:true});
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
  state.modal.assets = post.media && post.media.length ? post.media : [{type:'image', url:''}];
  state.modal.index = 0;
  els.vCopy.textContent = (post.copy||"").trim();
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
  els.vStage.innerHTML = a?.type==='video'
    ? `<video controls autoplay muted src="${a.url}" style="max-width:100%;max-height:100%"></video>`
    : `<img src="${a?.url||''}" alt="" style="max-width:100%;max-height:100%">`;
  const tot = state.modal.assets.length;
  const cur = state.modal.index+1;
  const dots = state.modal.assets.map((_,i)=>`<span style="width:6px;height:6px;border-radius:999px;background:${i===state.modal.index?'#111':'#d1d5db'};display:inline-block;margin:0 3px"></span>`).join('');
  els.vDots.innerHTML = `${cur}/${tot} ${dots}`;
}

// ---------- Icons ----------
function svgPin(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M5 3l7 7 7-7M5 3h14"/></svg>`}
function svgVideo(){return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a2 2 0 0 0-2-2H5A2 2 0 0 0 3 7v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 3.5V7l-4 3.5z"/></svg>`}
function svgCarousel(){return `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="6" width="14" height="12" rx="2"/><rect x="7" y="8" width="14" height="12" rx="2"/></svg>`}

// ---------- Utils ----------
function fmtDate(iso){ const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`; }
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
