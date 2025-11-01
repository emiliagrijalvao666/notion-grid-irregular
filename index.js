// Front state
const state = {
  pageSize: 12,
  cursor: null,
  filters: {
    client: null,   // {id, name}
    project: null,  // {id, name}
    platforms: [],  // ["Instagram", ...]
    owner: null,    // {id, name}
    status: null    // "Publicado" | ...
  }
};

const el = {
  grid: document.getElementById('grid'),
  btnMore: document.getElementById('btnMore'),
  btnRefresh: document.getElementById('btnRefresh'),
  // filter buttons & menus
  fClient: document.getElementById('fClient'),
  mClient: document.getElementById('mClient'),
  fProject: document.getElementById('fProject'),
  mProject: document.getElementById('mProject'),
  fPlatform: document.getElementById('fPlatform'),
  mPlatform: document.getElementById('mPlatform'),
  fOwner: document.getElementById('fOwner'),
  mOwner: document.getElementById('mOwner'),
  fStatus: document.getElementById('fStatus'),
  mStatus: document.getElementById('mStatus'),
  // modal
  modal: document.getElementById('modal'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalClose: document.getElementById('modalClose'),
  vStage: document.getElementById('vStage'),
  vDots: document.getElementById('vDots'),
  vPrev: document.getElementById('vPrev'),
  vNext: document.getElementById('vNext'),
  vCopy: document.getElementById('vCopy'),
};

let debounceTimer=null;
const debounce = (fn, ms=250) => (...args)=>{ clearTimeout(debounceTimer); debounceTimer=setTimeout(()=>fn(...args), ms); };

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-US', {month:'short', day:'2-digit'});
  return fmt.format(d); // e.g., Nov 03
}

/* ---------- Filters UI helpers ---------- */
function closeAllMenus(){ document.querySelectorAll('.select').forEach(s=>s.classList.remove('open')); }
document.addEventListener('click', e=>{
  if(!e.target.closest('.select')) closeAllMenus();
});

function makeMenu(container, items, onPick, isActive){
  container.innerHTML = '';
  items.forEach(it=>{
    const a = document.createElement('div');
    a.className = 'select__item' + (isActive && isActive(it) ? ' is-active' : '');
    a.textContent = it.name || it;
    a.addEventListener('click', ()=>{ onPick(it); closeAllMenus(); });
    container.appendChild(a);
  });
}

function bindSelect(btn, menuEl){
  btn.addEventListener('click', ()=>{
    const root = btn.parentElement;
    const open = root.classList.contains('open');
    closeAllMenus();
    if(!open) root.classList.add('open');
  });
}

bindSelect(el.fClient, el.mClient);
bindSelect(el.fProject, el.mProject);
bindSelect(el.fPlatform, el.mPlatform);
bindSelect(el.fOwner, el.mOwner);
bindSelect(el.fStatus, el.mStatus);

