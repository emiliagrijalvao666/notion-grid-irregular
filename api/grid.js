import { notion, DB, err, clamp, getDbMeta } from "./_notion.js";
import { detectContentSchema } from "./schema.js";

function guessTypeFromUrl(url=""){
  const u = url.toLowerCase();
  if (/\.(mp4|mov|webm|m4v)\b/.test(u)) return 'video';
  return 'image';
}

export default async function handler(req, res){
  if(req.method !== 'GET') return err(res,405,'Method not allowed');
  if(!DB.content) return err(res,500,'Missing CONTENT_DB_ID');

  const pageSize = clamp(parseInt(req.query.pageSize||'12',10), 6, 24);
  const start = req.query.cursor || undefined;

  const selected = {
    clients:  [].concat(req.query.client  || []),
    projects: [].concat(req.query.project || []),
    platforms:[].concat(req.query.platform|| []),
    owners:   [].concat(req.query.owner   || []),  // IDs
    statuses: [].concat(req.query.status  || [])
  };

  // 1) Detectar llaves de propiedades
  const schema = await detectContentSchema(DB.content);
  if(!schema) return err(res,500,'Cannot read Content DB schema');

  // 2) Leer tipos reales de propiedades (status/select, multi_select, people, relation)
  const meta = await getDbMeta(DB.content);
  if(!meta) return err(res,500,'Cannot read Content DB meta');

  const types = {
    status:   schema.statusKey   ? meta.properties[schema.statusKey]?.type   : null,      // 'status' o 'select'
    platform: schema.platformKey ? meta.properties[schema.platformKey]?.type : null,      // 'multi_select' o 'select'
    owner:    schema.ownerKey    ? meta.properties[schema.ownerKey]?.type    : null,      // 'people'
    client:   schema.clientKey   ? meta.properties[schema.clientKey]?.type   : null,      // 'relation'
    project:  schema.projectKey  ? meta.properties[schema.projectKey]?.type  : null       // 'relation'
  };

  // 3) Construir filtros seguros
  const filters = [];

  if(schema.hideKey){
    filters.push({ property: schema.hideKey, checkbox: { equals:false } });
  }

  if (selected.clients.length && schema.clientKey && types.client === 'relation'){
    filters.push({
      or: selected.clients.map(id => ({
        property: schema.clientKey, relation: { contains: id }
      }))
    });
  }

  if (selected.projects.length && schema.projectKey && types.project === 'relation'){
    filters.push({
      or: selected.projects.map(id => ({
        property: schema.projectKey, relation: { contains: id }
      }))
    });
  }

  if (selected.platforms.length && schema.platformKey){
    if (types.platform === 'multi_select'){
      filters.push({
        or: selected.platforms.map(v => ({
          property: schema.platformKey, multi_select: { contains: v }
        }))
      });
    } else if (types.platform === 'select'){
      filters.push({
        or: selected.platforms.map(v => ({
          property: schema.platformKey, select: { equals: v }
        }))
      });
    }
  }

  if (selected.owners.length && schema.ownerKey && types.owner === 'people'){
    filters.push({
      or: selected.owners.map(id => ({
        property: schema.ownerKey, people: { contains: id } // ¡IDs, no nombres!
      }))
    });
  }

  if (selected.statuses.length && schema.statusKey){
    const v = selected.statuses[0];
    if (types.status === 'status'){
      filters.push({ property: schema.statusKey, status: { equals: v } });
    } else if (types.status === 'select'){
      filters.push({ property: schema.statusKey, select: { equals: v } });
    }
  }

  const query = {
    database_id: DB.content,
    page_size: pageSize,
    start_cursor: start,
    filter: filters.length ? { and: filters } : undefined,
    sorts: [
      ...(schema.pinnedKey ? [{ property: schema.pinnedKey, direction:'descending' }] : []),
      ...(schema.dateKey   ? [{ property: schema.dateKey,   direction:'descending' }] :
                             [{ timestamp:'created_time', direction:'descending' }])
    ]
  };

  let resp;
  try{
    resp = await notion.databases.query(query);
  }catch(e){
    // expón el mensaje para depurar durante pruebas
    return err(res, 400, `Notion query failed: ${e.message||e}`);
  }

  const posts = resp.results.map(pg => {
    const p = pg.properties;
    const title = (p[schema.titleKey]?.title||[]).map(r=>r.plain_text).join('').trim() || 'Untitled';
    const date  = p[schema.dateKey]?.date?.start || pg.created_time;
    const owner = (p[schema.ownerKey]?.people||[])[0]?.name || null;

    let platforms = [];
    const plat = p[schema.platformKey];
    if (plat?.type === 'multi_select') platforms = (plat.multi_select||[]).map(o=>o.name);
    if (plat?.type === 'select' && plat.select) platforms = [plat.select.name];

    const pinned = !!(p[schema.pinnedKey]?.checkbox);

    let copy = '';
    const cprop = p[schema.copyKey];
    if(cprop?.type==='rich_text') copy = (cprop.rich_text||[]).map(r=>r.plain_text).join('').trim();

    const media = [];
    (schema.fileKeys||[]).forEach(k=>{
      const fp = p[k];
      if(fp?.type==='files' && Array.isArray(fp.files)){
        fp.files.forEach(f=>{
          const url = f.file?.url || f.external?.url || '';
          if(url) media.push({ type: guessTypeFromUrl(url), url });
        });
      }
    });

    return { id: pg.id, title, date, owner, platforms, pinned, copy, media };
  });

  return res.status(200).json({ ok:true, posts, next_cursor: resp.has_more ? resp.next_cursor : null });
}
