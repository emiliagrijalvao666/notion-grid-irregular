import { Client } from "@notionhq/client";

export default async function handler(req, res){
  try{
    const token = process.env.NOTION_TOKEN;
    const DB_CONTENT = process.env.NOTION_DATABASE_ID;
    const DB_CLIENTS = process.env.NOTION_DB_CLIENTS;
    const DB_PROJECTS = process.env.NOTION_DB_PROJECTS;

    if(!token || !DB_CONTENT || !DB_CLIENTS || !DB_PROJECTS){
      return res.status(500).json({ ok:false, error:"Missing NOTION_TOKEN or DB IDs" });
    }

    const notion = new Client({ auth: token });

    // 1) Clients (Name)
    const clients = await collectAllPages(notion, DB_CLIENTS, {}, p => ({
      id: p.id,
      name: getTitle(p, "Name")
    }));

    // 2) Projects (Project name + relation Client)
    const projects = await collectAllPages(notion, DB_PROJECTS, {}, p => ({
      id: p.id,
      name: getTitle(p, "Project name"),
      clientIds: getRelationIds(p, "Client")
    }));

    // 3) Content database properties => Platforms / Status
    const db = await notion.databases.retrieve({ database_id: DB_CONTENT });
    const platforms = (db.properties?.Platform?.multi_select?.options || [])
      .map(o => o.name).sort((a,b)=>a.localeCompare(b,'es'));
    const statuses = (db.properties?.Status?.status?.options || [])
      .map(o => ({ id:o.id, name:o.name })).sort((a,b)=>a.name.localeCompare(b.name,'es'));

    // 4) Owners: muestreamos algunas páginas para sacar people únicos
    const ownersSet = new Map();
    let cursor = undefined;
    do{
      const resp = await notion.databases.query({
        database_id: DB_CONTENT,
        start_cursor: cursor,
        page_size: 50,
        filter: { property: "Archivado", checkbox: { equals: false } }
      });
      resp.results.forEach(pg=>{
        (pg.properties?.Owner?.people || []).forEach(pe => {
          if(pe?.name) ownersSet.set(pe.id, pe.name);
        });
      });
      cursor = resp.has_more ? resp.next_cursor : undefined;
    }while(cursor);

    const owners = Array.from(ownersSet).map(([id,name])=>({id,name}))
      .sort((a,b)=>a.name.localeCompare(b.name,'es'));

    return res.json({ ok:true, clients, projects, platforms, owners, statuses });
  }catch(err){
    return res.status(500).json({ ok:false, error:String(err?.message||err) });
  }
}

/* helpers */
async function collectAllPages(notion, dbId, query, mapFn){
  const out = [];
  let cursor = undefined;
  do{
    const resp = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 50,
      ...query
    });
    resp.results.forEach(p => out.push(mapFn(p)));
    cursor = resp.has_more ? resp.next_cursor : undefined;
  }while(cursor);
  return out.sort((a,b)=> (a.name||"").localeCompare(b.name||"",'es'));
}
function getTitle(page, prop){ return (page.properties?.[prop]?.title?.[0]?.plain_text || "").trim(); }
function getRelationIds(page, prop){ return (page.properties?.[prop]?.relation || []).map(r=>r.id); }
