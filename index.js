/* ===== Elements ===== */
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

const state = {
  filtersData: null,
  selected: { clients:[], projects:[], platforms:[], owners:[], statuses:[] }, // owners = IDs
  cursor: null,
  posts: [],
  loading: false,
  modal: { open:false, assets:[], index:0, lastFocus:null }
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/* ===== Init ===== */
init();

async function init(){
  // Guard básico: si falta algo, no romper
  const req = ['grid','btnMore','btnRefresh','btnClear','filters','mClient','mProject','mPlatform','mOwner','mStatus'];
  const missing = req.filter(id => !document.getElementById(id));
  if(missing.length){
    console.error('Faltan elementos HTML', missing);
    toast('Faltan elementos del HTML.');
    return;
  }

  wireMenus();
  wireModal();
  els.more.addEventListener('click', onMore);
  els.refresh.addEventListener('click', ()=>refresh(true));
  els.clear.addEventListener('click', clearFilters);

  els.grid.innerHTML = placeholderList(12);

  await loadFilters();   // pinta menús
  await refresh(true);   // primera página
}

/* ===== Filters UI ===== */
function wireMenus(){
  document.querySelectorAll('.select').forEach(sel=>{
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
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
  try{
    const r = await fetch('/api/filters');
    const json = await r.json();
    if(!json.ok) throw new Error(json.error||'filters');

    state.filtersData = {
      clients: json.clients||[],
      projects: json.projects||[],
      platforms: json.platforms||[],
      owners: json.owners||[],     // [{id,name}]
      statuses: (json.statuses||[]).map(s=> typeof s==='string'? {name:s}:s )
    };

    renderMenu(els.mClient,   state.filtersData.clients,   'clients',   it=>it.name, it=>it.id,   {multi:true, searchable:true});
    renderMenu(els.mProject,  state.filtersData.projects,  'projects',  it=>it.name, it=>it.id,   {multi:true, searchable:true});
    renderMenu(els.mPlatform, state.filtersData.platforms, 'platforms', it=>it,      it=>it,      {multi:true, searchable:true});
    // IMPORTANTÍSIMO: owners por **ID**
    renderMenu(els.mOwner,    state.filtersData.owners,    'owners',    it=>it.name, it=>it.id,   {multi:true, searchable:true, initials:true});
    // Status: single-select
    renderMenu(els.mStatus,   state.filtersData.statuses,  'statuses',  it=>it.name, it=>it.name, {multi:false, searchable:true});

    setBtnText(els.fClient,"All Clients");
    setBtnText(els.fProject,"All Projects");
    setBtnText(els.fPlatform,"All Platforms");
    setOwnerBtnLabel();
    setBtnText(els.fStatus,"All Status");
  }catch(e){
    toast('No se pudieron cargar los filtros.');
    state.filtersData = {clients:[],projects:[],platforms:[],owners:[],statuses:[]};
  }
}

function renderMenu(container, list, key, labelFn, valueFn, opts={multi:true, searchable:true, initials:false}){
  container.innerHTML = '';
  if(opts.searchable){
    const sb = document.createElement('div');
    sb.className='search';
    const input = document.createElement('input'); input.placeholder='Search...';
    const clear = document.createElement('button'); clear.type='button'; clear.textContent='✕'; clear.title='Clear';
    sb.appendChild(input); sb.appendChild(clear);
    container.appendChild(sb);
    clear.addEventListener('click', ()=>{ input.value=''; renderList(''); input.focus(); });
    input.addEventListener('input', ()=> renderList(input.value));
  }
  const box = document.createElement('div'); container.appendChild(box);

  const renderList = (term='')=>{
    const q = term.toLowerCase(); box.innerHTML='';
    list.filter(it => (labelFn(it)||'').toLowerCase().includes(q)).forEach(it=>{
      const val = valueFn(it); const lbl = labelFn(it) || 'Untitled';
      const div = document.createElement('div'); div.className='option';
      if(opts.initials){
        const chip = document.createElement('span');
        chip.className='owner-chip';
        chip.textContent = initials(lbl);
        chip.style.cssText='display:inline-flex;width:20px;height:20px;border-radius:6px;background:#111;color:#fff;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-right:6px';
        div.appendChild(chip);
      }
      const txt = document.createElement('span'); txt.textContent = lbl; div.appendChild(txt);

      if(isSelected(key,val)) div.classList.add('selected');

      div.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(key==='statuses'){ // single
          state.selected.statuses = [val];
          document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
          setBtnText(els.fStatus, lbl);
          refresh(true);
        }else{
          toggleSelect(key, val);
          highlightSelection(container, key, valueFn, labelFn);
          updateButtonsText();
          if(key==='clients') filterProjectsForClients();
          refresh(true);
        }
      });
      box.appendChild(div);
    });
  };
  renderList('');
}
function highlightSelection(container, key, valueFn, labelFn){
  container.querySelectorAll('.option').forEach(el=>{
    const lbl = el.querySelector('span:last-child')?.textContent || '';
    const it = (state.filtersData[key] || []).find(x => (labelFn(x)||'') === lbl);
    const val = it ? valueFn(it) : lbl;
    el.classList.toggle('selected', isSelected(key,val));
  });
}
function isSelected(key, val){ return state.selected[key].includes(val); }
function toggleSelect(key, val){
  const arr = state.selected[key]; const ix = arr.indexOf(val);
  if(ix>=0) arr.splice(ix,1); else arr.push(val);
}
function filterProjectsForClients(){
  const all = state.filtersData.projects; const sel = state.selected.clients;
  let show = all;
  if(sel.length) show = all.filter(p => (p.clientIds||[]).some(id => sel.includes(id)));
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
  state.selected.projects = [];
  setBtnText(els.fProject, "All Projects");
}
function updateButtonsText(){
  setBtnText(els.fClient,   state.selected.clients.length   ? `${state.selected.clients.length} selected`   : "All Clients");
  setBtnText(els.fProject,  state.selected.projects.length  ? `${state.selected.projects.length} selected`  : "All Projects");
  setBtnText(els.fPlatform, state.selected.platforms.length ? `${state.selected.platforms.length} selected` : "All Platforms");
  setOwnerBtnLabel();
  setBtnText(els.fStatus,   state.selected.statuses.length  ? state.selected.statuses[0] : "All Status");
  const c = state.selected.clients.length + state.selected.projects.length + state.selected.platforms.length + state.selected.owners.length + state.selected.statuses.length;
  els.badgeCount.textContent = String(c); els.badgeCount.hidden = c===0;
  els.clear.disabled = c===0;
}
function setOwnerBtnLabel(){
  if(!state.selected.owners.length){
    setBtnText(els.fOwner,"All Owners"); els.fOwner.title="All Owners"; return;
  }
  const id2name = id => (state.filtersData.owners.find(o=>o.id===id)?.name || 'Unknown');
  const names = state.selected.owners.map(id2name);
  const label = names.length>2 ? `${names.slice(0,2).join(', ')} +${names.length-2}` : names.join(', ');
  setBtnText(els.fOwner, label);
  els.fOwner.title = names.join(', ');
}
function setBtnText(btn, txt){ btn.textContent = txt; }
function clearFilters(){
  state.selected = { clients:[], projects:[], platforms:[], owners:[], statuses:[] };
  updateButtonsText();
  renderMenu(els.mProject, state.filtersData.projects, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
  setBtnText(els.fProject, "All Projects");
  refresh(true);
}

/* ===== Data ===== */
async function refresh(reset=false){
  if(state.loading) return;
  if(reset){ state.cursor=null; state.posts=[]; }
  showOverlay(true);
  await fetchMore(true);
  showOverlay(false);
}
async function onMore(){
  if(state.loading) return;
  showMoreLoading(true);
  await fetchMore(false);
  showMoreLoading(false);
}
async function fetchMore(replace){
  try{
    state.loading = true;
    const qs = new URLSearchParams();
    qs.set('pageSize','12');
    if(state.cursor) qs.set('cursor', state.cursor);
    state.selected.clients.forEach(v=>qs.append('client', v));
    state.selected.projects.forEach(v=>qs.append('project', v));
    state.selected.platforms.forEach(v=>qs.append('platform', v));
    state.selected.owners.forEach(v=>qs.append('owner', v));     // IDs
    state.selected.statuses.forEach(v=>qs.append('status', v));

    const r = await fetch(`/api/grid?${qs.toString()}`);
    const json = await r.json();
    if(!json.ok) throw new Error(json.error||'grid');

    state.cursor = json.next_cursor || null;
    const posts = (json.posts||[]).map(p => ({
      id:p.id, title:p.title, date:p.date, owner:p.owner, platforms:p.platforms||[], pinned:!!p.pinned, copy:p.copy||'',
      media: Array.isArray(p.media)? p.media : []
    }));
    if(replace) state.posts = posts; else state.posts = state.posts.concat(posts);

    renderGrid(state.posts);
    els.more.style.display = state.cursor ? 'inline-flex' : 'none';
  }catch(e){
    toast('No se pudo cargar el grid.');
    if(state.posts.length===0) els.grid.innerHTML = placeholderList(12);
  }finally{
    state.loading = false;
  }
}

/* ===== Render Grid ===== */
function renderGrid(list){
  const cards = list.map(renderCard);
  const rest = (12 - (cards.length % 12)) % 12;
  els.grid.innerHTML = (cards.length? cards.join('') : '') + placeholderList(list.length? rest : 12);
  hookCardEvents();
}
function renderCard(p){
  const first = p.media?.[0];
  const isVideo = first?.type === 'video';
  const hasMulti = (p.media?.length||0) > 1;
  const badges = `
    <div class="card__badges">
      ${p.pinned ? `<span class="badge-ico" title="Pinned">${svgPin()}</span>` : ``}
      ${isVideo ? `<span class="badge-ico" title="Video">${svgVideo()}</span>` : ``}
      ${hasMulti ? `<span class="badge-ico" title="Carousel">${svgCarousel()}</span>` : ``}
      ${hasMulti ? `<span class="badge-ico badge-ico__count" title="Items">${p.media.length}</span>` : ``}
    </div>`;
  const mediaEl = first
    ? (isVideo ? `<video class="card__media" preload="metadata" muted playsinline src="${escapeHtml(first.url)}"></video>`
               : `<img class="card__media" alt="" src="${escapeHtml(first.url)}"/>`)
    : `<div class="placeholder">No content</div>`;
  const date = p.date ? fmtDate(p.date) : '';
  return `
  <div class="card" data-id="${p.id}">
    ${ownerSquare(p.owner)}
    ${badges}
    ${mediaEl}
    <div class="card__hover">
      <div class="card__title">${escapeHtml(p.title)}</div>
      <div class="card__date">${date}</div>
    </div>
  </div>`;
}
function ownerSquare(name){
  if(!name) return '';
  return `<div class="card__owner" style="background:${ownerColor(name)}" title="${escapeHtml(name)}">${initials(name)}</div>`;
}
function placeholderList(n){ return Array.from({length:n},()=>`<div class="placeholder">No content</div>`).join(''); }

/* ===== Events por card ===== */
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

/* ===== Modal ===== */
function wireModal(){
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape') closeModal();
    if(!state.modal.open) return;
    if(e.key==='ArrowLeft') moveModal(-1);
    if(e.key==='ArrowRight') moveModal(+1);
  });
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
  const post = state.posts.find(p=>p.id===id); if(!post) return;
  state.modal.open = true; state.modal.assets = post.media?.length ? post.media : [{type:'image',url:''}]; state.modal.index=0;
  const copy = (post.copy||'').trim(); els.vCopy.textContent = copy; els.vCopy.hidden = !copy;
  renderModal(); document.body.style.overflow='hidden'; els.modal.classList.add('is-open'); els.vStage.focus();
}
function closeModal(){
  state.modal.open=false; els.modal.classList.remove('is-open'); document.body.style.overflow='';
  els.vStage.innerHTML=''; els.vDots.innerHTML=''; els.vCopy.textContent='';
}
function moveModal(step){ const tot = state.modal.assets.length; state.modal.index=(state.modal.index+step+tot)%tot; renderModal(); }
function renderModal(){
  const a = state.modal.assets[state.modal.index];
  els.vStage.innerHTML = a.type==='video'
    ? `<video preload="metadata" controls playsinline src="${escapeHtml(a.url)}" style="max-width:100%;max-height:60vh;object-fit:contain"></video>`
    : `<img alt="" src="${escapeHtml(a.url)}" style="max-width:100%;max-height:60vh;object-fit:contain"/>`;
  const tot = state.modal.assets.length; const cur = state.modal.index+1;
  els.vDots.textContent = tot>1 ? `${cur}/${tot}  ${Array.from({length:tot},(_,i)=>i===state.modal.index?'●':'○').join(' ')}` : '';
}

