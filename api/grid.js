import { notion, DB, err, clamp } from "./_notion.js";
import { detectContentSchema, } from "./schema.js";

// Detectar si archivo es imagen o video por extensión simple
function guessTypeFromUrl(url=""){
  const u = url.toLowerCase();
  if(/\.(mp4|mov|webm|m4v)\b/.test(u)) return 'video';
  return 'image';
}

export default async function handler(req, res){
  if(req.method !== 'GET') return err(res,405,'Method not allowed');
  if(!DB.content) return err(res,500,'Missing CONTENT_DB_ID');

  const pageSize = clamp(parseInt(req.query.pageSize||'12',10), 6, 24);
  const start = req.query.cursor || undefined;

  const selected = {
    clients: [].concat(req.query.client||[]),
    projects:[].concat(req.query.project||[]),
    platforms:[].concat(req.query.platform||[]),
    owners:  [].concat(req.query.owner||[]),   // deben venir IDs!
    statuses:[].concat(req.query.status||[])
  };

  const schema = await detectContentSchema(DB.content);
  if(!schema) return err(res,500,'Cannot read Content DB schema');

  const filters = [];

  // Ocultar si existen
  if(schema.hideKey){
    filters.push({ property: schema.hideKey, checkbox: { equals:false }});
  }

  // CLIENTS (relation contains)
  if(selected.clients.length && schema.clientKey){
    filters.push({
      or: selected.clients.map(id => ({
        property: schema.clientKey, relation: { contains: id }
      }))
    });
  }

  // PROJECTS (relation contains)
  if(selected.projects.length && schema.projectKey){
    filters.push({
      or: selected.projects.map(id => ({
        property: schema.projectKey, relation: { contains: id }
      }))
    });
  }

  // PLATFORMS (multi-select contains)
  if(selected.platforms.length && schema.platformKey){
    const type = 'multi_select';
    filters.push({
      or: selected.platforms.map(v => ({
        property: schema.platformKey, [type]: { contains: v }
      }))
    });
  }

  // OWNERS (people contains — IDs)
  if(selected.owners.length && schema.ownerKey){
    filters.push({
      or: selected.owners.map(id => ({
        property: schema.ownerKey, people: { contains: id }
      }))
    });
  }

  // STATUS (single)
  if(selected.statuses.length && schema.statusKey){
    const v = selected.statuses[0];
    const p = {}; p[schema.statusKey] = { equals: v }; // para select/status Notion usa status.select/equals internamente
    // Usar forma genérica soportada por SDK:
    filters.push({ property: schema.statusKey, status: { equals: v }});
  }

  const query = {
    database_id: DB.content,
    page_size: pageSize,
    start_cursor: start,
    filter: filters.length ? { and: filters } : undefined,
    sorts: [
      ...(schema.pinnedKey ? [{ property: schema.pinnedKey, direction:'descending' }] : []),
      ...(schema.dateKey   ? [{ property: schema.dateKey,   direction:'descending' }] : [{ timestamp:'created_time', direction:'descending' }])
    ]
  };

  let resp;
  try{
    resp = await notion.databases.query(query);
  }catch(e){
    return err(res,400, e.message || 'Notion query failed');
  }

  // Mapear resultados
  const posts = resp.results.map(pg => {
    const p = pg.properties;

    const title = (p[schema.titleKey]?.title || []).map(r=>r.plain_text).join('').trim() || 'Untitled';
    const date  = p[schema.dateKey]?.date?.start || pg.created_time;
    const owner = (p[schema.ownerKey]?.people || [])[0]?.name || null;
    const platforms = (p[schema.platformKey]?.multi_select || p[schema.platformKey]?.select ? (p[schema.platformKey]?.multi_select||[]).map(o=>o.name) : []);
    const pinned = !!(p[schema.pinnedKey]?.checkbox);

    // copy
    let copy = '';
    const cprop = p[schema.copyKey];
    if(cprop?.type==='rich_text') copy = (cprop.rich_text||[]).map(r=>r.plain_text).join('').trim();

    // assets (unión de todas las fileKeys detectadas)
    const media = [];
    (schema.fileKeys||[]).forEach(k=>{
      const fp = p[k];
      if(fp?.type==='files' && Array.isArray(fp.files)){
        fp.files.forEach(f=>{
          const url = f.file?.url || f.external?.url || '';
          if(url){
            media.push({ type: guessTypeFromUrl(url), url });
          }
        });
      }
    });

    return { id: pg.id, title, date, owner, platforms, pinned, copy, media };
  });

  return res.status(200).json({
    ok:true,
    posts,
    next_cursor: resp.has_more ? resp.next_cursor : null
  });
}
