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
  selected: {
    clients: [],
    projects: [],
    platforms: [],
    owners: [],
    statuses: [],
  },
  cursor: null,
  posts: [],
  loading: false,
  modal: {
    open: false,
    assets: [],
    index: 0,
    lastFocus: null,
  }
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/* ===== Init ===== */
init();

async function init(){
  wireMenus();
  wireModal();
  els.more.addEventListener('click', onMore);
  els.refresh.addEventListener('click', ()=>refresh(true));
  els.clear.addEventListener('click', clearFilters);

  // initial placeholders (12)
  els.grid.innerHTML = skeleton(12);

  await loadFilters();         // carga y pinta menús
  await refresh(true);         // trae primeros 12 y pinta
}

/* ===== Filters UI ===== */
function wireMenus(){
  // Toggle abrir/cerrar
  document.querySelectorAll('.select').forEach(sel=>{
    const btn = sel.querySelector('.select__btn');
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const open = sel.classList.contains('open');
      document.querySelectorAll('.select').forEach(s=>s.classList.remove('open'));
      if(!open){
        sel.classList.add('open');
        btn.setAttribute('aria-expanded','true');
      }else{
        btn.setAttribute('aria-expanded','false');
      }
    });
  });

  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.select')){
      document.querySelectorAll('.select').forEach(s=>{
        s.classList.remove('open');
        const b = s.querySelector('.select__btn');
        b && b.setAttribute('aria-expanded','false');
      });
    }
  });
}

async function loadFilters(){
  try{
    const resp = await fetch('/api/filters');
    const json = await resp.json();
    if(!json.ok) throw new Error(json.error || 'filters');

    // Esperamos: { clients:[{id,name}], projects:[{id,name,clientIds?}], platforms:[string], owners:[{name}], statuses:[{name}] }
    state.filtersData = normalizeFilters(json);

    // Render menús
    renderMenu(els.mClient, state.filtersData.clients, 'clients', it=>it.name, it=>it.id, {multi:true, searchable:true});
    renderMenu(els.mProject, state.filtersData.projects, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
    renderMenu(els.mPlatform, state.filtersData.platforms, 'platforms', it=>it, it=>it, {multi:true, searchable:true});
    renderMenu(els.mOwner, state.filtersData.owners, 'owners', it=>it.name, it=>it.name, {multi:true, searchable:true, initials:true});
    renderMenu(els.mStatus, state.filtersData.statuses, 'statuses', it=>it.name, it=>it.name, {multi:false, searchable:true}); // single-select

    // Etiquetas por defecto
    setBtnText(els.fClient, "All Clients");
    setBtnText(els.fProject, "All Projects");
    setBtnText(els.fPlatform, "All Platforms");
    setOwnerBtnLabel(); // owners tiene formato especial
    setBtnText(els.fStatus, "All Status");
  }catch(err){
    toast("No se pudo cargar filtros; usando vacío.");
    state.filtersData = {clients:[],projects:[],platforms:[],owners:[],statuses:[]};
  }
}

function normalizeFilters(json){
  // Asegura que vengan nombres "bonitos" (no IDs) y que projects tengan clientIds si existen
  const clients = (json.clients||[]).map(c=>({ id: c.id ?? c.value ?? c.name, name: c.name ?? String(c.value||c.id||'') || 'Untitled' }));
  const owners = (json.owners||[]).map(o=>({ name: o.name ?? String(o.value||'') || 'Unknown' }));
  const platforms = (json.platforms||[]).map(p=> (typeof p==='string' ? p : (p.name ?? '')) ).filter(Boolean);
  const statuses = (json.statuses||[]).map(s=>({ name: s.name ?? String(s.value||'') })).filter(s=>s.name);

  let projects = (json.projects||[]).map(p=>({
    id: p.id ?? p.value ?? p.name,
    name: p.name ?? String(p.value||p.id||'') || 'Untitled',
    clientIds: Array.isArray(p.clientIds) ? p.clientIds : []
  }));

  return { clients, projects, platforms, owners, statuses };
}

function renderMenu(container, list, key, labelFn, valueFn, opts={multi:true, searchable:true, initials:false}){
  container.innerHTML = '';

  // Search
  if(opts.searchable){
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
        div.setAttribute('aria-selected', isSelected(key,val) ? 'true' : 'false');

        // Owners pueden mostrar iniciales como apoyo
        if(opts.initials){
          const badge = document.createElement('span');
          badge.className = 'owner-chip';
          badge.textContent = initials(lbl);
          badge.style.cssText = `
            display:inline-flex;align-items:center;justify-content:center;
            width:20px;height:20px;border-radius:6px;margin-right:6px;
            background:${ownerColor(lbl)};color:#fff;font-size:10px;font-weight:700;
          `;
          div.appendChild(badge);
        }

        const txt = document.createElement('span');
        txt.textContent = lbl;
        div.appendChild(txt);

        if(isSelected(key,val)) div.classList.add('selected');

        div.addEventListener('click', (e)=>{
          e.stopPropagation();
          if(key==='statuses'){ // single-select
            state.selected.statuses = [val];
            closeAllSelects();
            setBtnText(els.fStatus, lbl);
            refresh(true);
          }else{
            toggleSelect(key, val);
            highlightSelection(container, key, valueFn, labelFn);
            updateButtonsText();
            if(key==='clients'){ filterProjectsForClients(); }
            // No cerramos el menú en multi-select
            refresh(true);
          }
        });

        box.appendChild(div);
      });
  };

  renderList('');
}

