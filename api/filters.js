import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res){
  try{
    const { NOTION_TOKEN, NOTION_DATABASE_ID, NOTION_DB_CLIENTS, NOTION_DB_PROJECTS } = process.env;
    if(!NOTION_TOKEN || !NOTION_DATABASE_ID) return res.status(200).json({ ok:false, error:"Missing NOTION_TOKEN or NOTION_DATABASE_ID" });

    // Clients
    const clients = await collectAllPages(NOTION_DB_CLIENTS);
    const clientsOut = clients.map(p => ({
      id: p.id,
      name: getTitle(p) || "No name"
    }));

    // Projects (need client relation)
    const projects = await collectAllPages(NOTION_DB_PROJECTS);
    const projectsOut = projects.map(p => ({
      id: p.id,
      name: getPropTitle(p, "Project name") || getTitle(p) || "No name",
      clientIds: (p.properties?.Client?.relation||[]).map(r => r.id)
    }));

    // Platforms options (from DB schema if exists; fallback: scan posts)
    const db = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID });
    const platformProp = db.properties?.Platform;
    let platformsOut = [];
    if(platformProp?.type === 'multi_select'){
      platformsOut = (platformProp.multi_select.options||[]).map(o => ({ name:o.name }));
    }else{
      const posts = await collectAllPages(NOTION_DATABASE_ID, ['Platform']);
      const set = new Set();
      posts.forEach(p => (p.properties?.Platform?.multi_select||[]).forEach(o=>set.add(o.name)));
      platformsOut = Array.from(set).sort().map(name => ({name}));
    }

    // Status options from schema if exists
    const statusProp = db.properties?.Status;
    const statusesOut = statusProp?.type === 'status'
      ? (statusProp.status.options||[]).map(o=>({name:o.name}))
      : [];

    // Owners — scan posts people field
    const ownersSet = new Map(); // id -> name
    const postsForOwners = await collectAllPages(NOTION_DATABASE_ID, ['Owner']);
    postsForOwners.forEach(p=>{
      (p.properties?.Owner?.people||[]).forEach(person=>{
        if(person.id && !ownersSet.has(person.id)){
          ownersSet.set(person.id, person.name || (person.person?.email?.split('@')[0]) || 'Unknown');
        }
      })
    });
    const ownersOut = Array.from(ownersSet, ([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));

    res.status(200).json({ ok:true, clients:clientsOut, projects:projectsOut, platforms:platformsOut, owners:ownersOut, statuses:statusesOut });
  }catch(err){
    res.status(200).json({ ok:false, error: err.message || String(err) });
  }
}

// utils
async function collectAllPages(database_id, onlyProps){
  const out = [];
  let cursor = undefined;
  do{
    const resp = await notion.databases.query({
      database_id, start_cursor: cursor, page_size: 100
    });
    out.push(...resp.results.map(r=>{
      if(onlyProps?.length){
        // keep only those properties if requested
        const props = {};
        for(const k of onlyProps){ if(r.properties?.[k]) props[k] = r.properties[k]; }
        return { id:r.id, properties: props, parent:r.parent };
      }
      return r;
    }));
    cursor = resp.has_more ? resp.next_cursor : undefined;
  }while(cursor);
  return out;
}

function getTitle(page){
  const titleProp = Object.values(page.properties||{}).find(p => p.type==='title');
  return (titleProp?.title?.map(t=>t.plain_text).join('')||'').trim();
}
function getPropTitle(page, name){
  const p = page.properties?.[name];
  return (p?.title?.map(t=>t.plain_text).join('')||'').trim();
}