/* ---------- Load filter sets from API ---------- */
async function loadFilters(){
  // Clients & Projects (optionally scoped by client)
  const q = new URLSearchParams();
  if(state.filters.client?.id) q.set('clientId', state.filters.client.id);
  const res = await fetch(`/api/filters?${q.toString()}`);
  const data = await res.json();

  // Clients
  {
    const items = [{id:null,name:'All Clients'}, ...data.clients];
    makeMenu(el.mClient, items, (it)=>{
      state.filters.client = it.id ? {id:it.id, name:it.name} : null;
      el.fClient.textContent = it.id ? it.name : 'All Clients';
      // when client changes, clear project and reload projects menu scoped
      state.filters.project = null;
      el.fProject.textContent = 'All Projects';
      loadFilters(); // reload projects scoped to client
      debouncedRefresh();
    }, (it)=> state.filters.client?.id === it.id || (!state.filters.client && it.id===null));
  }

  // Projects (scoped if client selected)
  {
    const items = [{id:null,name:'All Projects'}, ...data.projects];
    makeMenu(el.mProject, items, (it)=>{
      state.filters.project = it.id ? {id:it.id, name:it.name} : null;
      el.fProject.textContent = it.id ? it.name : 'All Projects';
      debouncedRefresh();
    }, (it)=> state.filters.project?.id === it.id || (!state.filters.project && it.id===null));
  }

  // Platforms (multi)
  {
    const items = ['All Platforms', ...data.platforms];
    makeMenu(el.mPlatform, items, (it)=>{
      if(it==='All Platforms'){ state.filters.platforms=[]; el.fPlatform.textContent='All Platforms'; }
      else{
        const i = state.filters.platforms.indexOf(it);
        if(i>=0) state.filters.platforms.splice(i,1);
        else state.filters.platforms.push(it);
        el.fPlatform.textContent = state.filters.platforms.length ? `${state.filters.platforms[0]}${state.filters.platforms.length>1?` +${state.filters.platforms.length-1}`:''}` : 'All Platforms';
      }
      debouncedRefresh();
    }, (it)=> it!=='All Platforms' && state.filters.platforms.includes(it));
  }

  // Owners (single)
  {
    const items = [{id:null,name:'All Owners'}, ...data.owners];
    makeMenu(el.mOwner, items, (it)=>{
      state.filters.owner = it.id ? {id:it.id, name:it.name} : null;
      el.fOwner.textContent = it.id ? it.name : 'All Owners';
      debouncedRefresh();
    }, (it)=> state.filters.owner?.id === it.id || (!state.filters.owner && it.id===null));
  }

  // Status (single)
  {
    const items = [{name:'All Status'}, ...data.statuses.map(s=>({name:s}))];
    makeMenu(el.mStatus, items, (it)=>{
      state.filters.status = it.name==='All Status' ? null : it.name;
      el.fStatus.textContent = it.name;
      debouncedRefresh();
    }, (it)=> (state.filters.status??'All Status')===it.name);
  }
}

/* ---------- GRID rendering ---------- */
function badgeSVG(kind){
  // carousel squares, video play, pin
  if(kind==='carousel')
    return `<svg viewBox="0 0 24 24"><path d="M3 7h11v11H3zM10 6h11v11H10z"/></svg>`;
  if(kind==='video')
    return `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  if(kind==='pin')
    return `<svg viewBox="0 0 24 24"><path d="M12 2l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/></svg>`;
  return '';
}

function tileHTML(item){
  const hasMedia = item.media && item.media.length;
  const first = hasMedia ? item.media[0] : null;
  const isVideo = first?.type==='video';
  const badges = [];
  if(item.pinned) badges.push(`<span class="badge">${badgeSVG('pin')}</span>`);
  if(item.media?.length>1) badges.push(`<span class="badge">${badgeSVG('carousel')} ${item.media.length}</span>`);
  if(isVideo) badges.push(`<span class="badge">${badgeSVG('video')}</span>`);

  return `
  <div class="tile" data-id="${item.id}">
    ${ hasMedia
      ? (isVideo
          ? `<video class="tile__video" src="${first.url}" muted playsinline preload="metadata"></video>`
          : `<img class="tile__img" src="${first.url}" alt="" loading="lazy" />`)
      : `<div class="tile__empty">No content</div>`
    }
    <div class="tile__badges">${badges.join('')}</div>
    <div class="tile__overlay">
      <div class="tile__meta">
        <div class="tile__title">${item.title ?? ''}</div>
        <div class="tile__date">${fmtDate(item.date)}</div>
      </div>
    </div>
  </div>`;
}

function ensurePlaceholders(count){
  const need = Math.max(0, 12 - count);
  return Array.from({length:need}).map(()=>({
    id:`ph-${Math.random().toString(36).slice(2)}`,
    title:'', date:null, pinned:false, media:[]
  }));
}

