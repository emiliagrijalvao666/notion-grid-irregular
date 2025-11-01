// api/filters.js
import { notion } from './_notion.js';

// IDs de Notion: preferimos los nombres NOTION_* pero soportamos alias viejos
const CONTENT_DB_ID   = process.env.NOTION_DB_ID       || process.env.CONTENT_DB_ID       || process.env.NOTION_DATABASE_ID;
const PROJECTS_DB_ID  = process.env.NOTION_DB_PROJECTS || process.env.PROJECTS_DB_ID       || null;
const CLIENTS_DB_ID   = process.env.NOTION_DB_CLIENTS  || process.env.CLIENTS_DB_ID        || null;

// Candidatos de propiedades dentro del Content DB
const OWNER_CANDS        = ['Owner','Owners','Responsable','Asignado a'];
const STATUS_CANDS       = ['Status','Estado','State'];
const PLATFORM_CANDS     = ['Platform','Platforms'];
const REL_CLIENTS_CANDS  = ['Client','Clients','Brand','Brands','PostClient'];
const REL_PROJECTS_CANDS = ['Project','Projects','PostProject'];

export default async function handler(req, res){
  try{
    if(!CONTENT_DB_ID) return res.json({ ok:false, error:'Missing NOTION_DB_ID / CONTENT_DB_ID' });

    // --- meta de Content para conocer llaves y tipos
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });

    const ownerKey     = pickKey(meta, OWNER_CANDS, 'people');
    const statusKey    = pickKey(meta, STATUS_CANDS, 'select');
    const platformKey  = pickKey(meta, PLATFORM_CANDS, 'multi_select'); // también aceptamos 'select' abajo
    const relClientKey = pickKey(meta, REL_CLIENTS_CANDS, 'relation');
    const relProjKey   = pickKey(meta, REL_PROJECTS_CANDS, 'relation');

    // --- colecciones
    const [owners, statuses, platforms] = await collectFromContent({
      ownerKey, statusKey, platformKey
    });

    // --- clients
    const clients = await collectClients({ relClientKey });

    // --- projects (con clientIds para cascada)
    const projects = await collectProjects({ relProjKey });

    res.json({
      ok: true,
      platforms,
      statuses,
      owners,
      clients,
      projects
    });

  }catch(err){
    res.json({ ok:false, error: err.message || 'filters failed' });
  }
}

/* ---------------- helpers ---------------- */

function pickKey(meta, candidates, type){
  for(const k of candidates){
    const p = meta.properties?.[k];
    if(!p) continue;
    if(!type || p.type === type) return k;
    // tolerancia: Platforms podría ser 'select'
    if(type==='multi_select' && p.type==='select') return k;
  }
  return undefined;
}

async function collectFromContent({ ownerKey, statusKey, platformKey }){
  const ownersSet = new Map();  // id -> name
  const statusesSet = new Set();
  const platformsSet = new Set();

  let cursor;
  let loops = 0;
  do{
    const resp = await notion.databases.query({
      database_id: CONTENT_DB_ID,
      start_cursor: cursor,
      page_size: 50,
      // traemos campos mínimos; Notion igual retorna la página completa
    });
    resp.results.forEach(page=>{
      if(ownerKey){
        const prop = page.properties?.[ownerKey];
        if(prop?.type === 'people'){
          (prop.people||[]).forEach(p=>{
            const id = p.id; const name = p.name || p.person?.email || 'Unknown';
            if(id) ownersSet.set(id, name);
          });
        }
      }
      if(statusKey){
        const prop = page.properties?.[statusKey];
        if(prop?.type==='select' && prop.select?.name){
          statusesSet.add(prop.select.name);
        }
      }
      if(platformKey){
        const prop = page.properties?.[platformKey];
        if(prop?.type==='multi_select'){
          (prop.multi_select||[]).forEach(o=> o?.name && platformsSet.add(o.name));
        }else if(prop?.type==='select' && prop.select?.name){
          platformsSet.add(prop.select.name);
        }
      }
    });
    cursor = resp.has_more ? resp.next_cursor : null;
    loops++;
  }while(cursor && loops < 20); // límite seguridad

  const owners = Array.from(ownersSet.entries()).map(([id,name])=>({ id, name }));
  owners.sort((a,b)=> a.name.localeCompare(b.name));

  const statuses = Array.from(statusesSet);
  statuses.sort((a,b)=> a.localeCompare(b));

  const platforms = Array.from(platformsSet);
  platforms.sort((a,b)=> a.localeCompare(b));

  return [owners, statuses.map(name=>({name})), platforms];
}

