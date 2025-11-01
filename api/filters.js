// api/filters.js
import { notion } from './_notion.js';

const CONTENT_DB_ID    = process.env.NOTION_DB_ID || process.env.CONTENT_DB_ID || process.env.NOTION_DATABASE_ID;
const CLIENTS_DB_ID    = process.env.NOTION_DB_CLIENTS || process.env.NOTION_DB_BRANDS || process.env.NOTION_DB_CLIENT || process.env.NOTION_DB_BRAND;
const PROJECTS_DB_ID   = process.env.NOTION_DB_PROJECTS;

const TITLE_CANDS      = ['Name','Nombre','Title','Título'];
const PLATFORM_CANDS   = ['Platform','Platforms'];
const STATUS_CANDS     = ['Status','Estado','State'];
const REL_CLIENTS_CANDS  = ['Client','Clients','Brand','Brands','PostClient'];
const REL_PROJECTS_CANDS = ['Project','Projects','PostProject'];

export default async function handler(req, res){
  try{
    if (!CONTENT_DB_ID) return res.json({ ok:false, error:'Missing NOTION_DB_ID / CONTENT_DB_ID' });

    // cache CDN (5 min; SWR 10 min)
    res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');

    const type = String(req.query.type||'all');

    // — Schema (platforms/status) siempre viene del Content DB meta
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });
    const platformKey = firstExisting(meta, PLATFORM_CANDS, 'multi_select');
    const statusKey   = firstExisting(meta, STATUS_CANDS, 'select');

    const platforms = platformKey ? (meta.properties[platformKey].multi_select?.options||[]).map(o=>o.name).filter(Boolean) : [];
    const statuses  = statusKey   ? (meta.properties[statusKey].select?.options||[]).map(o=>o.name).filter(Boolean)   : [];

    if (type === 'schema'){
      return res.json({ ok:true, platforms, statuses });
    }

    // — Clients
    let clients = [];
    if (CLIENTS_DB_ID){
      clients = await loadIdNameList(CLIENTS_DB_ID);
    } else {
      // Fallback: obtiene ids de la relación y resuelve títulos de las páginas
      const relKey = firstExisting(meta, REL_CLIENTS_CANDS, 'relation');
      clients = relKey ? await collectRelationNames(CONTENT_DB_ID, relKey) : [];
    }

    if (type === 'clients'){
      return res.json({ ok:true, clients });
    }

    // — Projects
    let projects = [];
    if (PROJECTS_DB_ID){
      projects = await loadIdNameList(PROJECTS_DB_ID, /*includeClientIds=*/true);
    } else {
      const relKey = firstExisting(meta, REL_PROJECTS_CANDS, 'relation');
      projects = relKey ? await collectRelationNames(CONTENT_DB_ID, relKey) : [];
    }

    if (type === 'projects'){
      return res.json({ ok:true, projects });
    }

    // — all (completo)
    return res.json({ ok:true, platforms, statuses, owners: await ownersFromContent(meta), clients, projects });

  } catch (e){
    return res.json({ ok:false, error: e.message || 'filters failed' });
  }
}

/* ---------- helpers ---------- */

function firstExisting(meta, candidates, type){
  for (const key of candidates){
    const prop = meta.properties[key];
    if (!prop) continue;
    if (!type) return key;
    if (prop.type === type) return key;
  }
  return undefined;
}

async function ownersFromContent(meta){
  // Owners salen directamente de las opciones people que ya usas en el grid (ID es crítico)
  const OWNER_CANDS = ['Owner','Owners','Responsable','Asignado a'];
  const ownerKey = firstExisting(meta, OWNER_CANDS, 'people');
  if (!ownerKey) return [];
  // No hay catálogo de owners en meta, así que los resolvemos sobre los posts más recientes (100) para poblar el menú.
  const resp = await notion.databases.query({
    database_id: meta.id,
    page_size: 100,
    sorts: [{ timestamp:'last_edited_time', direction:'descending' }]
  });
  const set = new Map(); // id -> name
  for (const page of resp.results){
    const pp = page.properties[ownerKey];
    if (pp?.type!=='people') continue;
    for (const p of (pp.people||[])){
      const id = p.id;
      const name = p.name || p.person?.email || 'Unknown';
      if (id && !set.has(id)) set.set(id, name);
    }
  }
  return Array.from(set.entries()).map(([id,name])=>({ id, name }));
}

async function loadIdNameList(dbId, includeClientIds=false){
  // Detecta la key de título
  const meta = await notion.databases.retrieve({ database_id: dbId });
  const titleKey = getTitleKey(meta);
  let cur; const out = [];
  do{
    const resp = await notion.databases.query({ database_id: dbId, start_cursor: cur, page_size: 100 });
    for (const page of resp.results){
      const name = readTitle(page.properties[titleKey]) || 'Untitled';
      const item = { id: page.id, name };
      if (includeClientIds){
        // intenta mapear relación con Clients si existe
        const relKey = firstExisting(meta, REL_CLIENTS_CANDS, 'relation');
        if (relKey){
          const rel = page.properties[relKey];
          const ids = (rel?.relation||[]).map(r=>r.id);
          item.clientIds = ids;
        } else {
          item.clientIds = [];
        }
      }
      out.push(item);
    }
    cur = resp.has_more ? resp.next_cursor : undefined;
  } while (cur);
  return out;
}

async function collectRelationNames(dbId, relKey){
  // Escanea posts recientes (200) y junta IDs únicos de la relación
  const resp = await notion.databases.query({
    database_id: dbId,
    page_size: 200,
    sorts: [{ timestamp:'last_edited_time', direction:'descending' }]
  });
  const ids = new Set();
  for (const page of resp.results){
    const rel = page.properties?.[relKey];
    (rel?.relation||[]).forEach(r=> ids.add(r.id));
  }
  // Resuelve nombres por lotes
  const items = [];
  for (const id of ids){
    try{
      const pg = await notion.pages.retrieve({ page_id: id });
      const name = readAnyTitle(pg.properties) || 'Untitled';
      items.push({ id, name });
    }catch{}
  }
  return items;
}

function getTitleKey(meta){
  for (const [k,v] of Object.entries(meta.properties||{})){
    if (v.type === 'title') return k;
  }
  // fallback
  for (const cand of TITLE_CANDS){
    if (meta.properties[cand]?.type==='title') return cand;
  }
  return TITLE_CANDS.find(k => meta.properties[k]) || Object.keys(meta.properties||{})[0];
}

function readTitle(prop){
  if (!prop || prop.type!=='title') return '';
  return (prop.title||[]).map(t=>t.plain_text).join('').trim();
}
function readAnyTitle(props={}){
  // encuentra la primera propiedad de tipo "title"
  for (const [k,v] of Object.entries(props)){
    if (v.type==='title') return readTitle(v);
  }
  // fallback grosero
  const first = Object.values(props)[0];
  return readTitle(first);
}
