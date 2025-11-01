// ------- Elements
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
  vCopy: document.getElementById('vCopy'),
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ------- State
const state = {
  filtersData: null,
  selected: { clients:[], projects:[], platforms:[], owners:[], statuses:[] },
  cursor: null,
  posts: [],
  modal: { open:false, assets:[], index:0 },
};

// ------- Init
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

// ------- Filters UI
function wireFilters(){
  // toggles open/close
  document.querySelectorAll('.select').forEach(sel=>{
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', ()=>{
      const open = sel.classList.contains('open');
      document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
      if(!open) sel.classList.add('open');
    });
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.select')) document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
  });
}

async function loadFilters(){
  const resp = await fetch('/api/filters');
  const json = await resp.json();
  if(!json.ok) throw new Error(json.error||'filters');
  state.filtersData = json;

  renderMenu(els.mClient,  json.clients,   'clients',   it=>it.name, it=>it.id);
  renderMenu(els.mProject, json.projects,  'projects',  it=>it.name, it=>it.id);
  renderMenu(els.mPlatform,json.platforms, 'platforms', it=>it,       it=>it);
  renderMenu(els.mOwner,   json.owners,    'owners',    it=>it.name,  it=>it.name);
  renderMenu(els.mStatus,  json.statuses,  'statuses',  it=>it.name,  it=>it.name);

  setBtnText(els.fClient, "All Clients");
  setBtnText(els.fProject,"All Projects");
  setBtnText(els.fPlatform,"All Platforms");
  setBtnText(els.fOwner,"All Owners");
  setBtnText(els.fStatus,"All Status");
}

function renderMenu(container, list, key, labelFn, valueFn){
  container.innerHTML = '';
  const search = document.createElement('input');
  search.className = 'option';
  search.placeholder = 'Search...';
  container.appendChild(search);

  const box = document.createElement('div');
  container.appendChild(box);

  const paint = (term='')=>{
    box.innerHTML = '';
    list
      .filter(it => (labelFn(it)||'').toLowerCase().includes(term.toLowerCase()))
      .forEach(it=>{
        const div = document.createElement('div');
        div.className = 'option';
        div.textContent = labelFn(it) || 'Sin nombre';
        div.addEventListener('click', ()=>toggleSelect(key, valueFn(it), labelFn(it)));
        box.appendChild(div);
      });
  };
  search.addEventListener('input', e=>paint(e.target.value));
  paint();
}

function toggleSelect(key, val /*, label*/){
  const arr = state.selected[key];
  const idx = arr.indexOf(val);
  if(idx>=0) arr.splice(idx,1); else arr.push(val);

  // dependent menu: projects ↔ clients
  if(key==='clients'){ filterProjectsForClients(); }

  updateButtonsText();
  refresh(true);
}

function filterProjectsForClients(){
  const all = state.filtersData.projects;
  const clients = state.selected.clients;
  let show = all;
  if(clients.length){
    show = all.filter(p => p.clientIds?.some(id => clients.includes(id)));
  }
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id);
  state.selected.projects = []; // reset selection
  setBtnText(els.fProject, "All Projects");
}

function updateButtonsText(){
  setBtnText(els.fClient,   state.selected.clients.length   ? `${state.selected.clients.length} selected`   : "All Clients");
  setBtnText(els.fProject,  state.selected.projects.length  ? `${state.selected.projects.length} selected`  : "All Projects");
  setBtnText(els.fPlatform, state.selected.platforms.length ? `${state.selected.platforms.length} selected` : "All Platforms");
  setBtnText(els.fOwner,    state.selected.owners.length    ? `${state.selected.owners.length} selected`    : "All Owners");
  setBtnText(els.fStatus,   state.selected.statuses.length  ? `${state.selected.statuses.length} selected`  : "All Status");
}
function setBtnText(btn, txt){ btn.textContent = txt; }

function clearFilters(){
  state.selected = { clients:[], projects:[], platforms:[], owners:[], statuses:[] };
  // Re-pinta menús (para que proyectos vuelva a “todos”)
  filterProjectsForClients();
  updateButtonsText();
  refresh(true);
}

// ------- Data
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
  if(!json.ok){ els.grid.innerHTML = errorBox(json.error||'Could not connect.'); return; }

  state.cursor = json.next_cursor || null;
  state.posts = state.posts.concat(json.posts||[]);
  renderGrid(state.posts);

  els.more.style.display = state.cursor ? 'inline-flex' : 'none';
}

// ------- Render
function renderGrid(list){
  const cards = list.map(renderCard);
  const rest = (12 - (cards.length % 12)) % 12;
  for(let i=0;i<rest;i++) cards.push(placeholderCard());
  els.grid.innerHTML = cards.join('');
  hookCardEvents();
}

function renderCard(p){
  const first = p.media && p.media[0];
  const isVideo = first && first.type==='video';
  const hasMulti = (p.media?.length||0) > 1;

  const badges = `
    <div class="card__badges">
      ${p.pinned ? `<span class="badge" title="Pinned">📌</span>` : ``}
      ${isVideo ? `<span class="badge" title="Video">▶</span>` : ``}
      ${hasMulti ? `<span class="badge" title="Carousel">◧ ${p.media.length}</span>` : ``}
    </div>
  `;

  const mediaEl = first
    ? (isVideo
        ? `<video class="card__media" muted preload="metadata" src="${first.url}"></video>`
        : `<img class="card__media" loading="lazy" src="${first.url}" alt="">`)
    : `<div class="card__media card--empty"></div>`;

  const date = p.date ? fmtDate(p.date) : '';
  const title = escapeHtml(p.title||'');

  return `
    <article class="card" data-id="${p.id}">
      ${badges}
      ${mediaEl}
      <div class="card__bar">
        <div class="card__title">${title||' '}</div>
        <div class="card__date">${date}</div>
      </div>
    </article>
  `;
}

function placeholderCard(){
  return `<article class="card card--empty"><div>No content</div></article>`;
}
function skeleton(n){ return Array.from({length:n},()=>`<article class="card card--empty"><div> </div></article>`).join(''); }
function errorBox(msg){ return `<div style="padding:12px;border:1px solid #333;border-radius:10px">${escapeHtml(msg)}</div>`; }

// Hover video + click to open
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

// ------- Modal
function wireModal(){
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);

  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape') closeModal();
    if(!state.modal.open) return;
    if(e.key === 'ArrowLeft') moveModal(-1);
    if(e.key === 'ArrowRight') moveModal(+1);
  });

  // swipe
  let sx=0;
  els.vStage.addEventListener('touchstart', e=>{ sx = e.touches[0].clientX; }, {passive:true});
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
  state.modal.assets = post.media?.length ? post.media : [{type:'image', url:''}];
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
  els.vStage.innerHTML = (a.type==='video')
    ? `<video controls playsinline src="${a.url}" style="max-width:100%;max-height:100%"></video>`
    : `<img src="${a.url}" alt="" style="max-width:100%;max-height:100%">`;

  const tot = state.modal.assets.length;
  if(tot>1){
    const cur = state.modal.index+1;
    els.vDots.textContent = `${cur}/${tot}`;
    els.vDots.style.display = 'inline-flex';
    els.vPrev.style.display = 'inline-flex';
    els.vNext.style.display = 'inline-flex';
  }else{
    els.vDots.style.display = 'none';
    els.vPrev.style.display = 'none';
    els.vNext.style.display = 'none';
  }
}

// ------- Utils
function fmtDate(iso){
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`;
}
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