async function collectClients({ relClientKey }){
  // Preferimos Clients DB si existe; si no, derivamos del Content DB
  if(CLIENTS_DB_ID){
    const out = [];
    let cursor, loops=0;
    do{
      const resp = await notion.databases.query({ database_id: CLIENTS_DB_ID, start_cursor: cursor, page_size: 50 });
      resp.results.forEach(p=>{
        const name = readTitle(p);
        if(name) out.push({ id: p.id, name });
      });
      cursor = resp.has_more ? resp.next_cursor : null;
      loops++;
    }while(cursor && loops<20);
    out.sort((a,b)=> a.name.localeCompare(b.name));
    return out;
  }

  if(!relClientKey) return [];
  // Sin Clients DB: obtenemos las referencias únicas que aparecen en Content
  const found = new Map(); // id->name
  let cursor, loops=0;
  do{
    const resp = await notion.databases.query({ database_id: CONTENT_DB_ID, start_cursor: cursor, page_size: 50 });
    resp.results.forEach(page=>{
      const prop = page.properties?.[relClientKey];
      if(prop?.type==='relation'){
        (prop.relation||[]).forEach(ref=>{
          const id = ref.id; if(id) found.set(id, found.get(id)||'');
        });
      }
    });
    cursor = resp.has_more ? resp.next_cursor : null;
    loops++;
  }while(cursor && loops<20);

  // Intento de resolver nombres (best-effort)
  const clients = [];
  for(const id of found.keys()){
    try{
      const pg = await notion.pages.retrieve({ page_id: id });
      clients.push({ id, name: readTitle(pg) || 'Untitled' });
    }catch{}
  }
  clients.sort((a,b)=> a.name.localeCompare(b.name));
  return clients;
}

async function collectProjects({ relProjKey }){
  // Preferimos Projects DB si existe; ahí buscamos la relación "Client"
  if(PROJECTS_DB_ID){
    // Identificamos cuál propiedad de Projects se llama "Client"
    const projMeta = await notion.databases.retrieve({ database_id: PROJECTS_DB_ID });
    const clientKeyInProjects =
      ['Client','Clients','Brand','Brands'].find(k => projMeta.properties?.[k]?.type === 'relation');

    const out = [];
    let cursor, loops=0;
    do{
      const resp = await notion.databases.query({ database_id: PROJECTS_DB_ID, start_cursor: cursor, page_size: 50 });
      resp.results.forEach(p=>{
        const id = p.id;
        const name = readTitle(p) || 'Untitled';
        const clientIds = [];
        if(clientKeyInProjects){
          const rel = p.properties?.[clientKeyInProjects];
          if(rel?.type==='relation'){
            (rel.relation||[]).forEach(r=> r?.id && clientIds.push(r.id));
          }
        }
        out.push({ id, name, clientIds });
      });
      cursor = resp.has_more ? resp.next_cursor : null;
      loops++;
    }while(cursor && loops<20);

    out.sort((a,b)=> a.name.localeCompare(b.name));
    return out;
  }

  // Sin Projects DB: al menos devolvemos nombres vistos en Content y, si es posible, resolvemos clientIds por página
  if(!relProjKey) return [];
  const found = new Map(); // id -> {id,name,clientIds:Set}
  let cursor, loops=0;
  do{
    const resp = await notion.databases.query({ database_id: CONTENT_DB_ID, start_cursor: cursor, page_size: 50 });
    resp.results.forEach(page=>{
      const projRel = page.properties?.[relProjKey];
      if(projRel?.type==='relation'){
        (projRel.relation||[]).forEach(ref=>{
          if(!found.has(ref.id)) found.set(ref.id, { id: ref.id, name: '', clientIds: new Set() });
        });
      }
      // si la página tiene relación Client, la añadimos como pista
      const clientRel = Object.values(page.properties||{}).find(p=>p?.type==='relation');
      if(clientRel?.type==='relation'){
        const clientsOnPage = (clientRel.relation||[]).map(r=>r.id);
        // los asociamos débilmente a todos los proyectos vistos en la misma página
        const last = [...found.values()];
        last.forEach(pr => clientsOnPage.forEach(cid => pr.clientIds.add(cid)));
      }
    });
    cursor = resp.has_more ? resp.next_cursor : null;
    loops++;
  }while(cursor && loops<20);

  // Resolver nombres de projects
  const projects = [];
  for(const pr of found.values()){
    try{
      const pg = await notion.pages.retrieve({ page_id: pr.id });
      projects.push({ id: pr.id, name: readTitle(pg) || 'Untitled', clientIds: Array.from(pr.clientIds) });
    }catch{
      projects.push({ id: pr.id, name: 'Untitled', clientIds: Array.from(pr.clientIds) });
    }
  }
  projects.sort((a,b)=> a.name.localeCompare(b.name));
  return projects;
}

function readTitle(pageOrProp){
  // acepta page o prop.title
  if(pageOrProp?.properties){ // página
    const anyTitle = Object.values(pageOrProp.properties).find(p => p?.type==='title');
    if(!anyTitle) return '';
    return (anyTitle.title||[]).map(t=>t.plain_text).join('').trim();
  }
  if(pageOrProp?.type==='title'){
    return (pageOrProp.title||[]).map(t=>t.plain_text).join('').trim();
  }
  return '';
}