function highlightSelection(container, key, valueFn, labelFn){
  const items = container.querySelectorAll('.option');
  items.forEach(el=>{
    const lbl = el.querySelector('span:last-child')?.textContent || '';
    // Recalcular “val” basado en label (simple)
    const list = (state.filtersData[key] || []);
    const it = list.find(x => (labelFn(x)||'') === lbl);
    const val = it ? valueFn(it) : lbl;
    el.classList.toggle('selected', isSelected(key, val));
    el.setAttribute('aria-selected', isSelected(key, val) ? 'true' : 'false');
  });
}

function isSelected(key, val){
  return state.selected[key].includes(val);
}

function toggleSelect(key, val){
  const arr = state.selected[key];
  const ix = arr.indexOf(val);
  if(ix>=0) arr.splice(ix,1); else arr.push(val);
}

function filterProjectsForClients(){
  const all = state.filtersData.projects;
  const clients = state.selected.clients;
  let show = all;
  if(clients.length){
    show = all.filter(p => p.clientIds && p.clientIds.some(id => clients.includes(id)));
  }
  renderMenu(els.mProject, show, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
  setBtnText(els.fProject, "All Projects");
  state.selected.projects = [];
}

function updateButtonsText(){
  setBtnText(els.fClient, state.selected.clients.length ? `${state.selected.clients.length} selected` : "All Clients");
  setBtnText(els.fProject, state.selected.projects.length ? `${state.selected.projects.length} selected` : "All Projects");
  setBtnText(els.fPlatform, state.selected.platforms.length ? `${state.selected.platforms.length} selected` : "All Platforms");
  setOwnerBtnLabel();
  setBtnText(els.fStatus, state.selected.statuses.length ? state.selected.statuses[0] : "All Status");

  const activeCount = (
    state.selected.clients.length +
    state.selected.projects.length +
    state.selected.platforms.length +
    state.selected.owners.length +
    state.selected.statuses.length
  );
  els.clear.disabled = activeCount===0;
  els.badgeCount.textContent = String(activeCount);
  els.badgeCount.hidden = activeCount===0;
}

function setOwnerBtnLabel(){
  if(!state.selected.owners.length){
    setBtnText(els.fOwner, "All Owners");
    els.fOwner.title = "All Owners";
    return;
  }
  const chosen = state.selected.owners.slice(0,2);
  const more = state.selected.owners.length - chosen.length;
  const label = more>0 ? `${chosen.join(', ')} +${more}` : chosen.join(', ');
  setBtnText(els.fOwner, label);
  els.fOwner.title = state.selected.owners.join(', ');
}

function closeAllSelects(){
  document.querySelectorAll('.select').forEach(s=>{
    s.classList.remove('open');
    const b = s.querySelector('.select__btn');
    b && b.setAttribute('aria-expanded','false');
  });
}

function clearFilters(){
  state.selected = { clients:[], projects:[], platforms:[], owners:[], statuses:[] };
  updateButtonsText();
  // Re-render menús dependientes
  renderMenu(els.mProject, state.filtersData.projects, 'projects', it=>it.name, it=>it.id, {multi:true, searchable:true});
  setBtnText(els.fProject, "All Projects");
  refresh(true);
}

/* ===== Data ===== */
async function refresh(reset=false){
  if(state.loading) return;
  if(reset){ state.cursor = null; state.posts = []; }
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
    const params = new URLSearchParams();
    params.set('pageSize','12');
    if(state.cursor) params.set('cursor', state.cursor);

    // append multi-values
    state.selected.clients.forEach(v=>params.append('client', v));
    state.selected.projects.forEach(v=>params.append('project', v));
    state.selected.platforms.forEach(v=>params.append('platform', v));
    state.selected.owners.forEach(v=>params.append('owner', v));
    state.selected.statuses.forEach(v=>params.append('status', v));

    const resp = await fetch(`/api/grid?${params.toString()}`);
    const json = await resp.json();
    if(!json.ok) throw new Error(json.error || 'grid');

    state.cursor = json.next_cursor || null;

    const posts = (json.posts || []).map(mapPostShape);
    if(replace) state.posts = posts; else state.posts = state.posts.concat(posts);

    renderGrid(state.posts);

    els.more.style.display = state.cursor ? 'inline-flex' : 'none';
  }catch(err){
    toast("No se pudo cargar el grid.");
    if(state.posts.length===0){
      // 12 placeholders si no hay nada
      els.grid.innerHTML = placeholderList(12);
    }
  }finally{
    state.loading = false;
  }
}

