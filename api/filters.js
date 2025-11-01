import { Client } from "@notionhq/client";

const {
  NOTION_TOKEN,
  NOTION_DATABASE_ID,     // Content DB
  NOTION_DB_CLIENTS,      // Clients DB
  NOTION_DB_PROJECTS      // Projects DB
} = process.env;

const notion = new Client({ auth: NOTION_TOKEN });

export default async function handler(req, res){
  try{
    if(req.method !== 'GET') return res.status(405).json({ok:false, error:'Method not allowed'});
    if(!NOTION_TOKEN || !NOTION_DATABASE_ID) return res.status(400).json({ok:false, error:'Missing NOTION_TOKEN or NOTION_DATABASE_ID'});

    const { clientId } = req.query;

    // Clients (labels pretty, value uuid)
    let clients = [];
    if(NOTION_DB_CLIENTS){
      const r = await notion.databases.query({ database_id: NOTION_DB_CLIENTS, page_size: 100 });
      clients = r.results.map(p => ({
        id: p.id,
        name: p.properties?.["Client name"]?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || 'Untitled'
      })).sort((a,b)=>a.name.localeCompare(b.name));
    }

    // Projects (optionally scoped by client relation)
    let projects = [];
    if(NOTION_DB_PROJECTS){
      const filter = clientId ? {
        property: "Client",
        relation: { contains: clientId }
      } : undefined;
      const r = await notion.databases.query({ database_id: NOTION_DB_PROJECTS, filter, page_size: 100 });
      projects = r.results.map(p => ({
        id: p.id,
        name: p.properties?.["Project name"]?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || 'Untitled'
      })).sort((a,b)=>a.name.localeCompare(b.name));
    }

    // From Content DB metadata
    const meta = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID });
    const props = meta.properties || {};
    const platforms = (props["Platform"]?.multi_select?.options || []).map(o=>o.name);
    const statuses  = (props["Status"]?.status?.options || []).map(o=>o.name);

    // Owners: sample first 100 pages to collect unique people
    const ownersSet = new Map();
    const pages = await notion.databases.query({ database_id: NOTION_DATABASE_ID, page_size: 100 });
    for(const pg of pages.results){
      const people = pg.properties?.["Owner"]?.people || [];
      for(const person of people){
        if(person && person.id){
          const name = person.name || person.person?.email || 'Unknown';
          ownersSet.set(person.id, name);
        }
      }
    }
    const owners = Array.from(ownersSet, ([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));

    res.json({ ok:true, clients, projects, platforms, owners, statuses });
  }catch(err){
    console.error(err);
    res.status(500).json({ok:false, error:'Failed to load filters'});
  }
}
