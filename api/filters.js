// api/filters.js
import { notion } from './_notion.js';

const CONTENT_DB_ID  = process.env.NOTION_DB_ID || process.env.CONTENT_DB_ID || process.env.NOTION_DATABASE_ID;
const CLIENTS_DB_ID  = process.env.NOTION_DB_CLIENTS || process.env.NOTION_DB_BRANDS;
const PROJECTS_DB_ID = process.env.NOTION_DB_PROJECTS;

const PLATFORM_CANDS = ['Platform','Platforms'];
const STATUS_CANDS   = ['Status','Estado','State'];
const OWNER_CANDS    = ['Owner','Owners','Responsable','Asignado a'];
const PROJ_CLIENT_REL_CANDS = ['Client','Clients','Brand','Brands'];

export default async function handler(req, res){
  try{
    if(!CONTENT_DB_ID) return res.json({ ok:false, error:'Missing NOTION_DB_ID / CONTENT_DB_ID' });

    // meta del Content DB
    const meta = await notion.databases.retrieve({ database_id: CONTENT_DB_ID });

    const platformKey = firstExisting(meta, PLATFORM_CANDS, 'multi_select');
    const statusKey   = firstExisting(meta, STATUS_CANDS, ['status','select']); // admite ambos
    const ownerKey    = firstExisting(meta, OWNER_CANDS, 'people');

    // platforms
    const platforms = platformKey
      ? (meta.properties[platformKey].multi_select?.options || []).map(o=>o.name).filter(Boolean)
      : [];

    // statuses
    let statuses = [];
    if(statusKey){
      const prop = meta.properties[statusKey];
      if(prop.type === 'status'){
        statuses = (prop.status?.options || []).map(o=>({ name:o.name }));
      }else if(prop.type === 'select'){
        statuses = (prop.select?.options || []).map(o=>({ name:o.name }));
      }
    }

    // owners (escaneo de páginas para construir set único)
    const ownersMap = new Map();
    if(ownerKey){
      let cursor;
      for(let loops=0; loops<20; loops++){ // hasta 1000 páginas
        const resp = await notion.databases.query({
          database_id: CONTENT_DB_ID,
          start_cursor: cursor,
          page_size: 50
        });
        for(const page of resp.results){
          const p = page.properties[ownerKey];
          if(p?.type === 'people'){
            for(const person of (p.people||[])){
              const id   = person.id;
              const name = person.name || person.person?.email || 'Unknown';
              if(!ownersMap.has(id)) ownersMap.set(id, { id, name });
            }
          }
        }
        if(!resp.has_more) break;
        cursor = resp.next_cursor;
      }
    }
    const owners = Array.from(ownersMap.values());

    // clients
    const clients = CLIENTS_DB_ID ? await readSimpleList(CLIENTS_DB_ID) : [];

    // projects (con clientIds si existe relación)
    let projects = [];
    if(PROJECTS_DB_ID){
      const metaProj = await notion.databases.retrieve({ database_id: PROJECTS_DB_ID });
      const relClientKey = firstExisting(metaProj, PROJ_CLIENT_REL_CANDS, 'relation');
      let cursor;
      for(let loops=0; loops<50; loops++){
        const resp = await notion.databases.query({
          database_id: PROJECTS_DB_ID,
          start_cursor: cursor,
          page_size: 50,
        });
        for(const page of resp.results){
          const name = readTitle(page);
          const id   = page.id;
          const rel  = relClientKey ? page.properties[relClientKey] : null;
          const clientIds = (rel?.type === 'relation')
            ? (rel.relation||[]).map(r=>r.id)
            : [];
          projects.push({ id, name, clientIds });
        }
        if(!resp.has_more) break;
        cursor = resp.next_cursor;
      }
    }

    return res.json({ ok:true, platforms, statuses, owners, clients, projects });

  }catch(e){
    return res.json({ ok:false, error: e.message || 'filters failed' });
  }
}

/* ---------- helpers ---------- */
function firstExisting(meta, candidates, types){
  const want = Array.isArray(types) ? types : (types ? [types] : null);
  for(const key of candidates){
    const prop = meta.properties[key];
    if(!prop) continue;
    if(!want) return key;
    if(want.includes(prop.type)) return key;
  }
  return undefined;
}

async function readSimpleList(dbId){
  let out = [];
  let cursor;
  for(let loops=0; loops<50; loops++){
    const resp = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 50 });
    out = out.concat(resp.results.map(p => ({ id:p.id, name: readTitle(p) })));
    if(!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return out;
}

function readTitle(page){
  const props = page.properties || {};
  for(const k of Object.keys(props)){
    const prop = props[k];
    if(prop?.type === 'title'){
      return (prop.title||[]).map(t=>t.plain_text).join('').trim() || 'Untitled';
    }
  }
  return 'Untitled';
}