function mapPostShape(p){
  // Asegura compat: p.assets[] o p.media[]
  const assets = Array.isArray(p.assets) ? p.assets :
                 Array.isArray(p.media)  ? p.media  : [];
  return {
    id: p.id,
    title: p.title || 'Untitled',
    date: p.date || null,
    owner: p.owner || null,
    platforms: p.platforms || [],
    pinned: !!p.pinned,
    copy: p.copy || '',
    media: assets.map(a => ({
      type: a.type === 'video' ? 'video' : 'image',
      url: a.url || ''
    }))
  };
}

/* ===== Render Grid ===== */
function renderGrid(list){
  const cards = list.map(renderCard);
  // completar a múltiplos de 12 (si es la primera página)
  const slots = (12 - (cards.length % 12)) % 12;
  if(list.length===0){
    els.grid.innerHTML = placeholderList(12);
  }else{
    els.grid.innerHTML = cards.join('') + placeholderList(slots);
  }
  hookCardEvents();
}

function renderCard(p){
  const first = p.media && p.media[0];
  const isVideo = first && first.type === 'video';
  const hasMulti = (p.media?.length || 0) > 1;

  const ownerBadge = ownerSquare(p.owner);

  const badges = `
    <div class="card__badges">
      ${p.pinned ? `<span class="badge-ico" title="Pinned">${svgPin()}</span>` : ``}
      ${isVideo ? `<span class="badge-ico" title="Video">${svgVideo()}</span>` : ``}
      ${hasMulti ? `<span class="badge-ico" title="Carousel">${svgCarousel()}</span>` : ``}
      ${hasMulti ? `<span class="badge-ico badge-ico__count" title="Items">${p.media.length}</span>` : ``}
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
  const initialsTxt = initials(name);
  const color = ownerColor(name);
  return name ? `<div class="card__owner" style="background:${color}" title="${escapeHtml(name)}">${initialsTxt}</div>` : '';
}

function placeholderList(n){
  if(!n) return '';
  return Array.from({length:n}, ()=>`<div class="placeholder">No content</div>`).join('');
}

function skeleton(n){
  return placeholderList(n);
}

/* ===== Card events ===== */
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
  state.modal.lastFocus = document.activeElement;

  // copy
  const copy = (post.copy||"").trim();
  els.vCopy.textContent = copy;
  els.vCopy.hidden = !copy;

  renderModal();

  document.body.style.overflow = 'hidden';
  els.modal.classList.add('is-open');

  // focus trap starts on stage
  els.vStage.focus();
}

function closeModal(){
  state.modal.open = false;
  els.modal.classList.remove('is-open');
  document.body.style.overflow = '';
  els.vStage.innerHTML = '';
  els.vDots.innerHTML = '';
  els.vCopy.textContent = '';
  if(state.modal.lastFocus && state.modal.lastFocus.focus){
    state.modal.lastFocus.focus();
  }
}

function moveModal(step){
  const tot = state.modal.assets.length;
  state.modal.index = (state.modal.index + step + tot) % tot;
  renderModal();
}

function renderModal(){
  const a = state.modal.assets[state.modal.index];
  els.vStage.innerHTML = a.type==='video'
    ? `<video preload="metadata" controls playsinline src="${escapeHtml(a.url)}" style="max-width:100%;max-height:60vh;object-fit:contain"></video>`
    : `<img alt="" src="${escapeHtml(a.url)}" style="max-width:100%;max-height:60vh;object-fit:contain" />`;

  const tot = state.modal.assets.length;
  const cur = state.modal.index+1;
  // Dots (una sola línea)
  const dots = Array.from({length:tot}, (_,i)=> i===state.modal.index ? '●' : '○').join(' ');
  els.vDots.textContent = tot>1 ? `${cur}/${tot}  ${dots}` : '';
}

/* ===== UX helpers ===== */
function showOverlay(v){ els.overlay.hidden = !v; }
function showMoreLoading(v){
  els.more.disabled = v;
  els.more.textContent = v ? 'Loading…' : 'Load more';
}

function toast(msg, ms=2500){
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  els.toasts.appendChild(div);
  setTimeout(()=>div.remove(), ms);
}

function fmtDate(iso){
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const m = MONTHS[d.getMonth()];
  const dd = String(d.getDate()).padStart(2,'0');
  return `${m} ${dd}`;
}

function escapeHtml(s){
  return (s||"").replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function initials(name){
  const n = (name||'').trim();
  if(!n) return '??';
  const parts = n.split(/\s+/);
  const a = (parts[0]||'')[0]||'';
  const b = (parts[1]||'')[0]||'';
  return (a+b || a).toUpperCase();
}

const OWNER_COLORS = ['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
function ownerColor(name){
  const s = (name||'').trim();
  if(!s) return '#6B7280';
  let h=0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i))|0;
  const idx = Math.abs(h) % OWNER_COLORS.length;
  return OWNER_COLORS[idx];
}

/* ===== Icons (SVG) ===== */
function svgPin(){
  return `<svg viewBox="0 0 24 24"><path d="M14 3l7 7-4 1-3 7-2-2-2-2 7-3 1-4-4-4z"/></svg>`;
}
function svgVideo(){
  return `<svg viewBox="0 0 24 24"><path d="M17 10l4-2v8l-4-2v2H3V8h14v2z"/></svg>`;
}
function svgCarousel(){
  return `<svg viewBox="0 0 24 24"><path d="M3 7h14v10H3zM19 9h2v6h-2z"/></svg>`;
}
