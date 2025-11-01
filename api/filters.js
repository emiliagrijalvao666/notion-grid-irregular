import { notion, DB, err, getDbMeta, getPageTitle } from "./_notion.js";
import { detectContentSchema } from "./schema.js";

export default async function handler(req, res){
  if(req.method !== 'GET') return err(res,405,'Method not allowed');

  if(!DB.content) return err(res,500,'Missing CONTENT_DB_ID');

  // 1) Leer schema de la DB de contenido
  const schema = await detectContentSchema(DB.content);
  if(!schema) return err(res,500,'Cannot read Content DB schema');

  // 2) Platforms / Status directamente desde opciones del schema
  const meta = await getDbMeta(DB.content);
  const platforms = (meta.properties[schema.platformKey]?.multi_select?.options || meta.properties[schema.platformKey]?.select?.options || [])
                     .map(o=>o.name)
                     .filter(Boolean);
  const statuses  = (meta.properties[schema.statusKey]?.status?.options || meta.properties[schema.statusKey]?.select?.options || [])
                     .map(o=>o.name)
                     .filter(Boolean);

  // 3) Owners (únicos) desde páginas: solo IDs y nombres
  const owners = [];
  const ownerSeen = new Set();
  let cursor = undefined;
  for(let safety=0; safety<5; safety++){ // máx 5 páginas por performance
    const resp = await notion.databases.query({
      database_id: DB.content,
      page_size: 50,
      start_cursor: cursor
    });
    for(const r of resp.results){
      const p = r.properties[schema.ownerKey];
      if(p?.type==='people' && Array.isArray(p.people)){
        p.people.forEach(user=>{
          if(!ownerSeen.has(user.id)){
            ownerSeen.add(user.id);
            owners.push({ id:user.id, name: user.name || 'Unknown' });
          }
        });
      }
    }
    if(!resp.has_more) break;
    cursor = resp.next_cursor;
  }

  // 4) Clients desde relación en Content (resolviendo títulos)
  const clients = [];
  const clientSeen = new Map(); // id -> name
  cursor = undefined;
  for(let safety=0; safety<5; safety++){
    const resp = await notion.databases.query({
      database_id: DB.content,
      page_size: 50,
      start_cursor: cursor
    });
    for(const r of resp.results){
      const rel = r.properties[schema.clientKey];
      if(rel?.type==='relation' && Array.isArray(rel.relation)){
        for(const relPg of rel.relation){
          if(!clientSeen.has(relPg.id)){
            clientSeen.set(relPg.id, null);
          }
        }
      }
    }
    if(!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  // Resolver títulos de clientes
  for(const id of clientSeen.keys()){
    const name = await getPageTitle(id);
    clientSeen.set(id, name);
    clients.push({ id, name });
  }

  // 5) Projects: preferir DB de proyectos si existe, si no, desde relación en Content
  const projects = [];
  if(process.env.PROJECTS_DB_ID){
    let pcursor = undefined;
    for(let safety=0; safety<6; safety++){
      const r = await notion.databases.query({
        database_id: process.env.PROJECTS_DB_ID,
        page_size: 50,
        start_cursor: pcursor
      });
      for(const pg of r.results){
        const nameProp = Object.values(pg.properties).find(p=>p.type==='title');
        const name = (nameProp?.title||[]).map(t=>t.plain_text).join('').trim() || 'Untitled';

        const rel = Object.values(pg.properties).find(p=>p.type==='relation'); // Client relation en Projects
        const ids = rel?.relation?.map(x=>x.id) || [];
        projects.push({ id: pg.id, name, clientIds: ids });
      }
      if(!r.has_more) break;
      pcursor = r.next_cursor;
    }
  }else{
    // Derivar desde Content (no ideal pero funciona)
    const tmp = new Map(); // id -> {id,name, clientIds:Set}
    cursor = undefined;
    for(let safety=0; safety<5; safety++){
      const r = await notion.databases.query({
        database_id: DB.content, page_size: 50, start_cursor: cursor
      });
      for(const pg of r.results){
        const proj = pg.properties[schema.projectKey];
        const cli  = pg.properties[schema.clientKey];
        const cIds = cli?.relation?.map(x=>x.id) || [];
        const pRels = proj?.relation || [];
        for(const rel of pRels){
          if(!tmp.has(rel.id)) tmp.set(rel.id, { id: rel.id, name: null, clientIds: new Set() });
          cIds.forEach(id=> tmp.get(rel.id).clientIds.add(id));
        }
      }
      if(!r.has_more) break;
      cursor = r.next_cursor;
    }
    // Resolver nombres
    for(const it of tmp.values()){
      it.name = await getPageTitle(it.id);
      projects.push({ id: it.id, name: it.name, clientIds: Array.from(it.clientIds) });
    }
  }

  return res.status(200).json({
    ok:true,
    platforms, statuses, owners, clients, projects
  });
}