async function fetchPage(reset=false){
  const body = {
    pageSize: state.pageSize,
    cursor: reset ? null : state.cursor,
    filter: {
      clientId: state.filters.client?.id || null,
      projectId: state.filters.project?.id || null,
      ownerId: state.filters.owner?.id || null,
      platforms: state.filters.platforms,
      status: state.filters.status
    }
  };
  const res = await fetch('/api/grid', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Load failed');

  state.cursor = data.nextCursor || null;

  return data.items;
}

async function refresh(resetCursor=true){
  try{
    if(resetCursor) state.cursor = null;
    el.grid.innerHTML = '';
    const items = await fetchPage(true);
    const full = [...items, ...ensurePlaceholders(items.length)];
    el.grid.innerHTML = full.map(tileHTML).join('');
    hookTiles(full);
    el.btnMore.style.display = state.cursor ? 'inline-flex' : 'none';
  }catch(err){
    el.grid.innerHTML = `<div style="padding:14px;border:1px solid #eee;border-radius:10px;background:#fafafa;">Failed to load. Please try again.</div>`;
    el.btnMore.style.display = 'none';
    console.error(err);
  }
}
const debouncedRefresh = debounce(()=>refresh(true), 250);

async function loadMore(){
  if(!state.cursor) return;
  const items = await fetchPage(false);
  const html = items.map(tileHTML).join('');
  el.grid.insertAdjacentHTML('beforeend', html);
  hookTiles(items);
  if(!state.cursor) el.btnMore.style.display='none';
}

/* ---------- Hover video autoplay ---------- */
function hookTiles(items){
  const nodes = el.grid.querySelectorAll('.tile');
  nodes.forEach((node, i)=>{
    const vid = node.querySelector('.tile__video');
    if(vid){
      node.addEventListener('mouseenter', ()=>{ vid.play().catch(()=>{}); });
      node.addEventListener('mouseleave', ()=>{ vid.pause(); vid.currentTime=0; });
    }
    node.addEventListener('click', ()=> openModal(items[i]));
  });
}

/* ---------- Modal viewer ---------- */
let modalMedia=[], modalIndex=0;
function renderViewer(){
  const m = modalMedia[modalIndex];
  el.vStage.innerHTML = m.type==='video'
    ? `<video class="viewer__video" src="${m.url}" controls playsinline></video>`
    : `<img class="viewer__img" src="${m.url}" alt="" />`;
  // dots
  el.vDots.innerHTML = modalMedia.map((_,i)=>`<span class="${i===modalIndex?'is-active':''}"></span>`).join('');
}
function openModal(item){
  if(!item.media?.length) return;
  modalMedia = item.media;
  modalIndex = 0;
  renderViewer();
  el.vCopy.textContent = item.copy || '';
  document.body.style.overflow='hidden';
  el.modal.classList.add('is-open');
}
function closeModal(){
  el.modal.classList.remove('is-open');
  document.body.style.overflow='';
}
el.modalBackdrop.addEventListener('click', closeModal);
el.modalClose.addEventListener('click', closeModal);
document.addEventListener('keydown', e=>{
  if(!el.modal.classList.contains('is-open')) return;
  if(e.key==='Escape') closeModal();
  if(e.key==='ArrowRight'){ modalIndex=(modalIndex+1)%modalMedia.length; renderViewer(); }
  if(e.key==='ArrowLeft'){ modalIndex=(modalIndex-1+modalMedia.length)%modalMedia.length; renderViewer(); }
});
el.vNext.addEventListener('click', ()=>{ modalIndex=(modalIndex+1)%modalMedia.length; renderViewer(); });
el.vPrev.addEventListener('click', ()=>{ modalIndex=(modalIndex-1+modalMedia.length)%modalMedia.length; renderViewer(); });

/* ---------- Events ---------- */
el.btnRefresh.addEventListener('click', ()=>refresh(true));
el.btnMore.addEventListener('click', loadMore);

/* ---------- Boot ---------- */
(async function boot(){
  await loadFilters();
  await refresh(true);
})();
