const els = {
  grid: document.getElementById('grid'),
  more: document.getElementById('btnMore'),
  refresh: document.getElementById('btnRefresh'),
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

const state = {
  filtersData: null,
  selected: { clients:[], projects:[], platforms:[], owners:[], statuses:[] },
  cursor: null,
  posts: [],

  modal: { open:false, assets:[], index:0 }
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/* --- INIT --- */
init();

async function init(){
  wireFilters();
  wireModal();
  els.more.addEventListener('click', onMore);
  els.refresh.addEventListener('click', refresh);

  await loadFilters();
  await refresh();
}

/* ---------- Filters UI ---------- */
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

  renderMenu(els.mClient, json.clients, 'clients', item=>item.name, item=>item.id);
  renderMenu(els.mProject, json.projects, 'projects', item=>item.name, item=>item.id);
  renderMenu(els.mPlatform, json.platforms, 'platforms', (x)=>x, (x)=>x);
  renderMenu(els.mOwner, json.owners, 'owners', item=>item.name, item=>item.name);
  renderMenu(els.mStatus, json.statuses, 'statuses', item=>item.name, item=>item.name);
  // Default labels
  setBtnText(els.fClient, "All Clients");
  setBtnText(els.fProject, "All Projects");
  setBtnText(els.fPlatform, "All Platforms");
  setBtnText(els.fOwner, "All Owners");
  setBtnText(els.fStatus, "All Status");
}

function renderMenu(container, list, key, labelFn, valueFn){
  container.innerHTML = '';
  // search box
  const search = document.createElement('input');
  search.className = 'option';
  search.placeholder = 'Search...';
  search.style.marginBottom = '6px';
  container.appendChild(search);

  const box = document.createElement('div');
  container.appendChild(box);

  const render = (term='')=>{
    box.innerHTML = '';
    list
      .filter(it => (labelFn(it)||'').toLowerCase().includes(term.toLowerCase()))
      .forEach(it=>{
        const div = document.createElement('div');
        div.className = 'option';
        div.textContent = labelFn(it) || 'Sin nombre';
        div.addEventListener('click', ()=>{
          toggleSelect(key, valueFn(it), labelFn(it));
        });
        box.appendChild(div);
      });
  };
  search.addEventListener('input', e=>render(e.target.value));
  render();
}

function toggleSelect(key, val, label){
  const arr = state.selected[key];
  const idx = arr.indexOf(val);
  if(idx>=0) arr.splice(idx,1); else arr.push(val);

  // dependent projects
  if(key==='clients'){
    filterProjectsForClients();
  }
  updateButtonsText();
  refresh(true);
}

function filterProjectsForClients(){
  const all = state.filtersData.projects;
  const clients = state.selected.clients;
  let show = all;
  if(clients.length){
    show = all.filter(p => p.clientIds.some(id => clients.includes(id)));
  }
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id);
  setBtnText(els.fProject, "All Projects"); // reset label visual
  state.selected.projects = []; // reset selección efectiva
}

function updateButtonsText(){
  setBtnText(els.fClient, state.selected.clients.length ? `${state.selected.clients.length} selected` : "All Clients");
  setBtnText(els.fProject, state.selected.projects.length ? `${state.selected.projects.length} selected` : "All Projects");
  setBtnText(els.fPlatform, state.selected.platforms.length ? `${state.selected.platforms.length} selected` : "All Platforms");
  setBtnText(els.fOwner, state.selected.owners.length ? `${state.selected.owners.length} selected` : "All Owners");
  setBtnText(els.fStatus, state.selected.statuses.length ? `${state.selected.statuses.length} selected` : "All Status");
}
function setBtnText(btn, txt){ btn.textContent = txt; }

/* ---------- Data ---------- */
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
  if(!json.ok){ els.grid.innerHTML = errorBox(json.error||'No se pudo conectar con /api/grid.'); return; }

  state.cursor = json.next_cursor;
  state.posts = state.posts.concat(json.posts||[]);
  renderGrid(state.posts);
  els.more.style.display = state.cursor ? 'inline-flex' : 'none';
}