/* ===== UX helpers ===== */
function showOverlay(v){ if(els.overlay) els.overlay.hidden = !v; }
function showMoreLoading(v){ els.more.disabled=v; els.more.textContent = v?'Loading…':'Load more'; }
function toast(msg,ms=2200){ const d=document.createElement('div'); d.className='toast'; d.textContent=msg; els.toasts.appendChild(d); setTimeout(()=>d.remove(), ms); }
function fmtDate(iso){ const d=new Date(iso); if(isNaN(d)) return ''; return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,'0')}`; }
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function initials(name){ const p=(name||'').trim().split(/\s+/); return ((p[0]?.[0]||'')+(p[1]?.[0]||'')).toUpperCase()||'??'; }
const OWNER_COLORS=['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
function ownerColor(name){ const s=(name||''); let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0; return OWNER_COLORS[Math.abs(h)%OWNER_COLORS.length]; }

/* ===== Icons ===== */
function svgPin(){return `<svg viewBox="0 0 24 24"><path d="M14 3l7 7-4 1-3 7-2-2-2-2 7-3 1-4-4-4z"/></svg>`;}
function svgVideo(){return `<svg viewBox="0 0 24 24"><path d="M17 10l4-2v8l-4-2v2H3V8h14v2z"/></svg>`;}
function svgCarousel(){return `<svg viewBox="0 0 24 24"><path d="M3 7h14v10H3zM19 9h2v6h-2z"/></svg>`;}
