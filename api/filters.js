import { notion, DB_IDS } from "./_notion.js";
import { PROP, getExistingKey, getTitleFromPage } from "./schema.js";

export default async function handler(req, res){
  try {
    if (req.method !== "GET") return res.status(405).json({ ok:false, error:"Method not allowed" });
    if (!DB_IDS.posts) return res.status(400).json({ ok:false, error:"Missing NOTION_DATABASE_ID" });

    const meta = await notion.databases.retrieve({ database_id: DB_IDS.posts }).catch(()=>null);

    // Detectar claves existentes
    const ownersKey     = meta?.properties?.[PROP.owners] ? PROP.owners : null;
    const platformKey   = getExistingKey(meta, PROP.platformCandidates);
    const clientRelKey  = getExistingKey(meta, PROP.clientRelCandidates);
    const projectRelKey = getExistingKey(meta, PROP.projectRelCandidates);

    // 1) Opciones de esquema
    const statuses = meta?.properties?.[PROP.status]?.status?.options?.map(o=>o.name).filter(Boolean) || [];
    const platforms = platformKey
      ? (meta?.properties?.[platformKey]?.multi_select?.options?.map(o=>o.name).filter(Boolean) || [])
      : [];

    // 2) Recorrer posts (hasta 1000) solo para recopilar owners y relations usados
    const ownersMap = new Map();
    const clientIds = new Set();
    const projectIds = new Set();

    let cursor = undefined;
    for (let i=0;i<10;i++){
      const and = [];
      // no filtro por hide/archivado aquí → propósito es solo recolectar universo de opciones
      const resp = await notion.databases.query({
        database_id: DB_IDS.posts,
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ timestamp:"created_time", direction:"descending" }]
      });

      for (const p of resp.results){
        if (ownersKey){
          (p.properties?.[ownersKey]?.people || [])
            .forEach(pe => ownersMap.set(pe.id, pe.name || pe.person?.email || "Unknown"));
        }
        if (clientRelKey){
          (p.properties?.[clientRelKey]?.relation || []).forEach(r => clientIds.add(r.id));
        }
        if (projectRelKey){
          (p.properties?.[projectRelKey]?.relation || []).forEach(r => projectIds.add(r.id));
        }
      }
      if (!resp.has_more) break;
      cursor = resp.next_cursor;
    }

    // 3) Mapear nombres reales desde DBs
    const clients = DB_IDS.clients
      ? await fetchNames(DB_IDS.clients, Array.from(clientIds))
      : Array.from(clientIds).map(id => ({ id, name:id }));

    const projects = DB_IDS.projects
      ? await fetchProjects(DB_IDS.projects, Array.from(projectIds))
      : Array.from(projectIds).map(id => ({ id, name:id, clientIds:[] }));

    const owners = Array.from(ownersMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a,b)=>a.name.localeCompare(b.name));

    return res.json({ ok:true, platforms, statuses, owners,
      clients: clients.sort((a,b)=>a.name.localeCompare(b.name)),
      projects: projects.sort((a,b)=>a.name.localeCompare(b.name)),
    });

  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message||"filters error" });
  }
}

// Helpers
async function fetchNames(dbId, ids){
  if (!ids.length) return [];
  const out = [];
  let cursor;
  do{
    const resp = await notion.databases.query({ database_id: dbId, page_size:100, start_cursor:cursor });
    for (const p of resp.results){
      if (!ids.includes(p.id)) continue;
      out.push({ id:p.id, name: getTitleFromPage(p) || "Untitled" });
    }
    cursor = resp.has_more ? resp.next_cursor : null;
  } while (cursor);
  return out;
}
async function fetchProjects(dbId, ids){
  if (!ids.length) return [];
  const out = [];
  let cursor;
  do{
    const resp = await notion.databases.query({ database_id: dbId, page_size:100, start_cursor:cursor });
    for (const p of resp.results){
      if (!ids.includes(p.id)) continue;
      const name = getTitleFromPage(p) || "Untitled";
      const rel  = (p.properties?.Client?.relation || p.properties?.Main?.relation || []);
      out.push({ id:p.id, name, clientIds: rel.map(r=>r.id) });
    }
    cursor = resp.has_more ? resp.next_cursor : null;
  } while (cursor);
  return out;
}