/* ---------- Render ---------- */
function renderGrid(list){
  // 12 slots por página visible (si ya hay más de 12, mostramos todos los que haya pedido “load more”)
  const cards = list.map(renderCard);
  // si faltan para múltiplos de 12, completa placeholders
  const rest = (12 - (cards.length % 12)) % 12;
  for(let i=0;i<rest;i++) cards.push(placeholderCard());

  els.grid.innerHTML = cards.join('');
  hookCardEvents();
}

function renderCard(p){
  const first = p.media?.[0];
  const isVideo = first?.type === 'video';
  const hasMulti = (p.media?.length||0) > 1;

  const badges = `
    <div class="card__badges">
      ${p.pinned ? `<span class="badge" title="Pinned">${svgPin()}</span>` : ``}
      ${isVideo ? `<span class="badge" title="Video">${svgVideo()}</span>` : ``}
      ${hasMulti ? `<span class="badge" title="Carrusel">${svgCarousel()}</span>` : ``}
      ${hasMulti ? `<span class="badge badge--count" title="Items">${p.media.length}</span>` : ``}
    </div>`;

  const mediaEl = first
    ? (isVideo
       ? `<video class="card__media" muted playsinline preload="metadata" src="${first.url}"></video>`
       : `<img class="card__media" src="${first.url}" alt="" />`)
    : `<div class="card__media placeholder"><span>No content</span></div>`;

  const date = p.date ? fmtDate(p.date) : '';
  return `
    <div class="card" data-id="${p.id}">
      ${badges}
      ${mediaEl}
      <div class="card__overlay">
        <div class="card__title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
        <div class="card__date">${date}</div>
      </div>
    </div>`;
}

function placeholderCard(){
  return `<div class="card"><div class="card__media placeholder"><span>No content</span></div></div>`;
}
function skeleton(n){
  return Array.from({length:n},()=>`<div class="card"><div class="card__media placeholder"><span> </span></div></div>`).join('');
}
function errorBox(msg){
  return `<div style="padding:14px;border:1px solid #3a4254;border-radius:10px;background:#121621">${escapeHtml(msg)}</div>`;
}

/* ---------- Events per card ---------- */
function hookCardEvents(){
  document.querySelectorAll('.card').forEach(card=>{
    // hover video preview
    const vid = card.querySelector('video.card__media');
    if(vid){
      card.addEventListener('mouseenter', ()=>{ try{vid.play()}catch{} });
      card.addEventListener('mouseleave', ()=>{ try{vid.pause()}catch{} });
    }
    card.addEventListener('click', ()=>openModal(card.dataset.id));
  });
}

/* ---------- Modal ---------- */
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
  state.modal.assets = post.media && post.media.length ? post.media : [{type:'image', url:''}];
  state.modal.index = 0;

  els.vCopy.textContent = (post.copy||"").trim();
  renderModal();
  document.body.style.overflow = 'hidden';
  document.getElementById('modal').classList.add('is-open');
}
function closeModal(){
  state.modal.open = false;
  document.getElementById('modal').classList.remove('is-open');
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
  els.vStage.innerHTML = a.type==='video'
    ? `<video muted playsinline controls autoplay src="${a.url}" style="width:100%;height:100%;object-fit:cover"></video>`
    : `<img src="${a.url}" alt="" style="width:100%;height:100%;object-fit:cover" />`;

  const tot = state.modal.assets.length;
  const cur = state.modal.index+1;
  const dots = state.modal.assets.map((_,i)=>`<span class="dot ${i===state.modal.index?'active':''}"></span>`).join('');
  els.vDots.innerHTML = `<span class="count">${cur}/${tot}</span>${dots}`;
}

/* ---------- Icons ---------- */
function svgPin(){ return `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M14 2l8 8-3 3-3-3-6 6v4l-2-2v-2l6-6-3-3 3-3z"/></svg>`; }
function svgVideo(){ return `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M17 10.5V6a2 2 0 0 0-2-2H5C3.9 4 3 4.9 3 6v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5l4 4v-7l-4 4z"/></svg>`; }
function svgCarousel(){ return `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M3 7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm11 2h3a2 2 0 0 1 2 2v6h-5V9z"/></svg>`; }

/* ---------- Utils ---------- */
function fmtDate(iso){
  const d = new Date(iso);
  const m = MONTHS[d.getMonth()];
  const dd = String(d.getDate()).padStart(2,'0');
  return `${m} ${dd}`;
}
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
